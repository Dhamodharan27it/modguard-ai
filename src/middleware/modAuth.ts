import { Hono } from 'hono';
import { context as devvitContext } from '@devvit/web/server';

// Lightweight stub: in Devvit, moderator verification APIs vary by runtime.
// This middleware is intentionally permissive to avoid blocking hackathon demo.
export const modAuth = new Hono().use(async (_c, next) => {
  // Placeholder: you can replace with real moderator checks later.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void devvitContext.userId;

  await next();
});

