---
name: publisher-display-preload
description: Integrate Price Optimiser PublisherExperience SDK display preparation for current-page native and anchor ads without changing rewarded ads, GAM setup, pricing, targeting, or auction logic.
metadata:
  short-description: Prepare native and anchor ads
---

# PublisherExperience Display Preparation Integration

Use this skill when a publisher asks to prepare native and anchor ads on a page using the Price Optimiser PublisherExperience SDK.

The goal is to call `preloadSlots()` with the exact publisher div IDs after the relevant ad containers exist in the DOM. For jobguidematch.com this is `preloadSlots(["ad-leaderboard", "ad-incontent", "ad-results", "ad-anchor"])`. For Native and Anchor display placements, `preloadSlots()` is preparation-only: it validates and records the future placement lifecycle, but does not define hidden GPT slots, create offscreen divs, or request GAM inventory. On SPA/reward flows where those divs are hidden behind a rewarded modal, prepare while the user is waiting, then call the reveal helper after the article/results page is actually unhidden. Keep GAM setup, targeting, floors, experiments, waterfalls, and retry policy inside Price Optimiser runtime config.

This skill can be installed alongside the rewarded preload skill. Use the rewarded skill for `preloadRewarded()` and `showRewarded()` work; use this skill for current-page native and anchor display preparation work. When a task needs both, apply both sets of guidance without duplicating the SDK script or adding parallel ad logic.

## Hard Boundaries

- Use only the public SDK API: `preloadSlots()`, `revealSlots()` when available, `refresh()`, `refreshSlots()`, `refreshAll()`, and `status()`.
- Do not add rewarded preload or rewarded gate logic unless the user separately asks for rewarded integration.
- Do not call `googletag` directly from publisher code.
- Do not set or edit `price_rule`, `exp_key`, `exp_group`, `slot_name`, floors, ladders, or targeting.
- Do not use generic Native/Anchor tokens such as `native` or `anchor`; pass exact publisher div IDs only.
- Do not call `refreshAll()` as the reveal action for prepared display ads. Use the explicit reveal helper so Price Optimiser can request the intended exact slots in their real publisher divs.
- Do not loop preload calls aggressively. Treat preload as a page-render or route-render action.
- Do not preload ads before the publisher's required consent or privacy gate has completed.

## When This Is Good Practice

Preparing current-page native and anchor ads is a good fit when:

- The ad divs already exist on the current page.
- The user is waiting in a natural flow, such as during a rewarded ad or between questionnaire steps.
- The publisher wants Native/Anchor request ownership ready before the reward page becomes visible.
- The page has a small, known number of placements.

Use more restraint when the page creates many below-the-fold slots, when consent is not ready, or when the user may never see the page. In those cases, prepare only after route render or use the site's normal lazy behavior.

## Default Integration Shape

1. Confirm the Price Optimiser SDK script is loaded once.
2. Add or reuse a small SDK resolver if publisher code can run before the async SDK loads.
3. After the page or SPA route renders native/anchor containers, call `preloadSlots()` with exact div IDs.
4. For rewarded SPA flows, call `preloadSlots()` while the rewarded ad is playing or while the user waits, then call the reveal helper only after the article/results DOM is visible.
5. For SPAs, call the same helpers after each route that creates ad containers.
6. Keep layout placeholders in publisher HTML/CSS so ads do not shift content when they render.

Display preparation only requires the target divs to exist in the DOM; the publisher divs do not need to be visible yet. It does not request GAM inventory until reveal or refresh. If the next page is not rendered yet, call `preloadSlots()` immediately after navigation/render. If the page is hidden behind an overlay or `display:none` parent, reveal the page first and then call the reveal helper.

## References

- Read [references/integration-guide.md](references/integration-guide.md) before editing a publisher app.
- Use [references/snippets.md](references/snippets.md) for copy-paste-safe implementation examples.
