import { createExperience, readScriptOptions } from '../core/bootstrap.js';

const options = readScriptOptions({
  bundleName: 'publisher-sdk.js'
});

function inferredSiteKey() {
  if (options.siteKey) return options.siteKey;
  if (typeof window === 'undefined' || !window.location || !window.location.hostname) return null;
  return window.location.hostname.replace(/^www\./, '');
}

export const publisherSdkExperience = {
  siteKey: inferredSiteKey(),
  placements: [],
  interstitials: [],
  rewarded: []
};

export const publisherSdk = createExperience(publisherSdkExperience, options);

if (typeof window !== 'undefined') {
  window.PublisherExperienceSDK = window.PublisherExperienceSDK || {};
  window.PublisherExperienceSDK.publisher = publisherSdk;
  if (!window.PublisherExperience) window.PublisherExperience = publisherSdk;
  if (!window.PriceOptimiserExperience) window.PriceOptimiserExperience = publisherSdk;
}
