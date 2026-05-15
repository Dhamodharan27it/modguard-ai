import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { EntrypointHeight } from '@devvit/protos/json/reddit/devvit/post/v1/post.js';
import { redis, reddit, context as devvitContext } from '@devvit/web/server';
import {
  analyseContent,
  analyseContentFull,
  getUserStrikes,
  addStrike,
  alertAllModerators,
  checkNewAccountRisk,
  detectCoordinatedAttack,
  getCommunityHealthScore,
  getUserRiskScore,
  getModeratorCopilotReport,
  generateEvidenceLog,
  updateEmotionalTemperature,
  predictThreat,
  getSlowModeRecommendation,
  addTimelineEvent,
  addToWatchlist,
  addModNote,
} from '../core/nuke';

/** One custom post per subreddit hosts the Devvit Web dashboard (real Reddit URL). */
const dashboardPostRedisKey = (subredditName: string) =>
  `modguard:dashboard_post:${subredditName}`;

function absoluteRedditUrlFromPost(post: { url: string; permalink: string }): string {
  const raw = post.url?.trim() ?? '';
  if (raw && /^https?:\/\//i.test(raw)) {
    return new URL(raw).href;
  }
  const path = post.permalink.startsWith('/') ? post.permalink : `/${post.permalink}`;
  return new URL(path, 'https://www.reddit.com').href;
}

async function getOrCreateDashboardPost(subredditName: string) {
  const key = dashboardPostRedisKey(subredditName);
  const storedId = await redis.get(key);
  if (storedId) {
    try {
      const fullname = (storedId.startsWith('t3_')
        ? storedId
        : `t3_${storedId}`) as `t3_${string}`;
      const existing = await reddit.getPostById(fullname);
      if (existing && !existing.removed) {
        return existing;
      }
    } catch {
      // stale id — create a new dashboard post
    }
  }

  const post = await reddit.submitCustomPost({
    subredditName,
    title: 'ModGuard AI — moderator dashboard',
    entry: 'default',
    textFallback: {
      text: 'This post opens the ModGuard AI dashboard for moderators.',
    },
    styles: {
      height: EntrypointHeight.TALL,
      backgroundColor: '#00000000',
      backgroundColorDark: '#0D1117FF',
    },
  });

  await redis.set(key, post.id);
  try {
    await post.sticky(1);
  } catch (e) {
    console.warn('[ModGuard] Could not sticky dashboard post:', e);
  }
  return post;
}

export const menu = new Hono();

// ─── Analyse Post + Full AI Pipeline ─────────────────────────────────────────

