import test from 'node:test';
import assert from 'node:assert/strict';
import rewardedConfig from '../config/rewarded-price-experiments.cjs';
import configureSites from '../scripts/configure-price-optimiser-sites.cjs';
import { PriceOptimiserRuntimeAdapter } from '../src/core/price-optimiser-runtime.js';

const {
  JOBGUIDEMATCH_REWARDED_V5,
  JOBGUIDEMATCH_DISPLAY_FAST_LOAD,
  rewardedV5Prices,
  rewardedV5PricingRules,
  displayFastLoadInitialPrices,
  displayFastLoadRefreshLadders,
  displayFastLoadRoundLadders,
  displayFastLoadPricingRulesByRound,
  assertRequiredPricingRulesExist
} = rewardedConfig;

const TARGETING_POLICY = {
  control: ['exp_group'],
  variant: ['exp_group', 'exp_key', 'slot_name', 'price_rule']
};

const JOBGUIDEMATCH_DISPLAY_LADDERS = {
  native: displayFastLoadInitialPrices(),
  anchor: displayFastLoadInitialPrices(),
  interstitial: [30]
};

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

function locationFor(href) {
  const parsed = new URL(href, 'https://jobguidematch.com/');
  return {
    href: parsed.href,
    hostname: parsed.hostname,
    pathname: parsed.pathname,
    search: parsed.search
  };
}

function cloneRewardedLadder() {
  return JOBGUIDEMATCH_REWARDED_V5.ladder.map(item => Object.assign({}, item));
}

function rewardedRuntime(expGroup, { rewardedTargeting } = {}) {
  return {
    siteKey: JOBGUIDEMATCH_REWARDED_V5.siteKey,
    exp_group: expGroup,
    experiment: {
      enabled: true,
      expKey: JOBGUIDEMATCH_REWARDED_V5.experimentKey,
      key: JOBGUIDEMATCH_REWARDED_V5.experimentKey,
      variantPercentage: JOBGUIDEMATCH_REWARDED_V5.variantPercentage
    },
    targetingPolicy: TARGETING_POLICY,
    slots: {
      rewarded: {
        slotKey: 'rewarded',
        adUnitName: '/23360556473/jobguidematch.com_Rewarded',
        adUnitType: 'rewarded',
        integrationMode: 'both',
        configuredIntegrationMode: 'both',
        targetingKey: 'price_rule',
        retryLimit: rewardedV5Prices().length,
        maximumRewardedAttempts: rewardedV5Prices().length,
        retryDelayMs: 0,
        rewardedAttemptTimeoutMs: JOBGUIDEMATCH_REWARDED_V5.attemptTimeoutMs,
        rewardedRequestTimeoutMs: 15000,
        waterfall: cloneRewardedLadder(),
        targeting: rewardedTargeting,
        control: { enabled: true },
        variant: {
          baseFloor: rewardedV5Prices()[0],
          ladder: cloneRewardedLadder()
        },
        experiment: {
          control: { enabled: true },
          variant: {
            baseFloor: rewardedV5Prices()[0],
            ladder: cloneRewardedLadder()
          }
        }
      },
      'native-incontent': {
        slotKey: 'native-incontent',
        adUnitName: '/23360556473/jobguidematch.com_Native',
        adUnitType: 'native',
        sizes: 'fluid',
        waterfall: JOBGUIDEMATCH_DISPLAY_LADDERS.native.slice()
      },
      anchor: {
        slotKey: 'anchor',
        adUnitName: '/23360556473/jobguidematch.com_Anchor',
        adUnitType: 'anchor',
        sizes: [[320, 50], [728, 90]],
        waterfall: JOBGUIDEMATCH_DISPLAY_LADDERS.anchor.slice()
      },
      interstitial: {
        slotKey: 'interstitial',
        adUnitName: '/23360556473/jobguidematch.com_Interstitial',
        adUnitType: 'interstitial',
        waterfall: JOBGUIDEMATCH_DISPLAY_LADDERS.interstitial.slice()
      }
    }
  };
}

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
    timers,
    runNextAny() {
      const available = timers.filter(item => !item.cleared);
      if (!available.length) return false;
      available.sort((a, b) => a.delay - b.delay);
      available[0].cleared = true;
      available[0].run();
      return true;
    },
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

