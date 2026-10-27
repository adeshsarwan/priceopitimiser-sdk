# Auction Telemetry

This document describes the optional client-side auction telemetry added for Price Optimiser Native and Anchor display diagnostics.

The SDK change is observational only. It does not alter floor selection, ladders, retry timing, fallback behavior, GPT display/refresh calls, correlator behavior, slot ownership, slot destruction, targeting writes, experiment assignment, preload/reveal behavior, publisher APIs, runtime config values, GAM config, or pricing rules.

## Runtime Enablement

Telemetry is disabled by default and becomes active only when runtime config enables it and an endpoint is available.

Example runtime config:

```json
{
  "telemetry": {
    "enabled": true,
    "endpoint": "https://priceoptimiser1.thebesads.com/telemetry/auction-events",
    "sampleRate": 1,
    "maxBatchSize": 30,
    "maxQueueSize": 300,
    "flushIntervalMs": 5000,
    "maxPayloadBytes": 65536
  }
}
```

Supported config aliases:

- `auctionTelemetry`, `auction_telemetry`, or `telemetry`
- `endpoint` or `url`
- `sampleRate` or `sample_rate`
- `maxBatchSize` or `max_batch_size`
- `maxQueueSize` or `max_queue_size`
- `flushIntervalMs` or `flush_interval_ms`
- `maxPayloadBytes` or `max_payload_bytes`

If telemetry is enabled and no endpoint is provided, the SDK derives `https://<runtime-config-origin>/telemetry/auction-events` from `data-po-runtime-config-url` or the default Price Optimiser runtime-config origin.

Exact client defaults:

- `schema_version`: `1`
- `sampleRate`: `1`
- `maxBatchSize`: `30`
- `maxQueueSize`: `300`
- `flushIntervalMs`: `5000`
- `maxPayloadBytes`: `65536`
- `transport`: `fetch` with `keepalive: true`, `credentials: omit`, `cache: no-store`; `navigator.sendBeacon` is preferred on `pagehide` and hidden `visibilitychange`.
- `sdk_version`: runtime `sdkVersion`, `sdk_version`, `buildId`, or `build_id`; otherwise `0.1.0`.

## Event Coverage

The SDK emits telemetry for both control and variant display opportunities.

Covered paths:

- Native initial display
- Anchor initial display
- Native and Anchor control requests
- Priced variant attempts
- Final plain fallback attempts, with `price_rule` removed from the targeting snapshot
- Refresh opportunities with stable `refresh_round`
- Real preload, reveal reuse, and reveal recovery
- Request timeout and late GPT render events

Opportunity sources:

- `initial`
- `preload`
- `reveal_recovery`
- `scheduled_refresh`
- `other`

Core event types:

- `opportunity_created`
- `gam_request_started`
- `slot_requested`
- `slot_response_received`
- `slot_render_ended`
- `attempt_filled`
- `attempt_no_fill`
- `fallback_started`
- `fallback_completed`
- `refresh_opportunity_started`
- `preload_started`
- `preload_completed`
- `reveal_started`
- `reveal_completed`
- `timeout`
- `error`
- `opportunity_completed`

GPT events are captured through one adapter-level bridge registered on `googletag.pubads()` for `slotRequested`, `slotResponseReceived`, and `slotRenderEnded`. The bridge maps GPT slots back to Price Optimiser state and does not add per-attempt GPT listeners beyond the existing auction listener used by the runtime.

## Schema

Request body:

```json
{
  "schema_version": 1,
  "events": [
    {
      "schema_version": 1,
      "event_id": "po-event-example",
      "session_id": "po-session-example",
      "opportunity_id": "native-native-leaderboard-1",
      "timestamp": "2026-09-03T00:00:00.000Z",
      "monotonic_timestamp": 123.45,
      "site": "jobguidematch.com",
      "sdk_version": "0.1.0",
      "page_path": "/worldwide/",
      "slot_name": "native-leaderboard",
      "publisher_div_id": "ad-leaderboard",
      "gpt_slot_id": "ad-leaderboard",
      "ad_unit_path": "/23360556473/jobguidematch.com_Native",
      "exp_key": "ads_exp_v6",
      "exp_group": "variant",
      "refresh_round": "0",
      "attempt_number": 1,
      "price_rule": "3",
      "is_fallback": false,
      "event_type": "gam_request_started",
      "request_method": "display",
      "change_correlator": "not_applicable",
      "opportunity_source": "initial",
      "targeting_snapshot": {
        "exp_key": "ads_exp_v6",
        "exp_group": "variant",
        "slot_name": "native-leaderboard",
        "refresh_round": "0",
        "price_rule": "3"
      }
    }
  ]
}
```

Allowed event fields are fixed in `src/core/telemetry.js` and unknown fields are stripped before enqueue.

