// ─── nuke.ts — Core Moderation Engine (v2) ───────────────────────────────────
// Orchestrates the full AI pipeline: pre-process → detect → risk → decide → act

import { redis, reddit, context as devvitContext } from '@devvit/web/server';
import { preProcess } from './preprocessor';
import { runDetectionPipeline } from './detectors';
import {
  generateRiskScore,
  makeDecision,
  fetchUserProfile,
} from './riskEngine';
import {
  addTimelineEvent,
  checkPatternSimilarity,
  isOnWatchlist,
} from './memory';
import { classifier } from './classifier';
import { analyseImagesSync, ImageAnalysisResult } from './imageAnalyzer';
// ─── Types ────────────────────────────────────────────────────────────────────

export type Severity = 'none' | 'low' | 'medium' | 'high' | 'critical';
export type Action = 'approve' | 'remove' | 'escalate' | 'ban';
export type Category =
  | 'clean' | 'harassment' | 'hate_speech' | 'spam'
  | 'adult_content' | 'violence' | 'drugs' | 'doxxing'
  | 'dark_web' | 'child_safety' | 'misinformation' | 'leaked_content'
  | 'toxicity' | 'scam' | 'nsfw' | 'coordinated_attack';

export type AnalysisResult = {
  category: Category;
  violation: string;
  confidence: number;
  severity: Severity;
  suggestedAction: Action;
  rule: string | null;
  removalMessage: string | null;
  autoAction: boolean;
  requiresImmediateAlert: boolean;
  tier: 1 | 2 | 3 | 0;
  riskScore?: number;
  evasionDetected?: boolean;
  triggeredDetectors?: string[];
  contextNote?: string;
  falsePositiveRisk?: number;
  language?: string;
  memoryInsight?: string | null;
  decisionFactors?: string[];
  estimatedImpact?: {
    toxicityReduction: number;
    appealProbability: string;
    falsePositiveRisk: number;
  };
  imageAnalysis?: ImageAnalysisResult;
};

export type StrikeRecord = {
  username: string;
  count: number;
  history: StrikeEntry[];
  isPermanentlyBanned: boolean;
  currentBanDays: number;
  lastUpdated: string;
};

export type StrikeEntry = {
  strike: number;
  reason: string;
  category: Category;
  postId: string;
  date: string;
  banDays: number;
};

