import { redis, context as devvitContext } from '@devvit/web/server';
import { safeJsonParse } from '../utils/safe';

export type ModLogEntry = Record<string, unknown> & {
  timestamp?: string;
  moderator?: string;
};

export async function logAction(data: ModLogEntry, opts?: { cap?: number }) {
  const cap = opts?.cap ?? 100;
  const logKey = `modguard:log:${devvitContext.subredditName}`;
  const logRaw = await redis.get(logKey);
  const logs = safeJsonParse<ModLogEntry[]>(logRaw) ?? [];

  logs.unshift({
    ...data,
    timestamp: new Date().toISOString(),
    // devvitContext.userId may be undefined depending on runtime.
    ...(devvitContext.userId ? { moderator: devvitContext.userId } : {}),
  });

  await redis.set(logKey, JSON.stringify(logs.slice(0, cap)));
}


