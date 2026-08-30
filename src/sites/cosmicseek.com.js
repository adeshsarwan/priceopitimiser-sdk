import { createExperience, readScriptOptions } from '../core/bootstrap.js';

const options = readScriptOptions({
  siteKey: 'cosmicseek.com',
  bundleName: 'cosmicseek.com.js'
});

export const cosmicseekExperience = {
  siteKey: options.siteKey || 'cosmicseek.com',
  placements: [
    { slotKey: 'ad-leaderboard', selector: '#ad-leaderboard', adUnitType: 'native' },
    { slotKey: 'ad-incontent', selector: '#ad-incontent', adUnitType: 'native' },
    { slotKey: 'ad-results', selector: '#ad-results', adUnitType: 'native' },
    { slotKey: 'ad-sidebar', selector: '#ad-sidebar', adUnitType: 'native' },
    { slotKey: 'ad-anchor', selector: '#ad-anchor', adUnitType: 'anchor' }
  ],
  interstitials: [],
  rewarded: []
};

export const cosmicseek = createExperience(cosmicseekExperience, options);

if (typeof window !== 'undefined') {
  window.PublisherExperienceSDK = window.PublisherExperienceSDK || {};
  window.PublisherExperienceSDK.cosmicseek = cosmicseek;
  if (!window.PublisherExperience) window.PublisherExperience = cosmicseek;
  if (!window.PriceOptimiserExperience) window.PriceOptimiserExperience = cosmicseek;
}
