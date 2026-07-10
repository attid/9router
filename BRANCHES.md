# Branch Registry

This file lives on `local/meta` and is merged into `deploy`. Do not put it on
`master`.

## Base Branches

| Branch | Type | Purpose |
|---|---|---|
| `master` | stable upstream base | Clean upstream release `v0.5.20`; advance only to a published stable release after review. |
| `deploy` | integration | Runtime assembly of `master` plus the active overlays below. Never develop directly here. |

## Active Overlays

| Branch | Type | Purpose |
|---|---|---|
| `feat/api-key-model-restrictions` | feature | Per-key model allowlists enforced across model-bearing endpoints. |
| `feat/api-key-token-limits` | feature | Calendar token limits and free-combo metering; reports include free usage while limits exclude it. |
| `feat/api-key-management` | feature | API key rename, deterministic sorting, and filtering. |
| `feat/combo-weighted-balancing` | feature | Weighted combo members with fallback-only weight zero. |
| `feat/gemini-native-output` | feature | Native Gemini request/response translation with tool calling while preserving upstream TTS handling. |
| `feat/usage-api-key-report` | feature | Masked API-key usage report with distinct key aggregation and cached-token totals. |
| `local/request-details` | local | SQLite Request Details metadata, bounded stream traces, and streamed export. |
| `local/debug-chat-test` | local | Chat Test page without a hard response timeout. |
| `local/hide-donate` | local | Minimal removal of the Donate action from the header. |
| `local/ci-deploy` | local | Fork-only GHCR workflow triggered by `deploy`. |
| `local/base-path` | local | Configurable sub-path support and final assembled-tree URL scanner. Apply after every app overlay. |
| `local/meta` | local | This registry and fork metadata only. |

## Upstream Replacements

These historical overlays are not part of `deploy`:

| Old branch | Replacement |
|---|---|
| `feat/kimi-coding-oauth` | Upstream Kimi implementation. |
| `legacy/gemini-native-output` | Rebuilt `feat/gemini-native-output` on stable `v0.5.20`. |
| `feat/media-provider-example-fix` | Current upstream media pages plus `local/base-path`. |
| `local/db-lock-fix` | Upstream SQLite implementation. |
| `local/client-subpath-glue` | Rebuilt `local/base-path`. |
| `local/endpoint-subpath-glue` | Rebuilt `local/base-path`. |

The pre-update runtime is preserved at `deploy-before-upstream-20260710`.

## Assembly Order

Rebuild `deploy` from the stable base. Resolve integration conflicts only on a
temporary assembly branch; fixes that belong to one overlay must be moved back
to that owning branch.

```bash
git switch -C rebuild/deploy-v0.5.20 master
git merge --no-ff feat/api-key-model-restrictions
git merge --no-ff feat/api-key-token-limits
git merge --no-ff feat/api-key-management
git merge --no-ff feat/combo-weighted-balancing
git merge --no-ff feat/gemini-native-output
git merge --no-ff feat/usage-api-key-report
git merge --no-ff local/request-details
git merge --no-ff local/debug-chat-test
git merge --no-ff local/hide-donate
git merge --no-ff local/ci-deploy
git merge --no-ff local/base-path
git merge --no-ff local/meta
```

Verify feature branches without `BASE_PATH`. Verify the final assembly with
`BASE_PATH=/9router`, run the browser URL scanner, production build, and
Playwright checks before updating `deploy`.