Field notes:

- `session_id` is generated in memory and is not stored in cookies or localStorage.
- `event_id` and `opportunity_id` are SDK-generated diagnostic IDs.
- `page_path` includes only the path, never query strings or fragments.
- `targeting_snapshot` is limited to Price Optimiser-owned fields: `exp_key`, `exp_group`, `slot_name`, `refresh_round`, `price_rule`, and keys prefixed with `po_`.
- `creative_id`, `line_item_id`, and `advertiser_id` are copied from GPT render events when present.
- Timing fields use ISO wall-clock timestamps plus `performance.now()` monotonic timestamps. Per-attempt derived durations include request-to-requested, request-to-response, request-to-render, previous-render-to-next-request, attempt duration, and opportunity total duration.
- `overlap_detected` marks a new request beginning while the previous attempt has not reached render completion.
- `late_event` marks a GPT event that arrives after the active telemetry attempt has already completed, such as render after timeout.

Privacy boundaries:

- No cookies.
- No localStorage values.
- No IP addresses.
- No user identifiers.
- No full URLs or query strings.
- No arbitrary publisher targeting.
- No telemetry IDs are sent to GAM.

## Backend Endpoint

This repository does not contain a Worker, server route, D1 migration folder, SQL schema, or deployment config for a telemetry ingestion backend. The SDK therefore implements the client emitter and endpoint contract only.

Expected endpoint:

- `POST /telemetry/auction-events`
- Content type: `application/json`
- Body: `{ "schema_version": 1, "events": [...] }`
- Response: `204 No Content` or another 2xx status
- CORS: allow publisher origins that run the SDK
- Request failures must be accepted as normal; the client drops failed batches and keeps auctions fail-open.

Recommended storage model for a future Worker/D1 backend:

```sql
CREATE TABLE auction_telemetry_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schema_version INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  opportunity_id TEXT,
  session_id TEXT,
  timestamp TEXT NOT NULL,
  site TEXT,
  page_path TEXT,
  slot_name TEXT,
  publisher_div_id TEXT,
  ad_unit_path TEXT,
  exp_key TEXT,
  exp_group TEXT,
  refresh_round TEXT,
  attempt_number INTEGER,
  price_rule TEXT,
  is_fallback INTEGER,
  event_type TEXT NOT NULL,
  opportunity_source TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX auction_telemetry_event_id_idx
  ON auction_telemetry_events(event_id);

CREATE INDEX auction_telemetry_site_time_idx
  ON auction_telemetry_events(site, timestamp);

CREATE INDEX auction_telemetry_opportunity_idx
  ON auction_telemetry_events(opportunity_id);
```

Recommended raw retention: 7 to 14 days for unsummarized events, then aggregate by site, slot, experiment group, refresh round, attempt number, price rule, and fallback state.

## Volume Estimate

Network overhead is bounded by batching. At default settings the client sends at most 30 events per POST and caps a payload at 64 KB. Typical compressed CDN/network cost should be materially lower than the raw JSON size, but the raw default ceiling is about 2.1 KB per event if a full batch reaches the cap. Typical events are usually smaller, about 0.8 KB to 1.5 KB before compression.

Approximate event counts per opportunity:

- Control fill or no-fill: about 7 events.
- Variant fill on first priced attempt: about 7 events.
- Variant no-fill through `[3, 1]` plus final fallback: about 19 events.
- Refresh round 1 with `[5, 3, 1]` plus fallback: about 24 events.
- Refresh round 2 or later with four priced attempts plus fallback: about 29 events.
- Real preload adds `preload_started` and `preload_completed`.
- Reveal adds `reveal_started` and `reveal_completed`.

Daily D1 write estimate:

```text
daily writes = sampled opportunities * average events per opportunity
```

Using the recent audit sample of about 19,129 Native plus Anchor opportunities per day:

- 100 percent sampling at 7 events/opportunity: about 134k event rows/day.
- 100 percent sampling at 19 events/opportunity: about 363k event rows/day.
- 10 percent sampling at 19 events/opportunity: about 36k event rows/day.

Recommended initial rollout is `sampleRate: 0.1` unless the backend owner confirms D1 write capacity, retention, and aggregation are ready for a short 100 percent diagnostic window.

## Known Operational Gap

The current JobGuideMatch source still has `publisherControlledPreloadRoutes: ['/find/apply/*']`, while the operational handoff says `/worldwide/` is the live hidden rewarded waiting flow. Telemetry records `opportunity_source`, preload, reveal, and reveal recovery when those APIs are used, but it does not change route gating. If `/worldwide/` Native or Anchor divs are renderable before explicit publisher preload, auto-init can still consume them. Hidden or non-renderable ancestors reduce that risk, but the stale route remains a real configuration/code issue outside this telemetry-only change.
