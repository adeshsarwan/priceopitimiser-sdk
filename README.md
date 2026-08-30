# Publisher Experience SDK

Website-specific advertising UX modules that delegate runtime configuration, GAM setup data, pricing, fallback decisions, experiments, and reporting to the existing Price Optimiser backend.

The SDK does not include a database, dashboard, OpenAI integration, or telemetry subsystem. It does not create reward copy, render reward UI, unlock publisher content, or represent rewarded ads as mandatory.

## Price Optimiser Is Source Of Truth

The Publisher Experience SDK must not duplicate or replace any existing Price Optimiser monetisation logic. The SDK is only the presentation and trigger layer.

The SDK is responsible only for:

- loading runtime config
- creating GPT slots
- attaching slots to publisher div IDs
- triggering interstitial opportunities
- triggering rewarded opportunities
- navigation handling
- DOM management

The SDK must not implement:

- price optimisation
- floor selection
- waterfall generation
- country pricing
- experiment assignment
- retry algorithms
- fallback pricing
- targeting generation

These continue to come exclusively from the existing Price Optimiser runtime-config endpoint and publisher runtime logic. When rendering ads, the SDK consumes the existing runtime fields for `pricingKey`, `country`, `geo`, `waterfall`, `retryLimit`, `retryTimeoutMs`, `retryAfterMs`, `retryDelayMs`, `maxAttempts`, `targetingKey`, `experiment`, `variant`, `control`, `exp_group`, `exp_key`, `slot_name`, and `price_rule`.

Do not create a second optimisation engine, pricing ladder, or targeting system.

## Bundles

Production bundles are generated with:

```sh
npm run build
```

Output:

- `dist/publisher-sdk.js`
- `dist/quiz-rush.js`
- `dist/jobguidematch.js`
- `dist/sourcemaps/publisher-sdk.js.map`
- `dist/sourcemaps/quiz-rush.js.map`
- `dist/sourcemaps/jobguidematch.js.map`

The minified files do not include a `sourceMappingURL` comment, so source maps can be kept off the public asset path.

## Publisher Install

Preferred generic publisher snippet:

```html
<script
  async
  src="https://priceoptimiser1.thebesads.com/experiences/publisher-sdk.js"
  data-po-site="quiz-rush.com">
</script>
```

The generic SDK reads placement, selector, size, rewarded, interstitial, and debug settings from Price Optimiser runtime-config. It does not contain a publisher-specific placement map.

JobGuideMatch uses its site-specific entry bundle. The publisher should replace only the script URL; `jobguidematch.com.js` pins the site key internally and exposes the same public browser API aliases as the generic bundle:

```html
<script async src="https://priceoptimiser1.thebesads.com/experiences/jobguidematch.com.js"></script>
```

Other legacy site-specific snippets are still available while migrating existing publishers:

```html
<script async src="https://priceoptimiser1.thebesads.com/experiences/quiz-rush.js"></script>
```

Optional attributes:

```html
<script
  async
  src="https://priceoptimiser1.thebesads.com/experiences/publisher-sdk.js"
  data-po-site="quiz-rush.com"
  data-po-runtime-config-url="https://priceoptimiser1.thebesads.com/v1/runtime-config"
  data-debug="false">
</script>
```

The browser API is exposed as:

```js
window.PublisherExperience.refresh('ad-leaderboard');
window.PublisherExperience.refreshAll();
window.PublisherExperience.preloadSlots(['ad-leaderboard', 'ad-incontent', 'ad-results', 'ad-anchor']);
window.PublisherExperience.revealSlots(['ad-leaderboard', 'ad-incontent', 'ad-results', 'ad-anchor']);
window.PublisherExperience.preloadRewarded();
window.PublisherExperience.showInterstitial();
window.PublisherExperience.showRewarded({
  onGranted(detail) {},
  onFallback(detail) {}
});
window.PublisherExperience.status();
```

These methods let publishers control placement timing and page UX only. `preloadSlots()`, `revealSlots()`, and `refreshSlots()` require explicit publisher div IDs for Native and Anchor placements, such as `ad-leaderboard`, `ad-incontent`, `ad-results`, and `ad-anchor`. Generic Native/Anchor tokens such as `native` and `anchor` return `invalid_slot` with `explicit_div_id_required` and do not request inventory. For Native and Anchor display placements, `preloadSlots()` is preparation-only: it records the intended placement lifecycle but does not create hidden GPT divs, define GPT slots, or request GAM inventory. `revealSlots()` is the explicit visible-page signal; it sends the request into the real publisher div. `preloadRewarded()` still requests a rewarded ad without showing it; the next `showRewarded()` call consumes that cached ad automatically. These APIs do not expose or accept price floors, ladders, experiment arms, targeting keys, or retry settings.

## Runtime Boundary

The SDK reads `/v1/runtime-config?site=<siteKey>&path=<pathname>` and treats the response as data. It uses the returned slot/ad-unit configuration and targeting metadata, then lets GAM and Price Optimiser reporting remain authoritative.

Price Optimiser owns:

- GAM ad-unit paths
- country and pricing keys
- price ladders, retries, and fallback policy
- experiment keys and groups
- reporting and optimization decisions

The SDK owns:

- page and journey detection
- publisher selector lookup
- UX trigger timing
- navigation pause/resume
- session-level UX caps
- rewarded lifecycle hooks

## Publisher Runtime Adapter

The SDK now uses `src/core/price-optimiser-runtime.js` as the Price Optimiser runtime adapter. Site bundles such as `quiz-rush.js` and `jobguidematch.js` compose:

