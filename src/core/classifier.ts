import { TRAINING_DATA, Example } from './trainingData';

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'was', 'are', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her',
  'us', 'them', 'my', 'your', 'his', 'its', 'our', 'their', 'this',
  'that', 'these', 'those', 'some', 'any', 'each', 'every', 'all',
  'both', 'few', 'more', 'most', 'other', 'no', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'also', 'and', 'but',
  'or', 'for', 'nor', 'yet', 'to', 'of', 'in', 'on', 'at', 'by',
  'with', 'from', 'as', 'into', 'through', 'during', 'before', 'after',
  'above', 'below', 'between', 'out', 'off', 'over', 'under', 'again',
  'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
  'how', 'if', 'because', 'about', 'up', 'down', 'what', 'which', 'who',
  'whom', 'like', 'get', 'got', 'much', 'well', 'now',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

type ClassStats = {
  docCount: number;
  wordCount: number;
  wordFreq: Map<string, number>;
};

export class NaiveBayesClassifier {
  private classes: Map<string, ClassStats> = new Map();
  private vocabSize = 0;
  private totalDocs = 0;
  private trained = false;

  train(examples: Example[]): void {
    this.totalDocs = examples.length;
    const vocab = new Set<string>();

    for (const ex of examples) {
      if (!this.classes.has(ex.label)) {
        this.classes.set(ex.label, { docCount: 0, wordCount: 0, wordFreq: new Map() });
      }
      const stats = this.classes.get(ex.label)!;
      stats.docCount++;

      const tokens = tokenize(ex.text);
      const seen = new Set<string>();

      for (const token of tokens) {
        vocab.add(token);
        if (!seen.has(token)) {
          seen.add(token);
          stats.wordFreq.set(token, (stats.wordFreq.get(token) ?? 0) + 1);
        }
        stats.wordCount++;
      }
    }

    this.vocabSize = vocab.size;
    this.trained = true;
  }

  isTrained(): boolean { return this.trained; }

  predict(text: string): { category: string; confidence: number; scores: Record<string, number> } {
    const tokens = tokenize(text);
    const scores: Record<string, number> = {};

    for (const [className, stats] of this.classes) {
      const prior = Math.log(stats.docCount / this.totalDocs);
      const denom = stats.wordCount + this.vocabSize;

      let logProb = prior;
      const seenTokens = new Set(tokens);

      for (const token of seenTokens) {
        const freq = stats.wordFreq.get(token) ?? 0;
        logProb += Math.log((freq + 1) / denom);
      }

      scores[className] = logProb;
    }

    const maxLog = Math.max(...Object.values(scores));
    const expScores: Record<string, number> = {};
    let totalExp = 0;

    for (const [cls, logVal] of Object.entries(scores)) {
      const expVal = Math.exp(logVal - maxLog);
      expScores[cls] = expVal;
      totalExp += expVal;
    }

    const probs: Record<string, number> = {};
    for (const cls of Object.keys(scores)) {
      probs[cls] = (expScores[cls] ?? 0) / totalExp;
    }

    const sorted = Object.entries(probs).sort((a, b) => b[1] - a[1]);
    const top = sorted[0];
    if (!top) return { category: 'clean', confidence: 0, scores: probs };

    return { category: top[0], confidence: Math.round(top[1] * 100), scores: probs };
  }

  getTopCategories(text: string, limit = 3): { category: string; probability: number }[] {
    const result = this.predict(text);
    return Object.entries(result.scores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([category, probability]) => ({ category, probability: Math.round(probability * 100) }));
  }
}

export const classifier = (() => {
  const c = new NaiveBayesClassifier();
  c.train(TRAINING_DATA);
  return c;
})();
