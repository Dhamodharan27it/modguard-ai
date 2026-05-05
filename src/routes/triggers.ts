import { Hono } from 'hono';
import { getContext } from '@devvit/web/server';
import {
  analyseContent,
  executeAutoAction,
  getUserStrikes,
} from '../core/nuke';

export const triggers = new Hono();

// Fires automatically when a POST is reported
triggers.post('/post-reported', async (c) => {
  const { postId } = await c.req.json();
  const context = getContext(c);

  try {
    const post = await context.reddit.getPostById(postId);
    const author = post.authorName;

    const strikeRecord = await getUserStrikes(context, author);

    const analysis = analyseContent(
      post.body ?? post.title,
      post.title
    );

    // Store analysis result in Redis
    await context.redis.set(
      `modguard:analysis:${postId}`,
      JSON.stringify({
        postId,
        type: 'post',
        author,
        title: post.title,
        content: post.body ?? post.title,
        subreddit: post.subredditName,
        createdAt: new Date().toISOString(),
        autoDetected: true,
        existingStrikes: strikeRecord.count,
        ...analysis,
      })
    );

    // Add to mod queue
    await addToModQueue(context, postId);

    if (analysis.autoAction) {
      await executeAutoAction(context, postId, author, analysis, false);
    }

    return c.json({ success: true, analysis });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// Fires automatically when a COMMENT is reported
triggers.post('/comment-reported', async (c) => {
  const { commentId } = await c.req.json();
  const context = getContext(c);

  try {
    const comment = await context.reddit.getCommentById(commentId);
    const author = comment.authorName;

    const strikeRecord = await getUserStrikes(context, author);
    const analysis = analyseContent(comment.body);

    await context.redis.set(
      `modguard:analysis:${commentId}`,
      JSON.stringify({
        postId: commentId,
        type: 'comment',
        author,
        content: comment.body,
        subreddit: comment.subredditName,
        createdAt: new Date().toISOString(),
        autoDetected: true,
        existingStrikes: strikeRecord.count,
        ...analysis,
      })
    );

    await addToModQueue(context, commentId);

    if (analysis.autoAction) {
      await executeAutoAction(context, commentId, author, analysis, true);
    }

    return c.json({ success: true, analysis });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// Get full mod queue
triggers.get('/queue', async (c) => {
  const context = getContext(c);

  try {
    const queueRaw = await context.redis.get(
      `modguard:queue:${context.subredditName}`
    );
    const queue: string[] = queueRaw ? JSON.parse(queueRaw) : [];

    const items = await Promise.all(
      queue.map(async (id) => {
        const raw = await context.redis.get(`modguard:analysis:${id}`);
        return raw ? JSON.parse(raw) : null;
      })
    );

    const pending = items.filter(Boolean);
    return c.json({ success: true, queue: pending, total: pending.length });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// Get mod stats
triggers.get('/stats', async (c) => {
  const context = getContext(c);

  try {
    const logRaw = await context.redis.get(
      `modguard:log:${context.subredditName}`
    );
    const logs: any[] = logRaw ? JSON.parse(logRaw) : [];

    return c.json({
      success: true,
      stats: {
        totalActioned: logs.length,
        totalRemoved: logs.filter((l) => l.action === 'removed').length,
        totalApproved: logs.filter((l) => l.action === 'approved').length,
        totalEscalated: logs.filter((l) => l.action === 'escalated').length,
        autoRemoved: logs.filter((l) => l.auto === true).length,
        criticalAlerts: logs.filter((l) => l.severity === 'critical').length,
        recentActions: logs.slice(0, 10),
      },
    });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

//  Helper 

async function addToModQueue(
  context: ReturnType<typeof getContext>,
  itemId: string
) {
  const queueKey = `modguard:queue:${context.subredditName}`;
  const existing = await context.redis.get(queueKey);
  const queue: string[] = existing ? JSON.parse(existing) : [];

  if (!queue.includes(itemId)) {
    queue.unshift(itemId);
    await context.redis.set(queueKey, JSON.stringify(queue.slice(0, 50)));
  }
}