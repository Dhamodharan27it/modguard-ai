import { Hono } from 'hono';
import { getContext } from '@devvit/web/server';

export const triggers = new Hono();

//this fires automatically when a post is reported by users
triggers.post('/post-reported', async (c) => {
  const { postId } = await c.req.json();
  const context = getContext(c);

  try {
    //fetch the report post
    const post = await context.reddit.getPostById(postId);
    const analysis = detectViolation(post.title + ' ' + (post.body ?? ''));

    //store analysis in redis so dashboard can show it
    await context.redis.set(
      'modguard:analysis:${postId}',
      JSON.stringify({
        postId,
        author : post.authorName,
        title: post.title,
        content: post.body ?? post.title,
        subreddit: post.subredditName,
        createdAt: new Date().toISOString(),
        autoDetected: true,
        ...analysis,

      })
    );

    //add to the mod queue list
    await addToModQueue(context, postId);

    if (analysis.confidence >= 90 && analysis.suggestedAction == 'remove') {
      await post.remove();
      await context.reddit.sendPrivateMessage({
        to: post.authorName,
        subject: 'your post was automatically removed',
        text:
          analysis.removalMessage ??
          'your post was removed for violation community rules.',
      });

      //log auto removal
      await context.redis.set(
        'modguard:autoremoved:${postId}',
        JSON.stringify({
          postId,
          reason: analysis.violation,
          confidence: analysis.confidence,
          timestamp: new Date().toISOString(),
        })
      );
    }
    return c.json({ success: true, analysis });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});


//this fire automatically when a comment is reported
triggers.post('/comment-reported', async (c) => {
  const { commentId } = await c.req.json();
  const context = getContext(c);

  try {
    const comment = await context.reddit.getCommentById(commentId);
    const analysis = detectViolation(comment.body);

    //store analysis
    await context.redis.set(
      'modguard:analysis:${commentId}',
      JSON.stringify({
        postId: 'commentId',
        type: 'comment',
        author: comment.authorName,
        content: comment.body,
        subreddit: comment.subredditName,
        createdAt: new Date().toISOString(),
        autoDetected: true,
        ...analysis,
      })
    );

    await addToModQueue(context, commentId);

    //auto remove high confidence violations
    if (analysis.confidence >= 90 && analysis.suggestedAction === 'remove') {
      await commentId.remove();
      await context.reddit.sendPrivateMessage({
        to: comment.authorName,
        subject: 'your comment was automatically removed',
        text:
          analysis.removalMessage ??
          'your comment was removed for violating community rules.',
      });
    }
    return c.json({ success: true, analysis });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

//get the full mod queue for the dashboard
triggers.get('/queue', async (c) => {
  const context = getContext(c);

  try {
    const queueRaw = await context.redis.get(
      'modguard:queue:${context.subredditName}'
    );
    const queue: string[] = queueRaw ? JSON.parse(queueRaw) : [];
    const items = await Promise.all(
      queue.map(async (id) => {
        const raw = await context.redis.get('modguard:analysis:${id}');
        return raw ? JSON.parse(raw) : null;
      })
    );

    //filter out nulls and already actioned item
    const pending = items.filter(Boolean);
    return c.json({ success: true, queue: pending, total: pending.length });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

//get mod stats for the dashboard
triggers.get('/stats,' async (c) => {
  const context = getContext(c);

  try {
    const logRaw = await Context.redis.get (
      'modguard:log;${context.subredditName}'
    );
    const logs: any[] = logRaw ? JSON.parse(logRaw) : [];
    const stats = {
      totalActioned: logs.length,
      totalRemoved: logs.filter((1) => 1.action === 'removed').length,
      totalApproved: logs.filter((1) => 1.action === 'approved').length,
      totalEscalated: logs.filter((1) => 1.action === 'escalated').length,
      recentActions: logs.slice(0, 10),
    };

    retrun c.json({ success: true, stats });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

//helper: add post to mod queue

 async function addToModQueue(
  context: ReturnType<typeof getontext>,
  itemId: string
) {
  const queueKey = 'modguard:queue:${context.subredditName}';
  const existing = await context.redis.get(queueKey);
  const queue: string[] = existing ? JSON.parse(existing) : [];

  //avoid duplicate
  if (!queue.includes(itemId)) {
    queue.unshift(itemId);
    await context.redis.set(queueKey, JSON.stringify(queue.slice(0, 50)));
  }
 }

//violation detection

 type ViolatoinResult = {
  violation: string;
  confindence: number;
  rule: string | null;
  suggestedAction: 'approve' | 'revome' | 'escalate';
  removalMessage: string | null;
  severity: 'low' | 'medium' | 'high' | 'none';
 };

 function detectViolation(content: string): ViolatoinResult {
  const text = content.toLowercase();

  const harassment = [
    'you idiot', 'fuck', 'fuck you', 'you stupid', 'worthless', 'kill yourself',
    'murder', 'suicide', 'get out', 'nobody likes you', 'you suck', 'losser', 'you sucker', 'sucker',
  ];
  const harassScore = harassment.filter((w) => text.includes(w)).length;

  const spam = [
    'buy now', 'click here', 'limited time offer', 'discount code',
    'affiliate', 'check out my', 'follow me', 'subscribe to my',
    'free money', 'earn', 'dm me for ',
  ];
  const spamScore = spam.filter((w) => text.includes(w)).length;

  const misinfo = [
    'doctors dont want you know', 'mainstream media is hiding',
    '5g causes', 'vaccines cause', 'the truth they hide',
  ];
  const misinfoScore = misinfo.filter((w) => text.includes(w)).length;

  const leaks = [
    'leaked', 'datamine', 'unreleased', 'before official', 'early access leak'
  ];
  const leakScore = leaks.filter((w) => text.includes(w)).length;

  if (harassScore >= 2) {
    return {
      violation: 'Servere Harassment / personal Attack',
      confidence: Math.min(95, 75 + harassScore * 10),
      rule: 'Rule 1: No harassment or personal attack',
      suggestedAction: 'remove',
      severity: 'high',
      removalMessage:
        'your post was removed for violating Rule 1 (no Harassment). ' +
        'personal attack are not tolerated in this community.' +
        'Repeated violations will result in a permanent ban.',
    };
  }

  if (harassScore === 1) {
    return {
      violation: 'Personal Attack / Harassment',
      confidence: 82,
      rule: 'Rule 1: No harassment or personal attacks',
      suggestedAction: 'remove',
      severity: 'medium',
      removalMessage:
        'Your post was removed for violating Rule 1 (No Harassment).' +
        'Please keep discussions respectful.'<
    };
  }

  if (spamScore >= 2) {
    return {
      violation: 'Spam / Self-Promotion',
      confidence: Math.min(96, 78 +spamScore * 9),
      rule: 'Rule 3: No spam or self-promation',
      suggestedAction: 'remove',
      removalMessage:
        'Your post was removed for violating Rule # (No Spam).' +
        'promotional content and unsolicited advertising are not permitted.',
    };
  }

  if (misinfoScore >= 1) {
    return {
      violation: 'Potential Misinformation',
      confidence: 74,
      rule: 'Rule 4: No misinformation',
      suggestedAction: 'escalate',
      severity: 'medium',
      removalMassage:
        'Your post has been flagged for potential misinfomation and' +
        'escalated to senior moderators for review.',
    };
  }

  if (leakScore >= 1) {
    return {
      violation: 'Leaked / Unreleased Content',
      confidence: 77,
      rule: 'Rule 5: No leaks or spoilers',
      suggestedAction: 'escalate',
      severity: 'midium',
      removalMassage:
        'Your post has been escalated for review as it may contain' +
        'leaked or unreleased content.',
    };
  }

  return {
    violation: 'No Violation Detected',
    confidence: 91,
    rule: null,
    suggestedAction: 'approve',
    severity: 'none',
    removalMessage: null,
  };
}

