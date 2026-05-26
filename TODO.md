# ModGuard AI — Implementation TODO

## Phase 1: Explainability + Policy backbone
- [ ] Inspect and update moderation payload shape to include explainability bundle (detector evidence + decision factors + safer-text summary)
- [ ] Add subreddit policy store + policy fetch in backend (Redis-backed)
- [ ] Make detectors/risk scoring policy-aware (weights/threshold overrides)
- [ ] UI: Add explainability panel in queue detail

## Phase 2: Moderator feedback learning loop
- [ ] Add API endpoints to submit feedback (correct/wrong + optional note)
- [ ] Persist feedback in Redis and compute per-detector tuning deltas
- [ ] Apply tuning to detector weights / false-positive reduction
- [ ] UI: Add feedback buttons next to recommended actions

## Phase 3: Coordinated behavior intelligence + proactive signals
- [ ] Add coordinated/raid likelihood inference in backend using Redis recent activity signals
- [ ] Surface raid group alerts in Timeline/Team UI
- [ ] Expand proactive suggestions (duplicate detection hint, mod-only windows as suggestions)

## Phase 4: Playbooks + recommended responses
- [ ] Create message template service (ban/removal/warning/appeal replies)
- [ ] UI: Replace/upgrade responsive removal message widget with template controls + copy button

## Phase 5: Transparency / public accountability
- [ ] Expand /api/transparency with feedback-derived accuracy + false-positive rate + appeal outcomes
- [ ] UI: enrich transparency tab with tables/charts

## Phase 6: QA
- [ ] Run lint/type-check/test/build
- [ ] Smoke test: queue detail, policy UI, feedback submission, transparency tab

