# API-key Management Overlay Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task.

**Goal:** Add standalone API-key rename, stable name sorting, and name/full-or-masked-key filtering to upstream v0.5.20 without model restrictions or token limits.

**Architecture:** Keep persistence unchanged and extend the existing key update route with validated, trimmed `name` updates. Extract pure endpoint key display helpers so sorting/filtering behavior is focused and unit-testable, then wire those helpers and inline rename state into the existing endpoint page.

**Tech Stack:** Next.js route handlers, React 19, Vitest.

---

### Task 1: Rename API contract

**Files:**
- Modify: `src/app/api/keys/[id]/route.js`
- Test: `tests/unit/api-keys-update.test.js`

1. Write route tests proving whitespace is trimmed, blank/non-string names return 400, missing keys return 404, and updates contain only requested fields so key/history linkage is preserved.
2. Run the focused test and confirm it fails because rename is not implemented.
3. Add minimal `name` validation and update construction to the route.
4. Re-run the focused test and confirm it passes.

### Task 2: Endpoint key presentation

**Files:**
- Create: `src/app/(dashboard)/dashboard/endpoint/endpointKeyUtils.js`
- Modify: `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js`
- Test: `tests/unit/endpoint-key-utils.test.js`

1. Write pure-function tests proving stable case-insensitive name sorting and case-insensitive filtering by name, full key, and masked key.
2. Run the focused test and confirm it fails because the helper module does not exist.
3. Implement only the display helpers required by those tests.
4. Re-run the focused test and confirm it passes.
5. Wire the helpers into the endpoint page and add inline rename controls with Enter/Escape, Save, and Cancel behavior.

### Task 3: Verification and commit

**Files:**
- Review all files above.

1. Run both focused tests and the relevant database parity test.
2. Run the production build if dependencies/environment permit.
3. Inspect the final diff for scope, unwanted schema fields, and secrets.
4. Stage only relevant files and create one repository-style imperative commit; do not push.