menu.post('/analyse-post', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const postId = body.postId ?? body.targetId ?? devvitContext.postId;
    if (!postId) return c.json<UiResponse>({ showToast: 'No post ID found' }, 200);

    const post = await reddit.getPostById(postId);
    const author = post.authorName;

    // Full AI Pipeline
    const [strikeRecord, analysis, accountRisk, attackStatus, riskScore] = await Promise.all([
      getUserStrikes(author),
      Promise.resolve(analyseContent(post.body ?? post.title, post.title)),
      checkNewAccountRisk(author),
      detectCoordinatedAttack(devvitContext.subredditName, author),
      getUserRiskScore(author),
    ]);

    // Alert if coordinated attack
    if (attackStatus.isAttack) {
      await alertAllModerators(postId, author, attackStatus.message ?? 'Coordinated attack!');
    }

    // Update emotional temperature
    if (analysis.severity !== 'none') {
      await updateEmotionalTemperature(devvitContext.subredditName, analysis.severity);
    }

    // Save analysis
    await redis.set(`modguard:analysis:${postId}`, JSON.stringify({
      postId, type: 'post', author,
      title: post.title,
      content: post.body ?? post.title,
      subreddit: post.subredditName,
      createdAt: new Date().toISOString(),
      existingStrikes: strikeRecord.count,
      riskScore: riskScore.score,
      riskLevel: riskScore.level,
      accountAge: accountRisk.days,
      evasionDetected: analysis.evasionDetected,
      ...analysis,
    }));

    await addToModQueue(postId);

    // Build warning strings
    const riskText = riskScore.score > 40 ? ` | Risk: ${riskScore.score}/100 (${riskScore.level})` : '';
    const riskWarning = accountRisk.warning ? ` | ${accountRisk.warning}` : '';
    const evasionText = analysis.evasionDetected ? ' | ⚠️ EVASION DETECTED!' : '';
    const attackText = attackStatus.message ? ` | ${attackStatus.message}` : '';

    // AUTO REMOVE (confidence 90%+)
    if (analysis.confidence >= 90 && analysis.suggestedAction === 'remove') {
      await post.remove();
      const { record, banInfo } = await addStrike(author, analysis.violation, analysis.category, postId);

      await reddit.sendPrivateMessage({
        to: author,
        subject: `Your post was removed from r/${devvitContext.subredditName}`,
        text:
          `${analysis.removalMessage}\n\n` +
          `⚠️ Strike ${record.count}/5. Ban: ${banInfo.label}\n` +
          `${record.count >= 4 ? '🚨 WARNING: One more = permanent ban!' : 'Please follow community rules.'}\n\n` +
          `Risk Score: ${riskScore.score}/100 (${riskScore.level})\n` +
          `Account Age: ${accountRisk.days} days`,
      });

      if (analysis.requiresImmediateAlert || record.count >= 4 || banInfo.permanent) {
        await alertAllModerators(postId, author, `${analysis.violation} | Risk: ${riskScore.score}/100`);
      }

      // Generate evidence log
      const evidence = await generateEvidenceLog(postId, author, analysis, 'AUTO-REMOVED');
      await redis.set(`modguard:evidence:${postId}`, evidence);

      await logAction({
        itemId: postId, type: 'post', action: 'auto_removed',
        author, reason: analysis.violation,
        strikeCount: record.count, banApplied: banInfo.label,
        permanent: banInfo.permanent,
        riskScore: riskScore.score,
        evasionDetected: analysis.evasionDetected,
        auto: true,
      });
      await removeFromQueue(postId);

      return c.json<UiResponse>({
        showToast: `🤖 AUTO-REMOVED! ${analysis.violation} (${analysis.confidence}%) | Strike ${record.count}/5 | Ban: ${banInfo.label}${banInfo.permanent ? ' PERMANENT!' : ''}${riskText}${riskWarning}${evasionText}${attackText}`
      }, 200);
    }

    // AUTO ESCALATE (confidence 70%+)
    if (analysis.confidence >= 70 && analysis.suggestedAction === 'escalate') {
      await alertAllModerators(postId, author, `${analysis.violation} | Risk: ${riskScore.score}/100`);
      await logAction({
        itemId: postId, type: 'post', action: 'auto_escalated',
        author, reason: analysis.violation,
        riskScore: riskScore.score, auto: true,
      });
      return c.json<UiResponse>({
        showToast: `⚠️ AUTO-ESCALATED! ${analysis.violation} (${analysis.confidence}%) | Strikes: ${strikeRecord.count}${riskText}${riskWarning}${attackText}`
      }, 200);
    }

    // AUTO APPROVE
    if (analysis.suggestedAction === 'approve') {
      await post.approve();
      await logAction({
        itemId: postId, type: 'post', action: 'auto_approved',
        author, reason: 'No violation', auto: true,
      });
      await removeFromQueue(postId);
      return c.json<UiResponse>({
        showToast: `✅ AUTO-APPROVED! No violation (${analysis.confidence}%) | Strikes: ${strikeRecord.count}${riskText}${riskWarning}`
      }, 200);
    }

    return c.json<UiResponse>({
      showToast: `⚡ ${analysis.violation} (${analysis.confidence}%) | Suggested: ${analysis.suggestedAction.toUpperCase()} | Strikes: ${strikeRecord.count}${riskText}${riskWarning}${evasionText}`
    }, 200);

  } catch (error) {
    console.error('[ModGuard] analyse-post error:', error);
    return c.json<UiResponse>({ showToast: `Analysis failed: ${String(error)}` }, 200);
  }
});

// ─── Analyse Comment + Full AI Pipeline ──────────────────────────────────────

