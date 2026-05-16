import { Hono } from 'hono';

// Simple no-op rate limiter stub for now.
// Keeps structure compatible with the requested architecture.
export const rateLimit = new Hono().use(async (_c, next) => {
  await next();
});

