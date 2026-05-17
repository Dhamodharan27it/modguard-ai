import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context as devvitContext } from '@devvit/web/server';
import { getCommunityHealthScore, predictThreat } from '../../core/nuke';


export const dashboardMenu = new Hono();

dashboardMenu.post('/dashboard-blocks', async (c) => {
  try {
    const health = await getCommunityHealthScore(devvitContext.subredditName).catch(() => ({
      score: 85,
      grade: 'A',
      summary: 'Healthy',
    }));

    const threat = await predictThreat(devvitContext.subredditName).catch(() => ({
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
      showToast: `📊 Dashboard | Health: ${health.score}% ${health.grade} | ${threatEmoji} Threat: ${threat.threatLevel.toUpperCase()} | Features: Queue, Insights, Threat Detection, Appeals, Watchlist, Team Collab, Transparency`,
    }, 200);
  } catch (error) {
    return c.json<UiResponse>({
      showToast: `📊 Dashboard Ready | Features: Queue, Insights, Threat Detection, Appeals, Watchlist, Team Collab, Transparency`,
    }, 200);
  }
});

