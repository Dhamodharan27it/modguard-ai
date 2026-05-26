import { describe, it, expect, beforeEach } from 'vitest';
import {
  analyseImagesSync,
  analyseImages,
  hasImageUrls,
  clearImageCache,
  ImageAnalysisResult,
} from './imageAnalyzer';

beforeEach(() => {
  clearImageCache();
});

const isImageResult = (r: ImageAnalysisResult): void => {
  expect(r).toBeDefined();
  expect(typeof r.score).toBe('number');
  expect(r.score).toBeGreaterThanOrEqual(0);
  expect(r.score).toBeLessThanOrEqual(100);
  expect(['definite', 'likely', 'possible', 'none']).toContain(r.confidence);
  expect(Array.isArray(r.signals)).toBe(true);
  expect(Array.isArray(r.imageUrls)).toBe(true);
};

describe('hasImageUrls', () => {
  it('returns true for direct image URL', () => {
    expect(hasImageUrls('https://i.redd.it/abc123.jpg')).toBe(true);
  });

  it('returns true for known image domain', () => {
    expect(hasImageUrls('https://imgur.com/a/xyz')).toBe(true);
  });

  it('returns false for plain text', () => {
    expect(hasImageUrls('hello world')).toBe(false);
  });

  it('returns false for non-image domains', () => {
    expect(hasImageUrls('https://example.com/page')).toBe(false);
  });

  it('returns true for gallery link via sync analysis', () => {
    const result = analyseImagesSync('https://reddit.com/gallery/abc123');
    expect(result.hasImage).toBe(true);
  });
});

describe('analyseImagesSync', () => {
  it('detects i.redd.it image', () => {
    const result = analyseImagesSync('Check this out https://i.redd.it/abc123.jpg');
    isImageResult(result);
    expect(result.hasImage).toBe(true);
    expect(result.confidence).toBe('likely');
    expect(result.imageUrls.length).toBe(1);
    expect(result.signals.some(s => s.type === 'domain_match')).toBe(true);
    expect(result.signals.some(s => s.type === 'extension')).toBe(true);
  });

  it('detects imgur link', () => {
    const result = analyseImagesSync('https://imgur.com/gallery/xyz', '');
    isImageResult(result);
    expect(result.hasImage).toBe(true);
    expect(result.imageUrls.length).toBe(1);
    expect(result.signals.some(s => s.type === 'domain_match' && s.value.includes('Imgur'))).toBe(true);
  });

  it('detects gfycat link', () => {
    const result = analyseImagesSync('https://gfycat.com/abc123');
    isImageResult(result);
    expect(result.hasImage).toBe(true);
    expect(result.confidence).toBe('possible');
  });

  it('detects giphy media', () => {
    const result = analyseImagesSync('https://media.giphy.com/media/xyz/giphy.gif');
    isImageResult(result);
    expect(result.hasImage).toBe(true);
    expect(result.confidence).toBe('definite');
  });

  it('detects Twitter media', () => {
    const result = analyseImagesSync('https://pbs.twimg.com/media/abc.jpg');
    isImageResult(result);
    expect(result.hasImage).toBe(true);
    expect(result.confidence).toBe('likely');
    expect(result.signals.some(s => s.type === 'domain_match')).toBe(true);
  });

  it('detects YouTube link in text', () => {
    const result = analyseImagesSync('Check my video https://youtu.be/abc123');
    isImageResult(result);
    expect(result.hasImage).toBe(true);
    expect(result.signals.some(s => s.type === 'domain_match')).toBe(true);
  });

  it('detects image by extension alone', () => {
    const result = analyseImagesSync('https://cdn.example.com/image.png');
    isImageResult(result);
    expect(result.hasImage).toBe(true);
    expect(result.confidence).toBe('possible');
    expect(result.signals.some(s => s.type === 'extension' && s.value === '.png')).toBe(true);
  });

  it('detects video extension signal even when hasImage is false', () => {
    const result = analyseImagesSync('https://example.com/video.mp4');
    isImageResult(result);
    expect(result.hasImage).toBe(false);
    expect(result.confidence).toBe('none');
    expect(result.signals.some(s => s.type === 'extension' && s.value === '.mp4')).toBe(true);
  });

  it('returns none for plain text without URLs', () => {
    const result = analyseImagesSync('hello world how are you');
    isImageResult(result);
    expect(result.hasImage).toBe(false);
    expect(result.confidence).toBe('none');
    expect(result.score).toBe(0);
  });

  it('returns none for non-image URLs', () => {
    const result = analyseImagesSync('Visit https://example.com/page.html for info');
    isImageResult(result);
    expect(result.hasImage).toBe(false);
    expect(result.confidence).toBe('none');
  });

  it('returns none for empty content', () => {
    const result = analyseImagesSync('');
    isImageResult(result);
    expect(result.hasImage).toBe(false);
    expect(result.confidence).toBe('none');
  });

  it('counts multiple image URLs', () => {
    const result = analyseImagesSync(
      'https://i.redd.it/a.jpg https://i.redd.it/b.png https://i.redd.it/c.gif'
    );
    isImageResult(result);
    expect(result.imageUrls.length).toBe(3);
    expect(result.signals.some(s => s.type === 'url_count' && s.value === 3)).toBe(true);
  });

  it('applies multiple URLs score bonus', () => {
    const single = analyseImagesSync('https://i.redd.it/a.jpg');
    const multi = analyseImagesSync('https://i.redd.it/a.jpg https://i.redd.it/b.png https://i.redd.it/c.gif');
    expect(multi.score).toBeGreaterThan(single.score);
  });

  it('applies short URL penalty', () => {
    const result = analyseImagesSync('https://bit.ly/abc123');
    isImageResult(result);
    expect(result.signals.some(s => s.type === 'short_url')).toBe(true);
  });

  it('does not penalise short URLs with image extensions', () => {
    const imgur = analyseImagesSync('https://i.imgur.com/abc.jpg');
    const short = analyseImagesSync('https://bit.ly/abc123');
    expect(short.score).toBeLessThan(imgur.score);
  });

  it('detects webp extension on unknown domain', () => {
    const result = analyseImagesSync('https://example.com/image.webp');
    isImageResult(result);
    expect(result.hasImage).toBe(true);
    expect(result.confidence).toBe('possible');
    expect(result.signals.some(s => s.type === 'extension' && s.value === '.webp')).toBe(true);
  });
});

