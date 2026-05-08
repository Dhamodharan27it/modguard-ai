import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context, getContext } from '@devvit/web/server';
import { isT1, isT3 } from '@devvit/shared-types/tid.js';
import {
  analyseContent,
  getUserStrikes,
  addStrike,
  alertAllModerators,
  executeAutoAction,
} from '../core/nuke';

export const forms = new Hono();

//  Remove Comment Form 

forms.post('/mop-comment-submit', async (c) => {
  const ctx = getContext(c);
  const values = await c.req.json<{
    remove?: boolean;
    lock?: boolean;
    reason?: string;
    targetId?: string;
  }>();

  if (!values.remove && !values.lock) {
    return c.json<UiResponse>(
      { showToast: 'Please select either lock or remove.' },
      200
    );
  }

  const targetId =
    typeof values.targetId === 'string' && values.targetId.trim()
      ? values.targetId.trim()
      : context.postId;

  if (!isT1(targetId)) {
    return c.json<UiResponse>(
      { showToast: 'Action failed! Invalid comment ID.' },
      200
    );
  }

  try {
    const comment = await ctx.reddit.getCommentById(targetId);
    const author = comment.authorName;

    // Analyse comment content
    const analysis = analyseContent(comment.body);
    const reason = values.reason ?? analysis.removalMessage ?? 'Removed by moderator';

    if (values.remove) {
      await comment.remove();

      // Add strike
      const { record, banInfo } = await addStrike(
        ctx,
        author,
        reason,
        analysis.category,
        targetId
      );

      // Notify user
      await ctx.reddit.sendPrivateMessage({
        to: author,
        subject: `Your comment was removed from r/${ctx.subredditName}`,
        text:
          `${reason}\n\n` +
          `⚠️ Strike ${record.count} of 5 issued.\n` +
          `Ban applied: ${banInfo.label}\n\n` +
          `${record.count >= 4
            ? '🚨 WARNING: One more violation = permanent ban.'
            : 'Please follow community rules to avoid further action.'
          }`,
      });

      // Alert mods if serious
      if (record.count >= 4 || banInfo.permanent || analysis.requiresImmediateAlert) {
        await alertAllModerators(
          ctx,
          targetId,
          author,
          `Strike ${record.count}/5. ${banInfo.label} applied. Violation: ${analysis.violation}`
        );
      }

      // Log action
      await logAction(ctx, {
        itemId: targetId,
        type: 'comment',
        action: 'removed',
        author,
        reason,
        violation: analysis.violation,
        strikeCount: record.count,
        banApplied: banInfo.label,
        permanent: banInfo.permanent,
        auto: false,
      });
    }

    if (values.lock) {
      await comment.lock();