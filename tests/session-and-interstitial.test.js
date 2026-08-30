import test from 'node:test';
import assert from 'node:assert/strict';
import { createInteractionLock, createSessionGuard } from '../src/core/session-guard.js';
import { runInterstitial } from '../src/core/interstitial.js';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value)
  };
}

test('session guard enforces frequency caps', () => {
  const guard = createSessionGuard('site', memoryStorage());
  assert.equal(guard.consume('shared-cap', 1), true);
  assert.equal(guard.consume('shared-cap', 1), false);
  assert.equal(guard.count('shared-cap'), 1);
});

test('quiz question five interstitial resumes without losing page state', async () => {
  const windowRef = {
    location: { pathname: '/quiz/planets/q/5/' }
  };
  const pageState = { selectedAnswer: 'mars', resumed: false };
  const result = await runInterstitial({
    rule: {
      id: 'after-question-five',
      when: { routePattern: '/quiz/*/q/5/' },
      sessionScope: 'quizAttempt',
      maxPerSession: 1
    },
    adapter: {
      async requestInterstitial() {
        assert.equal(pageState.selectedAnswer, 'mars');
        return { status: 'closed' };
      }
    },
    sessionGuard: createSessionGuard('quiz-rush.com', memoryStorage()),
    lock: createInteractionLock(),
    logger: { debug() {}, warn() {} },
    windowRef,
    resume: () => {
      pageState.resumed = true;
    }
  });

  assert.equal(result, true);
  assert.deepEqual(pageState, { selectedAnswer: 'mars', resumed: true });
});

test('shared cap prevents click and timer rules from both showing', async () => {
  const guard = createSessionGuard('jobguidematch.com', memoryStorage());
  const windowRef = { location: { pathname: '/find/results/' } };
  let requests = 0;
  const context = {
    adapter: {
      async requestInterstitial() {
        requests += 1;
        return { status: 'closed' };
      }
    },
    sessionGuard: guard,
    lock: createInteractionLock(),
    logger: { debug() {}, warn() {} },
    windowRef,
    resume: () => {}
  };
  const baseRule = {
    id: 'results-card-click',
    sharedSessionKey: 'jobguidematch:results-interstitials',
    when: { routePattern: '/find/results/' },
    maxPerSession: 1
  };

  assert.equal(await runInterstitial({ ...context, rule: baseRule }), true);
  assert.equal(await runInterstitial({ ...context, rule: { ...baseRule, id: 'results-thirty-second' } }), false);
  assert.equal(requests, 1);
});
