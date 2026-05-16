import { Hono } from 'hono';
import { redis, reddit, context as devvitContext } from '@devvit/web/server';
import {
  analyseContentFull,
  getUserStrikes,
  addStrike,
  alertAllModerators,
  getUserRiskScore,
  predictThreat,
  getSlowModeRecommendation,
  generateWeeklyInsights,
  generateTransparencyReport,
  getTimeline,
  getAppeals,
  resolveAppeal,
  submitAppeal,
  getWatchlist,
  addToWatchlist,
  getModNotes,
  addModNote,
  getCollabAlerts,
  createCollabAlert,
  getModeratorPreferences,
  saveModeratorPreferences,
  getCommunityHealthScore,
  getEmotionalTemperature,
  getBehaviorDNA,
} from '../../core/nuke';




export const api = new Hono();

async function addToModQueue(itemId: string) {
  const queueKey = `modguard:queue:${devvitContext.subredditName}`;
  const existing = await redis.get(queueKey);
  const queue: string[] = existing ? JSON.parse(existing) : [];
  if (!queue.includes(itemId)) {
    queue.unshift(itemId);
    await redis.set(queueKey, JSON.stringify(queue.slice(0, 50)));
  }
}

// Mod Queue
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

// Analyse on demand
api.post('/analyse', async (c) => {
  const { postId } = await c.req.json();
  try {
    const post = await reddit.getPostById(postId);
    const author = post.authorName;
    const analysis = await analyseContentFull(post.body ?? post.title, post.title, author);
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
        ...analysis,
      })
    );
    await addToModQueue(postId);
    return c.json({ success: true, analysis });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// Resolve queue item
