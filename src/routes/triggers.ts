import { Hono } from 'hono';
import { redis, reddit, context as devvitContext } from '@devvit/web/server';
import {
  analyseContent,
  getUserStrikes,
  executeAutoAction,
} from '../core/nuke';

type JsonRecord = Record<string, unknown>;

function extractPostIdFromTrigger(body: JsonRecord): string | undefined {
  if (typeof body.postId === 'string') return body.postId;
  const pr = body.postReport as JsonRecord | undefined;
  const post = (pr?.post ?? body.post) as JsonRecord | undefined;
  const id = post?.id;
  return typeof id === 'string' ? id : undefined;
}

function extractCommentIdFromTrigger(body: JsonRecord): string | undefined {
  if (typeof body.commentId === 'string') return body.commentId;
  const cr = body.commentReport as JsonRecord | undefined;
  const comment = (cr?.comment ?? body.comment) as JsonRecord | undefined;
  const id = comment?.id;
  return typeof id === 'string' ? id : undefined;
}

function toPostFullname(id: string): `t3_${string}` {
  return (id.startsWith('t3_') ? id : `t3_${id}`) as `t3_${string}`;
}

function toCommentFullname(id: string): `t1_${string}` {
  return (id.startsWith('t1_') ? id : `t1_${id}`) as `t1_${string}`;
}

export const triggers = new Hono();

// ─── Post reported ────────────────────────────────────────────────────────────

triggers.post('/post-reported', async (c) => {
  const body = (await c.req.json()) as JsonRecord;
  const rawId = extractPostIdFromTrigger(body);
  if (!rawId) {
    console.error('[ModGuard] post-reported: missing post id', JSON.stringify(body));
    return c.json({ success: false, error: 'missing post id' }, 400);
  }
  const postId = toPostFullname(rawId);

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
        autoDetected: true,
        existingStrikes: strikeRecord.count,
        ...analysis,
      })
    );

    await addToModQueue(postId);

    if (analysis.autoAction) {
      await executeAutoAction(postId, author, analysis, false);
    }

    return c.json({ success: true, analysis });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// ─── Comment reported ─────────────────────────────────────────────────────────

triggers.post('/comment-reported', async (c) => {
  const body = (await c.req.json()) as JsonRecord;
  const rawId = extractCommentIdFromTrigger(body);
  if (!rawId) {
    console.error('[ModGuard] comment-reported: missing comment id', JSON.stringify(body));
    return c.json({ success: false, error: 'missing comment id' }, 400);
  }
  const commentId = toCommentFullname(rawId);

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
        autoDetected: true,
        existingStrikes: strikeRecord.count,
        ...analysis,
      })
    );

    await addToModQueue(commentId);

    if (analysis.autoAction) {
      await executeAutoAction(commentId, author, analysis, true);
    }

    return c.json({ success: true, analysis });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// ─── Get mod queue ────────────────────────────────────────────────────────────

triggers.get('/queue', async (c) => {
  try {
    const queueRaw = await redis.get(
      `modguard:queue:${devvitContext.subredditName}`
    );
    const queue: string[] = queueRaw ? JSON.parse(queueRaw) : [];

    const items = await Promise.all(
      queue.map(async (id) => {
        const raw = await redis.get(`modguard:analysis:${id}`);
        return raw ? JSON.parse(raw) : null;
      })
    );

    const pending = items.filter(Boolean);
    return c.json({ success: true, queue: pending, total: pending.length });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// ─── Get mod stats ────────────────────────────────────────────────────────────

triggers.get('/stats', async (c) => {
  try {
    const logRaw = await redis.get(
      `modguard:log:${devvitContext.subredditName}`
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


// ─── App Install Trigger ──────────────────────────────────────────────────────

triggers.post('/on-app-install', async (c) => {
  try {
    await redis.set(
      `modguard:installed:${devvitContext.subredditName}`,
      JSON.stringify({
        installedAt: new Date().toISOString(),
        subreddit: devvitContext.subredditName,
        version: '1.0.0',
      })
    );

    const mods = await reddit.getModerators({
      subredditName: devvitContext.subredditName,
    });

    for await (const mod of mods) {
      await reddit.sendPrivateMessage({
        to: mod.username,
        subject: `⚡ ModGuard AI installed in r/${devvitContext.subredditName}`,
        text:
          `ModGuard AI has been successfully installed!\n\n` +
          `✅ AI violation detection active\n` +
          `✅ Strike system enabled\n` +
          `✅ Child safety protection on\n` +
          `✅ Auto-removal for critical violations\n\n` +
          `Your community is now protected by ModGuard AI.`,
      });
    }

    return c.json({ success: true });
  } catch (error) {
    console.error('Install trigger failed:', error);
    return c.json({ success: false, error: String(error) }, 500);
  }
});



// ─── Helper ───────────────────────────────────────────────────────────────────

async function addToModQueue(itemId: string) {
  const queueKey = `modguard:queue:${devvitContext.subredditName}`;
  const existing = await redis.get(queueKey);
  const queue: string[] = existing ? JSON.parse(existing) : [];

  if (!queue.includes(itemId)) {
    queue.unshift(itemId);
    await redis.set(queueKey, JSON.stringify(queue.slice(0, 50)));
  }
}

