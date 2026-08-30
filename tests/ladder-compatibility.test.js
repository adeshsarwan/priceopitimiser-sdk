import test from 'node:test';
import assert from 'node:assert/strict';
import { PriceOptimiserRuntimeAdapter } from '../src/core/price-optimiser-runtime.js';

const RUNTIME_TARGETING_POLICY = {
  control: ['exp_group'],
  variant: ['exp_group', 'exp_key', 'slot_name', 'price_rule']
};

function expectedControlTargeting(expKey = 'ads_exp_v4', slotName = 'native') {
  return {
    exp_group: 'control',
    exp_key: expKey,
    slot_name: slotName
  };
}

const QUIZ_NATIVE_INCONTENT_RUNTIME_SLOT = {
  id: 171,
  siteKey: 'quiz-rush.com',
  pageKey: null,
  slotKey: 'native-incontent',
  adUnitName: '/23360556473/quiz-rush.com_Native',
  enabled: true,
  adUnitType: 'native',
  domId: 'ad-incontent',
  domSelector: '#ad-incontent',
  integrationMode: 'both',
  configuredIntegrationMode: 'both',
  targetingKey: 'price_rule',
  retryLimit: 4,
  retryTimeoutMs: 2500,
  retryAfterMs: 2500,
  retryDelayMs: 2500,
  maxAttempts: 4,
  delayMs: 0,
  waterfall: [300, 250, 180, 120],
  control: { enabled: true },
  variant: { baseFloor: 1.2, ladder: [300, 250, 180, 120] },
  experiment: {
    control: { enabled: true },
    variant: { baseFloor: 1.2, ladder: [300, 250, 180, 120] }
  }
};

function runtimeFixture(expGroup) {
  return {
    ok: true,
    siteKey: 'quiz-rush.com',
    integrationMode: 'waterfall_only',
    targetingPolicy: RUNTIME_TARGETING_POLICY,
    country: 'SG',
    countryCode: 'SG',
    regionGroup: 'tier1',
    pricingKey: 'SG',
    geo: {
      country: 'SG',
      countryCode: 'SG',
      regionGroup: 'tier1',
      pricingKey: 'SG'
    },
    exp_group: expGroup,
    experiment: {
      enabled: true,
      expKey: 'ads_exp_v4',
      key: 'ads_exp_v4',
      variantPercentage: 0.5
    },
    formats: {
      native: true
    },
    slots: {
      'native-incontent': Object.assign({}, QUIZ_NATIVE_INCONTENT_RUNTIME_SLOT)
    }
  };
}

function installManualTimers() {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = [];
  let nextId = 1;

  globalThis.setTimeout = (callback, delay = 0, ...args) => {
    const timer = {
      id: nextId,
      delay: Number(delay),
      cleared: false,
      run: () => callback(...args)
    };
    nextId += 1;
    timers.push(timer);
    return timer;
  };

  globalThis.clearTimeout = timer => {
    if (timer) timer.cleared = true;
  };

  return {
    timers,
    runNext(delay) {
      const timer = timers.find(item => !item.cleared && item.delay === delay);
      if (!timer) return false;
      timer.cleared = true;
      timer.run();
      return true;
    },
    restore() {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  };
}

function createFakeGpt() {
  const listeners = new Map();
  const snapshots = [];
  const slotsByDivId = new Map();

  const emit = (name, event) => {
    for (const listener of listeners.get(name) || []) listener(event);
  };

  const requestSlot = slot => {
    snapshots.push(Object.assign({}, slot.targeting));
    emit('slotRenderEnded', { slot, isEmpty: true });
  };

  const pubads = {
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
    },
    removeEventListener(name, listener) {
      if (listeners.has(name)) listeners.get(name).delete(listener);
    },
    collapseEmptyDivs() {},
    disableInitialLoad() {},
    enableSingleRequest() {},
    refresh(slots) {
      for (const slot of slots) requestSlot(slot);
    }
  };

  const googletag = {
    apiReady: true,
    cmd: {
      push(callback) {
        callback();
      }
    },
    pubads() {
      return pubads;
    },
    defineSlot(path, sizes, divId) {
      const slot = {
        path,
        sizes,
        divId,
        targeting: {},
        addService() {
          return this;
        },
        clearTargeting() {
          this.targeting = {};
        },
        setTargeting(key, value) {
          this.targeting[key] = value;
          return this;
        },
        getSlotElementId() {
          return divId;
        }
      };
      slotsByDivId.set(divId, slot);
      return slot;
    },
    display(slotOrDivId) {
      const slot = typeof slotOrDivId === 'string' ? slotsByDivId.get(slotOrDivId) : slotOrDivId;
      if (slot) requestSlot(slot);
    },
    enableServices() {}
  };

  return { googletag, snapshots };
}

