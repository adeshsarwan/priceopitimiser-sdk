import test from 'node:test';
import assert from 'node:assert/strict';
import { PriceOptimiserRuntimeAdapter } from '../src/core/price-optimiser-runtime.js';

const TARGETING_POLICY = {
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

function assignmentKey(siteKey, expKey) {
  return `po_exp:${siteKey}:${expKey}:group`;
}

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    snapshot() {
      return Object.fromEntries(values);
    }
  };
}

function createFakeGpt() {
  let definedSlot = null;
  const pubads = {};
  const googletag = {
    pubads() {
      return pubads;
    },
    defineSlot(path, sizes, divId) {
      definedSlot = {
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
          this.targeting[key] = String(value);
          return this;
        }
      };
      return definedSlot;
    }
  };
  return { googletag, get definedSlot() { return definedSlot; } };
}

function runAssignment({
  siteKey = 'jobguidematch.com',
  expKey = 'ads_exp_v4',
  enabled = true,
  variantPercentage = 0.8,
  storage = createStorage(),
  random = () => 0.5,
  slotConfig = {}
} = {}) {
  const fake = createFakeGpt();
  const runtime = {
    siteKey,
    targetingPolicy: TARGETING_POLICY,
    experiment: {
      enabled,
      expKey,
      key: expKey,
      variantPercentage
    },
    slots: {}
  };
  const adapter = new PriceOptimiserRuntimeAdapter({
    windowRef: {
      googletag: fake.googletag,
      localStorage: storage,
      __publisherExperienceSlots: {}
    },
    documentRef: {},
    runtime,
    random,
    logger: { debug() {}, warn() {} }
  });
  const state = adapter.defineDisplay('native-incontent', 'ad-incontent', {
    slotKey: 'native-incontent',
    adUnitName: '/23360556473/jobguidematch.com_Native',
    adUnitType: 'native',
    sizes: [[300, 250]],
    waterfall: [30, 20],
    retryLimit: 2,
    retryDelayMs: 0,
    ...slotConfig
  });
  const floor = adapter.applyTargeting(state);

  return {
    expGroup: adapter.experiment.expGroup,
    slotExpGroup: state && state.experiment ? state.experiment.expGroup : null,
    slotExpKey: state && state.experiment ? state.experiment.expKey : null,
    targeting: fake.definedSlot.targeting,
    floor,
    storage: storage.snapshot()
  };
}

test('variantPercentage = 0 assigns 100% control', () => {
  const storage = createStorage({ [assignmentKey('jobguidematch.com', 'ads_exp_v4')]: 'variant' });
  const result = runAssignment({ variantPercentage: 0, storage, random: () => 0 });

  assert.equal(result.expGroup, 'control');
  assert.deepEqual(result.targeting, expectedControlTargeting());
  assert.equal(result.floor, null);
});

test('variantPercentage = 1 assigns 100% variant', () => {
  const storage = createStorage({ [assignmentKey('jobguidematch.com', 'ads_exp_v4')]: 'control' });
  const result = runAssignment({ variantPercentage: 1, storage, random: () => 0.99 });

  assert.equal(result.expGroup, 'variant');
  assert.deepEqual(result.targeting, {
    exp_group: 'variant',
    exp_key: 'ads_exp_v4',
    slot_name: 'native',
    price_rule: '30'
  });
  assert.equal(result.floor, 30);
});

test('variantPercentage = 0.8 uses controlled random assignment', () => {
  const lowVariant = runAssignment({ storage: createStorage(), random: () => 0.10 });
  const variant = runAssignment({ storage: createStorage(), random: () => 0.79 });
  const control = runAssignment({ storage: createStorage(), random: () => 0.8 });

  assert.equal(lowVariant.expGroup, 'variant');
  assert.equal(lowVariant.storage[assignmentKey('jobguidematch.com', 'ads_exp_v4')], 'variant');
  assert.deepEqual(lowVariant.targeting, {
    exp_group: 'variant',
    exp_key: 'ads_exp_v4',
    slot_name: 'native',
    price_rule: '30'
  });

  assert.equal(variant.expGroup, 'variant');
  assert.equal(variant.storage[assignmentKey('jobguidematch.com', 'ads_exp_v4')], 'variant');
  assert.deepEqual(variant.targeting, {
    exp_group: 'variant',
    exp_key: 'ads_exp_v4',
    slot_name: 'native',
    price_rule: '30'
  });

  assert.equal(control.expGroup, 'control');
  assert.equal(control.storage[assignmentKey('jobguidematch.com', 'ads_exp_v4')], 'control');
  assert.deepEqual(control.targeting, expectedControlTargeting());
});