menu.post('/analyse-comment', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const commentId = body.commentId ?? body.targetId ?? devvitContext.commentId;
    if (!commentId) return c.json<UiResponse>({ showToast: 'No comment ID found' }, 200);

    const comment = await reddit.getCommentById(commentId);
    const author = comment.authorName;

    const [strikeRecord, analysis, accountRisk, attackStatus, riskScore] = await Promise.all([
      getUserStrikes(author),
      Promise.resolve(analyseContent(comment.body)),
      checkNewAccountRisk(author),
      detectCoordinatedAttack(devvitContext.subredditName, author),
      getUserRiskScore(author),
    ]);

    if (attackStatus.isAttack) {
      await alertAllModerators(commentId, author, attackStatus.message ?? 'Coordinated attack!');
    }

    if (analysis.severity !== 'none') {
      await updateEmotionalTemperature(devvitContext.subredditName, analysis.severity);
    }

    await redis.set(`modguard:analysis:${commentId}`, JSON.stringify({
      postId: commentId, type: 'comment', author,
      content: comment.body,
      subreddit: comment.subredditName,
      createdAt: new Date().toISOString(),
      existingStrikes: strikeRecord.count,
      riskScore: riskScore.score,
      riskLevel: riskScore.level,
      accountAge: accountRisk.days,
      evasionDetected: analysis.evasionDetected,
      ...analysis,
    }));

    await addToModQueue(commentId);

    const riskText = riskScore.score > 40 ? ` | Risk: ${riskScore.score}/100 (${riskScore.level})` : '';
    const riskWarning = accountRisk.warning ? ` | ${accountRisk.warning}` : '';
    const evasionText = analysis.evasionDetected ? ' | ⚠️ EVASION!' : '';
    const attackText = attackStatus.message ? ` | ${attackStatus.message}` : '';

    if (analysis.confidence >= 90 && analysis.suggestedAction === 'remove') {
      await comment.remove();
      const { record, banInfo } = await addStrike(author, analysis.violation, analysis.category, commentId);
      await reddit.sendPrivateMessage({
        to: author,
        subject: `Your comment was removed from r/${devvitContext.subredditName}`,
        text: `${analysis.removalMessage}\n\nStrike ${record.count}/5. Ban: ${banInfo.label}`,
      });
      if (analysis.requiresImmediateAlert || record.count >= 4 || banInfo.permanent) {
        await alertAllModerators(commentId, author, analysis.violation);
      }
      const evidence = await generateEvidenceLog(commentId, author, analysis, 'AUTO-REMOVED');
      await redis.set(`modguard:evidence:${commentId}`, evidence);
      await logAction({ itemId: commentId, type: 'comment', action: 'auto_removed', author, reason: analysis.violation, strikeCount: record.count, banApplied: banInfo.label, permanent: banInfo.permanent, riskScore: riskScore.score, evasionDetected: analysis.evasionDetected, auto: true });
      await removeFromQueue(commentId);
      return c.json<UiResponse>({ showToast: `🤖 AUTO-REMOVED! ${analysis.violation} (${analysis.confidence}%) | Strike ${record.count}/5 | Ban: ${banInfo.label}${riskText}${riskWarning}${evasionText}${attackText}` }, 200);
    }

    if (analysis.confidence >= 70 && analysis.suggestedAction === 'escalate') {
      await alertAllModerators(commentId, author, analysis.violation);
      await logAction({ itemId: commentId, type: 'comment', action: 'auto_escalated', author, reason: analysis.violation, riskScore: riskScore.score, auto: true });
      return c.json<UiResponse>({ showToast: `⚠️ AUTO-ESCALATED! ${analysis.violation} (${analysis.confidence}%) | Strikes: ${strikeRecord.count}${riskText}${riskWarning}` }, 200);
    }

    if (analysis.suggestedAction === 'approve') {
      await logAction({ itemId: commentId, type: 'comment', action: 'auto_approved', author, reason: 'No violation', auto: true });
      return c.json<UiResponse>({ showToast: `✅ No violation (${analysis.confidence}%) | Strikes: ${strikeRecord.count}${riskText}${riskWarning}` }, 200);
    }

    return c.json<UiResponse>({ showToast: `⚡ ${analysis.violation} (${analysis.confidence}%) | ${analysis.suggestedAction.toUpperCase()}${riskText}${evasionText}` }, 200);

  } catch (error) {
    console.error('[ModGuard] analyse-comment error:', error);
    return c.json<UiResponse>({ showToast: `Analysis failed: ${String(error)}` }, 200);
  }
});

// ─── Remove Post ──────────────────────────────────────────────────────────────

