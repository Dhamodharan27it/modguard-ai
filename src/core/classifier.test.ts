import { describe, it, expect } from 'vitest';
import { NaiveBayesClassifier } from './classifier';

const SIMPLE_DATA = [
  { text: 'buy now limited time offer click here', label: 'spam' },
  { text: 'check out my website affiliate link', label: 'spam' },
  { text: 'hello how are you doing today', label: 'clean' },
  { text: 'thanks for the great discussion', label: 'clean' },
  { text: 'you idiot nobody likes you kill yourself', label: 'harassment' },
  { text: 'you are worthless go die', label: 'harassment' },
  { text: 'nude pics xxx porn onlyfans', label: 'adult_content' },
  { text: 'explicit sexual content video', label: 'adult_content' },
  { text: 'i will kill you watch your back', label: 'violence' },
  { text: 'going to shoot up the school', label: 'violence' },
  { text: 'white supremacy ethnic cleansing nazi', label: 'hate_speech' },
  { text: 'all immigrants should die', label: 'hate_speech' },
  { text: 'buy cocaine heroin meth online', label: 'drugs' },
  { text: 'drugs for sale no prescription', label: 'drugs' },
  { text: 'double your bitcoin free money invest', label: 'scam' },
  { text: 'congratulations you won claim now', label: 'scam' },
];

describe('NaiveBayesClassifier', () => {
  it('should train and be in trained state', () => {
    const c = new NaiveBayesClassifier();
    expect(c.isTrained()).toBe(false);
    c.train(SIMPLE_DATA);
    expect(c.isTrained()).toBe(true);
  });

  it('should classify spam correctly', () => {
    const c = new NaiveBayesClassifier();
    c.train(SIMPLE_DATA);
    const result = c.predict('buy now limited time offer');
    expect(result.category).toBe('spam');
    expect(result.confidence).toBeGreaterThan(30);
  });

  it('should classify clean content correctly', () => {
    const c = new NaiveBayesClassifier();
    c.train(SIMPLE_DATA);
    const result = c.predict('thanks for the great discussion');
    expect(result.category).toBe('clean');
    expect(result.confidence).toBeGreaterThan(30);
  });

  it('should classify harassment correctly', () => {
    const c = new NaiveBayesClassifier();
    c.train(SIMPLE_DATA);
    const result = c.predict('you are an idiot nobody likes you');
    expect(result.category).toBe('harassment');
    expect(result.confidence).toBeGreaterThan(30);
  });

  it('should classify adult content correctly', () => {
    const c = new NaiveBayesClassifier();
    c.train(SIMPLE_DATA);
    const result = c.predict('nude pics xxx porn video');
    expect(result.category).toBe('adult_content');
    expect(result.confidence).toBeGreaterThan(30);
  });

  it('should classify violence correctly', () => {
    const c = new NaiveBayesClassifier();
    c.train(SIMPLE_DATA);
    const result = c.predict('i will kill you');
    expect(result.category).toBe('violence');
    expect(result.confidence).toBeGreaterThan(15);
  });

  it('should classify hate speech correctly', () => {
    const c = new NaiveBayesClassifier();
    c.train(SIMPLE_DATA);
    const result = c.predict('white supremacy is evil');
    expect(result.category).toBe('hate_speech');
    expect(result.confidence).toBeGreaterThan(15);
  });

  it('should classify drugs correctly', () => {
    const c = new NaiveBayesClassifier();
    c.train(SIMPLE_DATA);
    const result = c.predict('buy cocaine online no prescription');
    expect(result.category).toBe('drugs');
    expect(result.confidence).toBeGreaterThan(15);
  });

  it('should classify scam correctly', () => {
    const c = new NaiveBayesClassifier();
    c.train(SIMPLE_DATA);
    const result = c.predict('double your bitcoin free money');
    expect(result.category).toBe('scam');
    expect(result.confidence).toBeGreaterThan(15);
  });

  it('should return probabilities for all categories', () => {
    const c = new NaiveBayesClassifier();
    c.train(SIMPLE_DATA);
    const result = c.predict('hello everyone');
    expect(result.scores).toBeDefined();
    expect(Object.keys(result.scores).length).toBeGreaterThanOrEqual(3);
    const sum = Object.values(result.scores).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(0.01);
  });

  it('should return top categories', () => {
    const c = new NaiveBayesClassifier();
    c.train(SIMPLE_DATA);
    const top = c.getTopCategories('buy now limited time offer', 2);
    expect(top.length).toBe(2);
    expect(top[0]!.category).toBe('spam');
    expect(top[0]!.probability).toBeGreaterThan(0);
  });

  it('should handle empty text gracefully', () => {
    const c = new NaiveBayesClassifier();
    c.train(SIMPLE_DATA);
    const result = c.predict('');
    expect(result.category).toBeDefined();
    expect(result.scores).toBeDefined();
    const sum = Object.values(result.scores).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(0.01);
  });

  it('should handle unknown words gracefully', () => {
    const c = new NaiveBayesClassifier();
    c.train(SIMPLE_DATA);
    const result = c.predict('zzzzyyyyxxxx qqqqqqqqqwwww');
    expect(result.category).toBeDefined();
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });
});
