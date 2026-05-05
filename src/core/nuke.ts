import { getContext } from 'devvit/web/server';

//types------

export type Severity = 'none' | 'low' | 'medium' | 'high' | 'critical';
export type Action = 'approve' | 'remove' | 'escalate' | 'ban';
export type Category = 
  | 'clean'
  | 'harassment'
  | 'hate_speech'
  | 'spam'
  | 'adult_content'
  | 'violance'
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
    tier: 1 | 2 | 3 | 0 |;
  };

  export type StrikeRecord = {
    username: string;
    count: number;
    history: StrikeEntry [];
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
 
// Strike system

export function getBanDuration(strikeCount: number): {
  days: number;
  label: string;
  permanent: boolean;
}
 {
  switch (strikeCount) {
    case 1: 
      return {days: 1, label: '1 day timeout', permanent: false};
    case 2:
      return {days: 3, label: '3 day ban', permanent: false};
    case 3: 
      return {days: 7, label: '7 day ban', permanent: false};
    case 4:
      return {days: 30, label: '30 day ban', permanent: false};
    defult:
      return {days: 0, label: 'Permanent ban', permanent: true};        
  }
}

//get or create strike

export async function getUserStrikes(
  context: ReturnType<typeof getContext>,
  username: string
): Promise<StrikeRecord> {
  const key = 'modguard:strikes:${usename}';
  const raw = await context.redis.get(key);

  if (raw) return JSON.parse(raw);

  return {
    username,
    count: 0,
    history: [],
    ispermanentlyBanned: false,
    currentBanned: false,
    lastUpdated: new Date().toISOString(),
  };
}

// add a strike to a user
export async function addStrike(
  context: ReturnType<tyoeof getContext>,
  username: string,
  reason: string,
  category: Category,
  postId: string
): Promise<{ record: SrikeRecord; banInfo: ReturnType<typeof getBanDuration> }> {
  const record = await getUserStrikes(context, username);

  //add new strike
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

  record.history.unshit(entry);
  record.isPermanentlyBanned = banInfo.permanent;
  record.lastupdated = new Date().toISOString();

  //save updated record

  await context.redis.set(
    'modguard:strikes:${username}',
    JSON.stringify(record)
  );

  // apply the ban on reddit

  if (banInfo.permanent) {
    await context.reddit.banUser({
      subredditName: context.subredditName,
      username,
      reason: 'Strike 5 reached: ${ reason }. Permenent ban applied by modGuard AI.',
      duration: 0,
      message:
        'you have been parmenently banned from this community due to repeated violations. ' +
        'this is your 5th strike. this action cannot be reversed.',

    });
  } else {
    await context.reddit.danUser({
      subredditName: context.subredditname,
      username,
      reason: 'Strike ${record.count}: ${reason}',
      message:
        'you have recieved Strike ${record.count} of 5 ' +
        'you are banned for ${banInfo.label}. ' +
        'Further violations will result in longer bans. ' +
        'At Strike 5 you will be permanently banned. ',
    });
  }

  return { record, banInfo };
}

// main detection engine

export function analyseContent(content: DOMStringList, title: string = ''): AnalysisResult {
  const text =(content + '' + title).toLowerCase();
  const original = content + '' + title;

  //tier 1: critical-auto removal

  const childSafetyPatterns = [
    'jailbait', 'preteen', 'underage girl', 'underage boy',
    'child nude', 'kid nude', 'minor nude', 'cp link',
    'children sex', 'kids sex', 'kids sex', 'minor sex',
    'send nudes minor', 'young girl naked', 'young boy naked',
  ];

  if (childSafetyPatterns.some((p) => text.includes(p))) {
    return {
      category: 'child_safety',
      violation: 'Child Safety Violation - CRITICAL',
      confidence: 99,
      severity: 'critical',
      suggestedAction: 'ban',
      rule: 'Rule 0: Zero tolerance for child exploitation',
      removalMessage:
        'Your content has been removed for violating our zero-tolerance ' +
        'child safety policy. this incident has been logged and reported. ',
      autoAction: true,
      requiresImmediateAlert: true,
      tier: 1,   
    };
  }

  //doxxing -personal info exposure
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
      confidence: Math.min(97, 85 + doxxScore *6),
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
  
  //dark web / illegal market links
  const darkwebPatterns = [
    '.onion', 'tor browser', 'dark web', 'darkweb',
    'buy drugs online', 'illegal weapons', 'hitman',
    'silk road', 'dream market', 'buy stolen',
    'counterfeit', 'fake id', 'fake passport',
  ];
  const darkwebScore = darkwebPatterns.filter((p) => text.includes(p)).length;
  if (darkwebScore => 1) {
    return {
      category: 'dark_web',
      violation: 'Dark web / Illegal Activity Link',
      confidence: Math.min(96, 82 + darkwebScore * 7),
      severity: 'critical',
      suggestedAction: 'ban',
      rule: 'Rule 6: No illegal activity or dark web links',
      removalMessage:
        'Your post was removed for promating illegal activities or dark web content. ' +
        'this is a serious violation of our community rules. ',
      autoAction: true,
      requiresImmediateAlert: true,
      tier: 1,   
    };
  }
  
  //direct vioaltion threats

  const threatPatterns = [
    'i will kill you', 'i will hurt you', 'you will die',
    'i know where you live', 'watch your back',
    'going to shoot', 'bomb threat', 'send a shooter',
  ];

  const threatScore = threatPatterns.filter((p) => text.includes(p)).length;
  if (threatScore >= 1) {
    return {
      category: 'violence',
      violation: 'Direct threat of Violence',
      confidence: Math.min(97, 88 + threatScore * 5),
      severity: 'critical',
      suggestedAction: 'ban',
      rule: 'Rule 7: No threats of violence',
      removalMessage:
        'Your post was removed for containing direct threads of violance. ' +
        'This is zero tolerance violation. ',
      autoAction: true,
      requiresImmediateAlert: true,
      tier: 1,   
    };
  }

  // tier 2 high revome alert

  //explicit 18+ content
  const adultPatterns = [
    'nsfw', 'explicit content', 'nude', 'naked',
    'pornograghic', 'xxx', 'onlyfans link',
    'sexual content', 'graphics sex'
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
        'Your post was removed for containig explicit adult content ' +
        'which is not permitted in this community. ',
      autoAction: true,
      requiresImmediateAlert: true,
      tier: 2,   
    };
  }

  // hate speech
  const hatePatterns = [
    'all [ethnicity]', 'all [religion]', '[group] should be die',
    '[group] are subhuman','white supremacy', 'ethnic cleansing',
    'racial slur', 'go back to your country,'
  ];
  const hateScore = hatePatterns.filter((p) => text.includes(p)).length;
  if (hateScore >= 1) {
    return {
      category: 'hate_speech',
      violation: 'Hate Speech / Discrimination',
      confidence: Math.min(94, 80 + hateScore * 7),
      severity: 'high',
      suggestedAction: 'revome',
      rule: 'Rule 9: No hate speech or discrimination',
      removalMessage:
        'Your post was removed for containing hate speech or discriminatory content.',
      autoAction: true,
      requiresImmediateAlert: false,
      tier: 2,   
    };
  }

  //harassment
  const harassment = [
    'you idiot', 'fuck', 'fuck you', 'you stupid', 'worthless', 'kill yourself',
    'murder', 'suicide', 'get out', 'nobody likes you', 'you suck', 'losser', 
    'you sucker', 'sucker', 'get cancer', 'go die', 'you moron', 'kys', 'you dumb',
  ];
  const harassScore = harassment.filter((w) => text.includes(w)).length;
  if (harassScore >= 2) {
      return {
        category: 'harassment',
        violation: 'Severe Harassment / Personal Attack',
        confidence: Math.min(95, 75 + hateScore * 8),
        severity: 'high',
        suggestedAction: 'revome',
        rule: 'Rule 1: No Harassment or personal attacks',
        removalMessage:
          'Your post was removed for severe harassment.' +
          'Repeated violations will result in a permanent ban.',
        autoAction: true,
        requiresImmediateAlert: false,
        tier: 2,   
      };
  }

  //drug promotion
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
      suggestedAction: 'revome',
      rule: 'Rule 10: No drug promotion',
      removalMessage:
        'Your post was removed for promoting or facilitating illegal drug activity.',
      autoAction: true,
      requiresImmediateAlert: false,
      tier: 2,   
    };
  }

  //tier 3: medium

  //spam
  const spamPatterns = [
    'buy now', 'click here', 'limited time offer', 'discount code',
    'affiliate', 'check out my', 'follow me', 'subscribe to my',
    'free money', 'earn $', 'dm me for ', 'promo code'
  ];
  const spamScore = spamPatterns.filter((w) => text.includes(w)).length;
  if (spamScore >= 2) {
    return {
      category: 'spam',
      violation: 'Spam/ Self-Promotion',
      confidence: Math.min(94, 76 + spamScore * 9),
      severity: 'medium',
      suggestedAction: 'revome',
      rule: 'Rule 10: No drug promotion',
      removalMessage:
        'Your post was removed for promoting or facilitating illegal drug activity.',
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
      suggestedAction: 'revome',
      rule: 'Rule 1: No harassment or personal attacks',
      removalMessage:
        'Your post was removed for violating Rule 1. please keep discussions respectful.',
      autoAction: false,
      requiresImmediateAlert: false,
      tier: 3,   
    };
  }

  //moisinformation
  const misinfoPatterns = [
    'doctors dont want you know',
    'mainstream media is hiding',
    '5g causes', 'vaccines cause',
    'the truth they hide', 'government is lying',
  ];
  const misinfoScore = misinfoPatterns.filter((w) => text.includes(w)).length;
  if (misinfoScore >= 1) {
    return {
      category: 'misinformation',
      violation: 'Potential misinformation',
      confidence: Math.min(82, 68 + misinfoScore * 7),
      severity: 'medium',
      suggestedAction: 'escalate',
      rule: 'Rule 4: No misinformation',
      removalMessage:
        'Your post has been flagged for potential misinformation and for review.',
      autoAction: false,
      requiresImmediateAlert: false,
      tier: 3,   
    };
  }

  //leaked content
  const leakPatterns = [
    'leaked', 'detarmine', 'unrealeased',
    'before official', 'early access leak',
  ];
  const leakScore = leakPatterns.filter((p) => text.includes(p)).length;
  if (leakScore >= 1) {
    return {
      category: 'leaked_content',
      violation: 'leaked / Unreleased Content',
      confidence: Math.min(80, 65 + leakScore * 8),
      severity: 'low',
      suggestedAction: 'escalate',
      rule: 'Rule 5: No leaks or spoilers',
      removalMessage:
        'Your post has been escalated as it may contain leaked or unleased content.',
      autoAction: false,
      requiresImmediateAlert: false,
      tier: 3,   
    };
  }

  //tier 0: clean

    return {
      category: 'clean',
      violation: 'No Violation Detected',
      confidence: 91,
      severity: 'none',
      suggestedAction: 'approve',
      rule: 'null',
      removalMessage: null,
      autoAction: false,
      requiresImmediateAlert: false,
      tier: 0,   
    };
}

// alert all mods

export async function alertAllModerators(
  context: ReturnType<typeof getContext>,
  postId: string,
  author: string,
  violation: string
) {
  try {
    const subreddit = awiat context.reddit.getSubredditInfoByName(
      context.subredditName
    );
    const mods = await context.reddit.getModerators({
      subredditName: context.subredditName,
    });

    for await(const mod of mods) {
      await context.reddit.sendPrivateMessage({
        to: mod.username,
        subject: 'URGENT: Critical violation detected in r/${context.subredditname}',
        text:
          'ModGuard AI has detected a critical violation requiring immediate attention.\n\n' +
          'Violation: ${violation}\n ' +
          'Author: u/${author}\n' +
          'Post ID: ${PostId}\n' +
          'Acvtion taken: Auto-removed + strike issued\n\n' +
          'Please review immediately in your ModGuard AI dashboard,' ,
      });
    }

  }
}