menu.post('/remove-post', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const postId = body.postId ?? body.targetId ?? devvitContext.postId;
    const reason = body.reason ?? 'Removed for violating community rules.';
    if (!postId) return c.json<UiResponse>({ showToast: 'No post ID found' }, 200);
    const post = await reddit.getPostById(postId);
    const author = post.authorName;
    await post.remove();
    const { record, banInfo } = await addStrike(author, reason, 'harassment', postId);
    const riskScore = await getUserRiskScore(author);
    await reddit.sendPrivateMessage({
      to: author,
      subject: `Your post was removed from r/${devvitContext.subredditName}`,
      text: `${reason}\n\nStrike ${record.count}/5. Ban: ${banInfo.label}\n\n${record.count >= 4 ? 'WARNING: One more = permanent ban.' : 'Please follow community rules.'}\n\nRisk Score: ${riskScore.score}/100`,
    });
    if (record.count >= 4 || banInfo.permanent) {
      await alertAllModerators(postId, author, `Manual remove. Strike ${record.count}/5. Risk: ${riskScore.score}/100`);
    }
    await updateEmotionalTemperature(devvitContext.subredditName, 'high');
    await logAction({ itemId: postId, type: 'post', action: 'removed', author, reason, strikeCount: record.count, banApplied: banInfo.label, permanent: banInfo.permanent, riskScore: riskScore.score, auto: false });
    await removeFromQueue(postId);
    return c.json<UiResponse>({ showToast: `✕ Removed! Strike ${record.count}/5 → u/${author} | Ban: ${banInfo.label}${banInfo.permanent ? ' PERMANENT!' : ''} | Risk: ${riskScore.score}/100` }, 200);
  } catch (error) {
    console.error('[ModGuard] remove-post error:', error);
    return c.json<UiResponse>({ showToast: `Remove failed: ${String(error)}` }, 200);
  }
});

// ─── Remove Comment ───────────────────────────────────────────────────────────

menu.post('/remove-comment', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const commentId = body.commentId ?? body.targetId ?? devvitContext.commentId;
    const reason = body.reason ?? 'Removed for violating community rules.';
    if (!commentId) return c.json<UiResponse>({ showToast: 'No comment ID found' }, 200);
    const comment = await reddit.getCommentById(commentId);
    const author = comment.authorName;
    await comment.remove();
    const { record, banInfo } = await addStrike(author, reason, 'harassment', commentId);
    await reddit.sendPrivateMessage({
      to: author,
      subject: `Your comment was removed from r/${devvitContext.subredditName}`,
      text: `${reason}\n\nStrike ${record.count}/5. Ban: ${banInfo.label}`,
    });
    if (record.count >= 4 || banInfo.permanent) {
      await alertAllModerators(commentId, author, `Strike ${record.count}/5.`);
    }
    await updateEmotionalTemperature(devvitContext.subredditName, 'medium');
    await logAction({ itemId: commentId, type: 'comment', action: 'removed', author, reason, strikeCount: record.count, banApplied: banInfo.label, permanent: banInfo.permanent, auto: false });
    await removeFromQueue(commentId);
    return c.json<UiResponse>({ showToast: `✕ Comment removed! Strike ${record.count}/5 → u/${author} | Ban: ${banInfo.label}` }, 200);
  } catch (error) {
    console.error('[ModGuard] remove-comment error:', error);
    return c.json<UiResponse>({ showToast: `Remove failed: ${String(error)}` }, 200);
  }
});

// ─── Approve Post ─────────────────────────────────────────────────────────────

menu.post('/approve-post', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const postId = body.postId ?? body.targetId ?? devvitContext.postId;
    if (!postId) return c.json<UiResponse>({ showToast: 'No post ID found' }, 200);
    const post = await reddit.getPostById(postId);
    await post.approve();
    await logAction({ itemId: postId, type: 'post', action: 'approved', author: post.authorName, reason: 'No violation', auto: false });
    await removeFromQueue(postId);
    return c.json<UiResponse>({ showToast: '✓ Post approved!' }, 200);
  } catch (error) {
    return c.json<UiResponse>({ showToast: `Approve failed: ${String(error)}` }, 200);
  }
});

// ─── Escalate Post ────────────────────────────────────────────────────────────

menu.post('/escalate-post', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const postId = body.postId ?? body.targetId ?? devvitContext.postId;
    const reason = body.reason ?? 'Escalated for senior review.';
    if (!postId) return c.json<UiResponse>({ showToast: 'No post ID found' }, 200);
    const post = await reddit.getPostById(postId);
    await alertAllModerators(postId, post.authorName, `Escalated: ${reason}`);
    await logAction({ itemId: postId, type: 'post', action: 'escalated', author: post.authorName, reason, auto: false });
    await removeFromQueue(postId);
    return c.json<UiResponse>({ showToast: '⚠️ Escalated to senior moderators!' }, 200);
  } catch (error) {
    return c.json<UiResponse>({ showToast: `Escalate failed: ${String(error)}` }, 200);
  }
});