```text
Publisher
  -> site bundle
  -> Publisher SDK Core
  -> moved Price Optimiser runtime adapter
  -> existing runtime-config
  -> GAM
```

This avoids maintaining two publisher integrations. The adapter preserves the Price Optimiser runtime contract; site modules add only page detection, div mapping, and UX triggers.

## Placement Mapping

Normal page placements should use the publisher div ID as the primary slot key:

- `ad-leaderboard`
- `ad-incontent`
- `ad-results`
- `ad-sidebar`
- `ad-anchor`

The generic SDK relies on runtime-config `domId` / `domSelector` fields. The adapter still resolves currently published runtime keys such as `native-leaderboard`, `native-incontent`, and `native-results` through aliases and runtime DOM fields in the legacy site bundles. Duplicate display-slot protection is based on the resolved div ID, so several divs may share one GAM ad-unit path.

Sizes are normalized once in `src/core/sizes.js`. Supported browser-facing forms include `fluid`, `"fluid"`, `["fluid"]`, nested numeric pairs, flat numeric arrays, comma-separated numeric strings, and `320x50` strings. Interstitial and rewarded slots ignore normal display sizes and use GPT out-of-page APIs.

## Price Optimiser Publisher Settings

The dashboard should expose one publisher-placement screen per site, backed by the existing `ad_units` runtime fields:

- `enabled`
- `slot_key`
- `ad_unit_type`
- `ad_unit_name`
- `dom_id`
- `dom_selector`
- `sizes_json`
- `integration_mode`
- `retry_limit`
- `retry_timeout_ms`
- rewarded and interstitial configuration fields

Recommended defaults:

- `slot_key` equals the publisher div ID for normal display placements.
- `dom_id` equals the publisher div ID.
- `dom_selector` equals `#` plus the publisher div ID.
- GAM ad-unit name is generated from the GAM network code, site key, and slot key, then remains editable only for operators.
- Collapse empty display slots is enabled by default; runtime-config may send `collapseEmpty: false` / `collapse_empty: false` for publishers who want to keep the reserved box.
- Allowed sizes are stored in `sizes_json`; the SDK filters numeric sizes by viewport before calling GPT.
- Native-looking placements still need concrete mobile/desktop size capability in `sizes_json` when GAM demand expects a sized request, even when the GAM creative is a native unit.

The screen must not move existing Price Optimiser waterfall, experiment, targeting, or pricing controls. Those stay in their current dashboard sections and continue to feed runtime-config.

## Rewarded Hooks

Rewarded experiences are publisher initiated. The SDK exposes browser events and does not render UI:

- `publisherExperience:rewardedReady`
- `publisherExperience:rewardedGranted`
- `publisherExperience:rewardedVideoCompleted`
- `publisherExperience:rewardedClosed`
- `publisherExperience:rewardedSuccess`
- `publisherExperience:rewardedUnavailable`
- `publisherExperience:rewardedDeclined`
- `publisherExperience:rewardedFallback`
- `publisherExperience:rewardedBusy`

Rewarded events include `event.detail.href`, `event.detail.continueNavigation()`, and the compatibility alias `event.detail.continueWithoutReward()`. Publisher code decides what to show and when to continue.

## Site Behavior

`quiz-rush.com`:

- placements: `#ad-leaderboard`, `#ad-incontent`, `#ad-results`, `#ad-sidebar`, `#ad-anchor`
- question-five interstitial on `/quiz/{slug}/q/5/`
- supports link, form submit, and `journey_continue` event triggers
- resumes to the original publisher flow after close, timeout, or unavailable inventory
- rewarded on `/quiz/{slug}/results/` only from `[data-po-rewarded-results]` or `[data-po-rewarded-trigger]`

`jobguidematch.com`:

- placements: `#ad-leaderboard`, `#ad-incontent`, `#ad-results`, `#ad-anchor`
- 25% sampled genuine job-card click interstitial on `/find/results/`
- one 30-second results-page interstitial opportunity
- shared session cap across click and timer interstitials
- external apply rewarded hook on `/find/apply/*` for publisher-designated buttons only
- never alters the external destination URL

## Price Optimiser Site Config

The operational script `scripts/configure-price-optimiser-sites.cjs` upserts the two site records, ad units, derived selectors, page rules, and default floor rows into the existing Price Optimiser database. It is not part of the SDK runtime bundle.

The script is written around the three operator fields: slot key / publisher div ID, GAM ad-unit path, and ad-unit type. Display `dom_id`, `dom_selector`, and default sizes are derived centrally before insertion.

On the VPS:

```sh
cd /var/www/publisher-experience-sdk
sudo node scripts/configure-price-optimiser-sites.cjs
```

Publishing Cloudflare D1 runtime snapshots normally uses the existing Price Optimiser script:

```sh
cd /var/www/priceoptimizer1/server
sudo node scripts/push-d1-snapshot.cjs quiz-rush.com
sudo node scripts/push-d1-snapshot.cjs jobguidematch.com
```

At implementation time, the installed Wrangler version required Node 22 while the server default was Node 20, so a one-off D1 HTTP API publish was used instead.

## Testing

```sh
npm test
```

Covered:

- route matching
- generic quiz question-five detection
- quiz navigation resume without losing in-page state
- random probability boundaries
- shared session caps
- modified click bypass
- runtime size normalization
- shared GAM path support across multiple div IDs
- div-ID based duplicate display-slot protection
- out-of-page interstitial and rewarded slot creation
