// ─── AI Moderator Memory ─────────────────────────────────────────────────────
// Stores attack patterns, moderator preferences, repeat offender profiles,
// and historical patterns for cross-session learning.

import { redis, context as devvitContext } from '@devvit/web/server';

// ─── Types ────────────────────────────────────────────────────────────────────

type FeedbackItem = {
  id: string; itemId: string; action: string; correct: boolean; category?: string;
  note: string; username: string; timestamp: string; triggeredDetectors: string[];
};

export type AttackPattern = {
  id: string;
  subreddit: string;
  detectedAt: string;
  patternType: 'raid' | 'spam_wave' | 'coordinated' | 'bot_network' | 'scam_campaign';
  keywords: string[];
  accountCount: number;
  postCount: number;
  resolved: boolean;
  resolvedAt?: string;
};

export type ModeratorPreference = {
  moderatorId: string;
  autoRemoveThreshold: number;    // default 90
  autoEscalateThreshold: number;  // default 70
  preferredAction: 'strict' | 'balanced' | 'relaxed';
  notifyOnCritical: boolean;
  notifyOnHigh: boolean;
  lastUpdated: string;
};

export type MemoryInsight = {
  type: 'pattern_match' | 'repeat_offender' | 'attack_similarity' | 'trend';
  message: string;
  confidence: number;
  relatedId?: string;
};

export type Appeal = {
  id: string;
  username: string;
  postId: string;
  reason: string;
  submittedAt: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
};

export type TimelineEvent = {
  timestamp: string;
  type: 'detection' | 'action' | 'alert' | 'system' | 'threat' | 'slow_mode';
  message: string;
  severity: 'info' | 'warning' | 'critical';
  actor?: string;
  auto: boolean;
};

export type WatchlistEntry = {
  username: string;
  reason: string;
  addedBy: string;
  addedAt: string;
  alertOnActivity: boolean;
};

export type CollabAlert = {
  id: string;
  type: 'note' | 'warning' | 'escalation' | 'discussion';
  message: string;
  targetUser?: string | undefined;
  targetPostId?: string | undefined;
  createdBy: string;
  createdAt: string;
  resolved: boolean;
  replies: { author: string; message: string; at: string }[];
};

export type ModNote = {
  id: string;
  username: string;
  note: string;
  addedBy: string;
  addedAt: string;
  pinned: boolean;
};

// ─── Attack Pattern Memory ────────────────────────────────────────────────────

export async function recordAttackPattern(
  patternType: AttackPattern['patternType'],
  keywords: string[],
  accountCount: number,
  postCount: number,
): Promise<AttackPattern> {
  const key = `modguard:attack_patterns:${devvitContext.subredditName}`;
  const raw = await redis.get(key);
  const patterns: AttackPattern[] = raw ? JSON.parse(raw) : [];

  const pattern: AttackPattern = {
    id: `attack_${Date.now()}`,
    subreddit: devvitContext.subredditName,
    detectedAt: new Date().toISOString(),
    patternType,
    keywords,
    accountCount,
    postCount,
    resolved: false,
  };

  patterns.unshift(pattern);
  await redis.set(key, JSON.stringify(patterns.slice(0, 50)));
  return pattern;
}

export async function getAttackPatterns(): Promise<AttackPattern[]> {
  const key = `modguard:attack_patterns:${devvitContext.subredditName}`;
  const raw = await redis.get(key);
  return raw ? JSON.parse(raw) : [];
}

// ─── Pattern Similarity Check ─────────────────────────────────────────────────

export async function checkPatternSimilarity(
  keywords: string[],
): Promise<MemoryInsight | null> {
  const patterns = await getAttackPatterns();
  if (patterns.length === 0) return null;

  for (const pattern of patterns) {
    const overlap = keywords.filter(k => pattern.keywords.includes(k)).length;
    const similarity = pattern.keywords.length > 0 ? overlap / pattern.keywords.length : 0;

    if (similarity >= 0.5) {
      return {
        type: 'attack_similarity',
        message: `This attack pattern resembles a previous ${pattern.patternType.replace('_', ' ')} (${Math.round(similarity * 100)}% match from ${new Date(pattern.detectedAt).toLocaleDateString()})`,
        confidence: Math.round(similarity * 100),
        relatedId: pattern.id,
      };
    }
  }

  return null;
}

