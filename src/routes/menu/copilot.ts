import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { reddit, context as devvitContext } from '@devvit/web/server';
import { getModeratorCopilotReport, getUserRiskScore } from '../../core/nuke';

export const copilotMenu = new Hono();

copilotMenu.post('/copilot-report', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const postId = body.postId ?? body.targetId ?? devvitContext.postId;
    if (!postId) return c.json<UiResponse>({ showToast: 'No post ID found' }, 200);

    const post = await reddit.getPostById(postId);
    const author = post.authorName;

    const [report, riskScore] = await Promise.all([
      getModeratorCopilotReport(author),
      getUserRiskScore(author),
    ]);

    await reddit.sendPrivateMessage({
      to: devvitContext.userId ?? '',
      subject: `🤖 ModGuard AI Copilot — u/${author}`,
      text: report,
    });

    return c.json<UiResponse>({
      showToast: `🤖 Copilot: u/${author} | Risk: ${riskScore.score}/100 (${riskScore.level}) | Check inbox!`,
    }, 200);
  } catch (error) {
    console.error('[ModGuard] copilot-report error:', error);
    return c.json<UiResponse>({ showToast: `Copilot failed: ${String(error)}` }, 200);
  }
});

