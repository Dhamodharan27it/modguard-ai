// ─── Image Analyzer — Tier 1 + Tier 2 Smart URL Detection ────────────────────
// Detects image/video content from URLs, context signals, and heuristic scoring.
// No API key required. Metadata fetch (HEAD) is best-effort.

export type ImageConfidence = 'definite' | 'likely' | 'possible' | 'none';

export type ImageSignal =
  | { type: 'domain_match'; value: string }
  | { type: 'extension'; value: string }
  | { type: 'cdn_pattern'; value: string }
  | { type: 'short_url'; value: string }
  | { type: 'post_hint'; value: string }
  | { type: 'title_keyword'; value: string }
  | { type: 'flair_tag'; value: string }
  | { type: 'gallery'; value: string }
  | { type: 'content_type_head'; value: string }
  | { type: 'url_count'; value: number }
  | { type: 'known_image_domain'; value: string };

export type ImageAnalysisResult = {
  score: number;           // 0-100 heuristic score
  confidence: ImageConfidence;
  hasImage: boolean;
  signals: ImageSignal[];
  imageUrls: string[];
  contentType: string | null;
  cached: boolean;
};

// ─── Known Image Domains ─────────────────────────────────────────────────────

const KNOWN_IMAGE_DOMAINS: [string, string][] = [
  ['i.redd.it', 'Reddit image host'],
  ['i.reddituploads.com', 'Reddit legacy upload'],
  ['preview.redd.it', 'Reddit preview'],
  ['imgur.com', 'Imgur'],
  ['i.imgur.com', 'Imgur direct'],
  ['gfycat.com', 'Gfycat'],
  ['gifdeliverynetwork.com', 'Gfycat CDN'],
  ['giphy.com', 'GIPHY'],
  ['media.giphy.com', 'GIPHY media'],
  ['cdn.discordapp.com', 'Discord CDN'],
  ['pbs.twimg.com', 'Twitter media'],
  ['video.twimg.com', 'Twitter video'],
  ['youtu.be', 'YouTube short'],
  ['youtube.com', 'YouTube'],
  ['m.youtube.com', 'YouTube mobile'],
  ['v.redd.it', 'Reddit video'],
  ['reddit.com/gallery/', 'Reddit gallery'],
  ['reddit.com/r/', 'Reddit crosspost'],
  ['tenor.com', 'Tenor GIF'],
  ['media.tenor.com', 'Tenor GIF direct'],
  ['flickr.com', 'Flickr'],
  ['live.staticflickr.com', 'Flickr static'],
  ['deviantart.com', 'DeviantArt'],
  ['images-wixmp-ed30a86b8c4ca887773594c2.wixmp.com', 'DeviantArt CDN'],
  ['instagram.com', 'Instagram'],
  ['cdninstagram.com', 'Instagram CDN'],
  ['facebook.com', 'Facebook'],
  ['tiktok.com', 'TikTok'],
  ['images.unsplash.com', 'Unsplash'],
  ['cdnb.artstation.com', 'ArtStation'],
  ['cdn.dribbble.com', 'Dribbble'],
  ['miro.medium.com', 'Medium'],
  ['blogger.googleusercontent.com', 'Blogger'],
  ['lh3.googleusercontent.com', 'Google Photos'],
  ['drive.google.com', 'Google Drive'],
  ['dropbox.com', 'Dropbox'],
  ['dl.dropboxusercontent.com', 'Dropbox direct'],
];

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.heic', '.heif',
  '.bmp', '.svg', '.tiff', '.tif', '.ico',
]);

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.webm', '.mov', '.avi', '.mkv', '.flv', '.wmv', '.m4v',
]);

const SHORT_DOMAINS = new Set([
  'bit.ly', 'tinyurl.com', 'tiny.cc', 'ow.ly', 'is.gd', 'buff.ly',
  'goo.gl', 'rb.gy', 't.co', 'shorturl.at', 'cutt.ly', 'shorte.st',
  'adf.ly', 's.id', 'gg.gg', 'v.gd', 'cli.re',
]);

const CDN_PATTERNS = [
  /cdn\d*\./i,
  /\.cdn\./i,
  /static\d*\./i,
  /media\d*\./i,
  /images?\d*\./i,
  /storage\./i,
  /uploads?\d*\./i,
  /\bcloudfront\.net/i,
  /\bcloudinary\.com/i,
  /\bfastly\.net/i,
  /\bakamai/,
  /\bimgix\./i,
  /\bkeycdn\./i,
  /\bunpkg\./i,
  /\.s3\./i,
  /\.s3-[\w-]+\.amazonaws\.com/i,
];

// ─── URL Extraction ──────────────────────────────────────────────────────────

function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>"']+/gi;
  const matches = text.match(urlRegex);
  return matches ?? [];
}

function normalizeUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, '').split('?')[0]!.split('#')[0]!;
}

function getDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    const match = url.match(/https?:\/\/(?:www\.)?([^/\s]+)/i);
    return match?.[1]?.toLowerCase() ?? '';
  }
}

