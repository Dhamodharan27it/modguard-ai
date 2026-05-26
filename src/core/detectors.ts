// ─── Modular Detection Pipeline ───────────────────────────────────────────────
// Each detector is independent and returns a DetectorResult.
// The pipeline runs all detectors and the Risk Score Generator aggregates them.

import type { PreProcessedContent } from './preprocessor';

export type DetectorResult = {
  detector: string;
  triggered: boolean;
  confidence: number;       // 0–100
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  label: string;
  evidence: string[];
};

// ─── 1. Toxicity Detector ─────────────────────────────────────────────────────

const TOXICITY_TIERS: { patterns: string[]; weight: number }[] = [
  {
    weight: 3,
    patterns: ['kill yourself', 'kys', 'go die', 'get cancer', 'i hope you die', 'you should die'],
  },
  {
    weight: 2,
    patterns: ['fuck you', 'piece of shit', 'you piece', 'worthless', 'nobody likes you', 'you suck', 'you moron', 'you idiot', 'you stupid'],
  },
  {
    weight: 1,
    patterns: ['idiot', 'moron', 'loser', 'dumb', 'stupid', 'shut up', 'you suck'],
  },
];

export function detectToxicity(pre: PreProcessedContent): DetectorResult {
  const text = pre.normalised;
  const evidence: string[] = [];
  let score = 0;

  for (const tier of TOXICITY_TIERS) {
    for (const p of tier.patterns) {
      if (text.includes(p)) {
        score += tier.weight * 20;
        evidence.push(p);
      }
    }
  }

  // Caps boost
  if (pre.isAllCaps && score > 0) score += 15;
  // Evasion boost
  if (pre.evasionAttempts.length > 0 && score > 0) score += 20;

  score = Math.min(100, score);
  const triggered = score >= 30;

  return {
    detector: 'toxicity',
    triggered,
    confidence: score,
    severity: score >= 80 ? 'critical' : score >= 60 ? 'high' : score >= 40 ? 'medium' : score > 0 ? 'low' : 'none',
    label: triggered ? 'Toxic Content Detected' : 'No Toxicity',
    evidence,
  };
}

// ─── 2. Hate Speech Detector ──────────────────────────────────────────────────

const HATE_PATTERNS: { patterns: string[]; category: string; weight: number }[] = [
  {
    category: 'racial',
    weight: 3,
    patterns: ['ethnic cleansing', 'white supremacy', 'racial purity', 'go back to your country', 'are subhuman', 'should be exterminated'],
  },
  {
    category: 'religious',
    weight: 3,
    patterns: ['all muslims', 'all christians', 'all jews', 'religion should die', 'religious people are'],
  },
  {
    category: 'gender',
    weight: 2,
    patterns: ['women are', 'men are all', 'all women', 'females are', 'males are all'],
  },
  {
    category: 'slurs',
    weight: 3,
    patterns: ['racial slur', 'homophobic slur', 'transphobic'],
  },
];

export function detectHateSpeech(pre: PreProcessedContent): DetectorResult {
  const text = pre.normalised;
  const evidence: string[] = [];
  let score = 0;

  for (const group of HATE_PATTERNS) {
    for (const p of group.patterns) {
      if (text.includes(p)) {
        score += group.weight * 25;
        evidence.push(`[${group.category}] ${p}`);
      }
    }
  }

  score = Math.min(100, score);
  const triggered = score >= 25;

  return {
    detector: 'hate_speech',
    triggered,
    confidence: score,
    severity: score >= 75 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'none',
    label: triggered ? 'Hate Speech Detected' : 'No Hate Speech',
    evidence,
  };
}

// ─── 3. Spam / Bot Detector ───────────────────────────────────────────────────

const SPAM_PATTERNS = [
  'buy now', 'click here', 'limited time', 'discount code', 'affiliate link',
  'check out my', 'follow me', 'subscribe to my', 'free money', 'earn $',
  'dm me for', 'promo code', 'use code', 'link in bio', 'only fans',
  'make money fast', 'work from home', 'passive income', 'crypto giveaway',
  'double your', 'investment opportunity', 'guaranteed returns',
];