// ─── Text Normalizer (kept for backward compat) ───────────────────────────────

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e')
    .replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't')
    .replace(/8/g, 'b').replace(/\$/g, 's').replace(/@/g, 'a')
    .replace(/[^\w\s]/g, ' ')
    .replace(/(.)\1{2,}/g, '$1$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Strike System ────────────────────────────────────────────────────────────

export function getBanDuration(strikeCount: number): {
  days: number; label: string; permanent: boolean;
} {
  switch (strikeCount) {
    case 1: return { days: 1, label: '1 day timeout', permanent: false };
    case 2: return { days: 3, label: '3 day ban', permanent: false };
    case 3: return { days: 7, label: '7 day ban', permanent: false };
    case 4: return { days: 30, label: '30 day ban', permanent: false };
    default: return { days: 0, label: 'Permanent ban', permanent: true };
  }
}

export async function getUserStrikes(username: string): Promise<StrikeRecord> {
  const key = `modguard:strikes:${username}`;
  const raw = await redis.get(key);
  if (raw) return JSON.parse(raw);
  return {
    username, count: 0, history: [],
    isPermanentlyBanned: false, currentBanDays: 0,
    lastUpdated: new Date().toISOString(),
  };
}

export async function addStrike(
  username: string, reason: string, category: Category, postId: string
): Promise<{ record: StrikeRecord; banInfo: ReturnType<typeof getBanDuration> }> {
  const record = await getUserStrikes(username);
  record.count += 1;
  const banInfo = getBanDuration(record.count);
  record.history.unshift({
    strike: record.count, reason, category, postId,
    date: new Date().toISOString(), banDays: banInfo.days,
  });
  record.isPermanentlyBanned = banInfo.permanent;
  record.currentBanDays = banInfo.days;
  record.lastUpdated = new Date().toISOString();
  await redis.set(`modguard:strikes:${username}`, JSON.stringify(record));

  if (banInfo.permanent) {
    await reddit.banUser({
      subredditName: devvitContext.subredditName, username,
      reason: `Strike 5: ${reason}. Permanent ban by ModGuard AI.`,
      duration: 0,
      message: 'You have been permanently banned. This is your 5th strike.',
    });
  } else {
    await reddit.banUser({
      subredditName: devvitContext.subredditName, username,
      reason: `Strike ${record.count}: ${reason}`,
      duration: banInfo.days,
      message: `Strike ${record.count} of 5. Banned for ${banInfo.label}. At Strike 5 = permanent ban.`,
    });
  }

  await addTimelineEvent({
    type: 'action',
    message: `Strike ${record.count}/5 issued to u/${username} — ${banInfo.label}`,
    severity: record.count >= 4 ? 'critical' : 'warning',
    actor: username,
    auto: false,
  });

  return { record, banInfo };
}

// ─── Main Analysis Function (v2 — full pipeline) ──────────────────────────────

export async function analyseContentFull(
  content: string,
  title: string = '',
  username: string = 'unknown',
): Promise<AnalysisResult> {
  // Step 1: Pre-process
  const pre = preProcess(content, title);

  // Step 2: Run detection pipeline
  const pipeline = runDetectionPipeline(pre);

  // Step 3: Fetch user profile
  const profile = await fetchUserProfile(username);

  // Step 4: Generate risk score
  const risk = generateRiskScore(pipeline, profile);

  // Step 5: AI decision
  const decision = makeDecision(risk, pipeline);

  // Step 6: Memory insight
  const memoryInsight = await checkPatternSimilarity(
    pipeline.detectors.flatMap(d => d.evidence)
  );

  // Step 7: Watchlist check
  const onWatchlist = await isOnWatchlist(username);
  if (onWatchlist && decision.action === 'publish') {
    decision.action = 'queue';
    decision.requiresHumanReview = true;
  }

  // Map to legacy AnalysisResult shape for backward compatibility
  const topDetector = pipeline.detectors
    .filter(d => d.triggered)
    .sort((a, b) => b.confidence - a.confidence)[0];

  const categoryMap: Record<string, Category> = {
    toxicity: 'toxicity',
    hate_speech: 'hate_speech',
    spam: 'spam',
    scam: 'scam',
    nsfw: 'adult_content',
    misinformation: 'misinformation',
  };

  const category: Category = topDetector
    ? (categoryMap[topDetector.detector] ?? 'harassment')
    : 'clean';

  const actionMap: Record<string, Action> = {
    publish: 'approve',
    queue: 'escalate',
    remove: 'remove',
    ban: 'ban',
  };

  const evasionDetected = pre.evasionAttempts.length > 0;

  const result: AnalysisResult = {
    category,
    violation: topDetector?.label ?? 'No Violation Detected',
    confidence: decision.confidence,
    severity: pipeline.highestSeverity as Severity,
    suggestedAction: actionMap[decision.action] ?? 'approve',
    rule: topDetector ? `Detected by: ${topDetector.detector}` : null,
    removalMessage: decision.action !== 'publish'
      ? `Your content was removed: ${decision.reason}`
      : null,
    autoAction: decision.autoExecute,
    requiresImmediateAlert: pipeline.highestSeverity === 'critical',
    tier: pipeline.highestSeverity === 'critical' ? 1
      : pipeline.highestSeverity === 'high' ? 2
      : pipeline.highestSeverity === 'medium' ? 3 : 0,
    riskScore: risk.score,
    evasionDetected,
    triggeredDetectors: pipeline.triggeredDetectors,
    ...(pipeline.context.contextNote ? { contextNote: pipeline.context.contextNote } : {}),
    falsePositiveRisk: pipeline.context.falsePositiveRisk,
    language: pre.language,
    memoryInsight: memoryInsight?.message ?? null,
    decisionFactors: decision.decisionFactors,
    estimatedImpact: decision.estimatedImpact,
  };

  // Image analysis
  try {
    const imageResult = analyseImagesSync(content, title);
    if (imageResult.hasImage) {
      result.imageAnalysis = imageResult;
    }
  } catch {
    // Non-blocking
  }

  return result;
}

const CLASSIFIER_MAP: Record<string, { violation: string; severity: Severity; action: Action; rule: string; tier: 1 | 2 | 3 | 0 }> = {
  child_safety:    { violation: 'Child Safety Violation — CRITICAL', severity: 'critical', action: 'ban', rule: 'Rule 0: Zero tolerance', tier: 1 },
  doxxing:         { violation: 'Doxxing / Personal Information Exposure', severity: 'critical', action: 'ban', rule: 'Rule 2: No doxxing', tier: 1 },
  dark_web:        { violation: 'Dark Web / Illegal Activity', severity: 'critical', action: 'ban', rule: 'Rule 6: No illegal activity', tier: 1 },
  violence:        { violation: 'Direct Threat of Violence', severity: 'critical', action: 'ban', rule: 'Rule 7: No threats', tier: 1 },
  adult_content:   { violation: 'Explicit Adult Content', severity: 'high', action: 'remove', rule: 'Rule 8: No explicit content', tier: 2 },
  hate_speech:     { violation: 'Hate Speech / Discrimination', severity: 'high', action: 'remove', rule: 'Rule 9: No hate speech', tier: 2 },
  harassment:      { violation: 'Harassment', severity: 'high', action: 'remove', rule: 'Rule 1: No harassment', tier: 2 },
  drugs:           { violation: 'Drug Promotion', severity: 'high', action: 'remove', rule: 'Rule 10: No drug promotion', tier: 2 },
  spam:            { violation: 'Spam / Self-Promotion', severity: 'medium', action: 'remove', rule: 'Rule 3: No spam', tier: 3 },
  scam:            { violation: 'Scam / Fraud', severity: 'medium', action: 'remove', rule: 'Rule 11: No scams', tier: 3 },
  misinformation:  { violation: 'Potential Misinformation', severity: 'medium', action: 'escalate', rule: 'Rule 4: No misinformation', tier: 3 },
  leaked_content:  { violation: 'Leaked / Unreleased Content', severity: 'low', action: 'escalate', rule: 'Rule 5: No leaks', tier: 3 },
  toxicity:        { violation: 'Toxic Behavior', severity: 'low', action: 'escalate', rule: 'Rule 12: Be civil', tier: 3 },
  clean:           { violation: 'No Violation Detected', severity: 'none', action: 'approve', rule: null as unknown as string, tier: 0 },
};

export function analyseContent(content: string, title: string = ''): AnalysisResult {
  const text = (content + ' ' + title).toLowerCase();
  const plain = text.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const evasionDetected = plain !== text.replace(/\s+/g, ' ').trim() || /[0O5S$@]/.test(text.replace(/\s/g, ''));

  const prediction = classifier.predict(text);
  const predictedCat = prediction.category as keyof typeof CLASSIFIER_MAP;
  const catInfo = (CLASSIFIER_MAP[predictedCat] ?? CLASSIFIER_MAP.clean)!;

  const confidence = Math.min(99, prediction.confidence);

  const autoAction = catInfo.tier <= 1 || (catInfo.tier === 2 && confidence >= 85) || (catInfo.tier === 3 && confidence >= 90) || predictedCat === 'clean';
  const requiresImmediateAlert = catInfo.tier === 1;

  const removalMessage = catInfo.action === 'approve' ? null
    : `Removed for ${catInfo.violation.toLowerCase()}.`;

  const result: AnalysisResult = {
    category: predictedCat as Category,
    violation: catInfo.violation,
    confidence,
    severity: catInfo.severity,
    suggestedAction: catInfo.action,
    rule: catInfo.rule,
    removalMessage,
    autoAction,
    requiresImmediateAlert,
    tier: catInfo.tier,
    evasionDetected,
  };

  // Run image analysis (sync — URL matching only, no HEAD request)
  try {
    const imageResult = analyseImagesSync(content, title);
    if (imageResult.hasImage) {
      result.imageAnalysis = imageResult;
      if (result.severity === 'none' && imageResult.confidence === 'definite') {
        result.suggestedAction = 'escalate';
      }
    }
  } catch {
    // Image analysis failure should never crash the main analysis
  }

  return result;
}

// ─── User Risk Score ──────────────────────────────────────────────────────────

export async function getUserRiskScore(
  username: string
): Promise<{ score: number; level: string; reason: string }> {
  try {

    const strikes = await getUserStrikes(username);
    let score = 0;
    score += strikes.count * 15;
    if (strikes.isPermanentlyBanned) score += 30;
    const recentViolations = strikes.history.filter(h => {
      const daysDiff = (Date.now() - new Date(h.date).getTime()) / (1000 * 60 * 60 * 24);
      return daysDiff <= 7;
    }).length;
    score += recentViolations * 10;
    try {
      const user = await reddit.getUserByUsername(username);
      const days = Math.floor((Date.now() - new Date(user?.createdAt ?? Date.now()).getTime()) / (1000 * 60 * 60 * 24));
      if (days <= 1) score += 40;
      else if (days <= 7) score += 25;
      else if (days <= 30) score += 10;
    } catch { /* ignore */ }
    score = Math.min(100, score);
    if (score >= 80) return { score, level: 'CRITICAL', reason: 'Multiple severe violations' };
    if (score >= 60) return { score, level: 'HIGH', reason: 'Repeated violations' };
    if (score >= 40) return { score, level: 'MEDIUM', reason: 'Some violations — monitor' };
    if (score >= 20) return { score, level: 'LOW', reason: 'Minor risk factors' };
    return { score, level: 'SAFE', reason: 'No significant risk factors' };
  } catch {
    return { score: 0, level: 'UNKNOWN', reason: 'Unable to calculate' };
  }
}

// ─── New Account Risk ─────────────────────────────────────────────────────────

export async function checkNewAccountRisk(
  username: string
): Promise<{ isNew: boolean; riskLevel: string; warning: string | null; days: number }> {
  try {
    const user = await reddit.getUserByUsername(username);
    const days = Math.floor((Date.now() - new Date(user?.createdAt ?? Date.now()).getTime()) / (1000 * 60 * 60 * 24));
    if (days <= 1) return { isNew: true, riskLevel: 'critical', warning: `⚠️ Account only ${days} day old — VERY HIGH RISK!`, days };
    if (days <= 7) return { isNew: true, riskLevel: 'high', warning: `⚠️ Account ${days} days old — high risk`, days };
    if (days <= 30) return { isNew: true, riskLevel: 'medium', warning: `Account ${days} days old — monitor`, days };
    return { isNew: false, riskLevel: 'low', warning: null, days };
  } catch {
    return { isNew: false, riskLevel: 'unknown', warning: null, days: 0 };
  }
}

// ─── Emotional Temperature ────────────────────────────────────────────────────

export async function updateEmotionalTemperature(subredditName: string, severity: string) {
  try {
    const key = `modguard:emotional:${subredditName}`;
    const raw = await redis.get(key);
    const recent: { time: number; severity: string }[] = raw ? JSON.parse(raw) : [];
    const tenMinsAgo = Date.now() - 10 * 60 * 1000;
    const filtered = recent.filter(r => r.time > tenMinsAgo);
    filtered.push({ time: Date.now(), severity });
    await redis.set(key, JSON.stringify(filtered.slice(-100)));
  } catch { /* ignore */ }
}

export async function getEmotionalTemperature(
  subredditName: string
): Promise<{ temperature: number; status: string; warning: string | null }> {

  try {
    const key = `modguard:emotional:${subredditName}`;
    const raw = await redis.get(key);
    const recent: { time: number; severity: string }[] = raw ? JSON.parse(raw) : [];
    const tenMinsAgo = Date.now() - 10 * 60 * 1000;
    const recentViolations = recent.filter(r => r.time > tenMinsAgo);
    const criticalCount = recentViolations.filter(r => r.severity === 'critical').length;
    const highCount = recentViolations.filter(r => r.severity === 'high').length;
    const mediumCount = recentViolations.filter(r => r.severity === 'medium').length;
    const temperature = Math.min(100, criticalCount * 30 + highCount * 15 + mediumCount * 5);
    if (temperature >= 80) return { temperature, status: 'CRITICAL', warning: '🚨 Community in crisis!' };
    if (temperature >= 60) return { temperature, status: 'HOT', warning: '🔥 Discussion highly toxic' };
    if (temperature >= 40) return { temperature, status: 'WARM', warning: '⚠️ Tension rising' };
    if (temperature >= 20) return { temperature, status: 'MILD', warning: '📊 Minor tension detected' };
    return { temperature, status: 'CALM', warning: null };
  } catch {
    return { temperature: 0, status: 'CALM', warning: null };
  }
}

// ─── Coordinated Attack Detection ────────────────────────────────────────────

export async function detectCoordinatedAttack(
  subredditName: string, author: string
): Promise<{ isAttack: boolean; postCount: number; message: string | null }> {
  try {
    const key = `modguard:recent_posts:${subredditName}`;
    const raw = await redis.get(key);
    const recentPosts: { time: number; author: string }[] = raw ? JSON.parse(raw) : [];
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    const recent = recentPosts.filter(p => p.time > fiveMinutesAgo);
    recent.push({ time: now, author });
    await redis.set(key, JSON.stringify(recent.slice(-50)));
    const uniqueAuthors = new Set(recent.map(p => p.author)).size;
    if (recent.length >= 10) {
      await addTimelineEvent({ type: 'threat', message: `🚨 Coordinated attack: ${recent.length} posts from ${uniqueAuthors} users`, severity: 'critical', auto: true });
      return { isAttack: true, postCount: recent.length, message: `🚨 COORDINATED ATTACK! ${recent.length} posts in 5 mins from ${uniqueAuthors} users!` };
    }
    if (recent.length >= 5) return { isAttack: false, postCount: recent.length, message: `⚠️ High activity: ${recent.length} posts in 5 mins` };
    return { isAttack: false, postCount: recent.length, message: null };
  } catch {
    return { isAttack: false, postCount: 0, message: null };
  }
}

// ─── Community Health Score ───────────────────────────────────────────────────

export async function getCommunityHealthScore(
  subredditName: string
): Promise<{ score: number; grade: string; summary: string }> {
  try {
    const logRaw = await redis.get(`modguard:log:${subredditName}`);
    const logs: { action: string; severity?: string }[] = logRaw ? JSON.parse(logRaw) : [];
    if (logs.length === 0) return { score: 100, grade: 'A+', summary: 'Perfect — no violations yet!' };
    const total = logs.length;
    const removed = logs.filter(l => l.action === 'removed' || l.action === 'auto_removed').length;
    const critical = logs.filter(l => l.severity === 'critical').length;
    const banned = logs.filter(l => l.action === 'ban').length;
    let score = 100;
    score -= (removed / total) * 40;
    score -= (critical / total) * 30;
    score -= (banned / total) * 20;
    score -= Math.min(10, total * 0.5);
    score = Math.max(0, Math.min(100, Math.round(score)));
    if (score >= 90) return { score, grade: 'A+', summary: 'Excellent community health!' };
    if (score >= 80) return { score, grade: 'A', summary: 'Good — minor issues' };
    if (score >= 70) return { score, grade: 'B', summary: 'Moderate issues — needs attention' };
    if (score >= 60) return { score, grade: 'C', summary: 'Several violations — action needed' };
    if (score >= 40) return { score, grade: 'D', summary: 'Poor health — serious issues' };
    return { score, grade: 'F', summary: 'Critical — immediate attention needed!' };
  } catch {
    return { score: 100, grade: 'A+', summary: 'Unable to calculate' };
  }
}

// ─── AI Moderator Copilot Report ──────────────────────────────────────────────

export async function getModeratorCopilotReport(username: string): Promise<string> {
  try {
    const strikes = await getUserStrikes(username);
    const riskScore = await getUserRiskScore(username);
    const accountRisk = await checkNewAccountRisk(username);
    const categories = strikes.history.reduce((acc: Record<string, number>, h) => {
      acc[h.category] = (acc[h.category] ?? 0) + 1;
      return acc;
    }, {});
    const topViolations = Object.entries(categories)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([cat, count]) => `• ${cat}: ${count} times`)
      .join('\n');
    return (
      `📊 ModGuard AI — User Report: u/${username}\n\n` +
      `⚠️ Risk Score: ${riskScore.score}/100 (${riskScore.level})\n` +
      `📅 Account Age: ${accountRisk.days} days\n` +
      `🔴 Total Strikes: ${strikes.count}/5\n` +
      `🚫 Banned: ${strikes.isPermanentlyBanned ? 'Yes — PERMANENT' : strikes.currentBanDays > 0 ? `Yes — ${strikes.currentBanDays} days` : 'No'}\n\n` +
      `📋 Top Violations:\n${topViolations || '• No violations yet'}\n\n` +
      `💡 Recommendation: ${riskScore.reason}\n\n` +
      `🕐 Last Updated: ${new Date(strikes.lastUpdated).toLocaleString()}`
    );
  } catch {
    return `Unable to generate report for u/${username}`;
  }
}

