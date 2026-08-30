# Price Optimiser Publisher Settings

This screen is the operator-facing configuration for the generic Publisher Experience SDK.

The SDK snippet stays the same for every publisher:

```html
<script
  async
  src="https://priceoptimiser1.thebesads.com/experiences/publisher-sdk.js"
  data-po-site="quiz-rush.com">
</script>
```

Price Optimiser runtime-config remains the source of truth. The dashboard screen should only edit placement and integration fields; it must not move or duplicate waterfall, pricing, targeting, country, experiment, retry, fallback, or reporting controls.

## Fields

Back the screen with the existing `ad_units` table and runtime serializer:

| Field | Purpose |
| --- | --- |
| `enabled` | Turns a placement on or off for runtime-config. |
| `slot_key` | Public placement key. For normal display placements, use the publisher div ID such as `ad-leaderboard`. |
| `ad_unit_type` | Controls SDK behavior: `native`, `banner`, `anchor`, `interstitial`, or `rewarded`. |
| `ad_unit_name` | GAM ad-unit path used by GPT. Generate automatically from network code, site key, and slot key, then allow operator review. |
| `dom_id` | Publisher div ID without `#`. Required for normal display placements. |
| `dom_selector` | Publisher selector, normally `#` plus `dom_id`. Required for normal display placements. |
| `sizes_json` | Allowed request sizes. The SDK filters numeric sizes by viewport before GPT requests. |
| `integration_mode` | Must allow SDK display, currently `both` or `publisher_sdk`. |
| `retry_limit` | Existing Price Optimiser retry setting. Native and anchor currently use `9`. |
| `retry_timeout_ms` | Existing Price Optimiser retry timing. Native and anchor currently use `100`. |
| `collapse_empty` / `collapseEmpty` | Optional runtime toggle. Defaults to true when omitted. |
| rewarded/interstitial fields | Existing out-of-page lifecycle settings. |

Collapse empty display slots should default to enabled. The SDK already respects `collapseEmpty: false` / `collapse_empty: false` from runtime-config for publishers who want to keep the reserved box after no-fill.

## Default Placement Rules

For normal page placements:

| Value | Rule |
| --- | --- |
| `slot_key` | Exact publisher div ID. |
| `dom_id` | Exact publisher div ID. |
| `dom_selector` | `#` plus publisher div ID. |

Interstitial and rewarded placements do not need normal DOM selectors and should stay out-of-page.

## Quiz Rush Current Runtime

Live runtime-config checked on July 25, 2026:

| slotKey | adUnitType | adUnitName | domId | domSelector | sizes | enabled |
| --- | --- | --- | --- | --- | --- | --- |
| `anchor` | `anchor` | `/23360556473/quiz-rush.com_ad-anchor` | `ad-anchor` | `#ad-anchor` | `[[320,50],[728,90]]` | true |
| `interstitial` | `interstitial` | `/23360556473/quiz-rush.com_Interstitial` | | | `null` | true |
| `native-incontent` | `native` | `/23360556473/quiz-rush.com_ad-incontent` | `ad-incontent` | `#ad-incontent` | `[[300,250],[336,280]]` | true |
| `native-leaderboard` | `native` | `/23360556473/quiz-rush.com_ad-leaderboard` | `ad-leaderboard` | `#ad-leaderboard` | `[[320,50],[728,90]]` | true |
| `native-results` | `native` | `/23360556473/quiz-rush.com_ad-results` | `ad-results` | `#ad-results` | `[[300,250],[336,280]]` | true |
| `rewarded` | `rewarded` | `/23360556473/quiz-rush.com_Rewarded` | | | `null` | true |
| `sidebar` | `banner` | `/23360556473/quiz-rush.com_ad-sidebar` | `ad-sidebar` | `#ad-sidebar` | `[[300,250],[300,600]]` | true |

For the generic SDK model, the dashboard should display these rows pre-populated and allow changing normal display slot keys to exact div IDs when ready:

| Current slotKey | Final normal display slotKey |
| --- | --- |
| `native-leaderboard` | `ad-leaderboard` |
| `native-incontent` | `ad-incontent` |
| `native-results` | `ad-results` |
| `sidebar` | `ad-sidebar` |
| `anchor` | `ad-anchor` |

## Job Guide Match Current Runtime

Live runtime-config checked on July 25, 2026:

| slotKey | adUnitType | adUnitName | domId | domSelector | sizes | enabled |
| --- | --- | --- | --- | --- | --- | --- |
| `anchor` | `anchor` | `/23360556473/jobguidematch.com_Anchor` | `ad-anchor` | `#ad-anchor` | `[[320,50],[728,90]]` | true |
| `interstitial` | `interstitial` | `/23360556473/jobguidematch.com_Interstitial` | | | `null` | true |
| `native-incontent` | `native` | `/23360556473/jobguidematch.com_Native` | `ad-incontent` | `#ad-incontent` | `null` | true |
| `native-leaderboard` | `native` | `/23360556473/jobguidematch.com_Native` | `ad-leaderboard` | `#ad-leaderboard` | `null` | true |
| `native-results` | `native` | `/23360556473/jobguidematch.com_Native` | `ad-results` | `#ad-results` | `null` | true |
| `rewarded` | `rewarded` | `/23360556473/jobguidematch.com_Rewarded` | | | `null` | true |

Before testing Job Guide Match with the generic SDK, populate native `sizes_json` with the same concrete size strategy used for Quiz Rush unless the publisher gives different layout sizes.

## Required Backend Fix

The current live ad-unit save handlers include `dom_id` and `dom_selector` columns but write `null` for both. The publisher settings screen needs the save API to preserve:

- `dom_id` / `domId`
- `dom_selector` / `domSelector`
- `sizes_json` / `sizesJson`
- `collapse_empty` / `collapseEmpty` once the checkbox is added
- `enabled`
- `integration_mode`

Without that, the dashboard UI can display the fields but saving a row will remove the DOM mapping from runtime-config.

## Dashboard Behavior

The site settings area should link to a Publisher Placements screen:

- Load existing rows from `/api/ad-units?siteKey=<site>`.
- Pre-fill rows from current runtime values.
- Show display placements and out-of-page placements separately.
- Generate `ad_unit_name` automatically for new rows using the selected GAM network code, site key, and slot key.
- Validate that display placements have `dom_id`, `dom_selector`, and valid `sizes_json`.
- Validate that `interstitial` and `rewarded` remain out-of-page and do not require display sizes.
- Save only placement fields through the ad-unit API.
- Leave geo prices, waterfall, experiments, targeting, telemetry, and reporting in their existing screens.