function createRewardedFakeGpt({ markSlotBeforeFallback = false, silentRewardedRequests = false } = {}) {
  const listeners = new Map();
  const snapshots = [];
  const clearCalls = [];
  const slots = [];

  const emit = (name, event) => {
    for (const listener of listeners.get(name) || []) listener(event);
  };

  const requestSlot = slot => {
    const requestIndex = snapshots.length;
    snapshots.push(Object.assign({}, slot.targeting));
    if (markSlotBeforeFallback && requestIndex === rewardedV5Prices().length - 1) {
      slot.targeting.publisher_context = 'keep-me';
    }
    if (silentRewardedRequests) return;
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
    refresh(requestedSlots) {
      for (const slot of requestedSlots) requestSlot(slot);
    }
  };

  const googletag = {
    apiReady: true,
    cmd: {
      push(callback) {
        callback();
      }
    },
    enums: {
      OutOfPageFormat: {
        REWARDED: 'REWARDED'
      }
    },
    pubads() {
      return pubads;
    },
    defineOutOfPageSlot(path, format) {
      const slot = {
        path,
        format,
        targeting: {},
        addService() {
          return this;
        },
        clearTargeting(key) {
          clearCalls.push(key == null ? null : key);
          if (key == null) this.targeting = {};
          else delete this.targeting[key];
          return this;
        },
        setTargeting(key, value) {
          this.targeting[key] = String(value);
          return this;
        }
      };
      slots.push(slot);
      return slot;
    },
    display(slot) {
      requestSlot(slot);
    },
    enableServices() {}
  };

  return { googletag, snapshots, clearCalls, slots, emit, listeners };
}

