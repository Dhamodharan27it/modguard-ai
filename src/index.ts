import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { api } from './routes/api/index';
import { forms } from './routes/forms/forms';
import { menu } from './routes/menu/index';
import { triggers } from './routes/triggers/triggers';

const app = new Hono();
const internal = new Hono();

internal.route('/menu', menu);
internal.route('/form', forms);
internal.route('/triggers', triggers);

app.route('/api', api);
app.route('/internal', internal);

app.get('/health', (c) => c.json({ status: 'ok' }));

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});

console.log('[ModGuard AI] ⚡ Community Safety Operating System started');