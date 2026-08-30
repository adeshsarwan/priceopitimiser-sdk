import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldBypassLink, shouldSample } from '../src/core/navigation-guard.js';

function fakeLink(href, attrs = {}) {
  return {
    target: attrs.target || '',
    classList: { contains: value => (attrs.className || '').split(/\s+/).includes(value) },
    hasAttribute: name => Boolean(attrs[name]),
    getAttribute: name => (name === 'href' ? href : attrs[name]),
    closest: selector => {
      if (selector.includes('.admin') && attrs.admin) return {};
      if (selector.includes('.no-interstitial') && (attrs.className || '').includes('no-interstitial')) return {};
      return null;
    }
  };
}

const locationRef = {
  href: 'https://jobguidematch.com/find/results/',
  origin: 'https://jobguidematch.com',
  pathname: '/find/results/',
  search: ''
};

test('random click probability boundaries are deterministic at edges', () => {
  assert.equal(shouldSample(0, 0), false);
  assert.equal(shouldSample(-1, 0), false);
  assert.equal(shouldSample(1, 0.999), true);
  assert.equal(shouldSample(2, 0.999), true);
  assert.equal(shouldSample(0.25, 0.249), true);
  assert.equal(shouldSample(0.25, 0.25), false);
});

test('modified clicks and non-navigation links bypass interception', () => {
  assert.equal(shouldBypassLink(fakeLink('/job/123'), { metaKey: true }, { locationRef }), true);
  assert.equal(shouldBypassLink(fakeLink('/job/123'), { ctrlKey: true }, { locationRef }), true);
  assert.equal(shouldBypassLink(fakeLink('/job/123'), { button: 1 }, { locationRef }), true);
  assert.equal(shouldBypassLink(fakeLink('mailto:test@example.com'), {}, { locationRef }), true);
  assert.equal(shouldBypassLink(fakeLink('#details'), {}, { locationRef }), true);
  assert.equal(shouldBypassLink(fakeLink('/job/123', { download: true }), {}, { locationRef }), true);
  assert.equal(shouldBypassLink(fakeLink('/job/123'), {}, { locationRef }), false);
});
