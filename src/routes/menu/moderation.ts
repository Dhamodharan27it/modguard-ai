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
    
    if (!postId) return c.json<UiResponse>({ showToast: '❌ No post ID found' }, 200);

    const post = await reddit.getPostById(postId);
    if (!post || !post.authorName) return c.json<UiResponse>({ showToast: '❌ Post not found' }, 200);
    
    const author = post.authorName;
    await post.remove();

    const { record, banInfo } = await addStrike(author, reason, 'harassment', postId);
    const riskScore = await getUserRiskScore(author);

    await reddit.sendPrivateMessage({
      to: author,
      subject: `🚫 Your post was removed from r/${devvitContext.subredditName}`,
      text: `${reason}\n\n⚠️ STRIKE ${record.count}/5\n📛 Ban Duration: ${banInfo.label}${banInfo.permanent ? ' [PERMANENT]' : ''}\n\n${record.count >= 4 ? '🚨 WARNING: One more strike = PERMANENT BAN!' : '📌 Please follow community guidelines.'}\n\n📊 Risk Score: ${riskScore.score}/100 (${riskScore.level})`,
    });

    if (record.count >= 4 || banInfo.permanent) {
      await alertAllModerators(postId, author, `🔴 CRITICAL STRIKE: ${record.count}/5. Ban: ${banInfo.label}. Risk: ${riskScore.level}`);
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
      showToast: `✕ POST REMOVED! ⚠️ Strike ${record.count}/5 | 📛 ${banInfo.label}${banInfo.permanent ? ' [PERMANENT]' : ''} | 🔴 Risk: ${riskScore.level}`,
    }, 200);
  } catch (error) {
    return c.json<UiResponse>({ showToast: `❌ Remove failed: ${String(error)?.slice(0, 50)}` }, 200);
  }
});

// ─── Remove Comment ──────────────────────────────────────────────────────────

moderationMenu.post('/remove-comment', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const commentId = body.commentId ?? body.targetId ?? devvitContext.commentId;
    const reason = body.reason ?? 'Removed for violating community rules.';
    
    if (!commentId) return c.json<UiResponse>({ showToast: '❌ No comment ID found' }, 200);

    const comment = await reddit.getCommentById(commentId);
    if (!comment || !comment.authorName) return c.json<UiResponse>({ showToast: '❌ Comment not found' }, 200);
    
    const author = comment.authorName;
    await comment.remove();

    const { record, banInfo } = await addStrike(author, reason, 'harassment', commentId);
    const riskScore = await getUserRiskScore(author);

    await reddit.sendPrivateMessage({
      to: author,
      subject: `🚫 Your comment was removed from r/${devvitContext.subredditName}`,
      text: `${reason}\n\n⚠️ STRIKE ${record.count}/5\n📛 Ban Duration: ${banInfo.label}${banInfo.permanent ? ' [PERMANENT]' : ''}\n\n${record.count >= 4 ? '🚨 WARNING: One more strike = PERMANENT BAN!' : '📌 Please follow community guidelines.'}\n\n📊 Risk Score: ${riskScore.score}/100 (${riskScore.level})`,
    });

    if (record.count >= 4 || banInfo.permanent) {
      await alertAllModerators(commentId, author, `🔴 CRITICAL STRIKE: ${record.count}/5. Ban: ${banInfo.label}. Risk: ${riskScore.level}`);
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
      riskScore: riskScore.score,
      auto: false,
    });

    await removeFromQueue(commentId);

    return c.json<UiResponse>({
      showToast: `✕ COMMENT REMOVED! ⚠️ Strike ${record.count}/5 | 📛 ${banInfo.label}${banInfo.permanent ? ' [PERMANENT]' : ''} | 🔴 Risk: ${riskScore.level}`,
    }, 200);
  } catch (error) {
    return c.json<UiResponse>({ showToast: `❌ Remove failed: ${String(error)?.slice(0, 50)}` }, 200);
  }
});

// ─── Approve Post ─────────────────────────────────────────────────────────────

moderationMenu.post('/approve-post', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const postId = body.postId ?? body.targetId ?? devvitContext.postId;
    
    if (!postId) return c.json<UiResponse>({ showToast: '❌ No post ID found' }, 200);

    const post = await reddit.getPostById(postId);
    if (!post) return c.json<UiResponse>({ showToast: '❌ Post not found' }, 200);
    
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
    return c.json<UiResponse>({ showToast: `❌ Approve failed: ${String(error)?.slice(0, 50)}` }, 200);
  }
});

// ─── Escalate Post ────────────────────────────────────────────────────────────

moderationMenu.post('/escalate-post', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const postId = body.postId ?? body.targetId ?? devvitContext.postId;
    const reason = body.reason ?? 'Escalated for senior review.';
    
    if (!postId) return c.json<UiResponse>({ showToast: '❌ No post ID found' }, 200);

    const post = await reddit.getPostById(postId);
    if (!post) return c.json<UiResponse>({ showToast: '❌ Post not found' }, 200);
    
    await alertAllModerators(postId, post.authorName, `🔼 ESCALATED: ${reason}`);

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
    return c.json<UiResponse>({ showToast: `❌ Escalate failed: ${String(error)?.slice(0, 50)}` }, 200);
  }
});

// ─── Ban User ────────────────────────────────────────────────────────────────

moderationMenu.post('/ban-user', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { username, reason, days } = body;
    
    if (!username) return c.json<UiResponse>({ showToast: '❌ No username provided' }, 200);
    
    const parsedDays = days ? parseInt(String(days)) : 0;
    
    await reddit.banUser({
      subredditName: devvitContext.subredditName,
      username,
      reason,
      duration: parsedDays,
      message: parsedDays === 0
        ? `🚫 PERMANENT BAN\n\nReason: ${reason}\n\nYou have been permanently banned from this community.`
        : `⏱️ TEMPORARY BAN (${parsedDays} days)\n\nReason: ${reason}\n\nYou are banned for ${parsedDays} day${parsedDays !== 1 ? 's' : ''}.`,
    });

    await logAction({
      itemId: 'manual-ban',
      action: 'ban',
      author: username,
      reason,
      permanent: parsedDays === 0,
      auto: false,
    });

    return c.json<UiResponse>({ 
      showToast: `🚫 u/${username} BANNED! ${parsedDays === 0 ? '[PERMANENT]' : `[${parsedDays}d]`}` 
    }, 200);
  } catch (error) {
    return c.json<UiResponse>({ showToast: `❌ Ban failed: ${String(error)?.slice(0, 50)}` }, 200);
  }
});