function getExtension(url: string): string {
  const path = new URL(url).pathname;
  const match = path.match(/\.([a-zA-Z0-9]+)(?:\?|#|$)/);
  if (!match) return '';
  return '.' + match[1]!.toLowerCase();
}

// ─── Signal Detection ────────────────────────────────────────────────────────

function detectDomainSignals(urls: string[]): ImageSignal[] {
  const signals: ImageSignal[] = [];
  const seen = new Set<string>();

  for (const url of urls) {
    const domain = getDomain(url);
    for (const [pattern, label] of KNOWN_IMAGE_DOMAINS) {
      if (domain.includes(pattern) || url.toLowerCase().includes(pattern)) {
        if (!seen.has(label)) {
          seen.add(label);
          signals.push({ type: 'domain_match', value: label });
          signals.push({ type: 'known_image_domain', value: domain });
        }
      }
    }
  }
  return signals;
}

function detectExtensionSignals(urls: string[]): ImageSignal[] {
  const signals: ImageSignal[] = [];
  for (const url of urls) {
    const ext = getExtension(url);
    if (IMAGE_EXTENSIONS.has(ext)) {
      signals.push({ type: 'extension', value: ext });
    } else if (VIDEO_EXTENSIONS.has(ext)) {
      signals.push({ type: 'extension', value: ext });
    }
  }
  return signals;
}

function detectCdnPatterns(url: string): ImageSignal[] {
  const signals: ImageSignal[] = [];
  for (const pattern of CDN_PATTERNS) {
    if (pattern.test(url)) {
      signals.push({ type: 'cdn_pattern', value: pattern.source.slice(0, 30) });
      break;
    }
  }
  return signals;
}

function detectShortUrls(urls: string[]): ImageSignal[] {
  const signals: ImageSignal[] = [];
  for (const url of urls) {
    const domain = getDomain(url);
    if (SHORT_DOMAINS.has(domain)) {
      signals.push({ type: 'short_url', value: domain });
    }
  }
  return signals;
}

function detectContextSignals(
  title: string,
  postHint?: string,
  flair?: string,
): ImageSignal[] {
  const signals: ImageSignal[] = [];

  if (postHint) {
    const hint = postHint.toLowerCase();
    if (['image', 'rich:video', 'hosted:video', 'link'].includes(hint)) {
      signals.push({ type: 'post_hint', value: hint });
    }
  }

  const titleLower = title.toLowerCase();
  const titleKeywords = [
    '[oc]', '[pic]', 'screenshot', 'photo', 'photography',
    'selfie', 'meme', 'artwork', 'drawing', 'fanart',
    'wallpaper', 'album', 'gallery', 'picture', 'pics',
    'video', 'clip', 'gif', 'timelapse',
  ];
  for (const kw of titleKeywords) {
    if (titleLower.includes(kw)) {
      signals.push({ type: 'title_keyword', value: kw });
    }
  }

  if (flair) {
    const flairLower = flair.toLowerCase();
    const flairKeywords = ['art', 'photography', 'meme', 'media', 'video', 'image'];
    for (const fk of flairKeywords) {
      if (flairLower.includes(fk)) {
        signals.push({ type: 'flair_tag', value: fk });
      }
    }
  }

  const galleryMatch = titleLower.match(/reddit\.com\/gallery\/([a-z0-9]+)/);
  if (galleryMatch) {
    signals.push({ type: 'gallery', value: galleryMatch[0]! });
  }

  return signals;
}

// ─── Heuristic Scoring ───────────────────────────────────────────────────────

const WEIGHTS = {
  knownImageDomain: 25,
  imageExtension: 20,
  cdnPattern: 10,
  postHintImage: 20,
  postHintVideo: 15,
  titleKeyword: 8,
  flairTag: 5,
  galleryLink: 15,
  multipleUrls: 10,
  shortUrlPenalty: -5,
  videoExtension: 10,
  contentTypeImage: 20,
};

function computeScore(signals: ImageSignal[], imageUrlCount: number): number {
  let score = 0;

  for (const signal of signals) {
    switch (signal.type) {
      case 'domain_match':
        score += WEIGHTS.knownImageDomain;
        break;
      case 'extension':
        if (IMAGE_EXTENSIONS.has(signal.value)) score += WEIGHTS.imageExtension;
        else if (VIDEO_EXTENSIONS.has(signal.value)) score += WEIGHTS.videoExtension;
        break;
      case 'cdn_pattern':
        score += WEIGHTS.cdnPattern;
        break;
      case 'post_hint':
        score += signal.value === 'image' ? WEIGHTS.postHintImage
          : signal.value.startsWith('rich:') || signal.value === 'hosted:video'
          ? WEIGHTS.postHintVideo
          : 5;
        break;
      case 'title_keyword':
        score += WEIGHTS.titleKeyword;
        break;
      case 'flair_tag':
        score += WEIGHTS.flairTag;
        break;
      case 'gallery':
        score += WEIGHTS.galleryLink;
        break;
      case 'short_url':
        score += WEIGHTS.shortUrlPenalty;
        break;
      case 'content_type_head':
        if (signal.value.startsWith('image/')) score += WEIGHTS.contentTypeImage;
        else if (signal.value.startsWith('video/')) score += WEIGHTS.videoExtension;
        break;
    }
  }

  if (imageUrlCount >= 3) score += WEIGHTS.multipleUrls;
  else if (imageUrlCount >= 2) score += 5;

  return Math.max(0, Math.min(100, score));
}

function confidenceFromScore(score: number): ImageConfidence {
  if (score >= 70) return 'definite';
  if (score >= 40) return 'likely';
  if (score >= 15) return 'possible';
  return 'none';
}

// ─── Metadata Fetch (HEAD) ──────────────────────────────────────────────────

const contentTypeCache = new Map<string, { type: string; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const FETCH_TIMEOUT_MS = 3000;

async function fetchContentType(url: string): Promise<string | null> {
  const normalized = normalizeUrl(url);
  const cached = contentTypeCache.get(normalized);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.type;
  }
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
    });
    clearTimeout(id);

    const ct = res.headers.get('content-type');
    if (ct) {
      const primary = ct.split(';')[0]!.trim();
      contentTypeCache.set(normalized, { type: primary, ts: Date.now() });
      return primary;
    }
  } catch {
    // Graceful fallback — don't crash
  }
  return null;
}

