// ─── Risk Score Generator + AI Decision Engine ───────────────────────────────
// Combines pipeline results, user history, account age, and behavioural signals
// into a final risk score and a clear moderation decision.

import { redis, reddit } from '@devvit/web/server';
import type { PipelineResult } from './detectors';
import type { StrikeRecord } from './nuke';

export type TrustLevel = 'new' | 'low' | 'standard' | 'trusted' | 'veteran';

export type UserProfile = {
  username: string;
  trustLevel: TrustLevel;
  accountAgeDays: number;
  strikeCount: number;
  isPermanentlyBanned: boolean;
  recentViolations: number;   // last 7 days
  karmaScore: number;
  postCount: number;
};

export type RiskAssessment = {
  score: number;              // 0–100
  level: 'SAFE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  trustLevel: TrustLevel;
  factors: string[];
  recommendation: string;
};

export type ModerationDecision = {
  action: 'publish' | 'queue' | 'remove' | 'ban';
  confidence: number;
  reason: string;
  autoExecute: boolean;
  requiresHumanReview: boolean;
  decisionFactors: string[];
  falsePositiveRisk: number;
  estimatedImpact: {
    toxicityReduction: number;
    appealProbability: 'low' | 'medium' | 'high';
    falsePositiveRisk: number;
  };
};

// ─── Trust Level Calculator ───────────────────────────────────────────────────

export function calculateTrustLevel(
  accountAgeDays: number,
  strikeCount: number,
  karmaScore: number,
): TrustLevel {
  if (strikeCount >= 3) return 'low';
  if (accountAgeDays <= 1) return 'new';
  if (accountAgeDays <= 7) return 'low';
  if (accountAgeDays >= 365 && karmaScore >= 1000 && strikeCount === 0) return 'veteran';
  if (accountAgeDays >= 90 && karmaScore >= 100 && strikeCount === 0) return 'trusted';
  return 'standard';
}

// ─── Risk Score Generator ─────────────────────────────────────────────────────

