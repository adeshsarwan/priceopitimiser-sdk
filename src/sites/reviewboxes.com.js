import { createExperience, readScriptOptions } from '../core/bootstrap.js';

const options = readScriptOptions({
  siteKey: 'reviewboxes.com',
  bundleName: 'reviewboxes.com.js'
});

export const reviewboxesExperience = {
  siteKey: options.siteKey || 'reviewboxes.com',
  placements: [
    { slotKey: 'ad-leaderboard', selector: '#ad-leaderboard', adUnitType: 'native' },
    { slotKey: 'ad-incontent', selector: '#ad-incontent', adUnitType: 'native' },
    { slotKey: 'ad-results', selector: '#ad-results', adUnitType: 'native' },
    { slotKey: 'ad-anchor', selector: '#ad-anchor', adUnitType: 'anchor' }
  ],
  interstitials: [],
  rewarded: []
};

export const reviewboxes = createExperience(reviewboxesExperience, options);

if (typeof window !== 'undefined') {
  window.PublisherExperienceSDK = window.PublisherExperienceSDK || {};
  window.PublisherExperienceSDK.reviewboxes = reviewboxes;
  if (!window.PublisherExperience) window.PublisherExperience = reviewboxes;
  if (!window.PriceOptimiserExperience) window.PriceOptimiserExperience = reviewboxes;
}
