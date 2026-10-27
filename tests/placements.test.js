import test from 'node:test';
import assert from 'node:assert/strict';
import { isRenderablePlacementElement, setupPlacements } from '../src/core/placements.js';

function installNoDomWaitGuards() {
  const originalSetTimeout = globalThis.setTimeout;
  const OriginalMutationObserver = globalThis.MutationObserver;
  globalThis.MutationObserver = class {
    constructor() {
      throw new Error('MutationObserver should not be used for quick placement lookup');
    }
  };
  globalThis.setTimeout = () => {
    throw new Error('setTimeout should not be used for quick placement lookup');
  };

  return {
    restore() {
      globalThis.MutationObserver = OriginalMutationObserver;
      globalThis.setTimeout = originalSetTimeout;
    }
  };
}

test('missing placements are skipped without waiting for later available placements', async () => {
  const guards = installNoDomWaitGuards();
  const calls = [];

  try {
    const elements = {
      '#ad-anchor': { id: 'ad-anchor' }
    };
    const documentRef = {
      documentElement: {},
      querySelector(selector) {
        return elements[selector] || null;
      }
    };
    const adapter = {
      slotConfig() {
        return null;
      },
      async definePlacement(request) {
        calls.push(request);
        return { name: request.slotKey, unit: { divId: request.elementId } };
      }
    };

    const promise = setupPlacements({
      definition: {
        placements: [
          { slotKey: 'ad-incontent', selector: '#ad-incontent', adUnitType: 'native' },
          { slotKey: 'ad-anchor', selector: '#ad-anchor', adUnitType: 'anchor' }
        ]
      },
      runtime: {
        slots: {
          'ad-incontent': {
            slotKey: 'ad-incontent',
            adUnitName: '/23360556473/quiz-rush.com_ad-incontent',
            adUnitType: 'native',
            enabled: true
          },
          'ad-anchor': {
            slotKey: 'ad-anchor',
            adUnitName: '/23360556473/quiz-rush.com_ad-anchor',
            adUnitType: 'anchor',
            domId: 'ad-anchor',
            domSelector: '#ad-anchor',
            enabled: true
          }
        }
      },
      adapter,
      documentRef,
      logger: { debug() {} }
    });

    const states = await promise;

    assert.deepEqual(calls.map(call => call.slotKey), ['ad-anchor']);
    assert.deepEqual(states.map(state => state.name), ['ad-anchor']);
  } finally {
    guards.restore();
  }
});

test('anchor placements are defined before other display placements', async () => {
  const calls = [];
  const elements = {
    '#ad-incontent': { id: 'ad-incontent' },
    '#ad-anchor': { id: 'ad-anchor' }
  };
  const documentRef = {
    querySelector(selector) {
      return elements[selector] || null;
    }
  };
  const adapter = {
    slotConfig() {
      return null;
    },
    async definePlacement(request) {
      calls.push(request);
      return { name: request.slotKey, unit: { divId: request.elementId } };
    }
  };

  await setupPlacements({
    definition: {
      placements: [
        { slotKey: 'ad-incontent', selector: '#ad-incontent', adUnitType: 'native' },
        { slotKey: 'ad-anchor', selector: '#ad-anchor', adUnitType: 'anchor' }
      ]
    },
    runtime: {
      slots: {
        'ad-incontent': {
          slotKey: 'ad-incontent',
          adUnitName: '/23360556473/quiz-rush.com_ad-incontent',
          adUnitType: 'native',
          enabled: true
        },
        'ad-anchor': {
          slotKey: 'ad-anchor',
          adUnitName: '/23360556473/quiz-rush.com_ad-anchor',
          adUnitType: 'anchor',
          domId: 'ad-anchor',
          domSelector: '#ad-anchor',
          enabled: true
        }
      }
    },
    adapter,
    documentRef,
    logger: { debug() {} }
  });

  assert.deepEqual(calls.map(call => call.slotKey), ['ad-anchor', 'ad-incontent']);
});

