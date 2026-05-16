import { redis, context as devvitContext } from '@devvit/web/server';
import { safeJsonParse } from '../utils/safe';
import { uniqPushFront, uniqRemove } from '../utils/helpers';

export async function addToModQueue(itemId: string, maxLen = 50) {
  const queueKey = `modguard:queue:${devvitContext.subredditName}`;
  const existingRaw = await redis.get(queueKey);
  const existing = safeJsonParse<string[]>(existingRaw) ?? [];
  const next = uniqPushFront(existing, itemId, maxLen);
  await redis.set(queueKey, JSON.stringify(next));
}

export async function removeFromQueue(itemId: string) {
  const queueKey = `modguard:queue:${devvitContext.subredditName}`;
  const existingRaw = await redis.get(queueKey);
  const existing = safeJsonParse<string[]>(existingRaw) ?? [];
  const next = uniqRemove(existing, itemId);
  await redis.set(queueKey, JSON.stringify(next));
}

export async function getQueue() {
  const queueKey = `modguard:queue:${devvitContext.subredditName}`;
  const existingRaw = await redis.get(queueKey);
  return safeJsonParse<string[]>(existingRaw) ?? [];
}

