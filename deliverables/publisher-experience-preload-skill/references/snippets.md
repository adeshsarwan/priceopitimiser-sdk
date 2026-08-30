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
      if (value && typeof value.preloadRewarded === "function") return value;
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

## Start Rewarded Preload During Questions

```js
let rewardedPreloadStarted = false;

function startRewardedPreload() {
  if (rewardedPreloadStarted) return;
  rewardedPreloadStarted = true;

  withPublisherExperience(ads => {
    ads.preloadRewarded({
      onReady() {
        document.documentElement.dataset.rewardedPreloaded = "true";
      },
      onFallback() {
        rewardedPreloadStarted = false;
      }
    });
  });
}

document.addEventListener("click", event => {
  if (event.target.closest("[data-question-answer], .question-answer, .answer-option")) {
    startRewardedPreload();
  }
}, true);
```

Adjust the selector to match the publisher app. Keep this attached to user-intent moments such as answer clicks or continue buttons.

## Preload Current Page Native And Anchor Slots

```js
function preloadCurrentPageDisplayAds() {
  withPublisherExperience(ads => {
    ads.preloadSlots([
      "ad-leaderboard",
      "ad-incontent",
      "ad-results",
      "ad-anchor"
    ]);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", preloadCurrentPageDisplayAds, { once: true });
} else {
  preloadCurrentPageDisplayAds();
}
```

For an SPA, call `preloadCurrentPageDisplayAds()` after each route renders the ad containers.

## Reward Gate

```js
async function showRewardAndUnlock() {
  setRewardButtonLoading(true);

  const result = await withPublisherExperience(ads => ads.showRewarded({
    onReady() {
      setRewardButtonLoading(false);
    },
    onGranted() {
      unlockRewardedContent();
    },
    onClosed() {
      setRewardButtonLoading(false);
    },
    onFallback() {
      setRewardButtonLoading(false);
      unlockRewardedContent();
    }
  }));

  if (!result) {
    setRewardButtonLoading(false);
    unlockRewardedContent();
  }
}
```

Replace `setRewardButtonLoading()` and `unlockRewardedContent()` with the publisher app's own UI and unlock functions.