api.post('/resolve', async (c) => {
  const { itemId, action, author, reason } = await c.req.json();
  try {
    const subreddit = devvitContext.subredditName;
    const queueRaw = await redis.get(`modguard:queue:${subreddit}`);
    const queue: string[] = queueRaw ? JSON.parse(queueRaw) : [];
    await redis.set(`modguard:queue:${subreddit}`, JSON.stringify(queue.filter((id: string) => id !== itemId)));

    if (action === 'remove' || action === 'ban') {
      const { record, banInfo } = await addStrike(author, reason, 'harassment', itemId);
      if (action === 'ban' || record.count >= 4) {
        await alertAllModerators(itemId, author, `Manual ${action}. Strike ${record.count}/5. ${banInfo.label}`);
      }
    }

    const logKey = `modguard:log:${subreddit}`;
    const logRaw = await redis.get(logKey);
    const logs: object[] = logRaw ? JSON.parse(logRaw) : [];
    logs.unshift({ itemId, action, author, reason, timestamp: new Date().toISOString(), moderator: devvitContext.userId, auto: false });
    await redis.set(logKey, JSON.stringify(logs.slice(0, 100)));
    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// Behaviour DNA
api.get('/dna/:username', async (c) => {
  const username = c.req.param('username');
  try {
    const dna = await getBehaviorDNA(username);
    return c.json({ success: true, dna });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// Stats
api.get('/stats', async (c) => {
  try {
    const logRaw = await redis.get(`modguard:log:${devvitContext.subredditName}`);
    const logs: { action: string; auto?: boolean; severity?: string }[] = logRaw ? JSON.parse(logRaw) : [];
    return c.json({
      success: true,
      stats: {
        totalActioned: logs.length,
        totalRemoved: logs.filter((l) => l.action === 'removed' || l.action === 'auto_removed').length,
        totalApproved: logs.filter((l) => l.action === 'approved' || l.action === 'auto_approved').length,
        totalEscalated: logs.filter((l) => l.action === 'escalated' || l.action === 'auto_escalated').length,
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

// Offenders
api.get('/offenders', async (c) => {
  try {
    const logRaw = await redis.get(`modguard:log:${devvitContext.subredditName}`);
    const logs: { action: string; author?: string }[] = logRaw ? JSON.parse(logRaw) : [];
    const offenderMap: Record<string, number> = {};
    logs
      .filter((l) => l.action === 'removed' || l.action === 'ban' || l.action === 'auto_removed')
      .forEach((l) => {
        if (l.author) offenderMap[l.author] = (offenderMap[l.author] ?? 0) + 1;
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

// Strikes
api.get('/strikes/:username', async (c) => {
  const username = c.req.param('username');
  try {
    const record = await getUserStrikes(username);
    const riskScore = await getUserRiskScore(username);
    const notes = await getModNotes(username);
    return c.json({ success: true, record, riskScore, notes });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// Threat Prediction
api.get('/threat', async (c) => {
  try {
    const threat = await predictThreat(devvitContext.subredditName);
    const slowMode = await getSlowModeRecommendation(devvitContext.subredditName, threat);
    return c.json({ success: true, threat, slowMode });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// Community health
api.get('/health', async (c) => {
  try {
    const health = await getCommunityHealthScore(devvitContext.subredditName);
    const emotional = await getEmotionalTemperature(devvitContext.subredditName);
    return c.json({ success: true, health, emotional });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// Timeline
api.get('/timeline', async (c) => {
  try {
    const limitParam = c.req.query('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : 50;
    const timeline = await getTimeline(limit);
    return c.json({ success: true, timeline });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// Weekly insights
api.get('/insights', async (c) => {
  try {
    const insights = await generateWeeklyInsights(devvitContext.subredditName);
    return c.json({ success: true, insights });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// Transparency
api.get('/transparency', async (c) => {
  try {
    const report = await generateTransparencyReport(devvitContext.subredditName);
    return c.json({ success: true, report });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// Appeals
api.get('/appeals', async (c) => {
  try {
    const statusParam = c.req.query('status') as 'pending' | 'approved' | 'rejected' | undefined;
    const appeals = await getAppeals(statusParam);
    return c.json({ success: true, appeals });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

api.post('/appeals', async (c) => {
  const { username, postId, reason } = await c.req.json();
  try {
    const appeal = await submitAppeal(username, postId, reason);
    return c.json({ success: true, appeal });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

api.post('/appeals/:id/resolve', async (c) => {
  const id = c.req.param('id');
  const { decision, note } = await c.req.json();
  try {
    await resolveAppeal(id, decision, note);
    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// Watchlist
api.get('/watchlist', async (c) => {
  try {
    const list = await getWatchlist();
    return c.json({ success: true, watchlist: list });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

api.post('/watchlist', async (c) => {
  const { username, reason } = await c.req.json();
  try {
    await addToWatchlist(username, reason);
    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// Notes
api.get('/notes/:username', async (c) => {
  const username = c.req.param('username');
  try {
    const notes = await getModNotes(username);
    return c.json({ success: true, notes });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

api.post('/notes/:username', async (c) => {
  const username = c.req.param('username');
  const { note } = await c.req.json();
  try {
    const newNote = await addModNote(username, note);
    return c.json({ success: true, note: newNote });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// Collab
api.get('/collab', async (c) => {
  try {
    const alerts = await getCollabAlerts();
    return c.json({ success: true, alerts });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

api.post('/collab', async (c) => {
  const { type, message, targetUser, targetPostId } = await c.req.json();
  try {
    const alert = await createCollabAlert(type, message, targetUser, targetPostId);
    return c.json({ success: true, alert });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// Preferences
api.get('/prefs', async (c) => {
  try {
    const modId = devvitContext.userId ?? 'unknown';
    const prefs = await getModeratorPreferences(modId);
    return c.json({ success: true, prefs });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

api.post('/prefs', async (c) => {
  const body = await c.req.json();
  try {
    const modId = devvitContext.userId ?? 'unknown';
    const current = await getModeratorPreferences(modId);
    await saveModeratorPreferences({ ...current, ...body, moderatorId: modId });
    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