// ─── Moderator Preferences ────────────────────────────────────────────────────

export async function getModeratorPreferences(
  moderatorId: string,
): Promise<ModeratorPreference> {
  const key = `modguard:mod_prefs:${moderatorId}`;
  const raw = await redis.get(key);
  if (raw) return JSON.parse(raw);

  // Defaults
  return {
    moderatorId,
    autoRemoveThreshold: 90,
    autoEscalateThreshold: 70,
    preferredAction: 'balanced',
    notifyOnCritical: true,
    notifyOnHigh: false,
    lastUpdated: new Date().toISOString(),
  };
}

export async function saveModeratorPreferences(
  prefs: ModeratorPreference,
): Promise<void> {
  const key = `modguard:mod_prefs:${prefs.moderatorId}`;
  prefs.lastUpdated = new Date().toISOString();
  await redis.set(key, JSON.stringify(prefs));
}

// ─── Moderator Notes ────────────────────────────────────────────────────────

export async function addModNote(username: string, note: string): Promise<ModNote> {
  const key = `modguard:notes:${devvitContext.subredditName}:${username}`;
  const raw = await redis.get(key);
  const notes: ModNote[] = raw ? JSON.parse(raw) : [];

  const newNote: ModNote = {
    id: `note_${Date.now()}`,
    username,
    note,
    addedBy: devvitContext.userId ?? 'unknown',
    addedAt: new Date().toISOString(),
    pinned: false,
  };

  notes.unshift(newNote);
  await redis.set(key, JSON.stringify(notes.slice(0, 20)));
  return newNote;
}

export async function getModNotes(username: string): Promise<ModNote[]> {
  const key = `modguard:notes:${devvitContext.subredditName}:${username}`;
  const raw = await redis.get(key);
  return raw ? JSON.parse(raw) : [];
}

// ─── Watchlist ────────────────────────────────────────────────────────────────

export async function addToWatchlist(username: string, reason: string): Promise<void> {
  const key = `modguard:watchlist:${devvitContext.subredditName}`;
  const raw = await redis.get(key);
  const list: WatchlistEntry[] = raw ? JSON.parse(raw) : [];

  if (!list.find(e => e.username === username)) {
    list.unshift({
      username,
      reason,
      addedBy: devvitContext.userId ?? 'unknown',
      addedAt: new Date().toISOString(),
      alertOnActivity: true,
    });
    await redis.set(key, JSON.stringify(list.slice(0, 100)));
  }
}

export async function isOnWatchlist(username: string): Promise<boolean> {
  const key = `modguard:watchlist:${devvitContext.subredditName}`;
  const raw = await redis.get(key);
  const list: WatchlistEntry[] = raw ? JSON.parse(raw) : [];
  return list.some(e => e.username === username);
}

export async function getWatchlist(): Promise<WatchlistEntry[]> {
  const key = `modguard:watchlist:${devvitContext.subredditName}`;
  const raw = await redis.get(key);
  return raw ? JSON.parse(raw) : [];
}

// ─── Moderator Collaboration: Shared Alerts ───────────────────────────────────

export async function createCollabAlert(
  type: CollabAlert['type'],
  message: string,
  targetUser?: string,
  targetPostId?: string,
): Promise<CollabAlert> {
  const key = `modguard:collab:${devvitContext.subredditName}`;
  const raw = await redis.get(key);
  const alerts: CollabAlert[] = raw ? JSON.parse(raw) : [];

  const alert: CollabAlert = {
    id: `alert_${Date.now()}`,
    type,
    message,
    targetUser,
    targetPostId,
    createdBy: devvitContext.userId ?? 'unknown',
    createdAt: new Date().toISOString(),
    resolved: false,
    replies: [],
  };

  alerts.unshift(alert);
  await redis.set(key, JSON.stringify(alerts.slice(0, 50)));
  return alert;
}

