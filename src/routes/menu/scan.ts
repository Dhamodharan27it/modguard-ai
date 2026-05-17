import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { redis, reddit, context as devvitContext } from '@devvit/web/server';
import {
  analyseContent,
  getUserStrikes,
  checkNewAccountRisk,
  getUserRiskScore,
  detectCoordinatedAttack,
  updateEmotionalTemperature,
  addStrike,
  alertAllModerators,
  getCommunityHealthScore,
} from '../../core/nuke';
import { addToModQueue } from '../../services/queueService';
import { logAction } from '../../services/logService';

export const scanMenu = new Hono();

scanMenu.post('/scan-all', async (c) => {
  try {
    const posts = await reddit.getUnmoderated({
      subreddit: devvitContext.subredditName,
      type: 'post',
      limit: 10,
    });

    let scanned = 0,
      removed = 0,
      approved = 0,
      escalated = 0,
      highRisk = 0;

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
        postId: post.id,
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

        await logAction({
          itemId: post.id,
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

        removed++;
      } else if (analysis.suggestedAction === 'escalate') {
        await alertAllModerators(post.id, author, analysis.violation);
        escalated++;
      } else if (analysis.suggestedAction === 'approve') {
        await post.approve();
        await logAction({
          itemId: post.id,
          type: 'post',
          action: 'auto_approved',
          author,
          reason: 'No violation',
          auto: true,
        });
        approved++;
      }
    }

    const health = await getCommunityHealthScore(devvitContext.subredditName);

    return c.json<UiResponse>({
      showToast: `🔍 Scan Done! ${scanned} posts | ✕${removed} removed | ✓${approved} approved | ⚠${escalated} escalated | 🔴${highRisk} high-risk | Health: ${health.score}% (${health.grade})`,
    }, 200);
  } catch (error) {
    console.error('[ModGuard] scan-all error:', error);
    return c.json<UiResponse>({ showToast: `Scan failed: ${String(error)}` }, 200);
  }
});

