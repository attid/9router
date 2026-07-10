# Combo Weighted Balancing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task.

**Goal:** Add backward-compatible per-model weights to v0.5.20 ordinary combos without changing upstream Fusion, capacity, sticky rotation, or fallback semantics.

**Architecture:** Centralize member normalization and validation in `src/lib/comboUtils.js`, normalize SQLite repository boundaries, and make the upstream combo service build a weighted try order before its existing stable capacity reorder and fallback loop. Fusion receives names only and deliberately ignores weights. The shared combo editor owns the structured UI representation.

**Tech Stack:** Next.js 16, React 19, JavaScript modules, SQLite JSON columns, Vitest, ESLint.

---

### Task 1: Define and test combo member normalization

**Files:**
- Create: `src/lib/comboUtils.js`
- Create: `tests/unit/combo-weights.test.js`

1. Write tests for strings, structured and mixed arrays, default weight, non-mutating name extraction, and invalid member rejection.
2. Run `npm --prefix tests test -- tests/unit/combo-weights.test.js` and confirm failure because the helper does not exist.
3. Implement `normalizeComboModels`, `getComboModelName`, `getComboModelNames`, and validation with non-negative integer weights.
4. Re-run the focused test and confirm it passes.

### Task 2: Add weighted ordering to the upstream combo engine

**Files:**
- Modify: `open-sse/services/combo.js`
- Modify: `tests/unit/combo-routing.test.js`
- Modify: `tests/unit/combo-autoswitch.test.js`
- Modify: `tests/unit/combo-fusion.test.js`

1. Add failing tests for `2:1` deterministic rotation, sticky slots, zero-only and mixed fallback order, structured auto-switch, and Fusion ignoring weights.
2. Run the focused combo suites and confirm failures caused by missing weighted behavior.
3. Implement arithmetic weighted-slot selection and normalized try-list construction; retain the existing response/error fallback loop and stable capacity reorder.
4. Normalize Fusion members to names at its boundary.
5. Re-run all focused combo suites and confirm they pass.

### Task 3: Normalize SQLite and validate API writes

**Files:**
- Modify: `src/lib/db/repos/combosRepo.js`
- Modify: `src/lib/db/migrate.js`
- Modify: `src/app/api/combos/route.js`
- Modify: `src/app/api/combos/[id]/route.js`
- Test: `tests/unit/combo-weights.test.js`

1. Add failing tests covering repository-style normalization and API validation helper results.
2. Normalize members when rows are read, created, updated, and imported; no SQL schema change is needed because members remain JSON.
3. Reject malformed `models` payloads in POST and PUT with a 400 response while accepting legacy strings.
4. Re-run the focused tests.

### Task 4: Update the combo UI

**Files:**
- Modify: `src/shared/components/ComboFormModal.js`
- Modify: `src/app/(dashboard)/dashboard/combos/page.js`
- Modify: `src/app/(dashboard)/dashboard/media-providers/web/page.js`
- Modify: `src/app/(dashboard)/dashboard/media-providers/[kind]/page.js`

1. Normalize modal state to structured entries and update selection, deselection, inline editing, reordering, and save payloads.
2. Add a numeric weight control with `0` explained as fallback-only and note that Fusion ignores weights.
3. Render names and weights correctly on combo and media cards.
4. Run ESLint on the modified UI files and fix any errors.

### Task 5: Verify and commit

**Files:**
- Review all modified files; confirm no changes under `cloud/src` or in `open-sse/services/compact.js`.

1. Run focused combo tests, then the complete Vitest suite.
2. Run ESLint and `npm run build`.
3. Review `git diff --check`, `git diff --stat`, and the complete diff against this design.
4. Scan the diff for credentials and secret-like values.
5. Stage only relevant files and commit with the repository's Conventional Commit style; do not push.
