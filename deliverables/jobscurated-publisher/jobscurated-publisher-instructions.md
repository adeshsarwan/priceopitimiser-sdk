# Jobscurated.com — Publisher Ad Integration

Updated: 20 October 2026

The SDK is hosted on Cloudflare. Real display-ad preload is enabled for jobscurated.com.

## 1. Load the script once per page

```html
<script>
  async function onPriceOptimiserLoaded() {
    const ads = window.PublisherExperience;
    await ads.init();

    // Only on pages that offer rewarded ads:
    await ads.preloadRewarded();
  }
</script>

<script
  defer
  data-auto-init="false"
  src="https://priceoptimiser1.thebesads.com/experiences/jobscurated.com.js"
  onload="onPriceOptimiserLoaded()">
</script>
```

`preloadRewarded()` loads a rewarded ad without displaying it.

If this SDK script is already installed, keep one copy rather than adding a second.

## 2. Show rewarded when the user chooses to watch

Call this from your existing “Watch ad” action. Use `onReady` to preload the destination view’s display ads during the rewarded step:

```javascript
window.PublisherExperience.showRewarded({
  onReady() {
    void window.PublisherExperience.preloadSlots([
      "ad-leaderboard",
      "ad-incontent",
      "ad-results",
      "ad-anchor"
    ]);
  },
  onGranted() {
    // Your existing reward/unlock logic.
  },
  onFallback() {
    // Your existing unavailable-ad/continue flow.
  }
});
```

Pass only the placement IDs used on the destination view.

The destination DIVs must already exist during preload and remain in the same document. Keep the same DIV elements when showing the destination; do not replace them after preloading.

Preloaded ads do not carry across a full-page navigation. A new page must load and initialize the SDK itself.

## 3. Reveal display ads after showing the destination

After your application makes the destination view visible, call:

```javascript
requestAnimationFrame(() => {
  void window.PublisherExperience.revealSlots([
    "ad-leaderboard",
    "ad-incontent",
    "ad-results",
    "ad-anchor"
  ]);
});
```

`revealSlots()` is the display-ad show method. Use the same placement IDs you preloaded.

## 4. Keep the existing DIV IDs and responsive layout

Use the same IDs on phones, tablets, and desktops. Each ID must be unique within the page.

| Placement / DIV ID | Configured sizes in pixels |
| --- | --- |
| `ad-leaderboard` | 970×90, 728×90, 320×100, 320×50 |
| `ad-incontent` | 300×250, 336×280 |
| `ad-results` | 300×250, 336×280 |
| `ad-anchor` | 320×50, 320×100, 728×90 |
| Rewarded — no DIV needed | Full screen |

Keep your existing dimensions and responsive layout. The device split does not require changing DIV IDs, selectors, or the configured size lists.

## 5. Mobile and desktop routing is automatic

Cloudflare selects the GAM ad unit before returning the SDK configuration:

- **Mobile phones:** mobile units ending in `_m`.
- **Tablets and desktops:** units without the `_m` suffix.

The publisher does not need to hardcode GAM paths, detect devices, or load separate scripts for mobile and desktop.

The currently enabled formats use these paths:

| Format | Desktop / tablet | Mobile phone |
| --- | --- | --- |
| Native | `/23350639211/jobscurated.com_Native` | `/23350639211/jobscurated.com_Native_m` |
| Anchor | `/23350639211/jobscurated.com_Anchor` | `/23350639211/jobscurated.com_Anchor_m` |
| Rewarded | `/23350639211/jobscurated.com_Rewarded` | `/23350639211/jobscurated.com_Rewarded_m` |

These paths are provided for reference; the SDK receives them automatically. All three Native placements use the corresponding Native unit for the visitor’s device.

Interstitial remains disabled, and Video has no active website placement. Their GAM units have been created, but this integration does not activate those formats.
