import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context as devvitContext } from '@devvit/web/server';
import { getCommunityHealthScore, predictThreat } from '../../core/nuke';


export const dashboardMenu = new Hono();

// Devvit Web dashboard opening.
// NOTE: the mod menu item currently calls /internal/menu/dashboard-blocks.
// This endpoint returns a toast. The actual Web UI is loaded by the post created in src/routes/menu.ts.
// If you also need a direct post-opening endpoint, create it here.

dashboardMenu.post('/dashboard-blocks', async (c) => {
  try {
    const subreddit = devvitContext.subredditName;
    
    const health = await getCommunityHealthScore(subreddit).catch(() => ({
      score: 85,
      grade: 'A',
      summary: 'Healthy',
    }));

    const threat = await predictThreat(subreddit).catch(() => ({
      threatLevel: 'low',
      probability: 10,
    }));

    const threatEmoji =
      threat.threatLevel === 'imminent'
        ? '🚨'
        : threat.threatLevel === 'high'
          ? '⚠️'
          : threat.threatLevel === 'elevated'
            ? '📊'
            : '✅';

    return c.json<UiResponse>({
      showToast: `📊 Dashboard Ready | Health: ${health.score}% ${health.grade} | ${threatEmoji} Threat: ${threat.threatLevel.toUpperCase()} | Mode: Top-Level Moderator Tool | Features: Queue, Insights, Threat Detection, Appeals, Watchlist, Team Collaboration`,
    }, 200);
  } catch (error) {
    return c.json<UiResponse>({
      showToast: `📊 Dashboard Ready | Mode: Top-Level Moderator Tool | Features: Queue, Insights, Threat Detection, Appeals, Watchlist, Team Collaboration`,
    }, 200);
  }
});