async function runAdapterToExhaustion(expGroup) {
  const timers = installManualTimers();
  const fake = createFakeGpt();
  try {
    const runtime = runtimeFixture(expGroup);
    const adapter = new PriceOptimiserRuntimeAdapter({
      windowRef: {
        googletag: fake.googletag,
        __publisherExperienceSlots: {}
      },
      documentRef: {
        querySelector() {
          return null;
        },
        createElement() {
          return {};
        },
        head: {
          appendChild() {}
        }
      },
      runtime,
      logger: { debug() {}, warn() {} }
    });
    const config = adapter.slotConfig('native-incontent', 'native');
    const state = adapter.defineDisplay('native-incontent', 'ad-incontent', config);
    let result;
    const request = adapter.requestWithRetries(state).then(value => {
      result = value;
      return value;
    });

    while (!result && timers.runNext(QUIZ_NATIVE_INCONTENT_RUNTIME_SLOT.retryDelayMs)) {
      await Promise.resolve();
    }

    await request;
    return {
      result,
      snapshots: fake.snapshots,
      retryDelays: timers.timers
        .filter(timer => timer.delay === QUIZ_NATIVE_INCONTENT_RUNTIME_SLOT.retryDelayMs)
        .map(timer => timer.delay)
    };
  } finally {
    timers.restore();
  }
}

test('variant requests use runtime waterfall order, then one final fallback request', async () => {
  const expectedPricedFloors = QUIZ_NATIVE_INCONTENT_RUNTIME_SLOT.waterfall;
  const actual = await runAdapterToExhaustion('variant');

  assert.equal(actual.result.status, 'unavailable');
  assert.deepEqual(actual.snapshots.slice(0, expectedPricedFloors.length).map(snapshot => Number(snapshot.price_rule)), expectedPricedFloors);
  assert.equal(actual.snapshots.length, expectedPricedFloors.length + 1);
  assert.deepEqual(actual.retryDelays, [2500, 2500, 2500, 2500]);
});

test('native variant final fallback preserves experiment attribution', async () => {
  const actual = await runAdapterToExhaustion('variant');
  const fallbackSnapshot = actual.snapshots[QUIZ_NATIVE_INCONTENT_RUNTIME_SLOT.waterfall.length];

  assert.deepEqual(fallbackSnapshot, {
    exp_group: 'variant',
    exp_key: 'ads_exp_v4',
    slot_name: 'native'
  });
  assert.equal(Object.prototype.hasOwnProperty.call(fallbackSnapshot, 'price_rule'), false);
});

test('variant request targeting matches production key names', async () => {
  const actual = await runAdapterToExhaustion('variant');

  assert.deepEqual(actual.snapshots[0], {
    exp_group: 'variant',
    exp_key: 'ads_exp_v4',
    slot_name: 'native',
    price_rule: '300'
  });
});

test('control behaviour performs one unpriced request with full experiment attribution', async () => {
  const actual = await runAdapterToExhaustion('control');

  assert.equal(actual.result.status, 'unavailable');
  assert.deepEqual(actual.snapshots, [expectedControlTargeting()]);
  assert.deepEqual(actual.retryDelays, []);
});
