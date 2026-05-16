import { Hono } from 'hono';
import { menu } from '../menu';

// Temporary: keep existing monolithic menu during refactor.
// Next commits will split into analyse/moderation/dashboard/threat/copilot/scan modules.

const router = new Hono();
router.route('/', menu);

export { menu };




