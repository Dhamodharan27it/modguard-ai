import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { redis, reddit, context as devvitContext } from '@devvit/web/server';
import {
  analyseContent,
  getUserStrikes,
  addStrike,
  alertAllModerators,
  executeAutoAction,
} from '../core/nuke';

export const menu = new Hono();

//  Analyse post 

menu.post('/analyse-post', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const postId = body.postId ?? body.targetId ?? devvitContext.postId;
    if (!postId) return c.json<UiResponse>({ showToast: '❌ No post ID found' }, 200);

    const post = await reddit.getPostById(postId);
    const author = post.authorName;
    const strikeRecord = await getUserStrikes(author);
    const analysis = analyseContent(post.body ?? post.title, post.title);

    await redis.set(
      `modguard:analysis:${postId}`,
      JSON.stringify({
        postId, type: 'post', author,
        title: post.title,
        content: post.body ?? post.title,
        subreddit: post.subredditName,
        createdAt: new Date().toISOString(),
        existingStrikes: strikeRecord.count,
        ...analysis,
      })
    );

    await addToModQueue(postId);
    if (analysis.autoAction) await executeAutoAction(postId, author, analysis, false);

    return c.json<UiResponse>({
      showToast: `⚡ ${analysis.violation} — ${analysis.confidence}% confidence. Suggested: ${analysis.suggestedAction.toUpperCase()}`
    }, 200);
  } catch (error) {
    console.error('[ModGuard] analyse-post error:', error);
    return c.json<UiResponse>({ showToast: `❌ Analysis failed: ${String(error)}` }, 200);
  }
});

//  Analyse comment 

menu.post('/analyse-comment', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const commentId = body.commentId ?? body.targetId ?? devvitContext.commentId;
    if (!commentId) return c.json<UiResponse>({ showToast: '❌ No comment ID found' }, 200);

    const comment = await reddit.getCommentById(commentId);
    const author = comment.authorName;
    const strikeRecord = await getUserStrikes(author);
    const analysis = analyseContent(comment.body);

    await redis.set(
      `modguard:analysis:${commentId}`,
      JSON.stringify({
        postId: commentId, type: 'comment', author,
        content: comment.body,
        subreddit: comment.subredditName,
        createdAt: new Date().toISOString(),
        existingStrikes: strikeRecord.count,
        ...analysis,
      })
    );

    await addToModQueue(commentId);
    if (analysis.autoAction) await executeAutoAction(commentId, author, analysis, true);

    return c.json<UiResponse>({
      showToast: `⚡ ${analysis.violation} — ${analysis.confidence}% confidence. Suggested: ${analysis.suggestedAction.toUpperCase()}`
    }, 200);
  } catch (error) {
    console.error('[ModGuard] analyse-comment error:', error);
    return c.json<UiResponse>({ showToast: `❌ Analysis failed: ${String(error)}` }, 200);
  }
});

//  Remove post 

menu.post('/remove-post', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const postId = body.postId ?? body.targetId ?? devvitContext.postId;
    const reason = body.reason ?? 'Removed for violating community rules.';
    if (!postId) return c.json<UiResponse>({ showToast: '❌ No post ID found' }, 200);

    const post = await reddit.getPostById(postId);
    const author = post.authorName;
    await post.remove();

    const { record, banInfo } = await addStrike(author, reason, 'harassment', postId);

    await reddit.sendPrivateMessage({
      to: author,
      subject: `Your post was removed from r/${devvitContext.subredditName}`,
      text:
        `${reason}\n\n` +
        `⚠️ Strike ${record.count} of 5 issued.\n` +
        `Ban applied: ${banInfo.label}\n\n` +
        `${record.count >= 4 ? '🚨 WARNING: One more violation = permanent ban.' : 'Please follow community rules.'}`,
    });

    if (record.count >= 4 || banInfo.permanent) {
      await alertAllModerators(postId, author, `Strike ${record.count}/5. ${banInfo.label} applied.`);
    }

    await logAction({ itemId: postId, type: 'post', action: 'removed', author, reason, strikeCount: record.count, banApplied: banInfo.label, permanent: banInfo.permanent, auto: false });
    await removeFromQueue(postId);

    return c.json<UiResponse>({
      showToast: `✅ Post removed! Strike ${record.count}/5 issued to u/${author}. Ban: ${banInfo.label}`
    }, 200);
  } catch (error) {
    console.error('[ModGuard] remove-post error:', error);
    return c.json<UiResponse>({ showToast: `❌ Remove failed: ${String(error)}` }, 200);
  }
});