export async function getCollabAlerts(): Promise<CollabAlert[]> {
  const key = `modguard:collab:${devvitContext.subredditName}`;
  const raw = await redis.get(key);
  return raw ? JSON.parse(raw) : [];
}

// ─── AI Timeline ──────────────────────────────────────────────────────────────

export async function addTimelineEvent(event: Omit<TimelineEvent, 'timestamp'>): Promise<void> {
  const key = `modguard:timeline:${devvitContext.subredditName}`;
  const raw = await redis.get(key);
  const timeline: TimelineEvent[] = raw ? JSON.parse(raw) : [];

  timeline.unshift({ ...event, timestamp: new Date().toISOString() });
  await redis.set(key, JSON.stringify(timeline.slice(0, 200)));
}

export async function getTimeline(limit = 50): Promise<TimelineEvent[]> {
  const key = `modguard:timeline:${devvitContext.subredditName}`;
  const raw = await redis.get(key);
  const timeline: TimelineEvent[] = raw ? JSON.parse(raw) : [];
  return timeline.slice(0, limit);
}

// ─── Weekly Insights Generator ────────────────────────────────────────────────

export type WeeklyInsight = {
  generatedAt: string;
  period: string;
  topIssues: { category: string; count: number; trend: 'up' | 'down' | 'stable'; changePercent: number }[];
  totalActions: number;
  autoActions: number;
  humanActions: number;
  avgResponseTimeMinutes: number;
  suggestions: string[];
  healthTrend: 'improving' | 'stable' | 'declining';
};

export async function generateWeeklyInsights(subredditName: string): Promise<WeeklyInsight> {
  const logRaw = await redis.get(`modguard:log:${subredditName}`);
  const logs: {
    action: string;
    violation?: string;
    category?: string;
    timestamp: string;
    auto?: boolean;
  }[] = logRaw ? JSON.parse(logRaw) : [];

  const now = Date.now();
  const oneWeek = 7 * 24 * 60 * 60 * 1000;
  const twoWeeks = 2 * oneWeek;

  const thisWeek = logs.filter(l => now - new Date(l.timestamp).getTime() < oneWeek);
  const lastWeek = logs.filter(l => {
    const age = now - new Date(l.timestamp).getTime();
    return age >= oneWeek && age < twoWeeks;
  });

  // Category counts
  const thisCats: Record<string, number> = {};
  const lastCats: Record<string, number> = {};

  for (const log of thisWeek) {
    const cat = log.category ?? log.violation ?? 'unknown';
    thisCats[cat] = (thisCats[cat] ?? 0) + 1;
  }
  for (const log of lastWeek) {
    const cat = log.category ?? log.violation ?? 'unknown';
    lastCats[cat] = (lastCats[cat] ?? 0) + 1;
  }

  const topIssues = Object.entries(thisCats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, count]) => {
      const prev = lastCats[category] ?? 0;
      const changePercent = prev > 0 ? Math.round(((count - prev) / prev) * 100) : 0;
      const trend: 'up' | 'down' | 'stable' = changePercent > 10 ? 'up' : changePercent < -10 ? 'down' : 'stable';
      return { category, count, trend, changePercent };
    });

  const autoActions = thisWeek.filter(l => l.auto).length;
  const humanActions = thisWeek.length - autoActions;

  // Suggestions
  const suggestions: string[] = [];
  const spamCount = thisCats['spam'] ?? 0;
  const toxicCount = (thisCats['harassment'] ?? 0) + (thisCats['toxicity'] ?? 0);
  const scamCount = thisCats['scam'] ?? 0;

  if (spamCount > 10) suggestions.push('Consider enabling stricter link filtering — spam activity is elevated');
  if (toxicCount > 15) suggestions.push('Toxicity is high — consider enabling slow mode during peak hours');
  if (scamCount > 5) suggestions.push('Scam activity detected — add scam-related keywords to your filter list');
  if (autoActions / Math.max(1, thisWeek.length) < 0.3) suggestions.push('AI auto-action rate is low — consider lowering the confidence threshold');
  if (suggestions.length === 0) suggestions.push('Community is healthy — no immediate rule changes needed');

  const healthTrend: WeeklyInsight['healthTrend'] =
    thisWeek.length < lastWeek.length * 0.8 ? 'improving' :
    thisWeek.length > lastWeek.length * 1.2 ? 'declining' : 'stable';

  return {
    generatedAt: new Date().toISOString(),
    period: `${new Date(now - oneWeek).toLocaleDateString()} – ${new Date(now).toLocaleDateString()}`,
    topIssues,
    totalActions: thisWeek.length,
    autoActions,
    humanActions,
    avgResponseTimeMinutes: 3,  // placeholder — would need timestamps to calculate
    suggestions,
    healthTrend,
  };
}