export function detectSpam(pre: PreProcessedContent): DetectorResult {
  const text = pre.normalised;
  const evidence: string[] = [];
  let score = 0;

  for (const p of SPAM_PATTERNS) {
    if (text.includes(p)) {
      score += 18;
      evidence.push(p);
    }
  }

  // Link density boost
  if (pre.links.length >= 3) { score += 20; evidence.push(`${pre.links.length} links detected`); }
  if (pre.links.length >= 5) { score += 20; evidence.push('excessive links'); }

  // Repeated content
  if (pre.repeatedChars) { score += 10; evidence.push('repeated characters'); }

  // Very short with link
  if (pre.wordCount < 5 && pre.links.length > 0) { score += 25; evidence.push('short text with link'); }

  score = Math.min(100, score);
  const triggered = score >= 30;

  return {
    detector: 'spam',
    triggered,
    confidence: score,
    severity: score >= 80 ? 'high' : score >= 50 ? 'medium' : score >= 30 ? 'low' : 'none',
    label: triggered ? 'Spam / Bot Activity' : 'No Spam',
    evidence,
  };
}

// ─── 4. Scam / Fraud Detector ─────────────────────────────────────────────────

const SCAM_PATTERNS = [
  'send me your', 'wire transfer', 'western union', 'gift card', 'itunes card',
  'google play card', 'i need your help', 'inheritance', 'lottery winner',
  'unclaimed funds', 'nigerian prince', 'advance fee', 'verify your account',
  'your account has been', 'click to verify', 'suspended account',
  'bank details', 'credit card number', 'social security', 'ssn',
  'phishing', 'fake invoice', 'impersonat',
];

export function detectScam(pre: PreProcessedContent): DetectorResult {
  const text = pre.normalised;
  const evidence: string[] = [];
  let score = 0;

  for (const p of SCAM_PATTERNS) {
    if (text.includes(p)) {
      score += 22;
      evidence.push(p);
    }
  }

  // Suspicious links
  if (pre.links.some(l => ['bit.ly', 'tinyurl', 'ow.ly'].some(d => l.includes(d)))) {
    score += 25;
    evidence.push('suspicious shortened URL');
  }

  score = Math.min(100, score);
  const triggered = score >= 22;

  return {
    detector: 'scam',
    triggered,
    confidence: score,
    severity: score >= 70 ? 'critical' : score >= 44 ? 'high' : score >= 22 ? 'medium' : 'none',
    label: triggered ? 'Scam / Fraud Detected' : 'No Scam',
    evidence,
  };
}

// ─── 5. NSFW Detector ────────────────────────────────────────────────────────

const NSFW_PATTERNS = [
  'nsfw', 'explicit content', 'nude', 'naked', 'pornographic', 'xxx',
  'onlyfans', 'sexual content', 'graphic sex', 'adult content',
  '18+', 'not safe for work', 'lewd', 'hentai', 'erotic',
];

export function detectNSFW(pre: PreProcessedContent): DetectorResult {
  const text = pre.normalised;
  const evidence: string[] = [];
  let score = 0;

  for (const p of NSFW_PATTERNS) {
    if (text.includes(p)) {
      score += 20;
      evidence.push(p);
    }
  }

  // Media with NSFW signals
  if (pre.hasMedia && score > 0) { score += 20; evidence.push('media attachment with NSFW signals'); }

  score = Math.min(100, score);
  const triggered = score >= 20;

  return {
    detector: 'nsfw',
    triggered,
    confidence: score,
    severity: score >= 80 ? 'high' : score >= 40 ? 'medium' : score >= 20 ? 'low' : 'none',
    label: triggered ? 'NSFW Content Detected' : 'No NSFW',
    evidence,
  };
}

// ─── 6. Misinformation Detector ───────────────────────────────────────────────

const MISINFO_PATTERNS = [
  'doctors dont want you to know', 'mainstream media is hiding',
  '5g causes', 'vaccines cause', 'the truth they hide',
  'government is lying', 'deep state', 'plandemic', 'fake pandemic',
  'microchip in vaccine', 'bill gates', 'new world order',
  'chemtrails', 'flat earth', 'crisis actor', 'false flag',
  'they dont want you to know', 'banned information',
];