//  Remove comment 

menu.post('/remove-comment', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const commentId = body.commentId ?? body.targetId ?? devvitContext.commentId;
    const reason = body.reason ?? 'Removed for violating community rules.';
    if (!commentId) return c.json<UiResponse>({ showToast: '❌ No comment ID found' }, 200);

    const comment = await reddit.getCommentById(commentId);
    const author = comment.authorName;
    await comment.remove();

    const { record, banInfo } = await addStrike(author, reason, 'harassment', commentId);

    await reddit.sendPrivateMessage({
      to: author,
      subject: `Your comment was removed from r/${devvitContext.subredditName}`,
      text:
        `${reason}\n\n` +
        `⚠️ Strike ${record.count} of 5 issued.\n` +
        `Ban applied: ${banInfo.label}`,
    });

    if (record.count >= 4 || banInfo.permanent) {
      await alertAllModerators(commentId, author, `Strike ${record.count}/5. ${banInfo.label} applied.`);
    }

    await logAction({ itemId: commentId, type: 'comment', action: 'removed', author, reason, strikeCount: record.count, banApplied: banInfo.label, permanent: banInfo.permanent, auto: false });
    await removeFromQueue(commentId);

    return c.json<UiResponse>({
      showToast: `✅ Comment removed! Strike ${record.count}/5 issued to u/${author}.`
    }, 200);
  } catch (error) {
    console.error('[ModGuard] remove-comment error:', error);
    return c.json<UiResponse>({ showToast: `❌ Remove failed: ${String(error)}` }, 200);
  }
});

//  Approve post 

menu.post('/approve-post', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const postId = body.postId ?? body.targetId ?? devvitContext.postId;
    if (!postId) return c.json<UiResponse>({ showToast: '❌ No post ID found' }, 200);

    const post = await reddit.getPostById(postId);
    await post.approve();

    await logAction({ itemId: postId, type: 'post', action: 'approved', author: post.authorName, reason: 'No violation detected', auto: false });
    await removeFromQueue(postId);

    return c.json<UiResponse>({ showToast: '✅ Post approved!' }, 200);
  } catch (error) {
    console.error('[ModGuard] approve-post error:', error);
    return c.json<UiResponse>({ showToast: `❌ Approve failed: ${String(error)}` }, 200);
  }
});

//  Escalate post 

menu.post('/escalate-post', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const postId = body.postId ?? body.targetId ?? devvitContext.postId;
    const reason = body.reason ?? 'Escalated for senior review.';
    if (!postId) return c.json<UiResponse>({ showToast: '❌ No post ID found' }, 200);

    const post = await reddit.getPostById(postId);
    await alertAllModerators(postId, post.authorName, `Post escalated: ${reason}`);
    await logAction({ itemId: postId, type: 'post', action: 'escalated', author: post.authorName, reason, auto: false });
    await removeFromQueue(postId);

    return c.json<UiResponse>({ showToast: '⚠️ Post escalated to senior moderators!' }, 200);
  } catch (error) {
    console.error('[ModGuard] escalate-post error:', error);
    return c.json<UiResponse>({ showToast: `❌ Escalate failed: ${String(error)}` }, 200);
  }
});

//  Ban user 

menu.post('/ban-user', async (c) => {
  try {
    const { username, reason, days } = await c.req.json();
    await reddit.banUser({
      subredditName: devvitContext.subredditName,
      username, reason,
      duration: days ?? 0,
      message: days === 0
        ? `You have been permanently banned. Reason: ${reason}`
        : `You have been banned for ${days} days. Reason: ${reason}`,
    });
    await logAction({ itemId: 'manual-ban', action: 'ban', author: username, reason, permanent: days === 0, auto: false });
    return c.json<UiResponse>({ showToast: `⊘ u/${username} has been banned!` }, 200);
  } catch (error) {
    console.error('[ModGuard] ban-user error:', error);
    return c.json<UiResponse>({ showToast: `❌ Ban failed: ${String(error)}` }, 200);
  }
});

//  Get user strikes 

menu.get('/user-strikes/:username', async (c) => {
  try {
    const username = c.req.param('username');
    const record = await getUserStrikes(username);
    return c.json({ success: true, record });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

//  Helpers 

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