import { redis, reddit, context as devvitContext } from '@devvit/web/server';

// ─── Types ────────────────────────────────────────────────────────────────────

export type Severity = 'none' | 'low' | 'medium' | 'high' | 'critical';
export type Action = 'approve' | 'remove' | 'escalate' | 'ban';
export type Category =
  | 'clean'
  | 'harassment'
  | 'hate_speech'
  | 'spam'
  | 'adult_content'
  | 'violence'
  | 'drugs'
  | 'doxxing'
  | 'dark_web'
  | 'child_safety'
  | 'misinformation'
  | 'leaked_content';

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

// ─── Strike System ────────────────────────────────────────────────────────────

export function getBanDuration(strikeCount: number): {
  days: number;
  label: string;
  permanent: boolean;
} {
  switch (strikeCount) {
    case 1:
      return { days: 1, label: '1 day timeout', permanent: false };
    case 2:
      return { days: 3, label: '3 day ban', permanent: false };
    case 3:
      return { days: 7, label: '7 day ban', permanent: false };
    case 4:
      return { days: 30, label: '30 day ban', permanent: false };
    default:
      return { days: 0, label: 'Permanent ban', permanent: true };
  }
}

// ─── Get or create strike record ──────────────────────────────────────────────

export async function getUserStrikes(
  username: string
): Promise<StrikeRecord> {
  const key = `modguard:strikes:${username}`;
  const raw = await redis.get(key);

  if (raw) return JSON.parse(raw);

  return {
    username,
    count: 0,
    history: [],
    isPermanentlyBanned: false,
    currentBanDays: 0,
    lastUpdated: new Date().toISOString(),
  };
}

// ─── Add a strike to a user ───────────────────────────────────────────────────

export async function addStrike(
  username: string,
  reason: string,
  category: Category,
  postId: string
): Promise<{ record: StrikeRecord; banInfo: ReturnType<typeof getBanDuration> }> {
  const record = await getUserStrikes(username);

  record.count += 1;
  const banInfo = getBanDuration(record.count);

  const entry: StrikeEntry = {
    strike: record.count,
    reason,
    category,
    postId,
    date: new Date().toISOString(),
    banDays: banInfo.days,
  };

  record.history.unshift(entry);
  record.isPermanentlyBanned = banInfo.permanent;
  record.currentBanDays = banInfo.days;
  record.lastUpdated = new Date().toISOString();

  await redis.set(
    `modguard:strikes:${username}`,
    JSON.stringify(record)
  );

  if (banInfo.permanent) {
    await reddit.banUser({
      subredditName: devvitContext.subredditName,
      username,
      reason: `Strike 5 reached: ${reason}. Permanent ban applied by ModGuard AI.`,
      duration: 0,
      message:
        'You have been permanently banned from this community due to repeated violations. ' +
        'This is your 5th strike. This action cannot be reversed.',
    });
  } else {
    await reddit.banUser({
      subredditName: devvitContext.subredditName,
      username,
      reason: `Strike ${record.count}: ${reason}`,
      duration: banInfo.days,
      message:
        `You have received Strike ${record.count} of 5. ` +
        `You are banned for ${banInfo.label}. ` +
        `Further violations will result in longer bans. ` +
        `At Strike 5 you will be permanently banned.`,
    });
  }

  return { record, banInfo };
}

// ─── Main Detection Engine ────────────────────────────────────────────────────

