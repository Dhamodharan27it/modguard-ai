# ModGuard AI Refactor — TODO

## Step 1: Repo understanding (done)
- Reviewed current route files and core engine.

## Step 2: Create target architecture skeleton
- Create folders:
  - src/middleware/
  - src/services/
  - src/utils/
  - src/types/
  - src/routes/api/
  - src/routes/forms/
  - src/routes/menu/
  - src/routes/triggers/
- Add initial placeholder/real implementations:
  - middleware/modAuth.ts
  - middleware/rateLimit.ts
  - utils/safe.ts, utils/validators.ts, utils/helpers.ts
  - types/moderation.ts
  - services/* (queue/log/dashboard/threat/analytics/moderation)

## Step 3: Split routes into requested sub-files
- Move/implement:
  - routes/api/index.ts (from current src/routes/api.ts)
  - routes/forms/forms.ts (from current src/routes/forms.ts)
  - routes/triggers/triggers.ts (from current src/routes/triggers.ts)
  - routes/menu/*
    - analyse.ts, moderation.ts, dashboard.ts, threat.ts, copilot.ts, scan.ts
    - menu/index.ts composes them

## Step 4: Centralize shared Redis logic into services
- Move queue add/remove into services/queueService.ts
- Move logAction into services/logService.ts
- Update route handlers to use services

## Step 5: Update router wiring in src/index.ts
- Import new route modules and mount at the same endpoints:
  - /internal/menu
  - /internal/form
  - /internal/triggers
  - /api

## Step 6: Add middleware usage where appropriate
- Apply modAuth/rateLimit on moderation-mutating endpoints.

## Step 7: Clean up / compatibility
- Ensure no broken imports.
- Optionally keep shim files for old paths if needed.

## Step 8: Verification
- npm run type-check
- npm run lint
- npm run build