test('persisted control remains control', () => {
  const result = runAssignment({
    storage: createStorage({ [assignmentKey('jobguidematch.com', 'ads_exp_v4')]: 'control' }),
    random: () => 0
  });

  assert.equal(result.expGroup, 'control');
  assert.deepEqual(result.targeting, expectedControlTargeting());
});

test('persisted variant remains variant', () => {
  const result = runAssignment({
    storage: createStorage({ [assignmentKey('jobguidematch.com', 'ads_exp_v4')]: 'variant' }),
    random: () => 0.99
  });

  assert.equal(result.expGroup, 'variant');
  assert.deepEqual(result.targeting, {
    exp_group: 'variant',
    exp_key: 'ads_exp_v4',
    slot_name: 'native',
    price_rule: '30'
  });
});

test('different siteKey uses a separate assignment', () => {
  const storage = createStorage({ [assignmentKey('jobguidematch.com', 'ads_exp_v4')]: 'control' });

  const otherSite = runAssignment({
    siteKey: 'quiz-rush.com',
    storage,
    random: () => 0
  });
  const originalSite = runAssignment({
    siteKey: 'jobguidematch.com',
    storage,
    random: () => 0
  });

  assert.equal(otherSite.expGroup, 'variant');
  assert.equal(otherSite.storage[assignmentKey('quiz-rush.com', 'ads_exp_v4')], 'variant');
  assert.equal(originalSite.expGroup, 'control');
});

test('different expKey uses a separate assignment', () => {
  const storage = createStorage({ [assignmentKey('jobguidematch.com', 'ads_exp_v4')]: 'control' });

  const otherExperiment = runAssignment({
    expKey: 'ads_exp_v5',
    storage,
    random: () => 0
  });
  const originalExperiment = runAssignment({
    expKey: 'ads_exp_v4',
    storage,
    random: () => 0
  });

  assert.equal(otherExperiment.expGroup, 'variant');
  assert.equal(otherExperiment.storage[assignmentKey('jobguidematch.com', 'ads_exp_v5')], 'variant');
  assert.equal(originalExperiment.expGroup, 'control');
});

test('native variant can keep v4 GAM targeting while assignment uses v5 namespace', () => {
  const result = runAssignment({
    expKey: 'ads_exp_v5',
    random: () => 0,
    slotConfig: {
      variant: { expKey: 'ads_exp_v4', baseFloor: 30, ladder: [30, 20] }
    }
  });

  assert.equal(result.expGroup, 'variant');
  assert.equal(result.storage[assignmentKey('jobguidematch.com', 'ads_exp_v5')], 'variant');
  assert.deepEqual(result.targeting, {
    exp_group: 'variant',
    exp_key: 'ads_exp_v4',
    slot_name: 'native',
    price_rule: '30'
  });
});

test('native control keeps existing control targeting when assignment uses v5 namespace', () => {
  const result = runAssignment({
    expKey: 'ads_exp_v5',
    random: () => 0.8,
    slotConfig: {
      variant: { expKey: 'ads_exp_v4', baseFloor: 30, ladder: [30, 20] }
    }
  });

  assert.equal(result.expGroup, 'control');
  assert.equal(result.storage[assignmentKey('jobguidematch.com', 'ads_exp_v5')], 'control');
  assert.deepEqual(result.targeting, expectedControlTargeting('ads_exp_v5'));
});

test('native v6 slot experiment uses a fresh assignment namespace isolated from v4 and rewarded v5', () => {
  const storage = createStorage({
    [assignmentKey('jobguidematch.com', 'ads_exp_v4')]: 'control',
    [assignmentKey('jobguidematch.com', 'ads_exp_v5')]: 'control'
  });
  const result = runAssignment({
    expKey: 'ads_exp_v5',
    storage,
    random: () => 0,
    slotConfig: {
      waterfall: [3, 1],
      retryLimit: 2,
      refreshRoundTargetingKey: 'refresh_round',
      targetingPolicy: {
        control: ['exp_group', 'exp_key', 'slot_name', 'refresh_round'],
        variant: ['exp_group', 'exp_key', 'slot_name', 'refresh_round', 'price_rule']
      },
      experiment: {
        expKey: 'ads_exp_v6',
        key: 'ads_exp_v6',
        variantPercentage: 0.8,
        control: { enabled: true },
        variant: { baseFloor: 3, ladder: [3, 1], expKey: 'ads_exp_v6' }
      }
    }
  });

  assert.equal(result.expGroup, 'control');
  assert.equal(result.slotExpGroup, 'variant');
  assert.equal(result.slotExpKey, 'ads_exp_v6');
  assert.deepEqual(result.storage, {
    [assignmentKey('jobguidematch.com', 'ads_exp_v4')]: 'control',
    [assignmentKey('jobguidematch.com', 'ads_exp_v5')]: 'control',
    [assignmentKey('jobguidematch.com', 'ads_exp_v6')]: 'variant'
  });
  assert.deepEqual(result.targeting, {
    exp_group: 'variant',
    exp_key: 'ads_exp_v6',
    slot_name: 'native',
    refresh_round: '0',
    price_rule: '3'
  });
});

