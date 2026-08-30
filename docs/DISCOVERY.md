# Existing Price Optimiser Discovery

Investigation source: `/var/www/priceoptimizer1` on the VPS. No files, services, migrations, or Nginx config were changed during discovery.

## Publisher Setup

The existing publisher snippets are generated in `server/public/app.js` and point to:

```html
<script async src="https://priceoptimiser1.thebesads.com/po-waterfall.js" data-site-key="..."></script>
<script async src="https://priceoptimiser1.thebesads.com/layered-auto-ads.js" data-site-key="..."></script>
```

`data-site-key` is the existing site-key resolution mechanism. The Worker runtime endpoint also accepts `site` or `siteKey` query parameters.

## Runtime Config

The public runtime endpoint is:

```text
https://priceoptimiser1.thebesads.com/v1/runtime-config
```

The response includes:

- `siteKey`
- `pageKey`
- `integrationMode`
- `country`, `countryCode`, `regionGroup`, `pricingKey`, and `geo`
- `formats`
- `experiment`
- `targetingPolicy`
- `slots`

Slot records include `slotKey`, `adUnitName`, `adUnitType`, `domId`, `domSelector`, `sizes`, `targetingKey`, `retryLimit`, `retryTimeoutMs`, `rewardedRequestTimeoutMs`, `maximumRewardedAttempts`, `waterfall`, `control`, `variant`, and optimization-mode fields.

## GAM Loading And Slots

The current publisher scripts load GPT from:

```text
https://securepubads.g.doubleclick.net/tag/js/gpt.js
```

They guard `window.googletag = window.googletag || { cmd: [] }`, avoid duplicate script injection, call `disableInitialLoad()`, `enableSingleRequest()`, `collapseEmptyDivs()`, define slots from runtime config, then call `refresh()`.

Display slots are defined with runtime `adUnitName`, runtime sizes, and the DOM id resolved from `domId`, `domSelector`, `slotKey`, `data-po-slot`, or `data-po-unit`.

Out-of-page slots use:

- `googletag.enums.OutOfPageFormat.INTERSTITIAL`
- `googletag.enums.OutOfPageFormat.REWARDED`
- `googletag.enums.OutOfPageFormat.BOTTOM_ANCHOR` in the auto script

## Targeting, Pricing, And Experiments

Runtime config is produced from the Price Optimiser database and Cloudflare D1 snapshot. The Worker owns country detection through `CF-IPCountry`, maps that into `pricingKey` and legacy region groups, chooses geo floor rows, applies optimization policies, and emits the allowed ladder.

Publisher JS applies targeting to GAM slots from runtime data:

- `exp_group`
- `exp_key`
- `slot_name`
- `price_rule` or the configured `targetingKey`

Price-rule targeting is only attached for priced/variant requests. Fallback requests avoid inventing any SDK-specific telemetry.

## Source-Of-Truth Requirement

The Publisher Experience SDK must not replace Price Optimiser logic. Price Optimiser remains responsible for ad units, pricing rules, country detection, pricing keys, experiments, price ladders, waterfall values, targeting values, telemetry, reporting, and future AI optimizer output.

The SDK must only load runtime config, normalize browser-facing placement data, create GPT slots, attach slots to publisher div IDs, trigger interstitial/rewarded opportunities, and manage navigation/DOM concerns.

The first local SDK implementation contained SDK-owned monetisation logic in `src/core/gam-adapter.js`:

- `DEFAULT_WATERFALL`
- `resolveExperiment()`
- `floorConfigForGroup()`
- `floorsFor()`
- direct `exp_group`, `exp_key`, `slot_name`, and `price_rule` targeting generation
- retry/fallback refresh sequencing

Those code paths were removed. `src/core/gam-adapter.js` now only re-exports the Price Optimiser runtime adapter, and `src/core/price-optimiser-runtime.js` consumes explicit runtime-config fields instead of acting as a second SDK optimisation engine.

## Publisher Runtime Migration

The existing publisher runtime behavior has been moved into the Publisher Experience SDK rather than maintained as a separate integration. The target flow is:

```text
Publisher
  -> quiz-rush.js / jobguidematch.js
  -> Publisher SDK Core
  -> moved Price Optimiser runtime adapter
  -> existing Price Optimiser runtime-config
  -> GAM
```

This migration preserves the Price Optimiser monetisation boundary. The SDK wraps and organizes the publisher-facing runtime, but does not fork price optimization, targeting generation, retry/fallback decisions, or experiment assignment into an independent implementation.

## Telemetry And Reporting

No live publisher beacon/sendBeacon telemetry endpoint was found in the current runtime scripts. Reporting is GAM-report based: the publisher JS attaches GAM custom targeting, GAM records requests/impressions/revenue, and server scripts import those reports into `gam_report_rows` and related dashboard/optimizer tables.

The Publisher Experience SDK therefore does not add `telemetry.js`, beacon calls, or a separate reporting path.

## Rewarded Events

Existing scripts listen for:

- `rewardedSlotReady`
- `rewardedSlotClosed`

The new SDK also listens for `rewardedSlotGranted` and `rewardedSlotVideoCompleted` so the publisher can react to successful rewards without the SDK inventing the reward proposition.

Existing `po-waterfall.js` calls `makeRewardedVisible()` on `rewardedSlotReady` and navigates on close in its generic rewarded-click flow. The new SDK keeps the same GAM lifecycle idea but exposes publisher hooks instead of rendering copy or unlocking UI.

## Interstitial Eligibility And Suppression

Existing scripts support interstitial slots from runtime config and trigger on configured click selectors. They avoid `_blank`, downloads, and no-interstitial links. The new SDK adds stricter bypass rules for modified clicks, same-page anchors, mailto links, admin/editor elements, and session caps.

## Nginx And Cloudflare

Active Nginx config includes:

- `priceoptimizer.thebesads.com` proxied to `localhost:1337`
- `admin.priceoptimiser1.thebesads.com` proxied to `127.0.0.1:3000`

No active Nginx vhost for `priceoptimiser1.thebesads.com` was found. That domain is configured in the Cloudflare Worker `wrangler.jsonc` as a custom domain with assets served from `worker/public`; Worker-first routing covers `/v1/*`, `/health`, and `/`.

Serving `/experiences/*.js` from `https://priceoptimiser1.thebesads.com` should be reviewed before deployment. The likely path is copying built bundles into the existing Worker public assets under `experiences/` and deploying the Worker, or adding a separate approved Nginx/static route on another domain.

No Nginx changes were made.

## Site Configuration Added

After discovery, the user provided the two site ad-unit paths and selectors and approved defining them. The existing Price Optimiser database was updated with:

- `quiz-rush.com`: 7 ad units, 2 page rules, 30 geo floor rows
- `jobguidematch.com`: 6 ad units, 2 page rules, 30 geo floor rows

Cloudflare D1 runtime snapshots were published and verified through public `/v1/runtime-config`.

One limitation discovered: Price Optimiser page rules support exact matches and trailing-prefix wildcards, not middle segment wildcards such as `/quiz/*/q/*`. The SDK performs the generic quiz-route matching itself while ad units remain global for the site.
