// ─── Pre-Processing Engine ────────────────────────────────────────────────────
// Cleans text, detects language, extracts links/media, normalises evasion

export type PreProcessedContent = {
  original: string;
  cleaned: string;
  normalised: string;
  language: string;
  languageConfidence: number;
  links: string[];
  mediaRefs: string[];
  hasMedia: boolean;
  wordCount: number;
  capsRatio: number;
  punctuationDensity: number;
  repeatedChars: boolean;
  evasionAttempts: string[];
  isAllCaps: boolean;
  toxicSignalCount: number;
};

// ─── Language Detection (lightweight heuristic) ───────────────────────────────

const LANG_PATTERNS: Record<string, RegExp[]> = {
  en: [/\b(the|and|is|are|was|were|you|your|this|that|with|have|for|not|but)\b/gi],
  es: [/\b(el|la|los|las|es|son|que|con|por|para|una|uno|como|pero|más)\b/gi],
  fr: [/\b(le|la|les|est|sont|que|avec|pour|pas|mais|plus|dans|sur|vous)\b/gi],
  de: [/\b(der|die|das|ist|sind|und|mit|für|nicht|aber|auch|sich|auf|ein)\b/gi],
  pt: [/\b(o|a|os|as|é|são|que|com|por|para|uma|um|como|mas|mais)\b/gi],
  hi: [/[\u0900-\u097F]/g],
  ar: [/[\u0600-\u06FF]/g],
  zh: [/[\u4E00-\u9FFF]/g],
  ja: [/[\u3040-\u30FF]/g],
  ko: [/[\uAC00-\uD7AF]/g],
};

export function detectLanguage(text: string): { language: string; confidence: number } {
  const scores: Record<string, number> = {};
  const words = text.split(/\s+/).length || 1;

  for (const [lang, patterns] of Object.entries(LANG_PATTERNS)) {
    let matches = 0;
    for (const pattern of patterns) {
      const found = text.match(pattern);
      matches += found ? found.length : 0;
    }
    scores[lang] = matches / words;
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const top = sorted[0];
  if (!top || top[1] === 0) return { language: 'unknown', confidence: 0 };
  return {
    language: top[0],
    confidence: Math.min(100, Math.round(top[1] * 100)),
  };
}

// ─── Link & Media Extractor ───────────────────────────────────────────────────

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
const MEDIA_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|mp4|mov|avi|webm|pdf|zip|exe|apk)(\?[^\s]*)?$/i;
const SUSPICIOUS_DOMAINS = ['bit.ly', 't.co', 'tinyurl', 'ow.ly', 'goo.gl', 'rb.gy', 'cutt.ly'];

export function extractLinks(text: string): { links: string[]; mediaRefs: string[]; hasSuspiciousLinks: boolean } {
  const links: string[] = [];
  const mediaRefs: string[] = [];
  let hasSuspiciousLinks = false;

  const matches = text.match(URL_REGEX) ?? [];
  for (const url of matches) {
    links.push(url);
    if (MEDIA_EXTENSIONS.test(url)) mediaRefs.push(url);
    if (SUSPICIOUS_DOMAINS.some(d => url.includes(d))) hasSuspiciousLinks = true;
  }

  return { links, mediaRefs, hasSuspiciousLinks };
}

// ─── Evasion Detector ─────────────────────────────────────────────────────────

const EVASION_SUBSTITUTIONS: [RegExp, string][] = [
  [/0/g, 'o'], [/1/g, 'i'], [/3/g, 'e'], [/4/g, 'a'],
  [/5/g, 's'], [/7/g, 't'], [/8/g, 'b'], [/\$/g, 's'],
  [/@/g, 'a'], [/\|/g, 'i'], [/\+/g, 't'], [/!/g, 'i'],
  [/\*/g, ''], [/\./g, ''], [/-/g, ''], [/_/g, ''],
];

