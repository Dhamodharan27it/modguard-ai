import { Hono } from 'hono';
import { context as devvitContext } from '@devvit/web/server';


export const modAuth = new Hono().use(async (_c, next) => {
 
  void devvitContext.userId;

  await next();
});