export function clearImageCache(): void {
  contentTypeCache.clear();
}

// ─── Sync Analysis (no HEAD request) ───────────────────────────────────────

export function analyseImagesSync(
  content: string,
  title: string = '',
  options?: {
    postHint?: string;
    flair?: string;
  },
): ImageAnalysisResult {
  const urls = extractUrls(content + ' ' + title);
  const imageUrls = urls.filter(u => {
    const ext = getExtension(u);
    if (IMAGE_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext)) return true;
    const domain = getDomain(u);
    for (const [pattern] of KNOWN_IMAGE_DOMAINS) {
      if (domain.includes(pattern) || u.toLowerCase().includes(pattern)) return true;
    }
    return false;
  });

  const signals: ImageSignal[] = [
    ...detectDomainSignals(urls),
    ...detectExtensionSignals(urls),
    ...urls.flatMap(u => detectCdnPatterns(u)),
    ...detectShortUrls(urls),
    ...detectContextSignals(title, options?.postHint, options?.flair),
  ];

  if (imageUrls.length > 0) {
    signals.push({ type: 'url_count', value: imageUrls.length });
  }

  const score = computeScore(signals, imageUrls.length);
  const confidence = confidenceFromScore(score);

  return {
    score,
    confidence,
    hasImage: confidence !== 'none',
    signals,
    imageUrls,
    contentType: null,
    cached: false,
  };
}

// ─── Main Analysis Entry Point (async, with HEAD request) ──────────────────

export async function analyseImages(
  content: string,
  title: string = '',
  options?: {
    postHint?: string;
    flair?: string;
    enableHeadRequest?: boolean;
  },
): Promise<ImageAnalysisResult> {
  const urls = extractUrls(content + ' ' + title);
  const imageUrls = urls.filter(u => {
    const ext = getExtension(u);
    if (IMAGE_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext)) return true;
    const domain = getDomain(u);
    for (const [pattern] of KNOWN_IMAGE_DOMAINS) {
      if (domain.includes(pattern) || u.toLowerCase().includes(pattern)) return true;
    }
    return false;
  });

  const signals: ImageSignal[] = [
    ...detectDomainSignals(urls),
    ...detectExtensionSignals(urls),
    ...urls.flatMap(u => detectCdnPatterns(u)),
    ...detectShortUrls(urls),
    ...detectContextSignals(title, options?.postHint, options?.flair),
  ];

  if (imageUrls.length > 0) {
    signals.push({ type: 'url_count', value: imageUrls.length });
  }

  const score = computeScore(signals, imageUrls.length);
  const confidence = confidenceFromScore(score);

  let contentType: string | null = null;
  let cached = false;

  if (options?.enableHeadRequest !== false && imageUrls.length > 0) {
    const targetUrl = imageUrls[0]!;
    const normalized = normalizeUrl(targetUrl);
    const inCache = contentTypeCache.get(normalized);
    if (inCache) {
      contentType = inCache.type;
      cached = true;
    } else {
      contentType = await fetchContentType(targetUrl);
    }
    if (contentType) {
      signals.push({ type: 'content_type_head', value: contentType });
    }
  }

  return {
    score,
    confidence,
    hasImage: confidence !== 'none',
    signals,
    imageUrls,
    contentType,
    cached,
  };
}

// ─── Quick Sync Check (no fetch) ─────────────────────────────────────────────

export function hasImageUrls(content: string): boolean {
  const urls = extractUrls(content);
  for (const url of urls) {
    const ext = getExtension(url);
    if (IMAGE_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext)) return true;
    const domain = getDomain(url);
    for (const [pattern] of KNOWN_IMAGE_DOMAINS) {
      if (domain.includes(pattern)) return true;
    }
  }
  return false;
}