// ─── Appeal System ────────────────────────────────────────────────────────────

export async function submitAppeal(
  username: string,
  postId: string,
  reason: string,
): Promise<Appeal> {
  const key = `modguard:appeals:${devvitContext.subredditName}`;
  const raw = await redis.get(key);
  const appeals: Appeal[] = raw ? JSON.parse(raw) : [];

  const appeal: Appeal = {
    id: `appeal_${Date.now()}`,
    username,
    postId,
    reason,
    submittedAt: new Date().toISOString(),
    status: 'pending',
  };

  appeals.unshift(appeal);
  await redis.set(key, JSON.stringify(appeals.slice(0, 100)));
  return appeal;
}

export async function getAppeals(status?: Appeal['status']): Promise<Appeal[]> {
  const key = `modguard:appeals:${devvitContext.subredditName}`;
  const raw = await redis.get(key);
  const appeals: Appeal[] = raw ? JSON.parse(raw) : [];
  return status ? appeals.filter(a => a.status === status) : appeals;
}

export async function resolveAppeal(
  appealId: string,
  decision: 'approved' | 'rejected',
  note: string,
): Promise<void> {
  const key = `modguard:appeals:${devvitContext.subredditName}`;
  const raw = await redis.get(key);
  const appeals: Appeal[] = raw ? JSON.parse(raw) : [];

  const idx = appeals.findIndex(a => a.id === appealId);
  if (idx !== -1) {
    const appeal = appeals[idx];
    if (appeal) {
      appeal.status = decision;
      appeal.reviewedBy = devvitContext.userId ?? 'unknown';
      appeal.reviewedAt = new Date().toISOString();
      appeal.reviewNote = note;
      await redis.set(key, JSON.stringify(appeals));
    }
  }
}

// ─── Transparency Report ─────────────────────────────────────────────────────

export type TransparencyReport = {
  subreddit: string;
  generatedAt: string;
  totalActions: number;
  autoActions: number;
  humanActions: number;
  falsePositiveRate: number;
  appealSuccessRate: number;
  moderationAccuracy: number;
  avgConfidence: number;
  feedbackAccuracy: number;
  totalFeedback: number;
  feedbackByAction: Record<string, { total: number; correct: number; accuracy: number }>;
  topCategories: { category: string; count: number }[];
};

