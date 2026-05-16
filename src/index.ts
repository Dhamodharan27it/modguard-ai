import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { api } from './routes/api/index';
import { forms } from './routes/forms/forms';
import { menu } from './routes/menu/index';



import { triggers } from './routes/triggers/triggers';


const app = new Hono();
const internal = new Hono();

//  MUST be first — handles onAppInstall before anything else 
app.all('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  console.log(`[ModGuard] ${c.req.method} ${path}`);
  await next();
});

//  Internal routes 
internal.route('/menu', menu);


internal.route('/form', forms);
internal.route('/triggers', triggers);

//  API routes 
app.route('/api', api);
app.route('/internal', internal);

//  Health check 
app.get('/health', (c) => c.json({ status: 'ok' }));

//  Start server 
serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});

console.log('[ModGuard] Server starting...');