test('publisher-controlled preload routes defer auto-init without disabling other routes', async () => {
  const elements = {
    '#ad-leaderboard': { id: 'ad-leaderboard' }
  };
  const documentRef = {
    querySelector(selector) {
      return elements[selector] || null;
    }
  };
  const runtime = {
    slots: {
      'native-leaderboard': {
        slotKey: 'native-leaderboard',
        adUnitName: '/23360556473/jobguidematch.com_Native',
        adUnitType: 'native',
        domId: 'ad-leaderboard',
        domSelector: '#ad-leaderboard',
        sizes: [[320, 50], [728, 90]],
        enabled: true
      }
    }
  };
  const definition = {
    displayPreloadMode: 'real',
    publisherControlledPreloadRoutes: ['/find/apply/*'],
    placements: [
      { slotKey: 'ad-leaderboard', selector: '#ad-leaderboard', aliases: ['native-leaderboard'], adUnitType: 'native' }
    ]
  };
  const createAdapter = calls => ({
    slotConfig() {
      return null;
    },
    async definePlacement(request) {
      calls.push(request);
      return { name: request.slotKey, unit: { divId: request.elementId } };
    }
  });

  const applyCalls = [];
  const applyStates = await setupPlacements({
    definition,
    runtime,
    adapter: createAdapter(applyCalls),
    documentRef,
    windowRef: { location: { pathname: '/find/apply/acme' } },
    logger: { debug() {} }
  });

  assert.deepEqual(applyCalls, []);
  assert.deepEqual(applyStates, []);

  const normalCalls = [];
  const normalStates = await setupPlacements({
    definition,
    runtime,
    adapter: createAdapter(normalCalls),
    documentRef,
    windowRef: { location: { pathname: '/worldwide/' } },
    logger: { debug() {} }
  });

  assert.deepEqual(normalCalls.map(call => call.slotKey), ['ad-leaderboard']);
  assert.deepEqual(normalStates.map(state => state.name), ['ad-leaderboard']);
});

test('jobguidematch placements prefer sized native aliases over fluid duplicates', async () => {
  const calls = [];
  const elements = {
    '#ad-anchor': { id: 'ad-anchor' },
    '#ad-incontent': { id: 'ad-incontent' },
    '#ad-leaderboard': { id: 'ad-leaderboard' },
    '#ad-results': { id: 'ad-results' }
  };
  const documentRef = {
    querySelector(selector) {
      return elements[selector] || null;
    }
  };
  const adapter = {
    slotConfig() {
      return null;
    },
    async definePlacement(request) {
      calls.push(request);
      return { name: request.slotKey, unit: { divId: request.elementId } };
    }
  };

  await setupPlacements({
    definition: {
      placements: [
        { slotKey: 'ad-leaderboard', selector: '#ad-leaderboard', aliases: ['native-leaderboard'], adUnitType: 'native' },
        { slotKey: 'ad-incontent', selector: '#ad-incontent', aliases: ['native-incontent'], adUnitType: 'native' },
        { slotKey: 'ad-results', selector: '#ad-results', aliases: ['native-results'], adUnitType: 'native' },
        { slotKey: 'ad-anchor', selector: '#ad-anchor', aliases: ['anchor'], adUnitType: 'anchor' }
      ]
    },
    runtime: {
      slots: {
        'ad-anchor': {
          slotKey: 'ad-anchor',
          adUnitName: '/23360556473/jobguidematch.com_Anchor',
          adUnitType: 'anchor',
          domId: 'ad-anchor',
          domSelector: '#ad-anchor',
          sizes: [[320, 50], [728, 90]],
          enabled: true
        },
        'ad-incontent': {
          slotKey: 'ad-incontent',
          adUnitName: '/23360556473/jobguidematch.com_Native',
          adUnitType: 'native',
          domId: 'ad-incontent',
          domSelector: '#ad-incontent',
          sizes: 'fluid',
          enabled: true
        },
        'ad-leaderboard': {
          slotKey: 'ad-leaderboard',
          adUnitName: '/23360556473/jobguidematch.com_Native',
          adUnitType: 'native',
          domId: 'ad-leaderboard',
          domSelector: '#ad-leaderboard',
          sizes: 'fluid',
          enabled: true
        },
        'ad-results': {
          slotKey: 'ad-results',
          adUnitName: '/23360556473/jobguidematch.com_Native',
          adUnitType: 'native',
          domId: 'ad-results',
          domSelector: '#ad-results',
          sizes: 'fluid',
          enabled: true
        },
        anchor: {
          slotKey: 'anchor',
          adUnitName: '/23360556473/jobguidematch.com_Anchor',
          adUnitType: 'anchor',
          domId: 'ad-anchor',
          domSelector: '#ad-anchor',
          sizes: [[320, 50], [728, 90]],
          enabled: true
        },
        'native-incontent': {
          slotKey: 'native-incontent',
          adUnitName: '/23360556473/jobguidematch.com_Native',
          adUnitType: 'native',
          domId: 'ad-incontent',
          domSelector: '#ad-incontent',
          sizes: [[300, 250], [336, 280]],
          enabled: true
        },
        'native-leaderboard': {
          slotKey: 'native-leaderboard',
          adUnitName: '/23360556473/jobguidematch.com_Native',
          adUnitType: 'native',
          domId: 'ad-leaderboard',
          domSelector: '#ad-leaderboard',
          sizes: [[320, 50], [728, 90]],
          enabled: true
        },
        'native-results': {
          slotKey: 'native-results',
          adUnitName: '/23360556473/jobguidematch.com_Native',
          adUnitType: 'native',
          domId: 'ad-results',
          domSelector: '#ad-results',
          sizes: [[300, 250], [336, 280]],
          enabled: true
        }
      }
    },
    adapter,
    documentRef,
    logger: { debug() {} }
  });

  const bySlotKey = new Map(calls.map(call => [call.slotKey, call.config]));
  assert.deepEqual(bySlotKey.get('ad-leaderboard').sizes, [[320, 50], [728, 90]]);
  assert.deepEqual(bySlotKey.get('ad-incontent').sizes, [[300, 250], [336, 280]]);
  assert.deepEqual(bySlotKey.get('ad-results').sizes, [[300, 250], [336, 280]]);
  assert.deepEqual(bySlotKey.get('ad-anchor').sizes, [[320, 50], [728, 90]]);
  assert.equal(bySlotKey.get('ad-leaderboard').slotKey, 'native-leaderboard');
  assert.equal(bySlotKey.get('ad-incontent').slotKey, 'native-incontent');
  assert.equal(bySlotKey.get('ad-results').slotKey, 'native-results');
  assert.equal(bySlotKey.get('ad-anchor').slotKey, 'anchor');
});

