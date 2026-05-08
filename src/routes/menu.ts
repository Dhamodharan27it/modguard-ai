import { Hono } from 'hono';
import { getContext } from '@devvit/web/server';
import {
  analyseContent,
  getUserStrikes,
  addStrike,
  alertAllModerators,
  executeAutoAction,
} from '../core/nuke';

export const menu = new Hono();

//  Analyse post on demand 

menu.post('/analyse-post', async (c) => {
  const { postId } = await c.req.json();
  const context = getContext(c);

  try {
    const post = await context.reddit.getPostById(postId);
    const author = post.authorName;

    // Get existing strikes
    const strikeRecord = await getUserStrikes(context, author);

    // Run full detection engine
    const analysis = analyseContent(
      post.body ?? post.title,
      post.title
    );

    // Store result in Redis
    await context.redis.set(
      `modguard:analysis:${postId}`,
      JSON.stringify({
        postId,
        type: 'post',
        author,
        title: post.title,
        content: post.body ?? post.title,
        subreddit: post.subredditName,
        createdAt: new Date().toISOString(),
        existingStrikes: strikeRecord.count,
        ...analysis,
      })
    );

    // Add to mod queue
    await addToModQueue(context, postId);

    // Auto action if needed
    if (analysis.autoAction) {
      await executeAutoAction(context, postId, author, analysis, false);
    }

    return c.json({ success: true, analysis, strikes: strikeRecord });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

//  Analyse comment on demand 

menu.post('/analyse-comment', async (c) => {
  const { commentId } = await c.req.json();
  const context = getContext(c);

  try {
    const comment = await context.reddit.getCommentById(commentId);
    const author = comment.authorName;

    const strikeRecord = await getUserStrikes(context, author);
    const analysis = analyseContent(comment.body);

    await context.redis.set(
      `modguard:analysis:${commentId}`,
      JSON.stringify({
        postId: commentId,
        type: 'comment',
        author,
        content: comment.body,
        subreddit: comment.subredditName,
        createdAt: new Date().toISOString(),
        existingStrikes: strikeRecord.count,
        ...analysis,
      })
    );

    await addToModQueue(context, commentId);

    if (analysis.autoAction) {
      await executeAutoAction(context, commentId, author, analysis, true);
    }

    return c.json({ success: true, analysis, strikes: strikeRecord });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

//  Remove post 

menu.post('/remove-post', async (c) => {
  const { postId, reason } = await c.req.json();
  const context = getContext(c);

  try {
    const post = await context.reddit.getPostById(postId);
    const author = post.authorName;

    // Remove the post
    await post.remove();

    // Add strike
    const { record, banInfo } = await addStrike(
      context,
      author,
      reason,
      'harassment',
      postId
    );

    // Send removal message to user
    await context.reddit.sendPrivateMessage({
      to: author,
      subject: `Your post was removed from r/${context.subredditName}`,
      text:
        `${reason}\n\n` +
        `Strike ${record.count} of 5 issued.\n` +
        `Ban applied: ${banInfo.label}\n\n` +
        `${record.count >= 4
          ? '⚠️ WARNING: One more violation will result in a permanent ban.'
          : ''
        }`,
    });

    // Alert mods if high strike count
    if (record.count >= 4 || banInfo.permanent) {
      await alertAllModerators(
        context,
        postId,
        author,
        `Strike ${record.count}/5. ${banInfo.label} applied. ${banInfo.permanent ? 'PERMANENTLY BANNED.' : ''}`
      );
    }

    // Log action
    await logAction(context, {
      itemId: postId,
      action: 'removed',
      author,
      reason,
      strikeCount: record.count,
      banApplied: banInfo.label,
      permanent: banInfo.permanent,
      auto: false,
    });

    return c.json({ success: true, strikes: record, ban: banInfo });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

//  Remove comment 

menu.post('/remove-comment', async (c) => {
  const