test('experiment.enabled = false preserves disabled-experiment control behavior', () => {
  const result = runAssignment({
    enabled: false,
    variantPercentage: 1,
    storage: createStorage({ [assignmentKey('jobguidematch.com', 'ads_exp_v4')]: 'variant' }),
    random: () => 0
  });

  assert.equal(result.expGroup, 'control');
  assert.deepEqual(result.targeting, expectedControlTargeting());
});

function installManualTimers() {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = [];

  globalThis.setTimeout = (callback, delay = 0, ...args) => {
    const timer = {
      delay: Number(delay),
      cleared: false,
      run: () => callback(...args)
    };
    timers.push(timer);
    return timer;
  };

  globalThis.clearTimeout = timer => {
    if (timer) timer.cleared = true;
  };

  return {
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

function createWaterfallFakeGpt() {
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
    refresh(slots) {
      for (const slot of slots) requestSlot(slot);
    }
  };

  const googletag = {
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
          this.targeting[key] = String(value);
          return this;
        }
      };
      slotsByDivId.set(divId, slot);
      return slot;
    },
    display(slotOrDivId) {
      const slot = typeof slotOrDivId === 'string' ? slotsByDivId.get(slotOrDivId) : slotOrDivId;
      if (slot) requestSlot(slot);
    }
  };

  return { googletag, snapshots };
}

async function runAssignedBrowserToExhaustion({ random, storage = createStorage() }) {
  const timers = installManualTimers();
  const fake = createWaterfallFakeGpt();
  try {
    const adapter = new PriceOptimiserRuntimeAdapter({
      windowRef: {
        googletag: fake.googletag,
        localStorage: storage,
        __publisherExperienceSlots: {}
      },
      documentRef: {},
      runtime: {
        siteKey: 'jobguidematch.com',
        targetingPolicy: TARGETING_POLICY,
        experiment: {
          enabled: true,
          expKey: 'ads_exp_v4',
          key: 'ads_exp_v4',
          variantPercentage: 0.8
        },
        slots: {}
      },
      random,
      logger: { debug() {}, warn() {} }
    });
    const state = adapter.defineDisplay('native-leaderboard', 'ad-leaderboard', {
      slotKey: 'native-leaderboard',
      adUnitName: '/23360556473/jobguidematch.com_Native',
      adUnitType: 'native',
      sizes: [[320, 50], [728, 90]],
      targetingKey: 'price_rule',
      integrationMode: 'both',
      retryLimit: 2,
      retryDelayMs: 0,
      requestTimeoutMs: 1000,
      waterfall: [30, 20],
      control: { enabled: true },
      variant: { baseFloor: 30, ladder: [30, 20] },
      experiment: {
        control: { enabled: true },
        variant: { baseFloor: 30, ladder: [30, 20] }
      }
    });
    let result;
    const request = adapter.requestWithRetries(state).then(value => {
      result = value;
      return value;
    });

    while (!result && timers.runNext(0)) {
      await Promise.resolve();
    }

    await request;
    return {
      result,
      expGroup: adapter.experiment.expGroup,
      snapshots: fake.snapshots,
      storage: storage.snapshot()
    };
  } finally {
    timers.restore();
  }
}

test('variant-assigned browser uses the runtime ladder then final normal fallback', async () => {
  const actual = await runAssignedBrowserToExhaustion({ random: () => 0.79 });

  assert.equal(actual.result.status, 'unavailable');
  assert.equal(actual.expGroup, 'variant');
  assert.equal(actual.storage[assignmentKey('jobguidematch.com', 'ads_exp_v4')], 'variant');
  assert.deepEqual(actual.snapshots, [
    {
      exp_group: 'variant',
      exp_key: 'ads_exp_v4',
      slot_name: 'native',
      price_rule: '30'
    },
    {
      exp_group: 'variant',
      exp_key: 'ads_exp_v4',
      slot_name: 'native',
      price_rule: '20'
    },
    {
      exp_group: 'variant',
      exp_key: 'ads_exp_v4',
      slot_name: 'native'
    }
  ]);
});

test('control-assigned browser makes exactly one unpriced request', async () => {
  const actual = await runAssignedBrowserToExhaustion({ random: () => 0.8 });

  assert.equal(actual.result.status, 'unavailable');
  assert.equal(actual.expGroup, 'control');
  assert.equal(actual.storage[assignmentKey('jobguidematch.com', 'ads_exp_v4')], 'control');
  assert.deepEqual(actual.snapshots, [expectedControlTargeting()]);
});