describe('analyseImagesSync context signals', () => {
  it('uses title keywords as signal but not enough for positive', () => {
    const result = analyseImagesSync('', 'My awesome meme post');
    isImageResult(result);
    expect(result.hasImage).toBe(false);
    expect(result.confidence).toBe('none');
    expect(result.signals.some(s => s.type === 'title_keyword' && s.value === 'meme')).toBe(true);
  });

  it('uses post_hint for detection', () => {
    const result = analyseImagesSync('body text', 'title', { postHint: 'image' });
    isImageResult(result);
    expect(result.confidence).toBe('possible');
    expect(result.signals.some(s => s.type === 'post_hint')).toBe(true);
  });

  it('uses flair tag as signal but not enough for positive', () => {
    const result = analyseImagesSync('body text', 'title', { flair: 'Photography' });
    isImageResult(result);
    expect(result.hasImage).toBe(false);
    expect(result.confidence).toBe('none');
    expect(result.signals.some(s => s.type === 'flair_tag')).toBe(true);
  });

  it('combines post_hint, title keyword, and flair signals', () => {
    const result = analyseImagesSync('body text', 'My OC Artwork', {
      postHint: 'image',
      flair: 'Art',
    });
    isImageResult(result);
    expect(result.confidence).toBe('possible');
    const types = result.signals.map(s => s.type);
    expect(types).toContain('post_hint');
    expect(types).toContain('title_keyword');
    expect(types).toContain('flair_tag');
  });
});

describe('analyseImages (async)', () => {
  it('returns sync-equivalent result when no HEAD fetch is needed', async () => {
    const sync = analyseImagesSync('https://example.com/image.png');
    const asyncResult = await analyseImages('https://example.com/image.png', '', { enableHeadRequest: false });
    isImageResult(asyncResult);
    expect(asyncResult.confidence).toBe(sync.confidence);
    expect(asyncResult.score).toBe(sync.score);
    expect(asyncResult.imageUrls).toEqual(sync.imageUrls);
  });

  it('returns hasImage false for plain text', async () => {
    const result = await analyseImages('hello world', '', { enableHeadRequest: false });
    expect(result.hasImage).toBe(false);
    expect(result.confidence).toBe('none');
  });

  it('handles empty content gracefully', async () => {
    const result = await analyseImages('', '', { enableHeadRequest: false });
    expect(result.hasImage).toBe(false);
    expect(result.confidence).toBe('none');
  });
});

describe('clearImageCache', () => {
  it('does not throw', () => {
    expect(() => clearImageCache()).not.toThrow();
  });
});

describe('edge cases', () => {
  it('handles mixed image and non-image URLs', () => {
    const result = analyseImagesSync(
      'https://i.redd.it/a.jpg is great, also check https://example.com/page'
    );
    isImageResult(result);
    expect(result.imageUrls.length).toBe(1);
    expect(result.imageUrls[0]).toContain('i.redd.it');
    expect(result.hasImage).toBe(true);
  });

  it('handles URLs with query parameters', () => {
    const result = analyseImagesSync('https://i.imgur.com/abc.jpg?width=800&height=600');
    isImageResult(result);
    expect(result.hasImage).toBe(true);
    expect(result.confidence).toBe('definite');
  });

  it('handles URLs with fragments', () => {
    const result = analyseImagesSync('https://i.redd.it/abc.png#section');
    isImageResult(result);
    expect(result.hasImage).toBe(true);
  });

  it('returns score 0 for irrelevant content with short URLs', () => {
    const result = analyseImagesSync('https://bit.ly/xyz https://t.co/abc');
    isImageResult(result);
    expect(result.hasImage).toBe(false);
    expect(result.score).toBe(0);
  });

  it('detects Discord CDN', () => {
    const result = analyseImagesSync('https://cdn.discordapp.com/attachments/123/456/image.png');
    isImageResult(result);
    expect(result.hasImage).toBe(true);
    expect(result.confidence).toBe('likely');
  });
});
