# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.27.1 - 2026-09-21

### Fixed

- Enhance Azure v1 query handling and add multipart upstream URL logic

## 0.27.0 - 2026-09-15

### Added

- Database pool size and statement timeout are configurable with `POSTGRES_POOL_MAX` (default 10) and `POSTGRES_STATEMENT_TIMEOUT_MS` (default 30000)
- SSO sign-up setting: when it is off, only invited users and the first account can sign up through SSO, and the login page explains a refused sign-in

### Changed

- Navigation: Providers sits next to Machine Tokens, Audit Log moved to Monitor, and Governance is now called Configure
- Service and token forms group inline limits and access into collapsible sections
- Settings are cached for up to 5 seconds, so other instances can take that long to pick up a change
- Usage and cost analysis pages load faster: query results are cached, secondary panels stream in after the headline, and latency percentiles are cheaper to compute

### Removed

- Breaking: migration 0019 drops the `request_trace` and `trace_span` tables, so captured traces are deleted on upgrade; export them first if you need them
- Breaking: request tracing is gone: the trace viewer, the OTLP endpoint `/v1/traces` and the tracing switches on settings, policies, services and tokens. The `x-uprox-trace-id`, `x-uprox-session-id`, `x-uprox-metadata` and `x-uprox-meta-*` headers and the `tracingEnabled` API field are ignored

### Fixed

- `budget_alert_state` has a primary key (migration 0017)
- Budget status takes budgets set directly on a service into account
- Cancelling a request now cancels the upstream provider call, model listing included, and is audited as 499; streamed responses are passed through without buffering
- Deleting a provider secret or a policy is recorded in the audit log, and a new token is written together with its audit entry
- Native Gemini routes under `/v1beta` return the gateway JSON 404 for unknown paths and are no longer blocked by the dashboard CSRF check
- The admin API validates policy and pricing update bodies and rejects malformed ones
- The usage empty state shows the selected range, and chart axes keep compact cost labels
