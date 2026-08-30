import { createExperience, readScriptOptions } from '../core/bootstrap.js';

const options = readScriptOptions({
  siteKey: 'duniyaa.in',
  bundleName: 'duniyaa.in.js'
});

export const duniyaaExperience = {
  siteKey: options.siteKey || 'duniyaa.in',
  placements: [
    { slotKey: 'ad-leaderboard', selector: '#ad-leaderboard', adUnitType: 'native' },
    { slotKey: 'ad-incontent', selector: '#ad-incontent', adUnitType: 'native' },
    { slotKey: 'ad-results', selector: '#ad-results', adUnitType: 'native' },
    { slotKey: 'ad-anchor', selector: '#ad-anchor', adUnitType: 'anchor' }
  ],
  interstitials: [],
  rewarded: []
};

export const duniyaa = createExperience(duniyaaExperience, options);

if (typeof window !== 'undefined') {
  window.PublisherExperienceSDK = window.PublisherExperienceSDK || {};
  window.PublisherExperienceSDK.duniyaa = duniyaa;
  if (!window.PublisherExperience) window.PublisherExperience = duniyaa;
  if (!window.PriceOptimiserExperience) window.PriceOptimiserExperience = duniyaa;
}
