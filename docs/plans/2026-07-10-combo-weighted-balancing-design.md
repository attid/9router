# Combo Weighted Balancing Design

## Goal

Port per-model combo weights from the old feature branch onto the v0.5.20 combo engine while preserving Fusion, capacity auto-switch, sticky round-robin, and fallback behavior.

## Data model and compatibility

Combo members use the canonical shape `{ model: string, weight: number }`. Storage and API writes normalize legacy strings to `{ model, weight: 1 }`, so existing SQLite rows and imported backups continue to work without a schema migration. A valid member has a non-empty model name and a finite, non-negative integer weight. API requests reject malformed members instead of silently repairing them.

## Ordinary combo routing

Positive weights participate in deterministic weighted round-robin. For example, weights `A:2, B:1` select `A, A, B` across successive rotation slots. Sticky round-robin applies to each slot, so a sticky limit of two produces `A, A, A, A, B, B`. The implementation computes slots arithmetically rather than expanding a potentially large cycle array.

Each request retains upstream fallback behavior. The selected positive-weight model is tried first, followed by the other positive-weight models in cyclic declared order, with duplicates removed. Weight-zero models are never selected as rotation primaries and are tried only after the positive pool. Under the non-rotating `fallback` strategy, positive models keep declared order and zero-weight members move to the end.

Capacity auto-switch remains a stable reordering of the final try list. It can move a capable model (including a zero-weight compatibility fallback) ahead of the weighted primary for the current request, but rotation state still advances normally and no fallback candidate is dropped. Thus zero means "never a rotation primary," while the upstream compatibility safeguard still wins when request data would otherwise be lost.

## Fusion

Fusion is intentionally not a balancing strategy. It normalizes each member to its model name, keeps declared order, and ignores weights. This preserves fan-out and judge semantics: every configured model remains a panel member, including weight-zero entries, and the automatic judge remains the first normalized model. The UI explains that weights affect only Round Robin; Fusion ignores them.

## UI and scope

The shared combo editor exposes a non-negative integer weight for every member and labels zero as fallback-only. Combo cards render normalized model names and optional weight badges. Media combo listings use normalized names for provider icons. Changes stay in the current SQLite/API/UI and `open-sse/services/combo.js`; deleted `cloud/src` code and obsolete `open-sse/services/compact.js` are not restored or modified.

## Verification

Unit coverage proves legacy normalization, validation, weighted and sticky rotation, zero-weight fallback ordering, capacity reordering, and Fusion weight ignoring. Existing combo routing, auto-switch, and Fusion suites must remain green, followed by the full unit suite, lint, and production build.