// ─── Ban User ─────────────────────────────────────────────────────────────────

menu.post('/ban-user', async (c) => {
  try {
    const { username, reason, days } = await c.req.json();
    await reddit.banUser({
      subredditName: devvitContext.subredditName,
      username, reason,
      duration: days ?? 0,
      message: days === 0 ? `Permanently banned. Reason: ${reason}` : `Banned for ${days} days. Reason: ${reason}`,
    });
    await logAction({ itemId: 'manual-ban', action: 'ban', author: username, reason, permanent: days === 0, auto: false });
    return c.json<UiResponse>({ showToast: `⊘ u/${username} banned!` }, 200);
  } catch (error) {
    return c.json<UiResponse>({ showToast: `Ban failed: ${String(error)}` }, 200);
  }
});

// ─── AI Copilot Report ────────────────────────────────────────────────────────

menu.post('/copilot-report', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const postId = body.postId ?? body.targetId ?? devvitContext.postId;
    if (!postId) return c.json<UiResponse>({ showToast: 'No post ID found' }, 200);
    const post = await reddit.getPostById(postId);
    const author = post.authorName;
    const [report, riskScore] = await Promise.all([
      getModeratorCopilotReport(author),
      getUserRiskScore(author),
    ]);
    await reddit.sendPrivateMessage({
      to: devvitContext.userId ?? '',
      subject: `🤖 ModGuard AI Copilot — u/${author}`,
      text: report,
    });
    return c.json<UiResponse>({ showToast: `🤖 Copilot: u/${author} | Risk: ${riskScore.score}/100 (${riskScore.level}) | Check inbox!` }, 200);
  } catch (error) {
    console.error('[ModGuard] copilot-report error:', error);
    return c.json<UiResponse>({ showToast: `Copilot failed: ${String(error)}` }, 200);
  }
});

// ─── Scan All Posts ───────────────────────────────────────────────────────────

menu.post('/scan-all', async (c) => {
  try {
    const posts = await reddit.getUnmoderated({
      subreddit: devvitContext.subredditName,
      type: 'post',
      limit: 10,
    });

    let scanned = 0, removed = 0, approved = 0, escalated = 0, highRisk = 0;

    for await (const post of posts) {
      const author = post.authorName;
      const analysis = analyseContent(post.body ?? post.title, post.title);
      const [strikeRecord, accountRisk, riskScore] = await Promise.all([
        getUserStrikes(author),
        checkNewAccountRisk(author),
        getUserRiskScore(author),
      ]);

      await detectCoordinatedAttack(devvitContext.subredditName, author);

      if (riskScore.score >= 60) highRisk++;

      if (analysis.severity !== 'none') {
        await updateEmotionalTemperature(devvitContext.subredditName, analysis.severity);
      }

      await redis.set(`modguard:analysis:${post.id}`, JSON.stringify({
        postId: post.id, type: 'post', author,
        title: post.title,
        content: post.body ?? post.title,
        subreddit: post.subredditName,
        createdAt: new Date().toISOString(),
        existingStrikes: strikeRecord.count,
        riskScore: riskScore.score,
        riskLevel: riskScore.level,
        accountAge: accountRisk.days,
        evasionDetected: analysis.evasionDetected,
        autoDetected: true,
        ...analysis,
      }));

      await addToModQueue(post.id);
      scanned++;

      if (analysis.confidence >= 90 && analysis.suggestedAction === 'remove') {
        await post.remove();
        const { record, banInfo } = await addStrike(author, analysis.violation, analysis.category, post.id);
        await reddit.sendPrivateMessage({
          to: author,
          subject: `Your post was removed from r/${devvitContext.subredditName}`,
          text: `${analysis.removalMessage}\n\nStrike ${record.count}/5. Ban: ${banInfo.label}`,
        });
        if (analysis.requiresImmediateAlert || record.count >= 4) {
          await alertAllModerators(post.id, author, analysis.violation);
        }
        await logAction({ itemId: post.id, type: 'post', action: 'auto_removed', author, reason: analysis.violation, strikeCount: record.count, banApplied: banInfo.label, permanent: banInfo.permanent, riskScore: riskScore.score, evasionDetected: analysis.evasionDetected, auto: true });
        removed++;
      } else if (analysis.suggestedAction === 'escalate') {
        await alertAllModerators(post.id, author, analysis.violation);
        escalated++;
      } else if (analysis.suggestedAction === 'approve') {
        await post.approve();
        await logAction({ itemId: post.id, type: 'post', action: 'auto_approved', author, reason: 'No violation', auto: true });
        approved++;
      }
    }

    const health = await getCommunityHealthScore(devvitContext.subredditName);

    return c.json<UiResponse>({
      showToast: `🔍 Scan Done! ${scanned} posts | ✕${removed} removed | ✓${approved} approved | ⚠${escalated} escalated | 🔴${highRisk} high-risk | Health: ${health.score}% (${health.grade})`
    }, 200);

  } catch (error) {
    console.error('[ModGuard] scan-all error:', error);
    return c.json<UiResponse>({ showToast: `Scan failed: ${String(error)}` }, 200);
  }
});