test('visibility-first placements define visible slots immediately and defer offscreen slots', async () => {
  const calls = [];
  const deferredStates = [];
  const observers = [];
  const elements = {
    '#ad-anchor': {
      id: 'ad-anchor',
      getBoundingClientRect() {
        return { top: 620, bottom: 670 };
      }
    },
    '#ad-leaderboard': {
      id: 'ad-leaderboard',
      getBoundingClientRect() {
        return { top: 80, bottom: 170 };
      }
    },
    '#ad-results': {
      id: 'ad-results',
      getBoundingClientRect() {
        return { top: 1800, bottom: 2080 };
      }
    }
  };
  const windowRef = {
    innerHeight: 700,
    IntersectionObserver: class {
      constructor(callback, options) {
        this.callback = callback;
        this.options = options;
        this.disconnected = false;
        observers.push(this);
      }

      observe(element) {
        this.element = element;
      }

      disconnect() {
        this.disconnected = true;
      }
    }
  };
  const documentRef = {
    documentElement: { clientHeight: 700 },
    querySelector(selector) {
      return elements[selector] || null;
    }
  };
  const adapter = {
    slotConfig() {
      return null;
    },
    async definePlacement(request) {
      calls.push(request);
      return { name: request.slotKey, unit: { divId: request.elementId } };
    }
  };
  const runtimeSlot = slotKey => ({
    slotKey,
    adUnitName: `/23360556473/jobguidematch.com_${slotKey}`,
    adUnitType: slotKey === 'ad-anchor' ? 'anchor' : 'native',
    domId: slotKey,
    domSelector: `#${slotKey}`,
    enabled: true,
    visibilityFirst: true,
    lazyLoadMarginPx: 300
  });

  const states = await setupPlacements({
    definition: {
      placements: [
        { slotKey: 'ad-results', selector: '#ad-results', adUnitType: 'native' },
        { slotKey: 'ad-leaderboard', selector: '#ad-leaderboard', adUnitType: 'native' },
        { slotKey: 'ad-anchor', selector: '#ad-anchor', adUnitType: 'anchor' }
      ]
    },
    runtime: {
      slots: {
        'ad-results': runtimeSlot('ad-results'),
        'ad-leaderboard': runtimeSlot('ad-leaderboard'),
        'ad-anchor': runtimeSlot('ad-anchor')
      }
    },
    adapter,
    documentRef,
    windowRef,
    logger: { debug() {}, warn() {} },
    onStateDefined(state) {
      deferredStates.push(state);
    }
  });

  assert.deepEqual(calls.map(call => call.slotKey), ['ad-leaderboard', 'ad-anchor']);
  assert.deepEqual(states.map(state => state.name), ['ad-leaderboard', 'ad-anchor']);
  assert.equal(observers.length, 1);
  assert.equal(observers[0].options.rootMargin, '300px 0px 300px 0px');

  observers[0].callback([{ isIntersecting: true, intersectionRatio: 1 }], observers[0]);
  await Promise.resolve();

  assert.deepEqual(calls.map(call => call.slotKey), ['ad-leaderboard', 'ad-anchor', 'ad-results']);
  assert.deepEqual(deferredStates.map(state => state.name), ['ad-results']);
  assert.equal(observers[0].disconnected, true);
});