// ─── Evidence Log ─────────────────────────────────────────────────────────────

export async function generateEvidenceLog(
  postId: string, author: string, analysis: AnalysisResult, action: string
): Promise<string> {
  const strikes = await getUserStrikes(author);
  const riskScore = await getUserRiskScore(author);
  return (
    `🔍 ModGuard AI — Evidence Log\n\n` +
    `Action: ${action.toUpperCase()}\n` +
    `Post ID: ${postId}\n` +
    `Author: u/${author}\n` +
    `Timestamp: ${new Date().toISOString()}\n\n` +
    `Evidence:\n` +
    `• Violation: ${analysis.violation}\n` +
    `• Confidence: ${analysis.confidence}%\n` +
    `• Severity: ${analysis.severity.toUpperCase()}\n` +
    `• Category: ${analysis.category}\n` +
    `• Evasion Detected: ${analysis.evasionDetected ? 'YES' : 'No'}\n` +
    `• Detectors Triggered: ${analysis.triggeredDetectors?.join(', ') ?? 'N/A'}\n` +
    `• Context Note: ${analysis.contextNote ?? 'None'}\n` +
    `• False Positive Risk: ${analysis.falsePositiveRisk ?? 0}%\n` +
    `• Language: ${analysis.language ?? 'unknown'}\n\n` +
    `User History:\n` +
    `• Prior Strikes: ${strikes.count}\n` +
    `• Risk Score: ${riskScore.score}/100 (${riskScore.level})\n` +
    `• Permanently Banned: ${strikes.isPermanentlyBanned ? 'YES' : 'No'}\n\n` +
    `Decision Factors:\n${analysis.decisionFactors?.map(f => `• ${f}`).join('\n') ?? '• N/A'}\n\n` +
    `Estimated Impact:\n` +
    `• Toxicity Reduction: ${analysis.estimatedImpact?.toxicityReduction ?? 0}%\n` +
    `• Appeal Probability: ${analysis.estimatedImpact?.appealProbability ?? 'unknown'}\n` +
    `• False Positive Risk: ${analysis.estimatedImpact?.falsePositiveRisk ?? 0}%\n\n` +
    `Memory Insight: ${analysis.memoryInsight ?? 'No similar patterns found'}\n\n` +
    `Applied Rule: ${analysis.rule ?? 'Community guidelines'}\n` +
    `Auto Action: ${analysis.autoAction ? 'YES — System automated' : 'No — Mod decision'}`
  );
}

