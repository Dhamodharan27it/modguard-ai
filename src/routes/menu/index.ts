import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { reddit, context as devvitContext } from '@devvit/web/server';
import { addToWatchlist } from '../../core/memory';
import { analyseMenu } from './analyse';
import { moderationMenu } from './moderation';
import { dashboardMenu } from './dashboard';
import { threatMenu } from './threat';
import { copilotMenu } from './copilot';
import { scanMenu } from './scan';

export const menu = new Hono();

menu.route('/', analyseMenu);
menu.route('/', moderationMenu);
menu.route('/', dashboardMenu);
menu.route('/', threatMenu);

menu.route('/', copilotMenu);
menu.route('/', scanMenu);

menu.post('/watchlist-add', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const postId = body.postId ?? body.targetId ?? devvitContext.postId;
    if (!postId) return c.json<UiResponse>({ showToast: 'No post ID found' }, 200);
    const post = await reddit.getPostById(postId);
    await addToWatchlist(post.authorName, 'Flagged by moderator');
    return c.json<UiResponse>({ showToast: `👁 u/${post.authorName} added to watchlist` }, 200);
  } catch (error) {
    return c.json<UiResponse>({ showToast: `Watchlist failed: ${String(error)}` }, 200);
  }
});





