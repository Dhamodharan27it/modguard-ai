import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { redis, reddit, context as devvitContext } from '@devvit/web/server';

export const dashboardMenu = new Hono();

const DASHBOARD_KEY = 'modguard:dashboard';

function fullRedditUrl(path: string): string {
  return `https://reddit.com${path}`;
}

async function getOrCreateDashboardPost(): Promise<{ id: string; permalink: string; url: string }> {
  const key = `${DASHBOARD_KEY}:${devvitContext.subredditName}`;
  const existingRaw = await redis.get(key);

  if (existingRaw) {
    const existing = JSON.parse(existingRaw) as { postId: string; permalink: string };
    try {
      const post = await reddit.getPostById(existing.postId as `t3_${string}`);
      return { id: post.id, permalink: post.permalink, url: fullRedditUrl(post.permalink) };
    } catch {
      console.log('[ModGuard] Dashboard post was deleted, creating replacement');
    }
  }

  console.log('[ModGuard] Creating dashboard post in r/', devvitContext.subredditName);
  const post = await reddit.submitCustomPost({
    subredditName: devvitContext.subredditName,
    title: 'ModGuard AI Dashboard',
    textFallback: {
      text: 'ModGuard AI — Community Safety Operating System. Open this post on the latest Reddit app or web to view the interactive dashboard.',
    },
  });

  const url = fullRedditUrl(post.permalink);
  const data = { postId: post.id, permalink: post.permalink, createdAt: new Date().toISOString() };
  await redis.set(key, JSON.stringify(data));
  console.log('[ModGuard] Dashboard post created:', post.id, url);

  return { id: post.id, permalink: post.permalink, url };
}

dashboardMenu.post('/open-dashboard', async (c) => {
  console.log('[ModGuard] /open-dashboard: launching WebView...');
  try {
    const { url } = await getOrCreateDashboardPost();
    console.log('[ModGuard] /open-dashboard: navigating to', url);
    return c.json<UiResponse>({
      navigateTo: { url },
    }, 200);
  } catch (error) {
    console.error('[ModGuard] /open-dashboard error:', error);
    return c.json<UiResponse>({
      showToast: `📊 Dashboard: ${String(error).slice(0, 80)}`,
    }, 200);
  }
});

dashboardMenu.post('/dashboard-blocks', async (c) => {
  console.log('[ModGuard] /dashboard-blocks: launching WebView...');
  try {
    const { url } = await getOrCreateDashboardPost();
    console.log('[ModGuard] /dashboard-blocks: navigating to', url);
    return c.json<UiResponse>({
      navigateTo: { url },
    }, 200);
  } catch (error) {
    console.error('[ModGuard] /dashboard-blocks error:', error);
    return c.json<UiResponse>({
      showToast: `📊 Dashboard: ${String(error).slice(0, 80)}`,
    }, 200);
  }
});
