import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { redis, reddit, context as devvitContext } from '@devvit/web/server';
import {
  analyseContent,
  analyseContentFull,
  getUserStrikes,
  getUserRiskScore,
  checkNewAccountRisk,
  detectCoordinatedAttack,
  updateEmotionalTemperature,
  addStrike,
  alertAllModerators,
  generateEvidenceLog,
  addTimelineEvent,
  executeAutoAction,
} from '../../core/nuke';
import { addToModQueue, removeFromQueue } from '../../services/queueService';
import { logAction } from '../../services/logService';

export const analyseMenu = new Hono();

// ─── Analyse Post + Full AI Pipeline ─────────────────────────────────────────

analyseMenu.post('/analyse-post', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const postId = body.postId ?? body.targetId ?? devvitContext.postId;
    if (!postId) return c.json<UiResponse>({ showToast: 'No post ID found' }, 200);

    const post = await reddit.getPostById(postId);
    const author = post.authorName;

    const [strikeRecord, analysis, accountRisk, attackStatus, riskScore] = await Promise.all([
      getUserStrikes(author),
      Promise.resolve(analyseContent(post.body ?? post.title, post.title)),
      checkNewAccountRisk(author),
      detectCoordinatedAttack(devvitContext.subredditName, author),
      getUserRiskScore(author),
    ]);

    if (attackStatus.isAttack) {
      await alertAllModerators(postId, author, attackStatus.message ?? 'Coordinated attack!');
    }

    if (analysis.severity !== 'none') {
      await updateEmotionalTemperature(devvitContext.subredditName, analysis.severity);
    }

    await redis.set(`modguard:analysis:${postId}`, JSON.stringify({
      postId,
      type: 'post',
      author,
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
        text: `${analysis.removalMessage}\n\n` +
          `⚠️ Strike ${record.count}/5. Ban: ${banInfo.label}\n` +
          `${record.count >= 4 ? '🚨 WARNING: One more = permanent ban!' : 'Please follow community rules.'}\n\n` +
          `Risk Score: ${riskScore.score}/100 (${riskScore.level})\n` +
          `Account Age: ${accountRisk.days} days`,
      });

      if (analysis.requiresImmediateAlert || record.count >= 4 || banInfo.permanent) {
        await alertAllModerators(postId, author, `${analysis.violation} | Risk: ${riskScore.score}/100`);
      }

      const evidence = await generateEvidenceLog(postId, author, analysis, 'AUTO-REMOVED');
      await redis.set(`modguard:evidence:${postId}`, evidence);

      await logAction({
        itemId: postId,
        type: 'post',
        action: 'auto_removed',
        author,
        reason: analysis.violation,
        strikeCount: record.count,
        banApplied: banInfo.label,
        permanent: banInfo.permanent,
        riskScore: riskScore.score,
        evasionDetected: analysis.evasionDetected,
        auto: true,
      });

      await removeFromQueue(postId);

      return c.json<UiResponse>({
        showToast: `🤖 AUTO-REMOVED! ${analysis.violation} (${analysis.confidence}%) | Strike ${record.count}/5 | Ban: ${banInfo.label}${banInfo.permanent ? ' PERMANENT!' : ''}${riskText}${riskWarning}${evasionText}${attackText}`,
      }, 200);
    }

    // AUTO ESCALATE (confidence 70%+)
    if (analysis.confidence >= 70 && analysis.suggestedAction === 'escalate') {
      await alertAllModerators(postId, author, `${analysis.violation} | Risk: ${riskScore.score}/100`);
      await logAction({
        itemId: postId,
        type: 'post',
        action: 'auto_escalated',
        author,
        reason: analysis.violation,
        riskScore: riskScore.score,
        auto: true,
      });

      return c.json<UiResponse>({
        showToast: `⚠️ AUTO-ESCALATED! ${analysis.violation} (${analysis.confidence}%) | Strikes: ${strikeRecord.count}${riskText}${riskWarning}${attackText}`,
      }, 200);
    }

    // AUTO APPROVE
    if (analysis.suggestedAction === 'approve') {
      await post.approve();
      await logAction({
        itemId: postId,
        type: 'post',
        action: 'auto_approved',
        author,
        reason: 'No violation',
        auto: true,
      });

      await removeFromQueue(postId);

      return c.json<UiResponse>({
        showToast: `✅ AUTO-APPROVED! No violation (${analysis.confidence}%) | Strikes: ${strikeRecord.count}${riskText}${riskWarning}`,
      }, 200);
    }

    return c.json<UiResponse>({
      showToast: `⚡ ${analysis.violation} (${analysis.confidence}%) | Suggested: ${analysis.suggestedAction.toUpperCase()} | Strikes: ${strikeRecord.count}${riskText}${riskWarning}${evasionText}${attackText}`,
    }, 200);
  } catch (error) {
    console.error('[ModGuard] analyse-post error:', error);
    return c.json<UiResponse>({ showToast: `Analysis failed: ${String(error)}` }, 200);
  }
});

