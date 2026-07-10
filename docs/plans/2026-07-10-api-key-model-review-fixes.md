# API Key Model Review Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task.

**Goal:** Enforce API-key model allowlists consistently, preserve request-facing aliases, eliminate selector lost updates, and make API-key creation composable.

**Architecture:** Put authentication and exact request-facing model authorization in `src/sse/services/auth.js`, and call it from every authenticated model-bearing handler before combo, alias, provider, or credential resolution. Keep existing-key edits in a local draft and persist once when the modal closes. Change API-key creation's third argument to an options object so model restrictions and future limit overlays compose without positional arguments.

**Tech Stack:** Next.js 16, React 19, JavaScript ESM, SQLite repository adapters, Vitest.

---

### Task 1: Central model authorization

**Files:**
- Modify: `src/sse/services/auth.js`
- Modify: `src/sse/handlers/chat.js`
- Modify: `src/sse/handlers/embeddings.js`
- Modify: `src/sse/handlers/imageGeneration.js`
- Modify: `src/sse/handlers/tts.js`
- Modify: `src/sse/handlers/stt.js`
- Modify: `src/sse/handlers/search.js`
- Modify: `src/sse/handlers/fetch.js`
- Modify: `src/app/api/v1beta/models/[...path]/route.js`
- Test: `tests/unit/api-key-model-authorization.test.js`
- Test: `tests/unit/api-key-model-restrictions.test.js`

1. Add failing tests proving exact request-facing aliases are allowed and blocked models stop each modality before routing/provider lookup.
2. Run the focused tests and confirm failures are due to missing central enforcement.
3. Add an authorization helper that returns the authenticated key or a 401/403 response and compares the un-resolved request model.
4. Replace duplicated handler authentication with the helper before any combo/model/provider/credential lookup.
5. Run the focused tests and confirm they pass.

### Task 2: Race-free model selection and alias values

**Files:**
- Modify: `src/shared/components/ModelSelectModal.js`
- Modify: `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js`
- Test: `tests/unit/endpoint-key-model-ui.test.js`

1. Add failing source regressions for request-facing alias values and a single save-on-close update.
2. Run the focused UI regression and confirm failure.
3. Annotate alias entries with their request-facing value, maintain an existing-key draft locally, and save once on modal close.
4. Run the focused UI regression and confirm it passes.

### Task 3: Composable API-key creation

**Files:**
- Modify: `src/lib/db/repos/apiKeysRepo.js`
- Modify: `src/app/api/keys/route.js`
- Test: `tests/unit/api-key-routes.test.js`
- Test: `tests/unit/db-sqlite-vs-lowdb.test.js`

1. Change tests to require `createApiKey(name, machineId, { allowedModels })` while preserving restrictions.
2. Run the focused tests and confirm signature failures.
3. Refactor the repository and route call to the options object.
4. Run focused persistence and route tests.

### Task 4: Verification and commit

**Files:** all modified files above.

1. Run focused Vitest files, ESLint on modified source files, and the production build.
2. Inspect status/diff and scan the staged diff for secret-like values.
3. Request a code review of the final diff and address any critical or important findings.
4. Re-run affected checks after review fixes.
5. Commit only relevant files with a Conventional Commit message; do not push.
