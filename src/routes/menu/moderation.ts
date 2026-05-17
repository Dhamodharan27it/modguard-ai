import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { reddit, context as devvitContext } from '@devvit/web/server';
import { alertAllModerators, addStrike, getUserRiskScore, updateEmotionalTemperature } from '../../core/nuke';
import { removeFromQueue } from '../../services/queueService';
import { logAction } from '../../services/logService';

export const moderationMenu = new Hono();

// ─── Remove Post ─────────────────────────────────────────────────────────────

moderationMenu.post('/remove-post', async (c) => {
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
    await logAction({
      itemId: postId,
      type: 'post',
      action: 'removed',
      author,
      reason,
      strikeCount: record.count,
      banApplied: banInfo.label,
      permanent: banInfo.permanent,
      riskScore: riskScore.score,
      auto: false,
    });

    await removeFromQueue(postId);

    return c.json<UiResponse>({
      showToast: `✕ Removed! Strike ${record.count}/5 → u/${author} | Ban: ${banInfo.label}${banInfo.permanent ? ' PERMANENT!' : ''} | Risk: ${riskScore.score}/100`,
    }, 200);
  } catch (error) {
    console.error('[ModGuard] remove-post error:', error);
    return c.json<UiResponse>({ showToast: `Remove failed: ${String(error)}` }, 200);
  }
});

// ─── Remove Comment ──────────────────────────────────────────────────────────

moderationMenu.post('/remove-comment', async (c) => {
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

    await logAction({
      itemId: commentId,
      type: 'comment',
      action: 'removed',
      author,
      reason,
      strikeCount: record.count,
      banApplied: banInfo.label,
      permanent: banInfo.permanent,
      auto: false,
    });

    await removeFromQueue(commentId);

    return c.json<UiResponse>({
      showToast: `✕ Comment removed! Strike ${record.count}/5 → u/${author} | Ban: ${banInfo.label}`,
    }, 200);
  } catch (error) {
    console.error('[ModGuard] remove-comment error:', error);
    return c.json<UiResponse>({ showToast: `Remove failed: ${String(error)}` }, 200);
  }
});

// ─── Approve Post ─────────────────────────────────────────────────────────────

moderationMenu.post('/approve-post', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const postId = body.postId ?? body.targetId ?? devvitContext.postId;
    if (!postId) return c.json<UiResponse>({ showToast: 'No post ID found' }, 200);

    const post = await reddit.getPostById(postId);
    await post.approve();

    await logAction({
      itemId: postId,
      type: 'post',
      action: 'approved',
      author: post.authorName,
      reason: 'No violation',
      auto: false,
    });

    await removeFromQueue(postId);
    return c.json<UiResponse>({ showToast: '✓ Post approved!' }, 200);
  } catch (error) {
    return c.json<UiResponse>({ showToast: `Approve failed: ${String(error)}` }, 200);
  }
});

// ─── Escalate Post ────────────────────────────────────────────────────────────

moderationMenu.post('/escalate-post', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const postId = body.postId ?? body.targetId ?? devvitContext.postId;
    const reason = body.reason ?? 'Escalated for senior review.';
    if (!postId) return c.json<UiResponse>({ showToast: 'No post ID found' }, 200);

    const post = await reddit.getPostById(postId);
    await alertAllModerators(postId, post.authorName, `Escalated: ${reason}`);

    await logAction({
      itemId: postId,
      type: 'post',
      action: 'escalated',
      author: post.authorName,
      reason,
      auto: false,
    });

    await removeFromQueue(postId);
    return c.json<UiResponse>({ showToast: '⚠️ Escalated to senior moderators!' }, 200);
  } catch (error) {
    return c.json<UiResponse>({ showToast: `Escalate failed: ${String(error)}` }, 200);
  }
});

// ─── Ban User ────────────────────────────────────────────────────────────────

moderationMenu.post('/ban-user', async (c) => {
  try {
    const { username, reason, days } = await c.req.json();
    await reddit.banUser({
      subredditName: devvitContext.subredditName,
      username,
      reason,
      duration: days ?? 0,
      message: days === 0
        ? `Permanently banned. Reason: ${reason}`
        : `Banned for ${days} days. Reason: ${reason}`,
    });

    await logAction({
      itemId: 'manual-ban',
      action: 'ban',
      author: username,
      reason,
      permanent: days === 0,
      auto: false,
    });

    return c.json<UiResponse>({ showToast: `⊘ u/${username} banned!` }, 200);
  } catch (error) {
    return c.json<UiResponse>({ showToast: `Ban failed: ${String(error)}` }, 200);
  }
});

