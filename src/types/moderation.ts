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
  | 'leaked_content'
  | 'toxicity'
  | 'scam'
  | 'nsfw'
  | 'coordinated_attack';

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

