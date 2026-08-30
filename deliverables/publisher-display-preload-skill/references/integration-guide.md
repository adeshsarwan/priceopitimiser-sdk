# Integration Guide

## SDK Script

If the publisher already has a Price Optimiser SDK script, keep the existing script and do not add another one. Otherwise use the generic SDK:

```html
<script
  async
  src="https://priceoptimiser1.thebesads.com/experiences/publisher-sdk.js"
  data-po-site="example.com">
</script>
```

Replace `example.com` with the publisher site key supplied by Price Optimiser.

## What To Add

Add a publisher helper that calls:

```js
ads.preloadSlots([
  "ad-leaderboard",
  "ad-incontent",
  "ad-results",
  "ad-anchor"
]);
```

This asks the SDK to prepare each exact current-page publisher div. The SDK maps those div IDs to the configured runtime placements, GAM ad units, sizes, experiments, ladders, and targeting, but does not define hidden GPT slots, create offscreen divs, or request GAM inventory for Native/Anchor display preparation. Do not use generic tokens such as `native` or `anchor`; they are rejected with `explicit_div_id_required` and do not request inventory.

For SPA reward flows, also add a reveal helper that runs after the article/results page has been unhidden:

```js
ads.revealSlots([
  "ad-leaderboard",
  "ad-incontent",
  "ad-results",
  "ad-anchor"
]);
```

Guard this call with `typeof ads.revealSlots === "function"` so older SDK versions do not throw. Do not replace this with `refreshAll()`. The reveal helper is the explicit signal that these exact prepared publisher divs are now eligible to request visible GAM inventory in their real divs.

## When To Call It

Good call points:

- After `DOMContentLoaded` when server-rendered ad divs are present.
- After a client-side route has rendered its ad divs.
- When a reward modal opens and the article/results page already exists behind it.
- Immediately after a rewarded ad starts playing if native/anchor divs are already present.
- Immediately after the rewarded modal closes and the article/results page is visible, call the reveal helper for the same exact div IDs.

Bad call points:

- Before required consent or privacy checks are complete.
- Before the ad divs exist.
- In a tight interval or repeated click handler.
- For future pages that have not rendered yet.
- Before removing the CSS/class that hides the article/results page.
- As a reveal-time `refreshAll()` call.

## SPA Reward Flow

For jobguidematch-style flows:

1. The SPA route loads and creates the article/results DOM, including `ad-leaderboard`, `ad-incontent`, `ad-results`, and `ad-anchor`.
2. The user sees questions or a rewarded modal while the article/results page is hidden.
3. Call `preloadSlots(["ad-leaderboard", "ad-incontent", "ad-results", "ad-anchor"])` once the divs exist.
4. When the reward completes, unhide the article/results page first.
5. On the next animation frame, call `revealSlots(["ad-leaderboard", "ad-incontent", "ad-results", "ad-anchor"])` if the SDK supports it.

The preload call is authoritative even if the publisher containers are behind a hidden parent, but it remains preparation-only for Native/Anchor display. Visibility controls when reveal may make the actual GAM request.

## Review Checklist

- There is exactly one Price Optimiser SDK script.
- The code calls `preloadSlots()` with exact publisher div IDs.
- The code calls `revealSlots()` with the same exact publisher div IDs after hidden SPA content is made visible, when the SDK supports that API.
- The call runs only after native/anchor containers exist.
- SPA route changes trigger the helper after render.
- Publisher code does not call `googletag`.
- Publisher code does not set Price Optimiser or GAM targeting fields.
- The integration does not add rewarded behavior.
- The integration does not call `refreshAll()` to reveal prepared display ads.
- The integration does not remove layout placeholders or reserve space.
