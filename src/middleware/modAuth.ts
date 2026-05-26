import { redis, reddit, context as devvitContext } from '@devvit/web/server';
import type { Context } from 'hono';

const MODS_CACHE_KEY = 'modguard:mods';
const CACHE_TTL = 300;

export type AuthResult = {
  isModerator: boolean;
  username: string | null;
  error: string | null;
};

export async function verifyModerator(): Promise<AuthResult> {
  try {
    const username = await reddit.getCurrentUsername();
    if (!username) {
      console.log('[ModGuard Auth] Not logged in');
      return { isModerator: false, username: null, error: 'Not logged in' };
    }

    const subredditName = devvitContext.subredditName;
    const cacheKey = `${MODS_CACHE_KEY}:${subredditName}`;

    let modList: string[] | null = null;
    const cachedRaw = await redis.get(cacheKey);
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw) as { mods: string[]; timestamp: number };
        if (Date.now() - cached.timestamp < CACHE_TTL * 1000) {
          modList = cached.mods;
        }
      } catch { /* stale cache */ }
    }

    if (!modList) {
      modList = [];
      const mods = await reddit.getModerators({ subredditName, limit: 1000 });
      for await (const mod of mods) {
        modList.push(mod.username);
      }
      await redis.set(cacheKey, JSON.stringify({ mods: modList, timestamp: Date.now() }));
      await redis.expire(cacheKey, CACHE_TTL);
      console.log(`[ModGuard Auth] Cached ${modList.length} moderators for r/${subredditName}`);
    }

    const isModerator = modList.includes(username);
    console.log(`[ModGuard Auth] u/${username} is ${isModerator ? '' : 'NOT '}a moderator of r/${subredditName}`);

    if (!isModerator) {
      return { isModerator: false, username, error: `Access denied: u/${username} is not a moderator of r/${subredditName}` };
    }

    return { isModerator: true, username, error: null };
  } catch (error) {
    console.error('[ModGuard Auth] Verification error:', error);
    return { isModerator: false, username: null, error: `Auth error: ${String(error)}` };
  }
}

export function requireMod<C extends Context>(
  c: C,
  authResult: AuthResult
): { authorized: false; response: Response } | { authorized: true } {
  if (!authResult.isModerator) {
    console.warn(`[ModGuard Auth] BLOCKED unauthorized access: ${authResult.username ?? 'unknown'} — ${authResult.error}`);
    const status = authResult.username ? 403 : 401;
    return {
      authorized: false as const,
      response: c.json({ success: false, error: authResult.error ?? 'Unauthorized' }, status) as unknown as Response,
    };
  }
  return { authorized: true as const };
}
