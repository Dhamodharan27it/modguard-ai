import { Hono } from 'hono';
import { analyseMenu } from './analyse';
import { moderationMenu } from './moderation';
import { dashboardMenu } from './dashboard';
import { threatMenu } from './threat';
import { copilotMenu } from './copilot';
import { scanMenu } from './scan';

export const menu = new Hono();

menu.route('/', analyseMenu);
menu.route('/', moderationMenu);
menu.route('/', dashboardMenu);
menu.route('/', threatMenu);

menu.route('/', copilotMenu);
menu.route('/', scanMenu);





