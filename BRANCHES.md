# Active Personal Branches

| Branch | Type | Purpose | Upstream PR |
|---|---|---|---|
| feat/api-key-token-limits | feat | API key token limits with calendar-based periods | n/a |
| feat/api-key-model-restrictions | feat | Allowed-model enforcement and selector UI for API keys | n/a |
| feat/combo-weighted-balancing | feat | Weighted combo model selection and routing | n/a |
| feat/kimi-coding-oauth | feat | Kimi Coding OAuth provider, refresh flow, and dynamic models endpoint | n/a |
| local/base-path | local | BASE_PATH sub-path deployment overlay and prefixed URL codemods | n/a |
| local/ci-deploy | local | Fork Docker publish workflow for the deploy branch | n/a |
| local/debug-chat-test | local | Chat Test debug page and sidebar registration | n/a |
| local/request-details | local | Fork observability and request-details backup/stream-trace overlay | n/a |
| local/meta | local | Branch registry and fork metadata | n/a |

## Recipe

Runtime branch `deploy` is rebuilt from `master` plus the branches above via `git merge --no-ff`.