// ─── Dashboard (Blocks-based Alternative) ─────────────────────────────────
menu.post('/dashboard-blocks', async (c) => {
  try {
    const health = await getCommunityHealthScore(devvitContext.subredditName).catch(() => ({ score: 85, grade: 'A', summary: 'Healthy' }));
    const threat = await predictThreat(devvitContext.subredditName).catch(() => ({ threatLevel: 'low', probability: 10 }));
    const threatEmoji = threat.threatLevel === 'imminent' ? '🚨' : threat.threatLevel === 'high' ? '⚠️' : threat.threatLevel === 'elevated' ? '📊' : '✅';

    return c.json<UiResponse>({
      showToast: `📊 Dashboard | Health: ${health.score}% ${health.grade} | ${threatEmoji} Threat: ${threat.threatLevel.toUpperCase()} | Features: Queue, Insights, Threat Detection, Appeals, Watchlist, Team Collab, Transparency`,
    }, 200);
  } catch (error) {
    console.error('[ModGuard] Dashboard blocks error:', error);
    return c.json<UiResponse>({
      showToast: `📊 Dashboard Ready | Features: Queue, Insights, Threat Detection, Appeals, Watchlist, Team Collab, Transparency`,
    }, 200);
  }
});

menu.post('/open-dashboard', async (c) => {
  try {
    let health = { score: 75, grade: 'B' };
    let threat = { threatLevel: 'low', probability: 10 };

    try {
      health = await getCommunityHealthScore(devvitContext.subredditName);
    } catch (e) {
      console.error('[ModGuard] Health score error:', e);
    }

    try {
      threat = await predictThreat(devvitContext.subredditName);
    } catch (e) {
      console.error('[ModGuard] Threat prediction error:', e);
    }

    const threatEmoji = threat.threatLevel === 'imminent' ? '🚨'
      : threat.threatLevel === 'high' ? '⚠️'
      : threat.threatLevel === 'elevated' ? '📊'
      : '✅';

    const sub = devvitContext.subredditName;
    const dashboardPost = await getOrCreateDashboardPost(sub);
    const dashboardUrl = absoluteRedditUrlFromPost(dashboardPost);
    return c.json<UiResponse>({
      navigateTo: dashboardUrl,
      showToast: `📊 Health: ${health.score}% (${health.grade}) | ${threatEmoji} Threat: ${threat.threatLevel.toUpperCase()} | Opening dashboard`,
    }, 200);
  } catch (error) {
    console.error('[ModGuard] Dashboard error:', error);
    return c.json<UiResponse>({
      showToast: `📊 ModGuard Dashboard Ready`,
    }, 200);
  }
});

// ─── Get User Strikes ─────────────────────────────────────────────────────────