export async function generateTransparencyReport(subredditName: string): Promise<TransparencyReport> {
  const logRaw = await redis.get(`modguard:log:${subredditName}`);
  const logs: {
    action: string;
    category?: string;
    auto?: boolean;
    confidence?: number;
    timestamp: string;
  }[] = logRaw ? JSON.parse(logRaw) : [];

  const appealsRaw = await redis.get(`modguard:appeals:${subredditName}`);
  const appeals: Appeal[] = appealsRaw ? JSON.parse(appealsRaw) : [];

  // Get feedback stats
  const feedbackRaw = await redis.get(`modguard:feedback:${subredditName}`);
  const feedbackList: FeedbackItem[] = feedbackRaw ? JSON.parse(feedbackRaw) : [];
  
  const totalFeedback = feedbackList.length;
  const correctFeedback = feedbackList.filter(f => f.correct).length;
  const feedbackAccuracy = totalFeedback > 0 ? Math.round((correctFeedback / totalFeedback) * 100) : 0;
  
  // Group feedback by action
  const feedbackByAction: Record<string, { total: number; correct: number; accuracy: number }> = {};
  feedbackList.forEach(f => {
    if (!feedbackByAction[f.action]) {
      feedbackByAction[f.action] = { total: 0, correct: 0, accuracy: 0 };
    }
    feedbackByAction[f.action]!.total++;
    if (f.correct) feedbackByAction[f.action]!.correct++;
  });
  
  Object.keys(feedbackByAction).forEach(action => {
    const stats = feedbackByAction[action]!;
    stats.accuracy = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
  });

  const autoActions = logs.filter(l => l.auto).length;
  const humanActions = logs.length - autoActions;

  const resolvedAppeals = appeals.filter(a => a.status !== 'pending');
  const approvedAppeals = appeals.filter(a => a.status === 'approved');
  const appealSuccessRate = resolvedAppeals.length > 0
    ? Math.round((approvedAppeals.length / resolvedAppeals.length) * 100)
    : 0;

  const catCounts: Record<string, number> = {};
  for (const log of logs) {
    const cat = log.category ?? 'unknown';
    catCounts[cat] = (catCounts[cat] ?? 0) + 1;
  }

  const topCategories = Object.entries(catCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, count]) => ({ category, count }));

  const confidences = logs.map(l => l.confidence ?? 85).filter(c => c > 0);
  const avgConfidence = confidences.length > 0
    ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length)
    : 0;

  return {
    subreddit: subredditName,
    generatedAt: new Date().toISOString(),
    totalActions: logs.length,
    autoActions,
    humanActions,
    falsePositiveRate: 100 - feedbackAccuracy, // Inverse of feedback accuracy
    appealSuccessRate,
    moderationAccuracy: Math.max(0, 100 - appealSuccessRate),
    avgConfidence,
    feedbackAccuracy,
    totalFeedback,
    feedbackByAction,
    topCategories,
  };
}

// ─── Detector Weights for Feedback-Based Tuning ────────────────────────────────

export type DetectorWeights = {
  toxicity: number;
  hate_speech: number;
  spam: number;
  scam: number;
  nsfw: number;
  misinformation: number;
};

const DEFAULT_WEIGHTS: DetectorWeights = {
  toxicity: 1.0,
  hate_speech: 1.0,
  spam: 1.0,
  scam: 1.0,
  nsfw: 1.0,
  misinformation: 1.0,
};

export async function getDetectorWeights(subredditName: string): Promise<DetectorWeights> {
  const key = `modguard:detector_weights:${subredditName}`;
  const raw = await redis.get(key);
  if (raw) {
    try {
      return JSON.parse(raw) as DetectorWeights;
    } catch {
      return DEFAULT_WEIGHTS;
    }
  }
  return DEFAULT_WEIGHTS;
}

export async function updateDetectorWeights(subredditName: string): Promise<void> {
  try {
    const feedbackRaw = await redis.get(`modguard:feedback:${subredditName}`);
    const feedbackList: FeedbackItem[] = feedbackRaw ? JSON.parse(feedbackRaw) : [];

    if (feedbackList.length < 5) return;

    const weights = { ...DEFAULT_WEIGHTS };
    const adjustments: Record<string, { correct: number; total: number }> = {};

    for (const f of feedbackList) {
      const category = f.category || 'toxicity';
      if (!adjustments[category]) adjustments[category] = { correct: 0, total: 0 };
      adjustments[category]!.total++;
      if (f.correct) adjustments[category]!.correct++;
    }

    for (const [cat, stats] of Object.entries(adjustments)) {
      const accuracy = stats.total > 0 ? stats.correct / stats.total : 0.5;
      const key = cat as keyof typeof weights;
      if (key in weights) {
        if (accuracy >= 0.85) {
          weights[key] = Math.min(2.0, weights[key] + 0.15);
        } else if (accuracy <= 0.4) {
          weights[key] = Math.max(0.2, weights[key] - 0.2);
        }
      }
    }

    await redis.set(`modguard:detector_weights:${subredditName}`, JSON.stringify(weights));
  } catch (error) {
    console.error('Failed to update detector weights:', error);
  }
}