export function detectMisinformation(pre: PreProcessedContent): DetectorResult {
  const text = pre.normalised;
  const evidence: string[] = [];
  let score = 0;

  for (const p of MISINFO_PATTERNS) {
    if (text.includes(p)) {
      score += 20;
      evidence.push(p);
    }
  }

  score = Math.min(100, score);
  const triggered = score >= 20;

  return {
    detector: 'misinformation',
    triggered,
    confidence: score,
    severity: score >= 60 ? 'high' : score >= 40 ? 'medium' : score >= 20 ? 'low' : 'none',
    label: triggered ? 'Potential Misinformation' : 'No Misinformation',
    evidence,
  };
}

// ─── 7. Context Analyser (Sarcasm / Gaming Slang / Quotes) ───────────────────

const SARCASM_SIGNALS = ['/s', 'sarcasm', 'obviously', 'totally', 'sure buddy', 'yeah right', 'oh wow', 'great job'];
const GAMING_SLANG = ['gg', 'gg ez', 'noob', 'git gud', 'rekt', 'pwned', 'tryhard', 'camping', 'griefing', 'ganking'];
const QUOTE_SIGNALS = ['"', '>', 'quoting', 'they said', 'he said', 'she said', 'according to'];

export type ContextAnalysis = {
  isSarcasm: boolean;
  isGamingContext: boolean;
  isQuote: boolean;
  falsePositiveRisk: number;  // 0–100, higher = more likely false positive
  contextNote: string | null;
};

export function analyseContext(pre: PreProcessedContent): ContextAnalysis {
  const text = pre.normalised;
  const original = pre.original.toLowerCase();

  const isSarcasm = SARCASM_SIGNALS.some(s => original.includes(s));
  const isGamingContext = GAMING_SLANG.filter(s => text.includes(s)).length >= 2;
  const isQuote = QUOTE_SIGNALS.some(s => original.includes(s));

  let falsePositiveRisk = 0;
  if (isSarcasm) falsePositiveRisk += 35;
  if (isGamingContext) falsePositiveRisk += 25;
  if (isQuote) falsePositiveRisk += 30;

  let contextNote: string | null = null;
  if (isSarcasm) contextNote = 'Sarcasm marker detected — review before actioning';
  else if (isGamingContext) contextNote = 'Gaming context detected — slang may be non-harmful';
  else if (isQuote) contextNote = 'Content appears to be a quote — verify intent';

  return { isSarcasm, isGamingContext, isQuote, falsePositiveRisk, contextNote };
}

// ─── Run Full Detection Pipeline ─────────────────────────────────────────────

export type PipelineResult = {
  detectors: DetectorResult[];
  context: ContextAnalysis;
  triggeredDetectors: string[];
  highestSeverity: DetectorResult['severity'];
  aggregateScore: number;
};

export function runDetectionPipeline(pre: PreProcessedContent, weights?: Record<string, number>): PipelineResult {
  const detectors: DetectorResult[] = [
    detectToxicity(pre),
    detectHateSpeech(pre),
    detectSpam(pre),
    detectScam(pre),
    detectNSFW(pre),
    detectMisinformation(pre),
  ];

  const context = analyseContext(pre);
  const triggered = detectors.filter(d => d.triggered);

  const severityOrder: DetectorResult['severity'][] = ['none', 'low', 'medium', 'high', 'critical'];
  const highestSeverity = triggered.reduce<DetectorResult['severity']>((max, d) => {
    return severityOrder.indexOf(d.severity) > severityOrder.indexOf(max) ? d.severity : max;
  }, 'none');

  // Aggregate score: weighted average of triggered detectors, reduced by false positive risk
  let aggregateScore = 0;
  if (triggered.length > 0) {
    const raw = triggered.reduce((sum, d) => sum + d.confidence * (weights?.[d.detector] ?? 1), 0);
    const weightSum = triggered.reduce((sum, d) => sum + (weights?.[d.detector] ?? 1), 0);
    const weightedAverage = weightSum > 0 ? raw / weightSum : 0;
    const fpReduction = context.falsePositiveRisk * 0.4;
    aggregateScore = Math.max(0, Math.round(weightedAverage - fpReduction));
  }

  return {
    detectors,
    context,
    triggeredDetectors: triggered.map(d => d.detector),
    highestSeverity,
    aggregateScore,
  };
}
