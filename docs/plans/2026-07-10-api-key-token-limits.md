# API Key Token Limits and Free Combo Metering Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task.

**Goal:** Port calendar API-key token limits and explicitly unmetered free combos to v0.5.20 without the later rename/filter UI or the separate `allowedModels` overlay.

**Architecture:** Store key limits and combo `isFree` flags in additive SQLite columns and preserve them through CRUD, legacy import, and export. Persist `requestedModel` and `metered` in usage-history metadata so normal usage reports continue aggregating every request, while a metered-only API-key query initializes calendar-period counters. Propagate free-combo metadata through the current chat core's non-streaming, forced SSE-to-JSON, translated streaming, passthrough streaming, and fusion paths.

**Tech Stack:** Next.js 16 route handlers and React UI, SQLite/better-sqlite3 or sql.js repository layer, open-sse chat pipeline, Vitest.

---

### Task 1: Persistence and metered usage aggregation

**Files:**
- Modify: `src/lib/db/schema.js`
- Modify: `src/lib/db/repos/apiKeysRepo.js`
- Modify: `src/lib/db/repos/combosRepo.js`
- Modify: `src/lib/db/repos/usageRepo.js`
- Modify: `src/lib/db/index.js`
- Modify: `src/lib/db/migrate.js`
- Modify: `src/lib/localDb.js`
- Modify: `src/lib/usageDb.js`
- Test: `tests/unit/key-limits-persistence.test.js`
- Test: `tests/unit/free-combo-metering.test.js`

1. Write failing tests for limits CRUD, combo `isFree` preservation, export/import, metered-only totals, cached token preservation, masked usage reporting, and free usage visibility.
2. Run the focused tests and confirm failures are caused by missing schema/API behavior.
3. Add the columns, repository mappings, import/export mappings, usage metadata, and `getUsageByApiKey` export.
4. Emit an immediate per-insert usage event for counter accuracy while retaining the debounced dashboard update event.
5. Run the focused tests until green.

### Task 2: Calendar counters and enforcement API

**Files:**
- Create: `src/sse/services/keyLimits.js`
- Create: `src/app/api/keys/[id]/usage/route.js`
- Modify: `src/app/api/keys/route.js`
- Modify: `src/app/api/keys/[id]/route.js`
- Modify: `src/sse/handlers/chat.js`
- Test: `tests/unit/keyLimits.test.js`
- Test: `tests/unit/key-limits-routes.test.js`

1. Write failing tests for local calendar hour/day/Monday-week boundaries, initialization from persisted metered usage, rollovers, live counter increments, limit validation, HTTP 429 and Retry-After behavior, and usage endpoint output.
2. Run the focused tests and confirm expected failures.
3. Implement normalized non-negative limits, hybrid in-memory counters, usage endpoint, CRUD support, and pre-routing enforcement (free combos bypass the check).
4. Run the focused tests until green.

### Task 3: Free-combo propagation through current chat core

**Files:**
- Modify: `src/sse/handlers/chat.js`
- Modify: `open-sse/handlers/chatCore/requestDetail.js`
- Modify: `open-sse/handlers/chatCore/nonStreamingHandler.js`
- Modify: `open-sse/handlers/chatCore/sseToJsonHandler.js`
- Modify: `open-sse/handlers/chatCore/streamingHandler.js`
- Modify: `open-sse/utils/stream.js`
- Test: `tests/unit/free-combo-usage-propagation.test.js`

1. Write failing tests covering regular combo metering and free-combo metadata in non-streaming, both forced SSE-to-JSON branches, translated streams, passthrough streams, nested combos, and fusion panel/judge calls.
2. Run the focused tests and verify each missing propagation edge fails.
3. Attach immutable usage metadata at combo resolution and pass it to every usage write without changing report aggregation.
4. Run the focused tests until green.

### Task 4: Dashboard controls and progress

**Files:**
- Modify: `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js`
- Modify: `src/app/(dashboard)/dashboard/combos/page.js`
- Test: `tests/unit/key-limits-ui.test.js`

1. Write failing source-level regression tests proving limit inputs/editing/progress and free-combo controls/badges exist while rename/filter and `allowedModels` controls do not.
2. Run the tests and confirm expected failures.
3. Add create/edit limit controls, per-key usage fetching and progress bars, and combo `Free` toggle/badge.
4. Run the focused tests until green.

### Task 5: Verification and commit

**Files:**
- Review all changed files above.

1. Run all new regression suites plus existing cached-token, security-audit, DB migration/parity, stream, and chat-core suites.
2. Run lint/build checks relevant to changed JavaScript and UI files.
3. Inspect the diff for accidental `allowedModels`, rename/filter UI, raw-key report exposure, and duplicate streaming usage writes.
4. Use the commit skill to scan for secrets, review the final diff, and create one conventional commit.
5. Confirm the branch is clean and do not push.