export function analyseContent(content: string, title: string = ''): AnalysisResult {
  const text = (content + ' ' + title).toLowerCase();

  // ── TIER 1: CRITICAL ──────────────────────────────────────────────────────

  const childSafetyPatterns = [
    'jailbait', 'preteen', 'underage girl', 'underage boy',
    'child nude', 'kid nude', 'minor nude', 'cp link',
    'children sex', 'kids sex', 'minor sex',
    'send nudes minor', 'young girl naked', 'young boy naked',
  ];
  if (childSafetyPatterns.some((p) => text.includes(p))) {
    return {
      category: 'child_safety',
      violation: 'Child Safety Violation — CRITICAL',
      confidence: 99,
      severity: 'critical',
      suggestedAction: 'ban',
      rule: 'Rule 0: Zero tolerance for child exploitation',
      removalMessage:
        'Your content has been removed for violating our zero-tolerance ' +
        'child safety policy. This incident has been logged and reported.',
      autoAction: true,
      requiresImmediateAlert: true,
      tier: 1,
    };
  }

  const doxxPatterns = [
    'home address', 'his address is', 'her address is',
    'phone number is', 'social security', 'ssn is',
    'passport number', 'bank account', 'credit card number',
    'i know where you live', 'dox', 'leaked personal info',
  ];
  const doxxScore = doxxPatterns.filter((p) => text.includes(p)).length;
  if (doxxScore >= 1) {
    return {
      category: 'doxxing',
      violation: 'Doxxing / Personal Information Exposure',
      confidence: Math.min(97, 85 + doxxScore * 6),
      severity: 'critical',
      suggestedAction: 'ban',
      rule: 'Rule 2: No doxxing or personal information',
      removalMessage:
        'Your post was removed for sharing personal information about another person. ' +
        'Doxxing is a serious violation and may result in a permanent ban.',
      autoAction: true,
      requiresImmediateAlert: true,
      tier: 1,
    };
  }

  const darkWebPatterns = [
    '.onion', 'tor browser', 'dark web', 'darkweb',
    'buy drugs online', 'illegal weapons', 'hitman',
    'silk road', 'dream market', 'buy stolen',
    'counterfeit', 'fake id', 'fake passport',
  ];
  const darkWebScore = darkWebPatterns.filter((p) => text.includes(p)).length;
  if (darkWebScore >= 1) {
    return {
      category: 'dark_web',
      violation: 'Dark Web / Illegal Activity Link',
      confidence: Math.min(96, 82 + darkWebScore * 7),
      severity: 'critical',
      suggestedAction: 'ban',
      rule: 'Rule 6: No illegal activity or dark web links',
      removalMessage:
        'Your post was removed for promoting illegal activities or dark web content. ' +
        'This is a serious violation of our community rules.',
      autoAction: true,
      requiresImmediateAlert: true,
      tier: 1,
    };
  }

  const threatPatterns = [
    'i will kill you', 'i will hurt you', 'you will die',
    'i know where you live', 'watch your back',
    'going to shoot', 'bomb threat', 'send a shooter',
  ];
  const threatScore = threatPatterns.filter((p) => text.includes(p)).length;
  if (threatScore >= 1) {
    return {
      category: 'violence',
      violation: 'Direct Threat of Violence',
      confidence: Math.min(97, 88 + threatScore * 5),
      severity: 'critical',
      suggestedAction: 'ban',
      rule: 'Rule 7: No threats of violence',
      removalMessage:
        'Your post was removed for containing direct threats of violence. ' +
        'This is a zero tolerance violation.',
      autoAction: true,
      requiresImmediateAlert: true,
      tier: 1,
    };
  }

  // ── TIER 2: HIGH ──────────────────────────────────────────────────────────

  const adultPatterns = [
    'nsfw', 'explicit content', 'nude', 'naked',
    'pornographic', 'xxx', 'onlyfans link',
    'sexual content', 'graphic sex',
  ];
  const adultScore = adultPatterns.filter((p) => text.includes(p)).length;
  if (adultScore >= 2) {
    return {
      category: 'adult_content',
      violation: 'Explicit 18+ / Adult Content',
      confidence: Math.min(93, 75 + adultScore * 9),
      severity: 'high',
      suggestedAction: 'remove',
      rule: 'Rule 8: No explicit adult content',
      removalMessage:
        'Your post was removed for containing explicit adult content ' +
        'which is not permitted in this community.',
      autoAction: true,
      requiresImmediateAlert: false,
      tier: 2,
    };
  }

  const hatePatterns = [
    'all ethnicity', 'all religion', 'should die',
    'are subhuman', 'white supremacy', 'ethnic cleansing',
    'racial slur', 'go back to your country',
  ];
  const hateScore = hatePatterns.filter((p) => text.includes(p)).length;
  if (hateScore >= 1) {
    return {
      category: 'hate_speech',
      violation: 'Hate Speech / Discrimination',
      confidence: Math.min(94, 80 + hateScore * 7),
      severity: 'high',
      suggestedAction: 'remove',
      rule: 'Rule 9: No hate speech or discrimination',
      removalMessage:
        'Your post was removed for containing hate speech or discriminatory content.',
      autoAction: true,
      requiresImmediateAlert: false,
      tier: 2,
    };
  }

  const harassPatterns = [
    'you idiot', 'fuck you', 'you stupid', 'worthless',
    'kill yourself', 'kys', 'you dumb', 'nobody likes you',
    'you suck', 'get cancer', 'go die', 'you moron', 'loser',
  ];
  const harassScore = harassPatterns.filter((p) => text.includes(p)).length;
  if (harassScore >= 2) {
    return {
      category: 'harassment',
      violation: 'Severe Harassment / Personal Attack',
      confidence: Math.min(95, 75 + harassScore * 8),
      severity: 'high',
      suggestedAction: 'remove',
      rule: 'Rule 1: No harassment or personal attacks',
      removalMessage:
        'Your post was removed for severe harassment. ' +
        'Repeated violations will result in a permanent ban.',
      autoAction: true,
      requiresImmediateAlert: false,
      tier: 2,
    };
  }

  const drugPatterns = [
    'buy cocaine', 'buy heroin', 'buy meth',
    'sell drugs', 'drug dealer', 'how to make meth',
    'fentanyl for sale', 'buy weed online',
  ];
  const drugScore = drugPatterns.filter((p) => text.includes(p)).length;
  if (drugScore >= 1) {
    return {
      category: 'drugs',
      violation: 'Drug Promotion / Illegal Substances',
      confidence: Math.min(92, 78 + drugScore * 7),
      severity: 'high',
      suggestedAction: 'remove',
      rule: 'Rule 10: No drug promotion',
      removalMessage:
        'Your post was removed for promoting or facilitating illegal drug activity.',
      autoAction: false,
      requiresImmediateAlert: false,
      tier: 2,
    };
  }

  // ── TIER 3: MEDIUM ────────────────────────────────────────────────────────

  const spamPatterns = [
    'buy now', 'click here', 'limited time offer',
    'discount code', 'affiliate', 'check out my',
    'follow me', 'subscribe to my', 'free money',
    'earn $', 'dm me for', 'promo code',
  ];
  const spamScore = spamPatterns.filter((p) => text.includes(p)).length;
  if (spamScore >= 2) {
    return {
      category: 'spam',
      violation: 'Spam / Self-Promotion',
      confidence: Math.min(94, 76 + spamScore * 9),
      severity: 'medium',
      suggestedAction: 'remove',
      rule: 'Rule 3: No spam or self-promotion',
      removalMessage:
        'Your post was removed for spam or unsolicited self-promotion.',
      autoAction: false,
      requiresImmediateAlert: false,
      tier: 3,
    };
  }

  if (harassScore === 1) {
    return {
      category: 'harassment',
      violation: 'Personal Attack / Harassment',
      confidence: 80,
      severity: 'medium',
      suggestedAction: 'remove',
      rule: 'Rule 1: No harassment or personal attacks',
      removalMessage:
        'Your post was removed for violating Rule 1. Please keep discussions respectful.',
      autoAction: false,
      requiresImmediateAlert: false,
      tier: 3,
    };
  }

  const misinfoPatterns = [
    'doctors dont want you to know',
    'mainstream media is hiding',
    '5g causes', 'vaccines cause',
    'the truth they hide', 'government is lying',
  ];
  const misinfoScore = misinfoPatterns.filter((p) => text.includes(p)).length;
  if (misinfoScore >= 1) {
    return {
      category: 'misinformation',
      violation: 'Potential Misinformation',
      confidence: Math.min(82, 68 + misinfoScore * 7),
      severity: 'medium',
      suggestedAction: 'escalate',
      rule: 'Rule 4: No misinformation',
      removalMessage:
        'Your post has been flagged for potential misinformation and sent for review.',
      autoAction: false,
      requiresImmediateAlert: false,
      tier: 3,
    };
  }

  const leakPatterns = [
    'leaked', 'datamine', 'unreleased',
    'before official', 'early access leak',
  ];
  const leakScore = leakPatterns.filter((p) => text.includes(p)).length;
  if (leakScore >= 1) {
    return {
      category: 'leaked_content',
      violation: 'Leaked / Unreleased Content',
      confidence: Math.min(80, 65 + leakScore * 8),
      severity: 'low',
      suggestedAction: 'escalate',
      rule: 'Rule 5: No leaks or spoilers',
      removalMessage:
        'Your post has been escalated as it may contain leaked or unreleased content.',
      autoAction: false,
      requiresImmediateAlert: false,
      tier: 3,
    };
  }

  // ── TIER 0: CLEAN ─────────────────────────────────────────────────────────

  return {
    category: 'clean',
    violation: 'No Violation Detected',
    confidence: 91,
    severity: 'none',
    suggestedAction: 'approve',
    rule: null,
    removalMessage: null,
    autoAction: false,
    requiresImmediateAlert: false,
    tier: 0,
  };
}

