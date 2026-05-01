import { Hano } from 'hano';
import { getContext} from '@devvit/web/server';


export const menu = new Hano();

// when mod clipcks "analyse with ModGuard AI"
menu.post ('/analyse-post', async (c) => {
    const { postId } = await c.req.json();
    const context = getContext(c);

    try {
        const post = await context.reddit.getPostById(postId);
        const analysis = detectViolation(post.title + ' ' + (post.body ?? ''));
        await context.redis.set(
            'modguard:analysis:${postId}',
            JSON.stringify({
                postId,
                author: post.authorName,
                title: post.title,
                content: post.body ?? post.title,
                subreddit: post.subredditName,
                createdAt: post.createAt,
                ...analysis,

            })
        );
        return c.json({ success: true, analysis });
    }   catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
    
});

//when mod clicks "remove post" action
menu.post('/remove-post', async (c) => {
    const { postId, reason } = await c.req.json();
    const context = getContext(c);
    
    try{
        const post = await context.reddit.getPostById(postId);
        await post.remove();
        await context.reddit.sendPrivateMassage({
            to: post.authorName,
            subject: 'Your post was removed by the ModGuard AI'
        });
        await logModAction(context, postId, 'removed', reason);
        return c.json({ success: true });
    }   catch(error) {
        return c.json({ success: false, error: String(error)}, 500);

    }
}); 

//when mod clicks "approve post" action
menu.post('/approve-post', async (c) => {
    const { postId } = await c.req.json();
    const context = getContext(c);
    
    try{
        const post = await context.reddit.getPostById(postId);
        await post.approve();
        await logModAction(context, postId, 'approved', '');
        return c.json({ success: true });
    }   catch (error) {
        return c.json({ success: false, error: String(error)}, 500);

    }
}); 

//when mod clicks "ban user" action
menu.post('/ban-user', async (c) => {
    const { username, subredditName, reason, duration } = await c.req.json();
    const context = getContext(c);
    
    try{
        await context.reddit.banUser({
            subredditName,
            username,
            reason,
            duration,
            message: 'You Have Been Banned: ${reason}',
        
        });

        return c.json({ success: true });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }

});

// AI Violation Detection Engine

type ViolationResult = {
    violation: string;
    confidence: number;
    rule: string | null;
    suggestedAction: 'approve' | 'remove' | 'none' ;
    removealMessage: string | null;
    severity: 'low' | 'medium' | 'high' | 'none';
};

function detectionViolation(content: string): ViolationResult {
    const text = content.toLowerCase();

    //Rule 1: Harassment
    const harassment = [
        'you idiot', 'fuck', 'fuck you', 'you stupid', 'worthless', 'kill yourself',
        'murder', 'suicide', 'get out', 'nobody likes you', 'you suck', 'losser', 'you sucker', 'sucker'
    ];
    const harassScore = harassment.filter((w) => text.includes(w)).length;

    //Rule 2: Hate Speech
    const hateKeywords = [
        'all [group] should', 'i hate[group]', 'go back to',
    ];

    //Rule 3: Spam & Self-promotion
    const spam = [
        'buy now', 'click here', 'limited time offer', 'discount code',
        'affiliate', 'check out my', 'follow me', 'subscribe to my',
        'free money', 'earn', 'dm me for ',
    
    ];
    const spamScore = spam.filter((w) => text.includes(w)).length; 
        
    //Rule 4: MisInformation
    const misinfo = [
        'doctors dont want you know', 'mainstream media is hiding',
        '5g causes', 'vaccines cause', 'the truth they hide',
    ];
    const misinfoScore = misinfo.filter((w) => text.includes(w)).length;

    // Rule 5: Leaks & Spoliers
    const leaks = [
        'leaked', 'datamine', 'unreleased', 'before official', 'early access leak'
    ];
    const leakScore = leaks.filter((w) => text.includes(w)).length;

    
    // score and return

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

    //Clean post
    return {
        violation: 'No Violation Detected',
        confidence: 91,
        rule: null,
        suggestedAction: 'approve',
        severity: 'none',
        removalMessage: null,
    };
}

// log mod action to Redis for the stats dashboard

async function logModAction(
    context: ReturnType<typeof getContext>,
    postId: string,
    action: string,
    reason: string
) {
    const logKey = 'modguard:log:${context.subredditName}';
    const existing = await context.redis.get(logKey);
    const logs: object[] = existing ? JSON.parse(existing) : [];

    logs.unshift({
        postId,
        action,
        reason,
        timestamp: new Date().toISOString(),
        modeator: context.userId,
    });

    //Keep only last 100 log entries
    await context.redis.set(logKey, JSON.stringify(logs.slice(0, 100)));
}