export function detectEvasion(original: string, _normalised: string): string[] {
  const attempts: string[] = [];
  const orig = original.toLowerCase();

  // Leet speak
  let leet = orig;
  for (const [pattern, replacement] of EVASION_SUBSTITUTIONS) {
    leet = leet.replace(pattern, replacement);
  }
  if (leet !== orig.replace(/[^a-z0-9\s]/g, '')) {
    attempts.push('leet_speak');
  }

  // Excessive spaces between letters (k i l l)
  if (/\b([a-z]\s){3,}[a-z]\b/i.test(original)) {
    attempts.push('spaced_letters');
  }

  // Unicode lookalikes
  if (/[^\x00-\x7F]/.test(original) && !/[\u4E00-\u9FFF\u0900-\u097F\u0600-\u06FF\u3040-\u30FF\uAC00-\uD7AF]/.test(original)) {
    attempts.push('unicode_substitution');
  }

  // Repeated character bypass (haaate → hate)
  if (/(.)\1{2,}/.test(original)) {
    attempts.push('repeated_chars');
  }

  // Zero-width characters
  if (/[\u200B-\u200D\uFEFF]/.test(original)) {
    attempts.push('zero_width_chars');
  }

  return attempts;
}

// ─── Text Normaliser ──────────────────────────────────────────────────────────

export function normaliseText(text: string): string {
  let t = text.toLowerCase();
  for (const [pattern, replacement] of EVASION_SUBSTITUTIONS) {
    t = t.replace(pattern, replacement);
  }
  return t
    .replace(/(.)\1{2,}/g, '$1$1')   // haaate → haate
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .trim();
}

// ─── Text Statistics ──────────────────────────────────────────────────────────

export function getTextStats(text: string): {
  wordCount: number;
  capsRatio: number;
  punctuationDensity: number;
  isAllCaps: boolean;
  repeatedChars: boolean;
} {
  const words = text.trim().split(/\s+/);
  const wordCount = words.length;
  const letters = text.replace(/[^a-zA-Z]/g, '');
  const upperLetters = text.replace(/[^A-Z]/g, '');
  const capsRatio = letters.length > 0 ? upperLetters.length / letters.length : 0;
  const punctuation = text.replace(/[^!?.,:;]/g, '');
  const punctuationDensity = text.length > 0 ? punctuation.length / text.length : 0;
  const isAllCaps = letters.length > 5 && capsRatio > 0.8;
  const repeatedChars = /(.)\1{2,}/.test(text);

  return { wordCount, capsRatio, punctuationDensity, isAllCaps, repeatedChars };
}

// ─── Toxic Signal Pre-Counter ─────────────────────────────────────────────────

const QUICK_TOXIC_SIGNALS = [
  'kill', 'die', 'hate', 'stupid', 'idiot', 'moron', 'loser',
  'ban', 'spam', 'scam', 'fake', 'fraud', 'hack', 'nude', 'nsfw',
];

export function countToxicSignals(normalised: string): number {
  return QUICK_TOXIC_SIGNALS.filter(s => normalised.includes(s)).length;
}

// ─── Main Pre-Processor ───────────────────────────────────────────────────────

export function preProcess(content: string, title: string = ''): PreProcessedContent {
  const original = (content + ' ' + title).trim();
  const cleaned = original.replace(/\s+/g, ' ').trim();
  const normalised = normaliseText(cleaned);
  const { language, confidence: languageConfidence } = detectLanguage(cleaned);
  const { links, mediaRefs } = extractLinks(cleaned);
  const evasionAttempts = detectEvasion(cleaned, normalised);
  const stats = getTextStats(cleaned);
  const toxicSignalCount = countToxicSignals(normalised);

  return {
    original,
    cleaned,
    normalised,
    language,
    languageConfidence,
    links,
    mediaRefs,
    hasMedia: mediaRefs.length > 0,
    wordCount: stats.wordCount,
    capsRatio: stats.capsRatio,
    punctuationDensity: stats.punctuationDensity,
    repeatedChars: stats.repeatedChars,
    evasionAttempts,
    isAllCaps: stats.isAllCaps,
    toxicSignalCount,
  };
}
