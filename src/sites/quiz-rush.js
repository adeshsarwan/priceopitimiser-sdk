import { createExperience, readScriptOptions } from '../core/bootstrap.js';
import { safeQuerySelector } from '../core/dom.js';

const options = readScriptOptions({
  siteKey: 'quiz-rush.com',
  bundleName: 'quiz-rush.js'
});

function quizAttemptSessionKey({ rule, windowRef }) {
  const documentRef = windowRef.document;
  const attemptNode = safeQuerySelector(documentRef, '[data-quiz-attempt-id], [data-po-quiz-attempt-id], [name="quiz_attempt_id"], [name="attempt_id"]');
  const attemptId = attemptNode && (
    attemptNode.getAttribute('data-quiz-attempt-id') ||
    attemptNode.getAttribute('data-po-quiz-attempt-id') ||
    attemptNode.value
  );
  const path = windowRef.location && windowRef.location.pathname ? windowRef.location.pathname : '/';
  const slug = (path.match(/^\/quiz\/([^/]+)\/q\/5\/?$/) || [])[1] || 'unknown';
  return `${rule.id}:${slug}:${attemptId || 'session'}`;
}

export const quizRushExperience = {
  siteKey: options.siteKey || 'quiz-rush.com',
  placements: [
    { slotKey: 'ad-leaderboard', selector: '#ad-leaderboard', aliases: ['native-leaderboard'], adUnitType: 'native' },
    { slotKey: 'ad-incontent', selector: '#ad-incontent', aliases: ['native-incontent'], adUnitType: 'native' },
    { slotKey: 'ad-results', selector: '#ad-results', aliases: ['native-results'], adUnitType: 'native' },
    { slotKey: 'ad-sidebar', selector: '#ad-sidebar', aliases: ['sidebar'], adUnitType: 'banner' },
    { slotKey: 'ad-anchor', selector: '#ad-anchor', aliases: ['anchor'], adUnitType: 'anchor' }
  ],
  interstitials: [
    {
      id: 'after-question-five',
      slotKey: 'interstitial',
      when: {
        routePattern: '/quiz/*/q/5/',
        selector: '[data-po-journey-continue], [data-quiz-continue], a[href*="/q/6/"]',
        formSelector: 'form',
        event: 'journey_continue'
      },
      sessionKey: quizAttemptSessionKey,
      maxPerSession: 1
    }
  ],
  rewarded: [
    {
      id: 'quiz-results-reward',
      slotKey: 'rewarded',
      when: {
        routePattern: '/quiz/*/results/',
        selector: '[data-po-rewarded-results], [data-po-rewarded-trigger]'
      },
      action: 'publisher_hook'
    }
  ]
};

export const quizRush = createExperience(quizRushExperience, options);

if (typeof window !== 'undefined') {
  window.PublisherExperienceSDK = window.PublisherExperienceSDK || {};
  window.PublisherExperienceSDK.quizRush = quizRush;
}