// ─── Analyse Comment + Full AI Pipeline ──────────────────────────────────────

analyseMenu.post('/analyse-comment', async (c) => {
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
      postId: commentId,
      type: 'comment',
      author,
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

      await logAction({
        itemId: commentId,
        type: 'comment',
        action: 'auto_removed',
        author,
        reason: analysis.violation,
        strikeCount: record.count,
        banApplied: banInfo.label,
        permanent: banInfo.permanent,
        riskScore: riskScore.score,
        evasionDetected: analysis.evasionDetected,
        auto: true,
      });

      await removeFromQueue(commentId);

      return c.json<UiResponse>({
        showToast: `🤖 AUTO-REMOVED! ${analysis.violation} (${analysis.confidence}%) | Strike ${record.count}/5 | Ban: ${banInfo.label}${riskText}${riskWarning}${evasionText}${attackText}`,
      }, 200);
    }

    if (analysis.confidence >= 70 && analysis.suggestedAction === 'escalate') {
      await alertAllModerators(commentId, author, analysis.violation);
      await logAction({
        itemId: commentId,
        type: 'comment',
        action: 'auto_escalated',
        author,
        reason: analysis.violation,
        riskScore: riskScore.score,
        auto: true,
      });

      return c.json<UiResponse>({
        showToast: `⚠️ AUTO-ESCALATED! ${analysis.violation} (${analysis.confidence}%) | Strikes: ${strikeRecord.count}${riskText}${riskWarning}`,
      }, 200);
    }

    if (analysis.suggestedAction === 'approve') {
      await logAction({
        itemId: commentId,
        type: 'comment',
        action: 'auto_approved',
        author,
        reason: 'No violation',
        auto: true,
      });

      return c.json<UiResponse>({
        showToast: `✅ No violation (${analysis.confidence}%) | Strikes: ${strikeRecord.count}${riskText}${riskWarning}`,
      }, 200);
    }

    return c.json<UiResponse>({
      showToast: `⚡ ${analysis.violation} (${analysis.confidence}%) | ${analysis.suggestedAction.toUpperCase()}${riskText}${evasionText}`,
    }, 200);
  } catch (error) {
    console.error('[ModGuard] analyse-comment error:', error);
    return c.json<UiResponse>({ showToast: `Analysis failed: ${String(error)}` }, 200);
  }
});

// ─── Full AI Analysis v2 (post) ─────────────────────────────────────────────

analyseMenu.post('/analyse-post-v2', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const postId = body.postId ?? body.targetId ?? devvitContext.postId;
    if (!postId) return c.json<UiResponse>({ showToast: 'No post ID found' }, 200);

    const post = await reddit.getPostById(postId);
    const author = post.authorName;
    const analysis = await analyseContentFull(post.body ?? post.title, post.title, author);

    await redis.set(`modguard:analysis:${postId}`, JSON.stringify({
      postId,
      type: 'post',
      author,
      title: post.title,
      content: post.body ?? post.title,
      subreddit: post.subredditName,
      createdAt: new Date().toISOString(),
      ...analysis,
    }));

    await addToModQueue(postId);

    await executeAutoAction(postId, author, analysis, false);

    await addTimelineEvent({
      type: 'detection',
      message: `Full pipeline analysis: ${analysis.violation} (${analysis.confidence}%) — u/${author}`,
      severity: analysis.severity === 'critical' ? 'critical' : analysis.severity === 'high' ? 'warning' : 'info',
      actor: author,
      auto: true,
    });

    const contextNote = analysis.contextNote ? ` | ${analysis.contextNote}` : '';
    const memNote = analysis.memoryInsight ? ` | 🧠 ${analysis.memoryInsight}` : '';
    const langNote = analysis.language && analysis.language !== 'en' && analysis.language !== 'unknown' ? ` | Lang: ${analysis.language}` : '';
    const actionedNote = analysis.autoAction || analysis.suggestedAction === 'approve' ? ' | ✅ Auto-actioned' : '';

    return c.json<UiResponse>({
      showToast: `⚡ ${analysis.violation} (${analysis.confidence}%) | Risk: ${analysis.riskScore ?? 0}/100 | ${analysis.suggestedAction.toUpperCase()}${contextNote}${memNote}${langNote}${actionedNote}`,
    }, 200);
  } catch (error) {
    return c.json<UiResponse>({ showToast: `Analysis v2 failed: ${String(error)}` }, 200);
  }
});

