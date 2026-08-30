# Snippets

## SDK Resolver

Use this when the Price Optimiser script is async and publisher code may run first.

```js
function getPublisherExperience() {
  if (window.PublisherExperience) return window.PublisherExperience;
  if (window.PriceOptimiserExperience) return window.PriceOptimiserExperience;

  const registry = window.PublisherExperienceSDK;
  if (registry && typeof registry === "object") {
    for (const value of Object.values(registry)) {
      if (value && typeof value.preloadSlots === "function") return value;
    }
  }

  return null;
}

function withPublisherExperience(callback, options = {}) {
  const timeoutMs = options.timeoutMs || 8000;
  const intervalMs = options.intervalMs || 50;
  const startedAt = Date.now();

  return new Promise(resolve => {
    function tick() {
      const ads = getPublisherExperience();
      if (ads) {
        resolve(callback(ads));
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        resolve(null);
        return;
      }

      window.setTimeout(tick, intervalMs);
    }

    tick();
  });
}
```

## Preload Native And Anchor On Current Page

```js
const DISPLAY_SLOT_IDS = [
  "ad-leaderboard",
  "ad-incontent",
  "ad-results",
  "ad-anchor"
];

function getCurrentPageDisplaySlotIds() {
  return DISPLAY_SLOT_IDS.filter(id => document.getElementById(id));
}

function preloadCurrentPageDisplayAds() {
  withPublisherExperience(ads => {
    const ids = getCurrentPageDisplaySlotIds();
    if (ids.length) ads.preloadSlots(ids);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", preloadCurrentPageDisplayAds, { once: true });
} else {
  preloadCurrentPageDisplayAds();
}
```

## SPA Route Render Hook

Call this after the route has inserted the ad containers.

```js
function onRouteRendered() {
  preloadCurrentPageDisplayAds();
}
```

Wire `onRouteRendered()` into the publisher app's router, page transition, or content-render callback.

## During A Rewarded Modal Or Waiting Step

Use this only if native/anchor divs already exist in the page behind the modal or waiting UI.

```js
function onRewardedModalOpened() {
  preloadCurrentPageDisplayAds();
}

function onRewardedStarted() {
  preloadCurrentPageDisplayAds();
}
```

Do not add rewarded ad logic here. This snippet is only for display placements on the already-rendered page.

## Reveal Preloaded Display Ads

Call this only after the article/results page has been unhidden. Do not use `refreshAll()` as the reveal action.

```js
function revealCurrentPageDisplayAds() {
  return withPublisherExperience(ads => {
    const ids = getCurrentPageDisplaySlotIds();
    if (!ids.length) return { status: "no_display_slots" };

    if (typeof ads.revealSlots === "function") {
      return ads.revealSlots(ids);
    }

    return { status: "reveal_slots_unavailable" };
  });
}

function onRewardedCompletedAndPageRevealed() {
  requestAnimationFrame(() => {
    revealCurrentPageDisplayAds();
  });
}
```

The page should remove hidden classes, `display:none`, or modal-only wrappers before `onRewardedCompletedAndPageRevealed()` runs. The `requestAnimationFrame()` gives the browser one paint cycle to apply the visible layout before the SDK checks or promotes the exact display slots.

## Full SPA Timing Example

```js
function onArticleRouteRendered() {
  preloadCurrentPageDisplayAds();
}

function onRewardedAdPlaying() {
  preloadCurrentPageDisplayAds();
}

function onArticleUnlocked() {
  showArticleContent();
  onRewardedCompletedAndPageRevealed();
}
```

Replace `showArticleContent()` with the publisher's existing code that removes the modal/preview state. Keep these helpers idempotent: calling preload twice for the same current-page slots is acceptable, but do not run it in a tight loop.
