import { createExperience, readScriptOptions } from '../core/bootstrap.js';

const options = readScriptOptions({
  siteKey: 'jobguidematch.com',
  bundleName: 'jobguidematch.js'
});

const SHARED_INTERSTITIAL_CAP = 'jobguidematch:results-interstitials';
const DEFAULT_JOB_CARD_SELECTOR = [
  'a[data-po-job-card][href]',
  '[data-po-job-card] a[href]',
  'a[data-job-card][href]',
  '[data-job-card] a[href]',
  '.job-card a[href]',
  '.job-result a[href]',
  '[data-result-card] a[href]'
].join(', ');

export const jobGuideMatchExperience = {
  siteKey: options.siteKey || 'jobguidematch.com',
  placements: [
    { slotKey: 'ad-leaderboard', selector: '#ad-leaderboard', aliases: ['native-leaderboard'], adUnitType: 'native' },
    { slotKey: 'ad-incontent', selector: '#ad-incontent', aliases: ['native-incontent'], adUnitType: 'native' },
    { slotKey: 'ad-results', selector: '#ad-results', aliases: ['native-results'], adUnitType: 'native' },
    { slotKey: 'ad-anchor', selector: '#ad-anchor', aliases: ['anchor'], adUnitType: 'anchor' }
  ],
  interstitials: [
    {
      id: 'results-card-click',
      slotKey: 'interstitial',
      sharedSessionKey: SHARED_INTERSTITIAL_CAP,
      when: {
        routePattern: '/find/results/',
        selector: options.jobCardSelector || DEFAULT_JOB_CARD_SELECTOR
      },
      probability: 0.25,
      maxPerSession: 1
    },
    {
      id: 'results-thirty-second',
      slotKey: 'interstitial',
      sharedSessionKey: SHARED_INTERSTITIAL_CAP,
      when: {
        routePattern: '/find/results/',
        afterMs: 30000
      },
      maxPerSession: 1
    }
  ],
  rewarded: [
    {
      id: 'external-apply-reward',
      slotKey: 'rewarded',
      when: {
        routePattern: '/find/apply/*',
        selector: [
          '[data-po-external-apply][href]',
          '[data-po-apply-exit][href]',
          '[data-po-rewarded-exit][href]',
          '[data-po-external-apply] a[href]',
          '[data-po-apply-exit] a[href]',
          '[data-po-rewarded-exit] a[href]'
        ].join(', ')
      },
      requireExternal: true,
      action: 'publisher_hook'
    }
  ]
};

export const jobGuideMatch = createExperience(jobGuideMatchExperience, options);

if (typeof window !== 'undefined') {
  window.PublisherExperienceSDK = window.PublisherExperienceSDK || {};
  window.PublisherExperienceSDK.jobGuideMatch = jobGuideMatch;
}
