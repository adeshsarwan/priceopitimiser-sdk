import { createExperience, readScriptOptions } from '../core/bootstrap.js';

const options = readScriptOptions({
  siteKey: 'playloft.fun',
  bundleName: 'playloft.fun.js'
});

export const playloftFunExperience = {
  siteKey: options.siteKey || 'playloft.fun',
  placements: [
    { slotKey: 'ad-top', selector: '#ad-top', adUnitType: 'native' },
    { slotKey: 'ad-game-rect', selector: '#ad-game-rect', adUnitType: 'native' },
    { slotKey: 'ad-anchor', selector: '#ad-anchor', adUnitType: 'anchor' }
  ],
  interstitials: [],
  rewarded: []
};

export const playloftFun = createExperience(playloftFunExperience, options);

if (typeof window !== 'undefined') {
  window.PublisherExperienceSDK = window.PublisherExperienceSDK || {};
  window.PublisherExperienceSDK.playloftFun = playloftFun;
  if (!window.PublisherExperience) window.PublisherExperience = playloftFun;
  if (!window.PriceOptimiserExperience) window.PriceOptimiserExperience = playloftFun;
}