// ─── Alert All Moderators ─────────────────────────────────────────────────────

export async function alertAllModerators(postId: string, author: string, violation: string) {
  try {
    const mods = await reddit.getModerators({ subredditName: devvitContext.subredditName });
    for await (const mod of mods) {
      await reddit.sendPrivateMessage({
        to: mod.username,
        subject: `🚨 URGENT: Critical violation in r/${devvitContext.subredditName}`,
        text: `ModGuard AI detected a critical violation!\n\nViolation: ${violation}\nAuthor: u/${author}\nPost ID: ${postId}\n\nReview immediately in your ModGuard AI dashboard.`,
      });
    }
    await addTimelineEvent({ type: 'alert', message: `All moderators alerted: ${violation} by u/${author}`, severity: 'critical', actor: author, auto: true });
  } catch (error) {
    console.error('Failed to alert moderators:', error);
  }
}

// ─── Execute Auto Action ──────────────────────────────────────────────────────

export async function executeAutoAction(
  postId: string, author: string, analysis: AnalysisResult, isComment: boolean = false
) {
  try {
    if (analysis.suggestedAction === 'approve') {
      const target = isComment
        ? await reddit.getCommentById(postId as `t1_${string}`)
        : await reddit.getPostById(postId as `t3_${string}`);
      await target.approve();
      await addTimelineEvent({ type: 'action', message: `Auto-approved content by u/${author}`, severity: 'info', actor: author, auto: true });
      const logKey = `modguard:log:${devvitContext.subredditName}`;
      const logRaw = await redis.get(logKey);
      const logs: object[] = logRaw ? JSON.parse(logRaw) : [];
      logs.unshift({ postId, author, action: 'auto_approved', violation: 'none', category: 'clean', severity: 'none', timestamp: new Date().toISOString(), auto: true });
      await redis.set(logKey, JSON.stringify(logs.slice(0, 100)));
      return;
    }

    if (!analysis.autoAction) return;

    if (isComment) {
      const comment = await reddit.getCommentById(postId as `t1_${string}`);
      await comment.remove();
    } else {
      const post = await reddit.getPostById(postId as `t3_${string}`);
      await post.remove();
    }
    if (analysis.removalMessage) {
      await reddit.sendPrivateMessage({
        to: author,
        subject: `Your content was removed from r/${devvitContext.subredditName}`,
        text: analysis.removalMessage,
      });
    }
    const { record, banInfo } = await addStrike(author, analysis.violation, analysis.category, postId);
    if (analysis.requiresImmediateAlert) await alertAllModerators(postId, author, analysis.violation);
    await updateEmotionalTemperature(devvitContext.subredditName, analysis.severity);
    await addTimelineEvent({ type: 'action', message: `Auto-removed content by u/${author}: ${analysis.violation}`, severity: analysis.severity === 'critical' ? 'critical' : 'warning', actor: author, auto: true });
    const logKey = `modguard:log:${devvitContext.subredditName}`;
    const logRaw = await redis.get(logKey);
    const logs: object[] = logRaw ? JSON.parse(logRaw) : [];
    logs.unshift({ postId, author, action: 'auto_removed', violation: analysis.violation, category: analysis.category, severity: analysis.severity, strikeCount: record.count, banApplied: banInfo.label, permanent: banInfo.permanent, evasionDetected: analysis.evasionDetected, timestamp: new Date().toISOString(), auto: true });
    await redis.set(logKey, JSON.stringify(logs.slice(0, 100)));
  } catch (error) {
    console.error('Auto action failed:', error);
  }
}