async function runRewardedToExhaustion(expGroup, options = {}) {
  const timers = installManualTimers();
  const fake = createRewardedFakeGpt(options);
  try {
    const adapter = new PriceOptimiserRuntimeAdapter({
      windowRef: {
        googletag: fake.googletag,
        localStorage: createStorage(),
        sessionStorage: options.sessionStorage || createStorage(),
        location: options.href ? locationFor(options.href) : undefined,
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
      runtime: rewardedRuntime(expGroup, options),
      logger: { debug() {}, warn() {} }
    });

    let result = null;
    const request = adapter.requestRewarded('rewarded').then(value => {
      result = value;
      return value;
    });

    await Promise.resolve();
    await Promise.resolve();

    let guard = 0;
    while (!result && guard < 40 && (timers.runNext(0) || timers.runNextAny())) {
      guard += 1;
      await Promise.resolve();
      await Promise.resolve();
    }

    for (let index = 0; index < 10 && !result; index += 1) {
      await Promise.resolve();
    }

    assert.ok(result, 'rewarded request did not finish through the configured ladder');
    await request;

    return {
      result,
      snapshots: fake.snapshots,
      clearCalls: fake.clearCalls,
      timerDelays: timers.timers.map(timer => timer.delay),
      state: result.state
    };
  } finally {
    timers.restore();
  }
}

test('configured GAM pricing-rule catalog contains every rewarded v5 rule', () => {
  assert.doesNotThrow(() => assertRequiredPricingRulesExist());
  assert.deepEqual(rewardedV5PricingRules(), [
    'floor_price_300',
    'floor_price_250',
    'floor_price_180',
    'floor_price_120',
    'floor_price_80',
    'floor_price_50',
    'floor_price_30'
  ]);
});

test('configured GAM pricing-rule catalog contains every native and anchor v6 rule', () => {
  assert.doesNotThrow(() => assertRequiredPricingRulesExist());
  assert.deepEqual(displayFastLoadPricingRulesByRound(), [
    ['floor_price_3', 'floor_price_1'],
    ['floor_price_5', 'floor_price_3', 'floor_price_1'],
    ['floor_price_8', 'floor_price_5', 'floor_price_3', 'floor_price_1'],
    ['floor_price_15', 'floor_price_8', 'floor_price_5', 'floor_price_3', 'floor_price_1']
  ]);
});

test('jobguidematch rewarded v5 ladder is exactly 300, 250, 180, 120, 80, 50, 30 then fallback', async () => {
  const actual = await runRewardedToExhaustion('variant');

  assert.deepEqual(actual.state.sequence, rewardedV5Prices());
  assert.deepEqual(actual.snapshots.map(snapshot => snapshot.price_rule || null), [
    '300',
    '250',
    '180',
    '120',
    '80',
    '50',
    '30',
    null
  ]);
});

test('rewarded v5 waterfall advances when GPT rewarded no-fill events are silent', async () => {
  const actual = await runRewardedToExhaustion('variant', { silentRewardedRequests: true });

  assert.equal(actual.result.status, 'unavailable');
  assert.deepEqual(actual.snapshots.map(snapshot => snapshot.price_rule || null), [
    '300',
    '250',
    '180',
    '120',
    '80',
    '50',
    '30',
    null
  ]);
  assert.equal(actual.state.attempt, rewardedV5Prices().length);
  assert.equal(
    actual.timerDelays.filter(delay => delay === JOBGUIDEMATCH_REWARDED_V5.attemptTimeoutMs).length,
    rewardedV5Prices().length + 1
  );
});

test('jobguidematch rewarded v5 never uses removed ladder prices', () => {
  const removedPrices = new Set([200, 150, 100, 60]);
  const configuredPrices = rewardedV5Prices();

  assert.deepEqual(configuredPrices, [300, 250, 180, 120, 80, 50, 30]);
  assert.equal(configuredPrices.some(price => removedPrices.has(price)), false);
});

test('rewarded v5 control makes one unpriced attributed GAM request', async () => {
  const actual = await runRewardedToExhaustion('control');

  assert.equal(actual.result.status, 'unavailable');
  assert.deepEqual(actual.snapshots, [
    {
      exp_group: 'control',
      exp_key: 'ads_exp_v5',
      slot_name: 'rewarded'
    }
  ]);
  assert.equal(Object.prototype.hasOwnProperty.call(actual.snapshots[0], 'price_rule'), false);
});

test('every rewarded v5 variant priced attempt carries attribution and the correct price_rule', async () => {
  const actual = await runRewardedToExhaustion('variant');

  assert.deepEqual(actual.snapshots.slice(0, rewardedV5Prices().length), rewardedV5Prices().map(price => ({
    exp_group: 'variant',
    exp_key: 'ads_exp_v5',
    slot_name: 'rewarded',
    price_rule: String(price)
  })));
});

test('rewarded v5 variant fallback keeps attribution and clears only price_rule', async () => {
  const actual = await runRewardedToExhaustion('variant', {
    rewardedTargeting: { publisher_context: 'keep-me' }
  });
  const fallbackSnapshot = actual.snapshots[rewardedV5Prices().length];

  assert.deepEqual(fallbackSnapshot, {
    exp_group: 'variant',
    exp_key: 'ads_exp_v5',
    slot_name: 'rewarded',
    publisher_context: 'keep-me'
  });
  assert.equal(Object.prototype.hasOwnProperty.call(fallbackSnapshot, 'price_rule'), false);
  assert.deepEqual(actual.clearCalls.slice(-1), ['price_rule']);
});

test('rewarded v5 paid traffic attribution survives every priced attempt and fallback', async () => {
  const actual = await runRewardedToExhaustion('variant', {
    href: 'https://jobguidematch.com/?utm_source=facebook&utm_campaign=120214567890123'
  });

  assert.deepEqual(actual.snapshots.map(snapshot => snapshot.utm_source), [
    'facebook',
    'facebook',
    'facebook',
    'facebook',
    'facebook',
    'facebook',
    'facebook',
    'facebook'
  ]);
  assert.deepEqual(actual.snapshots.map(snapshot => snapshot.utm_campaign), [
    '120214567890123',
    '120214567890123',
    '120214567890123',
    '120214567890123',
    '120214567890123',
    '120214567890123',
    '120214567890123',
    '120214567890123'
  ]);
  assert.equal(Object.prototype.hasOwnProperty.call(actual.snapshots.at(-1), 'price_rule'), false);
});

test('native and anchor use explicit fast display ladders while rewarded and interstitial stay isolated', () => {
  const site = configureSites.sites.find(item => item.siteKey === JOBGUIDEMATCH_REWARDED_V5.siteKey);
  const expectedDisplayRounds = [
    [3, 1],
    [5, 3, 1],
    [8, 5, 3, 1],
    [15, 8, 5, 3, 1]
  ];

  assert.deepEqual(configureSites.waterfallFor(site, 'rewarded'), rewardedV5Prices());
  assert.equal(configureSites.variantFloorFor(site, 'rewarded'), 300);
  assert.equal(configureSites.retryTimeoutMsFor(site, { type: 'rewarded' }), JOBGUIDEMATCH_REWARDED_V5.attemptTimeoutMs);

  assert.deepEqual(configureSites.waterfallFor(site, 'native'), displayFastLoadInitialPrices());
  assert.equal(configureSites.variantFloorFor(site, 'native'), 3);
  assert.equal(configureSites.retryLimitFor(site, { type: 'native' }), displayFastLoadInitialPrices().length);
  assert.equal(JOBGUIDEMATCH_DISPLAY_FAST_LOAD.retryTimeoutMs, 0);
  assert.equal(configureSites.retryTimeoutMsFor(site, { type: 'native' }), JOBGUIDEMATCH_DISPLAY_FAST_LOAD.retryTimeoutMs);
  assert.equal(configureSites.refreshEnabledFor(site, { type: 'native' }), 1);
  assert.equal(configureSites.refreshDelayMsFor(site, { type: 'native' }), JOBGUIDEMATCH_DISPLAY_FAST_LOAD.refreshDelayMs);
  assert.equal(configureSites.maximumRefreshesFor(site, { type: 'native' }), JOBGUIDEMATCH_DISPLAY_FAST_LOAD.maximumRefreshes);
  assert.deepEqual(configureSites.refreshLaddersFor(site, 'native'), displayFastLoadRefreshLadders());
  assert.deepEqual(displayFastLoadRoundLadders(), expectedDisplayRounds);
  assert.deepEqual(configureSites.experimentFor(site, 'native'), {
    experimentKey: 'ads_exp_v6',
    variantPercentage: 0.8
  });
  assert.equal(configureSites.refreshRoundTargetingKeyFor(site, 'native'), 'refresh_round');
  assert.equal(configureSites.visibilityFirstFor(site, { type: 'native' }), true);
  assert.equal(configureSites.lazyLoadMarginPxFor(site, { type: 'native' }), JOBGUIDEMATCH_DISPLAY_FAST_LOAD.lazyLoadMarginPx);

  assert.deepEqual(configureSites.waterfallFor(site, 'anchor'), displayFastLoadInitialPrices());
  assert.equal(configureSites.variantFloorFor(site, 'anchor'), 3);
  assert.equal(configureSites.retryLimitFor(site, { type: 'anchor' }), displayFastLoadInitialPrices().length);
  assert.equal(configureSites.retryTimeoutMsFor(site, { type: 'anchor' }), JOBGUIDEMATCH_DISPLAY_FAST_LOAD.retryTimeoutMs);
  assert.equal(configureSites.refreshEnabledFor(site, { type: 'anchor' }), 1);
  assert.equal(configureSites.refreshDelayMsFor(site, { type: 'anchor' }), JOBGUIDEMATCH_DISPLAY_FAST_LOAD.refreshDelayMs);
  assert.equal(configureSites.maximumRefreshesFor(site, { type: 'anchor' }), JOBGUIDEMATCH_DISPLAY_FAST_LOAD.maximumRefreshes);
  assert.deepEqual(configureSites.refreshLaddersFor(site, 'anchor'), displayFastLoadRefreshLadders());
  assert.deepEqual(configureSites.experimentFor(site, 'anchor'), {
    experimentKey: 'ads_exp_v6',
    variantPercentage: 0.8
  });
  assert.equal(configureSites.refreshRoundTargetingKeyFor(site, 'anchor'), 'refresh_round');
  assert.equal(configureSites.visibilityFirstFor(site, { type: 'anchor' }), false);
  assert.equal(configureSites.lazyLoadMarginPxFor(site, { type: 'anchor' }), null);

  assert.deepEqual(configureSites.waterfallFor(site, 'interstitial'), configureSites.defaultFloors);
  assert.equal(configureSites.variantFloorFor(site, 'interstitial'), 1.2);
  assert.equal(configureSites.retryTimeoutMsFor(site, { type: 'interstitial' }), 2500);
  assert.deepEqual(configureSites.refreshLaddersFor(site, 'interstitial'), []);
  assert.equal(configureSites.experimentFor(site, 'interstitial'), null);
  assert.equal(configureSites.refreshRoundTargetingKeyFor(site, 'interstitial'), null);
  assert.equal(configureSites.visibilityFirstFor(site, { type: 'interstitial' }), false);
});

test('native and anchor v6 ladders avoid removed fast-display starting prices', () => {
  const rounds = displayFastLoadRoundLadders();
  const forbidden = new Set([30, 20, 12, 2]);

  assert.deepEqual(rounds, [
    [3, 1],
    [5, 3, 1],
    [8, 5, 3, 1],
    [15, 8, 5, 3, 1]
  ]);
  assert.equal(rounds.flat().some(price => forbidden.has(price)), false);
  assert.equal(rounds[0][0], 3);
  assert.equal(rounds[1][0], 5);
  assert.equal(rounds[2][0], 8);
  assert.equal(rounds[3][0], 15);
});

test('other publisher site configurations do not inherit jobguidematch native and anchor v6', () => {
  const site = configureSites.sites.find(item => item.siteKey === 'quiz-rush.com');

  assert.deepEqual(configureSites.waterfallFor(site, 'native'), configureSites.defaultFloors);
  assert.deepEqual(configureSites.waterfallFor(site, 'anchor'), configureSites.defaultFloors);
  assert.equal(configureSites.experimentFor(site, 'native'), null);
  assert.equal(configureSites.experimentFor(site, 'anchor'), null);
  assert.equal(configureSites.refreshRoundTargetingKeyFor(site, 'native'), null);
  assert.equal(configureSites.refreshRoundTargetingKeyFor(site, 'anchor'), null);
});

test('ads_exp_v4 and ads_exp_v5 use isolated localStorage assignment namespaces', () => {
  const storage = createStorage({
    [assignmentKey(JOBGUIDEMATCH_REWARDED_V5.siteKey, 'ads_exp_v4')]: 'control'
  });
  const fake = createRewardedFakeGpt();
  const adapter = new PriceOptimiserRuntimeAdapter({
    windowRef: {
      googletag: fake.googletag,
      localStorage: storage,
      __publisherExperienceSlots: {}
    },
    documentRef: {},
    runtime: {
      siteKey: JOBGUIDEMATCH_REWARDED_V5.siteKey,
      experiment: {
        enabled: true,
        expKey: JOBGUIDEMATCH_REWARDED_V5.experimentKey,
        key: JOBGUIDEMATCH_REWARDED_V5.experimentKey,
        variantPercentage: JOBGUIDEMATCH_REWARDED_V5.variantPercentage
      },
      slots: {}
    },
    random: () => 0,
    logger: { debug() {}, warn() {} }
  });

  assert.equal(adapter.experiment.expGroup, 'variant');
  assert.deepEqual(storage.snapshot(), {
    [assignmentKey(JOBGUIDEMATCH_REWARDED_V5.siteKey, 'ads_exp_v4')]: 'control',
    [assignmentKey(JOBGUIDEMATCH_REWARDED_V5.siteKey, 'ads_exp_v5')]: 'variant'
  });
});


for (const preloaded of [false, true]) {
  for (const grant of [false, true]) {
    test(`rewarded ${preloaded ? 'preloaded' : 'fresh'} playback outlives loading timeout and closes ${grant ? 'granted' : 'declined'}`, async () => {
      const timers = installManualTimers();
      const fake = createRewardedFakeGpt({ silentRewardedRequests: true });
      try {
        const adapter = new PriceOptimiserRuntimeAdapter({
          windowRef: { googletag: fake.googletag, localStorage: createStorage(), sessionStorage: createStorage(), __publisherExperienceSlots: {} },
          documentRef: { querySelector() { return null; }, createElement() { return {}; }, head: { appendChild() {} } },
          runtime: rewardedRuntime('variant'),
          logger: { debug() {}, warn() {} }
        });
        const events = [];
        const lifecycle = {
          ready() { events.push('ready'); },
          granted() { events.push('granted'); },
          videoCompleted() { events.push('completed'); },
          closed() { events.push('closed'); }
        };
        let settled = false;
        let shown = 0;
        let request;
        const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
        if (preloaded) {
          const preload = adapter.preloadRewarded('rewarded');
          await flush();
          fake.emit('rewardedSlotReady', { slot: fake.slots[0], makeRewardedVisible() { shown++; return true; } });
          assert.equal((await preload).status, 'ready');
          request = adapter.requestRewarded('rewarded', lifecycle);
        } else {
          request = adapter.requestRewarded('rewarded', lifecycle);
          await flush();
          fake.emit('rewardedSlotReady', { slot: fake.slots[0], makeRewardedVisible() { shown++; return true; } });
        }
        request.then(() => { settled = true; });
        await flush();
        assert.equal(shown, 1);
        assert.equal(timers.runNext(15000), false, 'loading deadline must be cancelled during playback');
        await flush();
        assert.equal(settled, false);
        assert.equal(adapter.fullscreenOverlayDepth, 1);
        for (const name of ['rewardedSlotGranted', 'rewardedSlotClosed', 'rewardedSlotVideoCompleted']) {
          assert.equal(fake.listeners.get(name).size, 1, `${name} stays attached during playback`);
        }
        const slot = fake.slots[0];
        const payload = { amount: 1, type: 'access' };
        if (grant) {
          fake.emit('rewardedSlotGranted', { slot, payload });
          await flush();
          assert.equal(settled, false, 'grant must still wait for close');
          assert.equal(fake.listeners.get('rewardedSlotClosed').size, 1);
          assert.equal(adapter.fullscreenOverlayDepth, 1);
        }
        fake.emit('rewardedSlotVideoCompleted', { slot });
        fake.emit('rewardedSlotClosed', { slot });
        const result = await request;
        assert.equal(result.status, grant ? 'granted' : 'declined');
        if (grant) assert.deepEqual(result.reward, payload);
        assert.deepEqual(events, grant ? ['ready', 'granted', 'completed', 'closed'] : ['ready', 'completed', 'closed']);
        assert.equal(adapter.fullscreenOverlayDepth, 0);
        for (const listeners of fake.listeners.values()) assert.equal(listeners.size, 0);
      } finally {
        timers.restore();
      }
    });
  }

  test(`rewarded ${preloaded ? 'preload' : 'fresh request'} still times out before readiness`, async () => {
    const timers = installManualTimers();
    const fake = createRewardedFakeGpt({ silentRewardedRequests: true });
    try {
      const adapter = new PriceOptimiserRuntimeAdapter({
        windowRef: { googletag: fake.googletag, localStorage: createStorage(), sessionStorage: createStorage(), __publisherExperienceSlots: {} },
        documentRef: { querySelector() { return null; }, createElement() { return {}; }, head: { appendChild() {} } },
        runtime: rewardedRuntime('variant'),
        logger: { debug() {}, warn() {} }
      });
      const request = preloaded ? adapter.preloadRewarded('rewarded') : adapter.requestRewarded('rewarded');
      for (let i = 0; i < 12; i++) await Promise.resolve();
      assert.equal(timers.runNext(15000), true);
      assert.equal((await request).status, 'timeout');
      for (const listeners of fake.listeners.values()) assert.equal(listeners.size, 0);
    } finally {
      timers.restore();
    }
  });
}