export function generateRiskScore(
  pipeline: PipelineResult,
  profile: UserProfile,
): RiskAssessment {
  const factors: string[] = [];
  let score = pipeline.aggregateScore;

  // Trust level modifiers
  if (profile.trustLevel === 'new') { score += 25; factors.push('New account (+25)'); }
  else if (profile.trustLevel === 'low') { score += 15; factors.push('Low trust account (+15)'); }
  else if (profile.trustLevel === 'trusted') { score -= 15; factors.push('Trusted account (-15)'); }
  else if (profile.trustLevel === 'veteran') { score -= 25; factors.push('Veteran account (-25)'); }

  // Strike history
  if (profile.strikeCount >= 4) { score += 30; factors.push(`${profile.strikeCount} prior strikes (+30)`); }
  else if (profile.strikeCount >= 2) { score += 15; factors.push(`${profile.strikeCount} prior strikes (+15)`); }
  else if (profile.strikeCount === 1) { score += 8; factors.push('1 prior strike (+8)'); }

  // Recent violations (last 7 days)
  if (profile.recentViolations >= 3) { score += 20; factors.push('3+ violations this week (+20)'); }
  else if (profile.recentViolations >= 1) { score += 10; factors.push('Recent violation (+10)'); }

  // Permanent ban flag
  if (profile.isPermanentlyBanned) { score += 40; factors.push('Permanently banned user (+40)'); }

  // Context reduction
  if (pipeline.context.falsePositiveRisk > 30) {
    const reduction = Math.round(pipeline.context.falsePositiveRisk * 0.3);
    score -= reduction;
    factors.push(`Context analysis: ${pipeline.context.contextNote ?? 'possible false positive'} (-${reduction})`);
  }

  // Evasion boost
  if (pipeline.detectors.some(d => d.triggered) && profile.trustLevel === 'new') {
    score += 10;
    factors.push('New account with violations (+10)');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let level: RiskAssessment['level'];
  let recommendation: string;
  if (score >= 80) { level = 'CRITICAL'; recommendation = 'Immediate removal and ban recommended'; }
  else if (score >= 60) { level = 'HIGH'; recommendation = 'Remove content and issue strike'; }
  else if (score >= 40) { level = 'MEDIUM'; recommendation = 'Queue for human review'; }
  else if (score >= 20) { level = 'LOW'; recommendation = 'Monitor — no immediate action needed'; }
  else { level = 'SAFE'; recommendation = 'Publish — no violations detected'; }

  return { score, level, trustLevel: profile.trustLevel, factors, recommendation };
}

// ─── AI Decision Engine ───────────────────────────────────────────────────────

export function makeDecision(
  risk: RiskAssessment,
  pipeline: PipelineResult,
): ModerationDecision {
  const factors: string[] = [...risk.factors];
  const fp = pipeline.context.falsePositiveRisk;

  // Critical violations always auto-remove regardless of context
  const hasCritical = pipeline.highestSeverity === 'critical';
  const hasHigh = pipeline.highestSeverity === 'high';

  let action: ModerationDecision['action'];
  let confidence: number;
  let reason: string;
  let autoExecute: boolean;
  let requiresHumanReview: boolean;

  if (hasCritical && risk.score >= 70) {
    action = 'ban';
    confidence = Math.min(99, risk.score + 5);
    reason = `Critical violation: ${pipeline.triggeredDetectors.join(', ')}`;
    autoExecute = true;
    requiresHumanReview = false;
    factors.push('Critical severity → auto-ban');
  } else if (hasCritical || (hasHigh && risk.score >= 75)) {
    action = 'remove';
    confidence = Math.min(97, risk.score);
    reason = `High-severity violation: ${pipeline.triggeredDetectors.join(', ')}`;
    autoExecute = risk.score >= 85 && fp < 20;
    requiresHumanReview = fp >= 20;
    factors.push(autoExecute ? 'Auto-remove threshold met' : 'Queued for human review');
  } else if (risk.score >= 50) {
    action = 'queue';
    confidence = risk.score;
    reason = `Suspicious content: ${pipeline.triggeredDetectors.join(', ')}`;
    autoExecute = false;
    requiresHumanReview = true;
    factors.push('Queued for moderator review');
  } else if (risk.score >= 25) {
    action = 'queue';
    confidence = risk.score;
    reason = 'Low-level signals detected — human review recommended';
    autoExecute = false;
    requiresHumanReview = true;
  } else {
    action = 'publish';
    confidence = 100 - risk.score;
    reason = 'No violations detected';
    autoExecute = true;
    requiresHumanReview = false;
  }

  // Estimate impact
  const toxicityReduction = action === 'remove' || action === 'ban' ? Math.round(risk.score * 0.6) : 0;
  const appealProbability: 'low' | 'medium' | 'high' =
    fp >= 40 ? 'high' : fp >= 20 ? 'medium' : 'low';

  return {
    action,
    confidence,
    reason,
    autoExecute,
    requiresHumanReview,
    decisionFactors: factors,
    falsePositiveRisk: fp,
    estimatedImpact: {
      toxicityReduction,
      appealProbability,
      falsePositiveRisk: fp,
    },
  };
}

// ─── Fetch User Profile from Redis + Reddit API ───────────────────────────────

export async function fetchUserProfile(username: string): Promise<UserProfile> {
  try {
    const strikesRaw = await redis.get(`modguard:strikes:${username}`);
    const strikes: StrikeRecord = strikesRaw
      ? JSON.parse(strikesRaw)
      : { username, count: 0, history: [], isPermanentlyBanned: false, currentBanDays: 0, lastUpdated: new Date().toISOString() };

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentViolations = strikes.history.filter(
      h => new Date(h.date).getTime() > sevenDaysAgo
    ).length;

    let accountAgeDays = 30;
    let karmaScore = 100;
    let postCount = 0;

    try {
      const user = await reddit.getUserByUsername(username);
      accountAgeDays = Math.floor((Date.now() - new Date(user?.createdAt ?? Date.now()).getTime()) / (1000 * 60 * 60 * 24));
      karmaScore = (user?.linkKarma ?? 0) + (user?.commentKarma ?? 0);
      postCount = user?.linkKarma ?? 0;
    } catch { /* ignore — use defaults */ }

    const trustLevel = calculateTrustLevel(accountAgeDays, strikes.count, karmaScore);

    return {
      username,
      trustLevel,
      accountAgeDays,
      strikeCount: strikes.count,
      isPermanentlyBanned: strikes.isPermanentlyBanned,
      recentViolations,
      karmaScore,
      postCount,
    };
  } catch {
    return {
      username,
      trustLevel: 'standard',
      accountAgeDays: 30,
      strikeCount: 0,
      isPermanentlyBanned: false,
      recentViolations: 0,
      karmaScore: 0,
      postCount: 0,
    };
  }
}

// ─── Threat Prediction Engine ─────────────────────────────────────────────────

export type ThreatPrediction = {
  threatLevel: 'none' | 'low' | 'elevated' | 'high' | 'imminent';
  probability: number;       // 0–100
  signals: string[];
  warning: string | null;
  timeWindow: string | null;
};

export async function predictThreat(subredditName: string): Promise<ThreatPrediction> {
  try {
    const signals: string[] = [];
    let score = 0;

    // Check recent post surge
    const recentKey = `modguard:recent_posts:${subredditName}`;
    const recentRaw = await redis.get(recentKey);
    const recentPosts: { time: number; author: string }[] = recentRaw ? JSON.parse(recentRaw) : [];
    const now = Date.now();
    const fiveMins = now - 5 * 60 * 1000;
    const tenMins = now - 10 * 60 * 1000;

    const last5 = recentPosts.filter(p => p.time > fiveMins);
    const last10 = recentPosts.filter(p => p.time > tenMins);
    void last10; // used for future pattern analysis
    const uniqueAuthors5 = new Set(last5.map(p => p.author)).size;

    if (last5.length >= 15) { score += 40; signals.push(`${last5.length} posts in last 5 mins`); }
    else if (last5.length >= 8) { score += 25; signals.push(`${last5.length} posts in last 5 mins (elevated)`); }

    if (uniqueAuthors5 >= 10) { score += 30; signals.push(`${uniqueAuthors5} unique accounts posting rapidly`); }

    // New account surge
    const newAccountKey = `modguard:new_accounts:${subredditName}`;
    const newAccountRaw = await redis.get(newAccountKey);
    const newAccounts: { time: number }[] = newAccountRaw ? JSON.parse(newAccountRaw) : [];
    const recentNew = newAccounts.filter(a => a.time > fiveMins).length;
    if (recentNew >= 5) { score += 35; signals.push(`${recentNew} new accounts active in 5 mins`); }
    else if (recentNew >= 3) { score += 20; signals.push(`${recentNew} new accounts active`); }

    // Emotional temperature
    const emotionalKey = `modguard:emotional:${subredditName}`;
    const emotionalRaw = await redis.get(emotionalKey);
    const emotional: { time: number; severity: string }[] = emotionalRaw ? JSON.parse(emotionalRaw) : [];
    const recentCritical = emotional.filter(e => e.time > fiveMins && e.severity === 'critical').length;
    if (recentCritical >= 3) { score += 25; signals.push(`${recentCritical} critical violations in 5 mins`); }

    // Repeated keywords (from log)
    const logRaw = await redis.get(`modguard:log:${subredditName}`);
    const logs: { timestamp: string; reason?: string }[] = logRaw ? JSON.parse(logRaw) : [];
    const recentLogs = logs.filter(l => new Date(l.timestamp).getTime() > tenMins);
    if (recentLogs.length >= 8) { score += 20; signals.push(`${recentLogs.length} mod actions in last 10 mins`); }

    score = Math.min(100, score);

    let threatLevel: ThreatPrediction['threatLevel'];
    let warning: string | null = null;
    let timeWindow: string | null = null;

    if (score >= 80) {
      threatLevel = 'imminent';
      warning = '🚨 RAID IMMINENT — Coordinated attack likely in progress!';
      timeWindow = 'NOW';
    } else if (score >= 60) {
      threatLevel = 'high';
      warning = '⚠️ HIGH THREAT — Possible raid attack predicted in next 5–10 minutes';
      timeWindow = '5–10 minutes';
    } else if (score >= 40) {
      threatLevel = 'elevated';
      warning = '📊 ELEVATED — Unusual activity detected, monitor closely';
      timeWindow = '10–20 minutes';
    } else if (score >= 20) {
      threatLevel = 'low';
      warning = 'Minor activity spike detected';
      timeWindow = null;
    } else {
      threatLevel = 'none';
    }

    return { threatLevel, probability: score, signals, warning, timeWindow };
  } catch {
    return { threatLevel: 'none', probability: 0, signals: [], warning: null, timeWindow: null };
  }
}

// ─── Smart Slow Mode ──────────────────────────────────────────────────────────

export type SlowModeRecommendation = {
  shouldActivate: boolean;
  mode: 'none' | 'slow' | 'approval' | 'lockdown';
  reason: string | null;
  suggestedDurationMinutes: number;
};

export async function getSlowModeRecommendation(
  subredditName: string,
  threat: ThreatPrediction,
): Promise<SlowModeRecommendation> {
  if (threat.threatLevel === 'imminent' || threat.probability >= 80) {
    return { shouldActivate: true, mode: 'lockdown', reason: 'Imminent raid detected', suggestedDurationMinutes: 30 };
  }
  if (threat.threatLevel === 'high' || threat.probability >= 60) {
    return { shouldActivate: true, mode: 'approval', reason: 'High threat level — approval mode recommended', suggestedDurationMinutes: 15 };
  }
  if (threat.threatLevel === 'elevated' || threat.probability >= 40) {
    return { shouldActivate: true, mode: 'slow', reason: 'Elevated activity — slow mode recommended', suggestedDurationMinutes: 10 };
  }

  // Check emotional temperature independently
  const emotionalKey = `modguard:emotional:${subredditName}`;
  const emotionalRaw = await redis.get(emotionalKey);
  const emotional: { time: number; severity: string }[] = emotionalRaw ? JSON.parse(emotionalRaw) : [];
  const fiveMins = Date.now() - 5 * 60 * 1000;
  const recentHigh = emotional.filter(e => e.time > fiveMins && (e.severity === 'high' || e.severity === 'critical')).length;

  if (recentHigh >= 5) {
    return { shouldActivate: true, mode: 'slow', reason: 'High toxicity spike — slow mode recommended', suggestedDurationMinutes: 10 };
  }

  return { shouldActivate: false, mode: 'none', reason: null, suggestedDurationMinutes: 0 };
}
