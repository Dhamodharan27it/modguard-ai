import { describe, it, expect } from 'vitest';
import { analyseContent } from './nuke';

describe('analyseContent', () => {
  it('should detect child safety violations with high confidence', () => {
    const result = analyseContent('child abuse exploitation content', '');
    expect(result.category).toBe('child_safety');
    expect(result.severity).toBe('critical');
    expect(result.suggestedAction).toBe('ban');
    expect(result.confidence).toBeGreaterThanOrEqual(10);
  });

  it('should detect doxxing with high confidence', () => {
    const result = analyseContent('my address is 123 main street', '');
    expect(result.category).toBe('doxxing');
    expect(result.severity).toBe('critical');
    expect(result.suggestedAction).toBe('ban');
  });

  it('should detect violence with high confidence', () => {
    const result = analyseContent('i will kill you', '');
    expect(result.category).toBe('violence');
    expect(result.severity).toBe('critical');
    expect(result.suggestedAction).toBe('ban');
  });

  it('should detect harassment with medium severity', () => {
    const result = analyseContent('you are a stupid idiot nobody likes you', '');
    expect(result.category).toBe('harassment');
    expect(['high', 'medium']).toContain(result.severity);
    expect(result.suggestedAction).toBe('remove');
  });

  it('should detect adult content', () => {
    const result = analyseContent('sexual content xxx video', '');
    expect(result.category).toBe('adult_content');
    expect(result.suggestedAction).toBe('remove');
  });

  it('should detect drug promotion', () => {
    const result = analyseContent('buy cocaine online today', '');
    expect(result.category).toBe('drugs');
    expect(['high', 'medium']).toContain(result.severity);
  });

  it('should detect hate speech', () => {
    const result = analyseContent('all immigrants are subhuman and should die', '');
    expect(result.category).toBe('hate_speech');
    expect(result.severity).toBe('high');
  });

  it('should detect scam', () => {
    const result = analyseContent('verify your wallet seed phrase', '');
    expect(result.category).toBe('scam');
    expect(result.suggestedAction).toBe('remove');
  });

  it('should detect spam', () => {
    const result = analyseContent('buy now click here limited time offer dm me for promo', '');
    expect(result.category).toBe('spam');
    expect(result.suggestedAction).toBe('remove');
  });

  it('should return clean for benign content', () => {
    const result = analyseContent('hello how are you doing today', '');
    expect(result.category).toBe('clean');
    expect(result.suggestedAction).toBe('approve');
    expect(result.autoAction).toBe(true);
  });

  it('should include title in analysis', () => {
    const result = analyseContent('innocent body content', 'buy cocaine online');
    expect(result.category).toBe('drugs');
  });

  it('should return consistent results for same input', () => {
    const text = 'this is a test post about normal things';
    const a = analyseContent(text, '');
    const b = analyseContent(text, '');
    expect(a.category).toBe(b.category);
    expect(a.confidence).toBe(b.confidence);
    expect(a.severity).toBe(b.severity);
  });
});