// ─── Alert all moderators ─────────────────────────────────────────────────────

export async function alertAllModerators(
  postId: string,
  author: string,
  violation: string
) {
  try {
    const mods = await reddit.getModerators({
      subredditName: devvitContext.subredditName,
    });

    for await (const mod of mods) {
      await reddit.sendPrivateMessage({
        to: mod.username,
        subject: `🚨 URGENT: Critical violation detected in r/${devvitContext.subredditName}`,
        text:
          `ModGuard AI has detected a critical violation requiring immediate attention.\n\n` +
          `Violation: ${violation}\n` +
          `Author: u/${author}\n` +
          `Post ID: ${postId}\n` +
          `Action taken: Auto-removed + strike issued\n\n` +
          `Please review immediately in your ModGuard AI dashboard.`,
      });
    }
  } catch (error) {
    console.error('Failed to alert moderators:', error);
  }
}

// ─── Execute auto action ──────────────────────────────────────────────────────

export async function executeAutoAction(
  postId: string,
  author: string,
  analysis: AnalysisResult,
  isComment: boolean = false
) {
  if (!analysis.autoAction) return;

  try {
    if (isComment) {
      const comment = await reddit.getCommentById(postId);
      await comment.remove();
    } else {
      const post = await reddit.getPostById(postId);
      await post.remove();
    }

    if (analysis.removalMessage) {
      await reddit.sendPrivateMessage({
        to: author,
        subject: `Your content was removed from r/${devvitContext.subredditName}`,
        text: analysis.removalMessage,
      });
    }

    const { record, banInfo } = await addStrike(
      author,
      analysis.violation,
      analysis.category,
      postId
    );

    if (analysis.requiresImmediateAlert) {
      await alertAllModerators(postId, author, analysis.violation);
    }

    const logKey = `modguard:log:${devvitContext.subredditName}`;
    const logRaw = await redis.get(logKey);
    const logs: object[] = logRaw ? JSON.parse(logRaw) : [];

    logs.unshift({
      postId,
      author,
      action: 'auto_removed',
      violation: analysis.violation,
      category: analysis.category,
      severity: analysis.severity,
      strikeCount: record.count,
      banApplied: banInfo.label,
      permanent: banInfo.permanent,
      timestamp: new Date().toISOString(),
      auto: true,
    });

    await redis.set(logKey, JSON.stringify(logs.slice(0, 100)));
  } catch (error) {
    console.error('Auto action failed:', error);
  }
}