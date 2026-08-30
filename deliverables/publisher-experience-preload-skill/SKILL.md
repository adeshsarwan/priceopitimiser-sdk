---
name: publisher-experience-preload
description: Integrate Price Optimiser PublisherExperience SDK preload APIs into a publisher site, especially rewarded question flows, without changing GAM pricing, targeting, floors, or auction logic.
metadata:
  short-description: Add Price Optimiser rewarded/display preloading
---

# PublisherExperience Preload Integration

Use this skill when a publisher asks to integrate or review Price Optimiser SDK preloading for rewarded ads, native placements, anchors, or reward-page ad loading.

The goal is to call the public PublisherExperience SDK at the right moments in the publisher UI. Keep Price Optimiser runtime config, GAM setup, pricing rules, floors, experiment keys, ladders, and custom targeting out of publisher code unless the Price Optimiser owner explicitly asks for those backend changes.

## Hard Boundaries

- Use only the public SDK API: `preloadRewarded()`, `preloadSlots()`, `showRewarded()`, `refresh()`, `refreshAll()`, `status()`.
- Do not call `googletag` directly from publisher code.
- Do not create or modify GAM pricing rules, line items, floors, targeting keys, experiment arms, waterfalls, or retry policy.
- Use exact publisher div IDs for Native/Anchor display preparation, for example `preloadSlots(["ad-leaderboard", "ad-incontent", "ad-results", "ad-anchor"])` on jobguidematch.com. Do not use generic `native` or `anchor` tokens.
- Do not add a publisher-specific waterfall or timeout system. Price Optimiser runtime config owns the waterfall.
- Do not block the user journey forever. If rewarded is unavailable, times out, or is declined, run the publisher-approved fallback/unlock path.

## Default Integration Shape

1. Confirm the Price Optimiser SDK script is loaded once.
2. Add a small SDK resolver if the app needs to wait for the async script.
3. Start `preloadRewarded()` as early as possible after a user interaction or once the question flow begins.
4. Call `preloadSlots()` with exact Native/Anchor publisher div IDs after current-page ad containers exist in the DOM.
5. At the reward gate, call `showRewarded()`. It consumes a cached rewarded preload automatically when one exists.
6. Keep reward, unlock, loading, and fallback UI owned by the publisher app.

Native/Anchor `preloadSlots()` is preparation-only: it validates and records exact current-page divs, but does not request GAM inventory until reveal or refresh. If the native/anchor divs are created only after navigation, call `preloadSlots()` with the exact div IDs immediately after that route/page renders.

## References

- Read [references/integration-guide.md](references/integration-guide.md) before editing a publisher app.
- Use [references/snippets.md](references/snippets.md) for copy-paste-safe implementation examples.
