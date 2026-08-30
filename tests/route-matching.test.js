import test from 'node:test';
import assert from 'node:assert/strict';
import { routeMatches } from '../src/core/dom.js';

test('route matching recognises generic quiz question five routes', () => {
  assert.equal(routeMatches('/quiz/*/q/5/', '/quiz/capital-cities/q/5/'), true);
  assert.equal(routeMatches('/quiz/*/q/5/', '/quiz/history-101/q/5'), true);
  assert.equal(routeMatches('/quiz/*/q/5/', '/quiz/history-101/q/4/'), false);
  assert.equal(routeMatches('/quiz/*/q/5/', '/quiz/history-101/results/'), false);
});

test('route matching is segment-aware for wildcard paths', () => {
  assert.equal(routeMatches('/find/results/', '/find/results/'), true);
  assert.equal(routeMatches('/find/results/', '/find/results/page/2'), false);
  assert.equal(routeMatches('/find/*', '/find/results/page/2'), true);
  assert.equal(routeMatches('/find/apply/*', '/find/apply/external-123'), true);
  assert.equal(routeMatches('/find/apply/*', '/find/results/'), false);
});