test('jobguidematch viewport priority starts visible inventory before below-fold native', async () => {
  const calls = [];
  const deferredStates = [];
  const observers = [];
  const element = (id, top, height = 90) => ({
    id,
    style: { display: '', visibility: '' },
    hidden: false,
    getBoundingClientRect() {
      return {
        left: 0,
        top,
        right: 728,
        bottom: top + height,
        width: 728,
        height
      };
    }
  });
  const elements = {
    '#ad-leaderboard': element('ad-leaderboard', 80),
    '#ad-anchor': element('ad-anchor', 620, 50),
    '#ad-incontent': element('ad-incontent', 1800, 250),
    '#ad-results': element('ad-results', 2600, 250)
  };
  const windowRef = {
    innerHeight: 700,
    getComputedStyle(item) {
      return item.style || {};
    },
    IntersectionObserver: class {
      constructor(callback, options) {
        this.callback = callback;
        this.options = options;
        this.disconnected = false;
        observers.push(this);
      }

      observe(item) {
        this.element = item;
      }

      disconnect() {
        this.disconnected = true;
      }
    }
  };
  const documentRef = {
    documentElement: { clientHeight: 700 },
    querySelector(selector) {
      return elements[selector] || null;
    }
  };
  const adapter = {
    slotConfig() {
      return null;
    },
    async definePlacement(request) {
      calls.push(request);
      return { name: request.slotKey, unit: { divId: request.elementId } };
    }
  };
  const nativeSlot = slotKey => ({
    slotKey,
    adUnitName: `/23360556473/jobguidematch.com_${slotKey}`,
    adUnitType: 'native',
    domId: slotKey,
    domSelector: `#${slotKey}`,
    sizes: [[300, 250], [336, 280]],
    enabled: true,
    visibilityFirst: true,
    lazyLoadMarginPx: 300
  });
  const anchorSlot = {
    slotKey: 'ad-anchor',
    adUnitName: '/23360556473/jobguidematch.com_Anchor',
    adUnitType: 'anchor',
    domId: 'ad-anchor',
    domSelector: '#ad-anchor',
    sizes: [[320, 50], [728, 90]],
    enabled: true,
    visibilityFirst: false
  };

  const states = await setupPlacements({
    definition: {
      placements: [
        { slotKey: 'ad-leaderboard', selector: '#ad-leaderboard', aliases: ['native-leaderboard'], adUnitType: 'native' },
        { slotKey: 'ad-incontent', selector: '#ad-incontent', aliases: ['native-incontent'], adUnitType: 'native' },
        { slotKey: 'ad-results', selector: '#ad-results', aliases: ['native-results'], adUnitType: 'native' },
        { slotKey: 'ad-anchor', selector: '#ad-anchor', aliases: ['anchor'], adUnitType: 'anchor' }
      ]
    },
    runtime: {
      slots: {
        'ad-leaderboard': nativeSlot('ad-leaderboard'),
        'ad-incontent': nativeSlot('ad-incontent'),
        'ad-results': nativeSlot('ad-results'),
        'ad-anchor': anchorSlot
      }
    },
    adapter,
    documentRef,
    windowRef,
    logger: { debug() {}, warn() {} },
    onStateDefined(state) {
      deferredStates.push(state);
    }
  });

  assert.deepEqual(calls.map(call => call.slotKey), ['ad-leaderboard', 'ad-anchor']);
  assert.deepEqual(states.map(state => state.name), ['ad-leaderboard', 'ad-anchor']);
  assert.deepEqual(observers.map(observer => observer.element.id), ['ad-incontent', 'ad-results']);
  assert.deepEqual(calls.map(call => call.elementId), ['ad-leaderboard', 'ad-anchor']);
  assert.equal(calls.some(call => String(call.elementId || '').startsWith('poexp-preload-')), false);

  observers.find(observer => observer.element.id === 'ad-incontent')
    .callback([{ isIntersecting: true, intersectionRatio: 1 }]);
  await Promise.resolve();

  assert.deepEqual(calls.map(call => call.slotKey), ['ad-leaderboard', 'ad-anchor', 'ad-incontent']);
  assert.deepEqual(deferredStates.map(state => state.name), ['ad-incontent']);
  assert.equal(calls[2].elementId, 'ad-incontent');
});

