import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context as devvitContext } from '@devvit/web/server';
import { predictThreat, getSlowModeRecommendation } from '../../core/nuke';

export const threatMenu = new Hono();

threatMenu.post('/predict-threat', async (c) => {
  try {
    const threat = await predictThreat(devvitContext.subredditName);
    const slowMode = await getSlowModeRecommendation(devvitContext.subredditName, threat);

    const msg = threat.warning
      ? `${threat.warning}${slowMode.shouldActivate ? ` | Recommend: ${slowMode.mode.toUpperCase()} MODE` : ''}`
      : `✅ No threat detected (${threat.probability}% probability)`;

    return c.json<UiResponse>({ showToast: msg }, 200);
  } catch (error) {
    return c.json<UiResponse>({ showToast: `Threat check failed: ${String(error)}` }, 200);
  }
});

