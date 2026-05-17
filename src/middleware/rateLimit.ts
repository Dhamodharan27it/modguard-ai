import { Hono } from 'hono';


export const rateLimit = new Hono().use(async (_c, next) => {
  await next();
});