test('hidden placement elements are deferred until they become renderable', async () => {
  const calls = [];
  const deferredStates = [];
  const observers = [];
  const element = {
    id: 'ad-leaderboard',
    hidden: false,
    style: { display: 'none', visibility: '' },
    getBoundingClientRect() {
      return { top: 80, bottom: 170 };
    }
  };
  const windowRef = {
    innerHeight: 700,
    getComputedStyle(item) {
      return item.style || {};
    },
    IntersectionObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.disconnected = false;
        observers.push(this);
      }

      observe(item) {
        this.element = item;
      }

      disconnect() {
        this.disconnected = true;
      }
    }
  };
  const documentRef = {
    documentElement: { clientHeight: 700 },
    querySelector(selector) {
      return selector === '#ad-leaderboard' ? element : null;
    }
  };
  const adapter = {
    slotConfig() {
      return null;
    },
    async definePlacement(request) {
      calls.push(request);
      return { name: request.slotKey, unit: { divId: request.elementId } };
    }
  };

  const states = await setupPlacements({
    definition: {
      placements: [
        { slotKey: 'ad-leaderboard', selector: '#ad-leaderboard', adUnitType: 'native' }
      ]
    },
    runtime: {
      slots: {
        'ad-leaderboard': {
          slotKey: 'ad-leaderboard',
          adUnitName: '/23360556473/jobguidematch.com_Native',
          adUnitType: 'native',
          domId: 'ad-leaderboard',
          domSelector: '#ad-leaderboard',
          enabled: true
        }
      }
    },
    adapter,
    documentRef,
    windowRef,
    logger: { debug() {}, warn() {} },
    onStateDefined(state) {
      deferredStates.push(state);
    }
  });

  assert.deepEqual(states, []);
  assert.equal(calls.length, 0);
  assert.equal(observers.length, 1);

  element.style.display = '';
  observers[0].callback([{ isIntersecting: true, intersectionRatio: 1 }], observers[0]);
  await Promise.resolve();

  assert.deepEqual(calls.map(call => call.slotKey), ['ad-leaderboard']);
  assert.deepEqual(deferredStates.map(state => state.name), ['ad-leaderboard']);
  assert.equal(observers[0].disconnected, true);
});

test('renderable placement detection treats hidden ancestors as not renderable', () => {
  const wrapper = {
    hidden: false,
    style: { display: 'none', visibility: '' },
    parentNode: null
  };
  const element = {
    id: 'ad-leaderboard',
    hidden: false,
    style: { display: '', visibility: '' },
    parentNode: wrapper
  };
  const windowRef = {
    getComputedStyle(item) {
      return item.style || {};
    }
  };

  assert.equal(isRenderablePlacementElement(element, windowRef), false);
});

test('missing configured anchor div is skipped instead of falling back to out-of-page', async () => {
  const calls = [];
  const documentRef = {
    querySelector() {
      return null;
    }
  };
  const adapter = {
    slotConfig() {
      return null;
    },
    async definePlacement(request) {
      calls.push(request);
      return { name: request.slotKey, unit: { divId: request.elementId } };
    }
  };

  const states = await setupPlacements({
    definition: {
      placements: [
        { slotKey: 'ad-anchor', selector: '#ad-anchor', aliases: ['anchor'], adUnitType: 'anchor' }
      ]
    },
    runtime: {
      slots: {
        anchor: {
          slotKey: 'anchor',
          adUnitName: '/23360556473/quiz-rush.com_ad-anchor',
          adUnitType: 'anchor',
          domId: 'ad-anchor',
          domSelector: '#ad-anchor',
          enabled: true
        }
      }
    },
    adapter,
    documentRef,
    logger: { debug() {} }
  });

  assert.deepEqual(calls, []);
  assert.deepEqual(states, []);
});
