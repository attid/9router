# Branch Registry

This file lives on `local/meta` and is merged into `deploy`. Do not put it on
`master`; `master` stays a clean upstream mirror.

## Base Branches

| Branch | Type | Purpose | Notes |
|---|---|---|---|
| `master` | upstream mirror | Clean mirror of upstream `master` | No fork-specific commits. |
| `deploy` | integration | Runtime branch assembled from `master` plus overlays | Do not develop here directly. |

## Active Overlays

These branches are expected to participate in the `deploy` assembly unless a
specific rebuild intentionally excludes one.

| Branch | Type | Purpose | Upstream PR |
|---|---|---|---|
| `feat/api-key-model-restrictions` | feat | Allowed-model enforcement and selector UI for API keys | n/a |
| `feat/api-key-token-limits` | feat | API key token limits, metered usage accounting, and free combo metering behavior | n/a |
| `feat/combo-weighted-balancing` | feat | Weighted combo model selection and routing | n/a |
| `feat/kimi-coding-oauth` | feat | Kimi Coding OAuth provider, refresh flow, and dynamic models endpoint | candidate |
| `feat/media-provider-example-fix` | feat | Media provider example-card fix | n/a |
| `feat/usage-api-key-report` | feat | Usage report tab grouped by model/date/API key | n/a |
| `local/base-path` | local | `BASE_PATH` sub-path deployment overlay and prefixed URL fixes | n/a |
| `local/ci-deploy` | local | Fork Docker/deploy workflow for the `deploy` branch | n/a |
| `local/client-subpath-glue` | local | Client-side sub-path integration glue | n/a |
| `local/db-lock-fix` | local | Local SQLite/db write-path locking fix | n/a |
| `local/debug-chat-test` | local | Chat Test debug page and sidebar registration | n/a |
| `local/endpoint-subpath-glue` | local | Endpoint/provider page sub-path integration glue | n/a |
| `local/meta` | local | Branch registry and fork metadata | n/a |
| `local/request-details` | local | Request details / observability fork overlay | n/a |

## Parked Branches

These branches are local history, backups, extraction work, or obsolete variants.
They are not part of the normal `deploy` assembly unless explicitly restored.

| Branch | Type | Purpose |
|---|---|---|
| `backup-before-upstream-merge` | backup | Full pre-upstream-merge backup branch. |
| `deploy-before-upstream-20260601` | backup | `deploy` snapshot before the 2026-06-01 upstream update. |
| `legacy/api-key-model-restrictions` | legacy | Previous model-restriction implementation. |
| `legacy/api-key-token-limits` | legacy | Previous token-limit implementation. |
| `legacy/calendar-based-limits` | legacy | Previous calendar-limit implementation. |
| `legacy/combo-weighted-balancing` | legacy | Previous weighted-combo implementation. |
| `legacy/model-select-checkboxes` | legacy | Previous model-select checkbox implementation. |
| `migration/extract` | migration | Extraction/migration scratch branch. |
| `refactor/calendar-based-limits` | refactor | Calendar-limit refactor branch retained for reference. |
| `wip/split-kimi-login` | wip | Experimental split Kimi login work. |

## Recipe

Runtime branch `deploy` is rebuilt from `master` plus the active overlays above:

```bash
git switch deploy
git reset --hard master
git merge --no-ff feat/api-key-model-restrictions
git merge --no-ff feat/api-key-token-limits
git merge --no-ff feat/combo-weighted-balancing
git merge --no-ff feat/kimi-coding-oauth
git merge --no-ff feat/media-provider-example-fix
git merge --no-ff feat/usage-api-key-report
git merge --no-ff local/base-path
git merge --no-ff local/client-subpath-glue
git merge --no-ff local/endpoint-subpath-glue
git merge --no-ff local/db-lock-fix
git merge --no-ff local/debug-chat-test
git merge --no-ff local/request-details
git merge --no-ff local/ci-deploy
git merge --no-ff local/meta
```