menu.get('/user-strikes/:username', async (c) => {
  try {
    const username = c.req.param('username');
    const record = await getUserStrikes(username);
    return c.json({ success: true, record });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// ─── Threat Prediction ────────────────────────────────────────────────────────

menu.post('/predict-threat', async (c) => {
  try {
    const threat = await predictThreat(devvitContext.subredditName);
    const slowMode = await getSlowModeRecommendation(devvitContext.subredditName, threat);
    const msg = threat.warning
      ? `${threat.warning}${slowMode.shouldActivate ? ` | Recommend: ${slowMode.mode.toUpperCase()} MODE` : ''}`
      : `✅ No threat detected (${threat.probability}% probability)`;
    return c.json<UiResponse>({ showToast: msg }, 200);
  } catch (error) {
    return c.json<UiResponse>({ showToast: `Threat check failed: ${String(error)}` }, 200);
  }
});

// ─── Full AI Analysis v2 (post) ───────────────────────────────────────────────

menu.post('/analyse-post-v2', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const postId = body.postId ?? body.targetId ?? devvitContext.postId;
    if (!postId) return c.json<UiResponse>({ showToast: 'No post ID found' }, 200);

    const post = await reddit.getPostById(postId);
    const author = post.authorName;
    const analysis = await analyseContentFull(post.body ?? post.title, post.title, author);

    await redis.set(`modguard:analysis:${postId}`, JSON.stringify({
      postId, type: 'post', author, title: post.title,
      content: post.body ?? post.title, subreddit: post.subredditName,
      createdAt: new Date().toISOString(), ...analysis,
    }));
    await addToModQueue(postId);

    await addTimelineEvent({ type: 'detection', message: `Full pipeline analysis: ${analysis.violation} (${analysis.confidence}%) — u/${author}`, severity: analysis.severity === 'critical' ? 'critical' : analysis.severity === 'high' ? 'warning' : 'info', actor: author, auto: true });

    const contextNote = analysis.contextNote ? ` | ${analysis.contextNote}` : '';
    const memNote = analysis.memoryInsight ? ` | 🧠 ${analysis.memoryInsight}` : '';
    const langNote = analysis.language && analysis.language !== 'en' && analysis.language !== 'unknown' ? ` | Lang: ${analysis.language}` : '';

    return c.json<UiResponse>({
      showToast: `⚡ ${analysis.violation} (${analysis.confidence}%) | Risk: ${analysis.riskScore ?? 0}/100 | ${analysis.suggestedAction.toUpperCase()}${contextNote}${memNote}${langNote}`
    }, 200);
  } catch (error) {
    return c.json<UiResponse>({ showToast: `Analysis v2 failed: ${String(error)}` }, 200);
  }
});

// ─── Watchlist Add ────────────────────────────────────────────────────────────

menu.post('/watchlist-add', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const postId = body.postId ?? body.targetId ?? devvitContext.postId;
    if (!postId) return c.json<UiResponse>({ showToast: 'No post ID found' }, 200);
    const post = await reddit.getPostById(postId);
    await addToWatchlist(post.authorName, 'Flagged by moderator');
    return c.json<UiResponse>({ showToast: `👁 u/${post.authorName} added to watchlist` }, 200);
  } catch (error) {
    return c.json<UiResponse>({ showToast: `Watchlist failed: ${String(error)}` }, 200);
  }
});

// ─── Add Mod Note ─────────────────────────────────────────────────────────────

menu.post('/add-note', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const postId = body.postId ?? body.targetId ?? devvitContext.postId;
    const note = body.note ?? 'Flagged for review';
    if (!postId) return c.json<UiResponse>({ showToast: 'No post ID found' }, 200);
    const post = await reddit.getPostById(postId);
    await addModNote(post.authorName, note);
    return c.json<UiResponse>({ showToast: `📝 Note added for u/${post.authorName}` }, 200);
  } catch (error) {
    return c.json<UiResponse>({ showToast: `Note failed: ${String(error)}` }, 200);
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function addToModQueue(itemId: string) {
  const queueKey = `modguard:queue:${devvitContext.subredditName}`;
  const existing = await redis.get(queueKey);
  const queue: string[] = existing ? JSON.parse(existing) : [];
  if (!queue.includes(itemId)) {
    queue.unshift(itemId);
    await redis.set(queueKey, JSON.stringify(queue.slice(0, 50)));
  }
}

async function removeFromQueue(itemId: string) {
  const queueKey = `modguard:queue:${devvitContext.subredditName}`;
  const existing = await redis.get(queueKey);
  const queue: string[] = existing ? JSON.parse(existing) : [];
  await redis.set(queueKey, JSON.stringify(queue.filter(id => id !== itemId)));
}

async function logAction(data: object) {
  const logKey = `modguard:log:${devvitContext.subredditName}`;
  const logRaw = await redis.get(logKey);
  const logs: object[] = logRaw ? JSON.parse(logRaw) : [];
  logs.unshift({ ...data, timestamp: new Date().toISOString(), moderator: devvitContext.userId });
  await redis.set(logKey, JSON.stringify(logs.slice(0, 100)));
}