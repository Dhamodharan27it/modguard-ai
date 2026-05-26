import { Hono } from 'hono';
import { redis, reddit, context as devvitContext } from '@devvit/web/server';
import { verifyModerator, requireMod } from '../../middleware/modAuth';

type FeedbackEntry = {
  id: string; itemId: string; action: string; correct: boolean;
  note: string; username: string; timestamp: string; triggeredDetectors: string[];
};

type LogEntry = {
  action: string; auto?: boolean; severity?: string; author?: string; timestamp?: string;
};

import {
  analyseContent,
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
  updateDetectorWeights,
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

api.get('/auth/check', async (c) => {
  const auth = await verifyModerator();
  return c.json({
    success: true,
    isModerator: auth.isModerator,
    username: auth.username,
    subreddit: devvitContext.subredditName,
  });
});

api.use('*', async (c, next) => {
  if (c.req.path.endsWith('/auth/check')) {
    await next();
    return;
  }
  const auth = await verifyModerator();
  const guard = requireMod(c, auth);
  if (!guard.authorized) return guard.response;
  await next();
});

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
const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, none: 4 };

api.get('/queue', async (c) => {
  try {
    const subreddit = devvitContext.subredditName;
    const severityFilter = c.req.query('severity') ?? 'all';
    const queueRaw = await redis.get(`modguard:queue:${subreddit}`);
    const queue: string[] = queueRaw ? JSON.parse(queueRaw) : [];
    const items = await Promise.all(
      queue.map(async (id) => {
        const raw = await redis.get(`modguard:analysis:${id}`);
        return raw ? JSON.parse(raw) : null;
      })
    );
    let pending = items.filter(Boolean);

    pending.sort((a, b) => {
      const aOrder = SEVERITY_ORDER[a.severity] ?? 4;
      const bOrder = SEVERITY_ORDER[b.severity] ?? 4;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return (b.confidence ?? 0) - (a.confidence ?? 0);
    });

    if (severityFilter !== 'all') {
      pending = pending.filter(i => i.severity === severityFilter);
    }

    const counts = { critical: 0, high: 0, medium: 0, low: 0, none: 0 };
    pending.forEach(i => { const s = i.severity as keyof typeof counts; if (s in counts) counts[s]++; });

    return c.json({ success: true, queue: pending, total: pending.length, counts });
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

// FEEDBACK ENDPOINTS
api.post('/feedback', async (c) => {
  const { itemId, action, correct, note, username } = await c.req.json();
  try {
    // Validate input
    if (!itemId || !action || correct === undefined) {
      return c.json({ success: false, error: 'Missing required fields: itemId, action, correct' }, 400);
    }

    // Get the analysis for this item to see which detectors triggered
    const analysisRaw = await redis.get(`modguard:analysis:${itemId}`);
    let triggeredDetectors: string[] = [];
    if (analysisRaw) {
      const analysis = JSON.parse(analysisRaw);
      triggeredDetectors = analysis.triggeredDetectors ?? [];
    }

    // Store feedback in Redis
    const feedbackKey = `modguard:feedback:${devvitContext.subredditName}`;
    const feedbackRaw = await redis.get(feedbackKey);
    const feedbackList: FeedbackEntry[] = feedbackRaw ? JSON.parse(feedbackRaw) : [];

    const feedbackEntry = {
      id: `${itemId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      itemId,
      action,
      correct,
      note: note ?? '',
      username: username ?? 'anonymous',
      timestamp: new Date().toISOString(),
      triggeredDetectors, // Store which detectors were triggered for this item
    };

    feedbackList.push(feedbackEntry);
    await redis.set(feedbackKey, JSON.stringify(feedbackList.slice(-1000))); // Keep last 1000 feedback entries

    // Detector weights tuning is handled server-side in core (currently not wired here).
    // Return success and allow background/cron jobs to process detector updates.

    return c.json({ success: true, feedbackId: feedbackEntry.id });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

api.get('/feedback/stats', async (c) => {
  try {
    const feedbackKey = `modguard:feedback:${devvitContext.subredditName}`;
    const feedbackRaw = await redis.get(feedbackKey);
    const feedbackList: FeedbackEntry[] = feedbackRaw ? JSON.parse(feedbackRaw) : [];

    // Calculate statistics
    const total = feedbackList.length;
    const correctCount = feedbackList.filter(f => f.correct).length;
    const incorrectCount = total - correctCount;
    const accuracy = total > 0 ? Math.round((correctCount / total) * 100) : 0;

    // Group by action type
    const byAction: Record<string, { total: number; correct: number; accuracy: number }> = {};
    feedbackList.forEach((f) => {
      const action = String(f.action ?? 'unknown');
      if (!byAction[action]) {
        byAction[action] = { total: 0, correct: 0, accuracy: 0 };
      }
      byAction[action]!.total++;
      if (f.correct) byAction[action]!.correct++;
    });

    Object.keys(byAction).forEach((action) => {
      const stats = byAction[action];
      if (!stats) return;
      stats.accuracy = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
    });

    return c.json({
      success: true,
      stats: {
        total,
        correct: correctCount,
        incorrect: incorrectCount,
        accuracy,
        byAction,
        recent: feedbackList.slice(-10).reverse(), // Last 10 feedback entries
      }
    });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});


api.post('/feedback/process', async (c) => {
  try {
    await updateDetectorWeights(devvitContext.subredditName);

    const feedbackRaw = await redis.get(`modguard:feedback:${devvitContext.subredditName}`);
    const feedbackList: FeedbackEntry[] = feedbackRaw ? JSON.parse(feedbackRaw) : [];
    const correct = feedbackList.filter(f => f.correct).length;

    return c.json({
      success: true,
      message: `Processed ${feedbackList.length} feedback entries (${correct} correct). Detector weights updated.`,
      totalFeedback: feedbackList.length,
      accuracy: feedbackList.length > 0 ? Math.round((correct / feedbackList.length) * 100) : 0,
    });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

api.get('/community-scan', async (c) => {
  try {
    const logRaw = await redis.get(`modguard:log:${devvitContext.subredditName}`);
    const logs: LogEntry[] = logRaw ? JSON.parse(logRaw) : [];

    const posts = await reddit.getUnmoderated({ subreddit: devvitContext.subredditName, type: 'post', limit: 25 });
    const commentData = await reddit.getUnmoderated({ subreddit: devvitContext.subredditName, type: 'comment', limit: 25 });

    const unmoderated: { id: string; type: string; author: string; text: string; severity: string; score: number }[] = [];

    for await (const post of posts) {
      const a = analyseContent(post.body ?? post.title, post.title);
      unmoderated.push({ id: post.id, type: 'post', author: post.authorName, text: (post.title + ' ' + (post.body ?? '')).slice(0, 80), severity: a.severity, score: a.confidence });
    }

    for await (const cData of commentData) {
      const a = analyseContent(cData.body);
      unmoderated.push({ id: cData.id, type: 'comment', author: cData.authorName, text: (cData.body ?? '').slice(0, 80), severity: a.severity, score: a.confidence });
    }

    const critical = unmoderated.filter(i => i.severity === 'critical' || i.severity === 'high');
    const pending = unmoderated.filter(i => i.severity === 'medium');
    const safe = unmoderated.filter(i => i.severity === 'none' || i.severity === 'low');

    return c.json({
      success: true,
      scan: {
        total: unmoderated.length,
        critical: { count: critical.length, items: critical.slice(0, 10) },
        pending: { count: pending.length, items: pending.slice(0, 10) },
        safe: { count: safe.length },
        totalActions: logs.length,
        autoActions: logs.filter(l => l.auto).length,
        humanActions: logs.filter(l => !l.auto).length,
      },
    });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

api.get('/coordinated', async (c) => {
  try {
    const key = `modguard:coordinated:${devvitContext.subredditName}`;
    const raw = await redis.get(key);
    const attacks: { timestamp: string; users: string[]; windowMinutes: number }[] = raw ? JSON.parse(raw) : [];
    return c.json({ success: true, attacks: attacks.slice(-10) });
  } catch {
    return c.json({ success: true, attacks: [] });
  }
});