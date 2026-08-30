# Integration Guide

## SDK Script

If the publisher already has a Price Optimiser script, keep it and do not add a duplicate. Otherwise use the generic SDK:

```html
<script
  async
  src="https://priceoptimiser1.thebesads.com/experiences/publisher-sdk.js"
  data-po-site="example.com">
</script>
```

Replace `example.com` with the publisher site key supplied by Price Optimiser.

## Rewarded Preload Timing

For a questionnaire or guided flow, start rewarded preload during the flow, not at the final reward gate. Good trigger points:

- The first answer click.
- The first question screen after the SDK is ready.
- A transition where the user has already shown intent to continue.

Calling `preloadRewarded()` more than once is safe. The SDK reuses a ready cached rewarded ad when possible. If the user journey is long, calling it again shortly before the reward gate is acceptable.

## Native And Anchor Preload Timing

Use:

```js
ads.preloadSlots([
  "ad-leaderboard",
  "ad-incontent",
  "ad-results",
  "ad-anchor"
]);
```

The SDK maps these exact publisher div IDs to configured runtime slots, GAM ad units, sizes, experiments, ladders, and targeting. For Native and Anchor display placements, this is preparation-only: the SDK does not request GAM inventory until reveal or refresh. Do not use generic tokens such as `native` or `anchor`; they are rejected with `explicit_div_id_required` and do not request inventory. Do not list internal slot names such as `native-leaderboard` or `native-incontent` unless the Price Optimiser owner explicitly asks for an internal runtime-key call.

Call display preload:

- After ad divs are rendered on the current page.
- After SPA route changes or client-rendered content inserts those divs.
- While a rewarded modal is open only if the target native/anchor divs already exist behind the modal.

If the target article/results page does not exist yet, display preload cannot define those future GAM slots. Call `preloadSlots()` with exact div IDs immediately after navigation/render instead.

## Reward Gate

Use `showRewarded()` at the reward gate:

```js
const result = await ads.showRewarded({
  onReady() {},
  onGranted({ reward }) {},
  onClosed() {},
  onFallback({ status }) {}
});
```

`showRewarded()` automatically consumes a preloaded rewarded ad unless `usePreload: false` is passed. Do not pass `usePreload: false` in the normal flow.

The publisher app owns what happens after fallback. For reward-gated UX, prefer a clear fallback path so users are not stuck if no ad demand is available.

## Review Checklist

- The page loads exactly one Price Optimiser SDK bundle.
- The code calls `preloadRewarded()` before the reward gate.
- The code calls `preloadSlots()` with exact publisher div IDs after current-page ad containers exist.
- The code uses `showRewarded()` to show the rewarded ad.
- No publisher code imports or calls `googletag`.
- No publisher code sets `price_rule`, `exp_key`, `exp_group`, `slot_name`, floors, or waterfall values.
- No publisher code uses generic `native` or `anchor` display tokens.
- Fallback UI cannot strand the user indefinitely.
