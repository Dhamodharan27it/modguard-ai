import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { redis, reddit, context as devvitContext } from '@devvit/web/server';
import { isT1, isT3 } from '@devvit/shared-types/tid.js';
import {
  analyseContent,
  addStrike,
  alertAllModerators,
} from '../../core/nuke';

export const forms = new Hono();

forms.post('/mop-comment-submit', async (c) => {
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
      : devvitContext.postId;

  if (!isT1(targetId)) {
    return c.json<UiResponse>(
      { showToast: 'Action failed! Invalid comment ID.' },
      200
    );
  }

  try {
    const comment = await reddit.getCommentById(targetId);
    const author = comment.authorName;
    const analysis = analyseContent(comment.body);
    const reason = values.reason ?? analysis.removalMessage ?? 'Removed by moderator';

    if (values.remove) {
      await comment.remove();

      const { record, banInfo } = await addStrike(
        author,
        reason,
        analysis.category,
        targetId
      );

      await reddit.sendPrivateMessage({
        to: author,
        subject: `Your comment was removed from r/${devvitContext.subredditName}`,
        text:
          `${reason}\n\n` +
          `\u26a0\ufe0f Strike ${record.count} of 5 issued.\n` +
          `Ban applied: ${banInfo.label}\n\n` +
          `${record.count >= 4
            ? 'WARNING: One more violation = permanent ban.'
            : 'Please follow community rules.'
          }`,
      });

      if (record.count >= 4 || banInfo.permanent || analysis.requiresImmediateAlert) {
        await alertAllModerators(
          targetId,
          author,
          `Strike ${record.count}/5. ${banInfo.label}. Violation: ${analysis.violation}`
        );
      }

      await logAction({
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
      await logAction({
        itemId: targetId,
        type: 'comment',
        action: 'locked',
        author,
        reason,
        auto: false,
      });
    }

    return c.json<UiResponse>(
      { showToast: `\u2705 ${values.remove ? 'Comment removed' : 'Comment locked'}!` },
      200
    );
  } catch (error) {
    console.error('Comment action failed:', error);
    return c.json<UiResponse>({ showToast: '✖ Action failed. Please try again.' }, 200);
  }
});

forms.post('/mop-post-submit', async (c) => {
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
      : devvitContext.postId;

  if (!isT3(targetId)) {
    return c.json<UiResponse>(
      { showToast: 'Action failed! Invalid post ID.' },
      200
    );
  }

  try {
    const post = await reddit.getPostById(targetId);
    const author = post.authorName;
    const analysis = analyseContent(post.body ?? post.title, post.title);
    const reason = values.reason ?? analysis.removalMessage ?? 'Removed by moderator';

    if (values.remove) {
      await post.remove();

      const { record, banInfo } = await addStrike(
        author,
        reason,
        analysis.category,
        targetId
      );

      await reddit.sendPrivateMessage({
        to: author,
        subject: `Your post was removed from r/${devvitContext.subredditName}`,
        text:
          `${reason}\n\n` +
          `\u26a0\ufe0f Strike ${record.count} of 5 issued.\n` +
          `Ban applied: ${banInfo.label}\n\n` +
          `${record.count >= 4
            ? 'WARNING: One more violation = permanent ban.'
            : 'Please follow community rules.'
          }`,
      });

      if (record.count >= 4 || banInfo.permanent || analysis.requiresImmediateAlert) {
        await alertAllModerators(
          targetId,
          author,
          `Strike ${record.count}/5. ${banInfo.label}. Violation: ${analysis.violation}`
        );
      }

      await logAction({
        itemId: targetId,
        type: 'post',
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
      await post.lock();
      await logAction({
        itemId: targetId,
        type: 'post',
        action: 'locked',
        author,
        reason,
        auto: false,
      });
    }

    return c.json<UiResponse>(
      { showToast: `\u2705 ${values.remove ? 'Post removed' : 'Post locked'}!` },
      200
    );
  } catch (error) {
    console.error('Post action failed:', error);
    return c.json<UiResponse>({ showToast: '✖ Action failed. Please try again.' }, 200);
  }
});

async function logAction(data: object) {
  const logKey = `modguard:log:${devvitContext.subredditName}`;
  const logRaw = await redis.get(logKey);
  const logs: object[] = logRaw ? JSON.parse(logRaw) : [];
  logs.unshift({
    ...data,
    timestamp: new Date().toISOString(),
    moderator: devvitContext.userId,
  });
  await redis.set(logKey, JSON.stringify(logs.slice(0, 100)));
}