// ─── Re-export new engine functions for routes ────────────────────────────────

export { predictThreat, getSlowModeRecommendation } from './riskEngine';
export { generateWeeklyInsights, generateTransparencyReport, getTimeline, addTimelineEvent, getAppeals, resolveAppeal, submitAppeal, getWatchlist, addToWatchlist, getModNotes, addModNote, getCollabAlerts, createCollabAlert, getModeratorPreferences, saveModeratorPreferences, updateDetectorWeights, getDetectorWeights } from './memory';

export type BehaviorDNA = {
  username: string;
  dnaScore: number; // 0-1000
  riskPrediction48h: { probability: number; label: string };
  peakRiskBand: string;
  patternTrajectory: { from: string; to: string; trend: 'rising' | 'steady' | 'falling' };
  triggerWords: string[];
  evasionAttempts: number;
  triggeredCategories: string[];
  trustLevel: string;
  raidLink: { coordinatedRisk: number; recommendedShield: boolean };
};

function hourBandFromPercent(pct: number): string {
  // Deterministic mapping: 0-100 -> 00-22 (2-hour bands)
  const bandIndex = Math.max(0, Math.min(10, Math.floor((pct / 100) * 10)));
  const start = bandIndex * 2;
  const end = (start + 2) % 24;
  const fmt = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? 'AM' : 'PM'}`;
  return `${fmt(start)}-${fmt(end)}`;
}

export async function getBehaviorDNA(username: string): Promise<BehaviorDNA> {
  const strikes = await getUserStrikes(username);
  const risk = await getUserRiskScore(username);

  const categories = strikes.history.map(h => h.category);
  const triggeredCategories = Array.from(new Set(categories)).slice(0, 6);

  const countsByCat: Record<string, number> = {};
  for (const c of categories) countsByCat[c] = (countsByCat[c] ?? 0) + 1;
  const topCat = Object.entries(countsByCat).sort((a, b) => b[1] - a[1])[0]?.[0];
  const recentCat = strikes.history[0]?.category;

  const patternTrajectory = {
    from: (recentCat && topCat && recentCat !== topCat) ? recentCat : (recentCat ?? 'clean'),
    to: topCat ?? 'clean',
    trend:
      strikes.count >= 3 ? 'rising' :
      strikes.count === 2 ? 'steady' :
      'falling',
  } as BehaviorDNA['patternTrajectory'];

  // Heuristic trigger words (derived from top categories)
  const triggerMap: Record<string, string[]> = {
    spam: ['promo', 'discount', 'dm me', 'click here'],
    harassment: ['kys', 'worthless', 'you idiot', 'go die'],
    toxicity: ['hate', 'trash', 'idiot'],
    hate_speech: ['subhuman', 'slur', 'ethnic cleansing'],
    scam: ['wallet', 'airdrop', 'send funds', 'investment'],
    adult_content: ['nsfw', 'explicit', 'nude'],
    drugs: ['buy meth', 'fentanyl', 'cocaine'],
    doxxing: ['address', 'phone number', 'ssn'],
    dark_web: ['.onion', 'tor browser', 'dark web'],
    violence: ['i will kill you', 'bomb threat', 'shoot'],
    misinformation: ['government is lying', 'truth they hide', 'vaccines cause'],
    leaked_content: ['leaked', 'unreleased', 'early access'],
    child_safety: ['jailbait', 'minor nude', 'send nudes minor'],
    coordinated_attack: ['raid', 'bot', 'spam wave'],
    clean: ['none'],
  };

  const triggerWords = topCat ? (triggerMap[topCat] ?? ['violation']) : ['violation'];

  // Heuristic evasion attempts: if evasionDetected existed in any history is not stored.
  // We approximate using high risk + multi-category history.
  const categoryDiversity = triggeredCategories.length;
  const evasionAttempts = Math.min(10, Math.max(0, Math.round((risk.score / 20) + (categoryDiversity - 1))));

  const probability48hRaw = Math.min(100, Math.round(risk.score * 0.85 + strikes.count * 3));
  const probability48h = strikes.count === 0 ? Math.min(20, Math.round(risk.score * 0.4)) : probability48hRaw;
  const label = probability48h >= 70 ? 'HIGH' : probability48h >= 40 ? 'MEDIUM' : 'LOW';

  // Peak risk band tied to risk score (deterministic)
  const peakRiskBand = hourBandFromPercent(risk.score);

  const dnaScore = Math.max(0, Math.min(1000, Math.round(probability48h * 10 + risk.score * 2 - strikes.count * 5)));

  // Raid link (reuse existing coordinated signals threshold semantics)
  const coordinatedRisk = Math.min(100, Math.round(risk.score * 0.6 + strikes.count * 4));

  return {
    username,
    dnaScore,
    riskPrediction48h: { probability: probability48h, label },
    peakRiskBand,
    patternTrajectory,
    triggerWords: triggerWords.slice(0, 10),
    evasionAttempts,
    triggeredCategories,
    trustLevel: risk.level,
    raidLink: { coordinatedRisk, recommendedShield: coordinatedRisk >= 70 },
  };
}

export function getAIScore(analysis: AnalysisResult, accountAgeDays: number, strikeCount: number): {
  finalConfidence: number;
  riskWeightedSeverity: string;
  aiInsight: string;
  detectionFactors: string[];
} {
  const factors: string[] = [];
  let adjustedConfidence = analysis.confidence;

  if (analysis.evasionDetected) {
    adjustedConfidence = Math.min(99, adjustedConfidence + 5);
    factors.push('Evasion patterns detected (+5)');
  }

  if (accountAgeDays <= 1) {
    adjustedConfidence = Math.min(99, adjustedConfidence + 8);
    factors.push('New account <1 day (+8)');
  } else if (accountAgeDays <= 7) {
    adjustedConfidence = Math.min(99, adjustedConfidence + 4);
    factors.push('New account <7 days (+4)');
  }

  if (strikeCount >= 3) {
    adjustedConfidence = Math.min(99, adjustedConfidence + 6);
    factors.push(`Repeat offender (${strikeCount} strikes) (+6)`);
  } else if (strikeCount >= 1) {
    adjustedConfidence = Math.min(99, adjustedConfidence + 3);
    factors.push(`Prior strikes (${strikeCount}) (+3)`);
  }

  let severityBoost = 0;
  if (analysis.severity === 'critical') severityBoost = 0;
  else if (analysis.severity === 'high') severityBoost = 1;
  else if (analysis.severity === 'medium') severityBoost = 2;
  else severityBoost = 4;

  const effectiveSeverity = severityBoost <= 1 ? analysis.severity
    : accountAgeDays <= 7 ? (severityBoost <= 2 ? 'high' : 'medium')
    : analysis.severity;

  let insight = '';
  if (analysis.category === 'clean') {
    insight = accountAgeDays <= 7 ? 'Content clean — new account flagged for monitoring'
      : 'No violations detected — content safe';
  } else if (analysis.evasionDetected) {
    insight = `User attempted evasion via text obfuscation — ${analysis.violation}`;
  } else {
    insight = `${analysis.violation} (${adjustedConfidence}% confidence) — account is ${accountAgeDays <= 7 ? 'new (' + accountAgeDays + ' days)' : 'established (' + accountAgeDays + ' days)'}, ${strikeCount > 0 ? strikeCount + ' prior strikes' : 'clean record'}`;
  }

  return {
    finalConfidence: Math.round(adjustedConfidence),
    riskWeightedSeverity: effectiveSeverity,
    aiInsight: insight,
    detectionFactors: factors,
  };
}

