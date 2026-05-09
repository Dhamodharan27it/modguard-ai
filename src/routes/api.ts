import { Hono } from 'hono';
import { redis, reddit, context as devvitContext } from '@devvit/web/server';
import {
  analyseContent,
  getUserStrikes,
  addStrike,
  alertAllModerators,
} from '../core/nuke';

export const api = new Hono();

// ─── Get full mod queue ───────────────────────────────────────────────────────

api.get('/queue', async (c) => {
  try {
    const subreddit = devvitContext.subredditName;
    const queueRaw = await redis.get(`modguard:queue:${subreddit}`);
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

// ─── Analyse any post on demand ──────────────────────────────────────────────

api.post('/analyse', async (c) => {
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
    return c.json({ success: true, analysis, strikes: strikeRecord });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// ─── Resolve item from queue ──────────────────────────────────────────────────

api.post('/resolve', async (c) => {
  const { itemId, action, author, reason } = await c.req.json();

  try {
    const subreddit = devvitContext.subredditName;
    const queueRaw = await redis.get(`modguard:queue:${subreddit}`);
    const queue: string[] = queueRaw ? JSON.parse(queueRaw) : [];
    const updated = queue.filter((id) => id !== itemId);
    await redis.set(`modguard:queue:${subreddit}`, JSON.stringify(updated));

    if (action === 'remove' || action === 'ban') {
      const { record, banInfo } = await addStrike(
        author, reason, 'harassment', itemId
      );
      if (action === 'ban' || record.count >= 4) {
        await alertAllModerators(
          itemId, author,
          `Manual ${action} by moderator. Strike ${record.count}/5. ${banInfo.label} applied.`
        );
      }
    }

    const logKey = `modguard:log:${subreddit}`;
    const logRaw = await redis.get(logKey);
    const logs: object[] = logRaw ? JSON.parse(logRaw) : [];
    logs.unshift({
      itemId, action, author, reason,
      timestamp: new Date().toISOString(),
      moderator: devvitContext.userId,
      auto: false,
    });
    await redis.set(logKey, JSON.stringify(logs.slice(0, 100)));

    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// ─── Get mod stats ────────────────────────────────────────────────────────────

api.get('/stats', async (c) => {
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
        totalBanned: logs.filter((l) => l.action === 'ban').length,
        autoRemoved: logs.filter((l) => l.auto === true).length,
        criticalAlerts: logs.filter((l) => l.severity === 'critical').length,
        recentActions: logs.slice(0, 10),
      },
    });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// ─── Get repeat offenders ─────────────────────────────────────────────────────

api.get('/offenders', async (c) => {
  try {
    const logRaw = await redis.get(
      `modguard:log:${devvitContext.subredditName}`
    );
    const logs: any[] = logRaw ? JSON.parse(logRaw) : [];

    const offenderMap: Record<string, number> = {};
    logs
      .filter((l) => l.action === 'removed' || l.action === 'ban')
      .forEach((l) => {
        if (l.author) {
          offenderMap[l.author] = (offenderMap[l.author] ?? 0) + 1;
        }
      });

    const offenders = Object.entries(offenderMap)
      .map(([username, count]) => ({ username, violations: count }))
      .sort((a, b) => b.violations - a.violations)
      .slice(0, 20);

    return c.json({ success: true, offenders });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// ─── Get user strike history ──────────────────────────────────────────────────

api.get('/strikes/:username', async (c) => {
  const username = c.req.param('username');
  try {
    const record = await getUserStrikes(username);
    return c.json({ success: true, record });
  } catch (error) {
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