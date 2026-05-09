import { Hono } from 'hono';
import { redis, reddit, context as devvitContext } from '@devvit/web/server';
import {
  analyseContent,
  getUserStrikes,
  addStrike,
  alertAllModerators,
  executeAutoAction,
} from '../core/nuke';

export const menu = new Hono();

// ─── Analyse post ─────────────────────────────────────────────────────────────

menu.post('/analyse-post', async (c) => {
  const { postId } = await c.req.json();

  try {
    const post = await reddit.getPostById(postId);
    const author = post.authorName;
    const strikeRecord = await getUserStrikes(author);
    const analysis = analyseContent(post.body ?? post.title, post.title);

    await redis.set(
      `modguard:analysis:${postId}`,
      JSON.stringify({
        postId,
        type: 'post',
        author,
        title: post.title,
        content: post.body ?? post.title,
        subreddit: post.subredditName,
        createdAt: new Date().toISOString(),
        existingStrikes: strikeRecord.count,
        ...analysis,
      })
    );

    await addToModQueue(postId);

    if (analysis.autoAction) {
      await executeAutoAction(postId, author, analysis, false);
    }

    return c.json({ success: true, analysis, strikes: strikeRecord });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// ─── Analyse comment ──────────────────────────────────────────────────────────

menu.post('/analyse-comment', async (c) => {
  const { commentId } = await c.req.json();

  try {
    const comment = await reddit.getCommentById(commentId);
    const author = comment.authorName;
    const strikeRecord = await getUserStrikes(author);
    const analysis = analyseContent(comment.body);

    await redis.set(
      `modguard:analysis:${commentId}`,
      JSON.stringify({
        postId: commentId,
        type: 'comment',
        author,
        content: comment.body,
        subreddit: comment.subredditName,
        createdAt: new Date().toISOString(),
        existingStrikes: strikeRecord.count,
        ...analysis,
      })
    );

    await addToModQueue(commentId);

    if (analysis.autoAction) {
      await executeAutoAction(commentId, author, analysis, true);
    }

    return c.json({ success: true, analysis, strikes: strikeRecord });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// ─── Remove post ──────────────────────────────────────────────────────────────

menu.post('/remove-post', async (c) => {
  const { postId, reason } = await c.req.json();

  try {
    const post = await reddit.getPostById(postId);
    const author = post.authorName;

    await post.remove();

    const { record, banInfo } = await addStrike(
      author, reason, 'harassment', postId
    );

    await reddit.sendPrivateMessage({
      to: author,
      subject: `Your post was removed from r/${devvitContext.subredditName}`,
      text:
        `${reason}\n\n` +
        `⚠️ Strike ${record.count} of 5 issued.\n` +
        `Ban applied: ${banInfo.label}\n\n` +
        `${record.count >= 4
          ? '🚨 WARNING: One more violation = permanent ban.'
          : 'Please follow community rules.'
        }`,
    });

    if (record.count >= 4 || banInfo.permanent) {
      await alertAllModerators(
        postId, author,
        `Strike ${record.count}/5. ${banInfo.label} applied.`
      );
    }

    await logAction({
      itemId: postId, type: 'post', action: 'removed',
      author, reason, strikeCount: record.count,
      banApplied: banInfo.label, permanent: banInfo.permanent, auto: false,
    });

    await removeFromQueue(postId);
    return c.json({ success: true, strikes: record, ban: banInfo });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// ─── Remove comment ───────────────────────────────────────────────────────────

menu.post('/remove-comment', async (c) => {
  const { commentId, reason } = await c.req.json();

  try {
    const comment = await reddit.getCommentById(commentId);
    const author = comment.authorName;

    await comment.remove();

    const { record, banInfo } = await addStrike(
      author, reason, 'harassment', commentId
    );

    await reddit.sendPrivateMessage({
      to: author,
      subject: `Your comment was removed from r/${devvitContext.subredditName}`,
      text:
        `${reason}\n\n` +
        `⚠️ Strike ${record.count} of 5 issued.\n` +
        `Ban applied: ${banInfo.label}\n\n` +
        `${record.count >= 4
          ? '🚨 WARNING: One more violation = permanent ban.'
          : 'Please follow community rules.'
        }`,
    });

    if (record.count >= 4 || banInfo.permanent) {
      await alertAllModerators(
        commentId, author,
        `Strike ${record.count}/5. ${banInfo.label} applied.`
      );
    }

    await logAction({
      itemId: commentId, type: 'comment', action: 'removed',
      author, reason, strikeCount: record.count,
      banApplied: banInfo.label, permanent: banInfo.permanent, auto: false,
    });

    await removeFromQueue(commentId);
    return c.json({ success: true, strikes: record, ban: banInfo });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// ─── Approve post ─────────────────────────────────────────────────────────────

menu.post('/approve-post', async (c) => {
  const { postId } = await c.req.json();

  try {
    const post = await reddit.getPostById(postId);
    await post.approve();

    await logAction({
      itemId: postId, type: 'post', action: 'approved',
      author: post.authorName, reason: 'No violation detected', auto: false,
    });

    await removeFromQueue(postId);
    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// ─── Escalate post ────────────────────────────────────────────────────────────

menu.post('/escalate-post', async (c) => {
  const { postId, reason } = await c.req.json();

  try {
    const post = await reddit.getPostById(postId);

    await alertAllModerators(
      postId, post.authorName,
      `Post escalated for review: ${reason}`
    );

    await logAction({
      itemId: postId, type: 'post', action: 'escalated',
      author: post.authorName, reason, auto: false,
    });

    await removeFromQueue(postId);
    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// ─── Ban user ─────────────────────────────────────────────────────────────────

menu.post('/ban-user', async (c) => {
  const { username, reason, days } = await c.req.json();

  try {
    await reddit.banUser({
      subredditName: devvitContext.subredditName,
      username,
      reason,
      duration: days ?? 0,
      message:
        days === 0
          ? `You have been permanently banned from r/${devvitContext.subredditName}. Reason: ${reason}`
          : `You have been banned for ${days} days. Reason: ${reason}`,
    });

    await alertAllModerators(
      'manual-ban', username,
      `Manually banned. ${days === 0 ? 'PERMANENT' : `${days} days`}. Reason: ${reason}`
    );

    await logAction({
      itemId: 'manual-ban', action: 'ban', author: username,
      reason, banApplied: days === 0 ? 'Permanent' : `${days} days`,
      permanent: days === 0, auto: false,
    });

    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// ─── Get user strikes ─────────────────────────────────────────────────────────

menu.get('/user-strikes/:username', async (c) => {
  const username = c.req.param('username');
  try {
    const record = await getUserStrikes(username);
    return c.json({ success: true, record });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
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
  const updated = queue.filter((id) => id !== itemId);
  await redis.set(queueKey, JSON.stringify(updated));
}

async function logAction(data: object) {
  const logKey = `modguard:log:${devvitContext.subredditName}`;
  const logRaw = await redis.get(logKey);
  const logs: object[] = logRaw ? JSON.parse(logRaw) : [];
  logs.unshift({
    ...data,
    timestamp: new Date().toISOString(),
    moderator: devvitContext.userId,
  });
  await redis.set(logKey, JSON.stringify(logs.slice(0, 100)));
}