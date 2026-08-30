import test from 'node:test';
import assert from 'node:assert/strict';
import { PriceOptimiserRuntimeAdapter } from '../src/core/price-optimiser-runtime.js';

function createFakeSlot({ path, sizes, divId, format }) {
  return {
    path,
    sizes,
    divId,
    format,
    targeting: {},
    addService() {
      return this;
    },
    clearTargeting() {
      this.targeting = {};
    },
    setConfig(config) {
      if (!config || !Object.prototype.hasOwnProperty.call(config, 'targeting')) return this;
      if (config.targeting == null) {
        this.targeting = {};
        return this;
      }
      for (const [key, value] of Object.entries(config.targeting)) {
        if (value == null) delete this.targeting[key];
        else this.targeting[key] = value;
      }
      return this;
    },
    setTargeting(key, value) {
      this.targeting[key] = value;
      return this;
    },
    getSlotElementId() {
      return this.divId;
    }
  };
}

function createFakeElement(id) {
  const classes = new Set();
  const element = {
    id,
    hidden: false,
    dataset: {},
    style: { display: '' },
    attributes: {},
    children: [],
    parentNode: null,
    offsetWidth: 728,
    offsetHeight: 90,
    classList: {
      add(...names) {
        for (const name of names) classes.add(name);
      },
      remove(...names) {
        for (const name of names) classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      }
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === 'hidden') this.hidden = true;
    },
    removeAttribute(name) {
      delete this.attributes[name];
      if (name === 'hidden') this.hidden = false;
    },
    getAttribute(name) {
      return this.attributes[name] || null;
    },
    appendChild(child) {
      if (!child) return child;
      if (child.parentNode && child.parentNode.removeChild) child.parentNode.removeChild(child);
      child.parentNode = this;
      this.children.push(child);
      this.firstChild = this.children[0] || null;
      return child;
    },
    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index !== -1) this.children.splice(index, 1);
      if (child) child.parentNode = null;
      this.firstChild = this.children[0] || null;
      return child;
    },
    getBoundingClientRect() {
      return {
        left: 0,
        top: 0,
        right: this.offsetWidth,
        bottom: this.offsetHeight,
        width: this.offsetWidth,
        height: this.offsetHeight
      };
    }
  };
  return element;
}

function createFakeGpt({ renderEmpty = false, interstitialEmpty = false } = {}) {
  const listeners = new Map();
  const slotsByDivId = new Map();
  let renderIndex = 0;
  const pageTargeting = {};
  const calls = {
    defineSlot: [],
    defineOutOfPageSlot: [],
    display: [],
    refresh: [],
    refreshTargeting: [],
    destroySlots: [],
    services: [],
    setConfig: [],
    pubadsSet: []
  };

  const emit = (name, event) => {
    for (const listener of listeners.get(name) || []) listener(event);
  };

  const requestSlot = slot => {
    calls.refreshTargeting.push({
      slot: Object.assign({}, slot.targeting),
      page: Object.assign({}, pageTargeting)
    });
    if (slot.format === 'INTERSTITIAL') {
      if (interstitialEmpty) {
        emit('slotRenderEnded', { slot, isEmpty: true });
        return;
      }
      emit('gameManualInterstitialSlotReady', {
        slot,
        makeGameManualInterstitialVisible() {}
      });
      emit('gameManualInterstitialSlotClosed', { slot });
      return;
    }
    if (slot.format === 'REWARDED') {
      emit('rewardedSlotReady', {
        slot,
        makeRewardedVisible() {}
      });
      emit('rewardedSlotGranted', { slot, payload: { type: 'publisher-owned' } });
      emit('rewardedSlotClosed', { slot });
      return;
    }
    const decision = Array.isArray(renderEmpty)
      ? renderEmpty[Math.min(renderIndex, renderEmpty.length - 1)]
      : (typeof renderEmpty === 'function' ? renderEmpty(slot, renderIndex) : renderEmpty);
    renderIndex += 1;
    if (decision === 'pending') return;
    const isEmpty = Boolean(decision);
    emit('slotRenderEnded', { slot, isEmpty });
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
      calls.refresh.push(slots);
      for (const slot of slots) requestSlot(slot);
    },
    collapseEmptyDivs() {
      calls.services.push('collapseEmptyDivs');
    },
    disableInitialLoad() {
      calls.services.push('disableInitialLoad');
    },
    enableSingleRequest() {
      calls.services.push('enableSingleRequest');
    },
    clearTargeting(key) {
      if (key == null) {
        for (const pageKey of Object.keys(pageTargeting)) delete pageTargeting[pageKey];
        return;
      }
      delete pageTargeting[key];
    },
    setTargeting(key, value) {
      pageTargeting[key] = value;
      return this;
    },
    set(key, value) {
      calls.pubadsSet.push([key, value]);
      calls.services.push(`pubads.set:${key}`);
      return this;
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
        BOTTOM_ANCHOR: 'BOTTOM_ANCHOR',
        INTERSTITIAL: 'INTERSTITIAL',
        REWARDED: 'REWARDED'
      }
    },
    pubads() {
      return pubads;
    },
    defineSlot(path, sizes, divId) {
      const slot = createFakeSlot({ path, sizes, divId });
      slotsByDivId.set(divId, slot);
      calls.defineSlot.push(slot);
      return slot;
    },
    defineOutOfPageSlot(path, format) {
      const slot = createFakeSlot({ path, format });
      calls.defineOutOfPageSlot.push(slot);
      return slot;
    },
    destroySlots(slots) {
      calls.destroySlots.push(slots);
      return true;
    },
    display(slotOrDivId) {
      calls.display.push(slotOrDivId);
      const slot = typeof slotOrDivId === 'string' ? slotsByDivId.get(slotOrDivId) : slotOrDivId;
      if (slot) requestSlot(slot);
    },
    setConfig(config) {
      calls.setConfig.push(config);
      calls.services.push('setConfig');
      if (!config || !Object.prototype.hasOwnProperty.call(config, 'targeting')) return;
      if (config.targeting == null) {
        for (const key of Object.keys(pageTargeting)) delete pageTargeting[key];
        return;
      }
      for (const [key, value] of Object.entries(config.targeting)) {
        if (value == null) delete pageTargeting[key];
        else pageTargeting[key] = value;
      }
    },
    enableServices() {
      calls.services.push('enableServices');
    }
  };

  return { googletag, calls };
}

function adapterFor(runtime, { href, renderEmpty, interstitialEmpty, innerWidth, elements = {} } = {}) {
  const fake = createFakeGpt({ renderEmpty, interstitialEmpty });
  const body = createFakeElement('body');
  const windowRef = {
    googletag: fake.googletag,
    __publisherExperienceSlots: {},
    location: href ? { href } : undefined,
    innerWidth,
    innerHeight: 900
  };
  const documentRef = {
    body,
    visibilityState: 'visible',
    getElementById(id) {
      return elements[id] || null;
    },
    querySelector() {
      return null;
    },
    createElement() {
      return createFakeElement('');
    },
    head: {
      appendChild() {}
    },
    documentElement: {
      clientWidth: innerWidth,
      clientHeight: 900
    }
  };
  const adapter = new PriceOptimiserRuntimeAdapter({
    windowRef,
    documentRef,
    runtime,
    logger: { debug() {}, warn() {} }
  });
  return { adapter, fake };
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
    runNext(delay) {
      const timer = timers.find(item => !item.cleared && item.delay === delay);
      if (!timer) return false;
      timer.cleared = true;
      timer.run();
      return true;
    },
    pendingCount(delay) {
      return timers.filter(item => !item.cleared && item.delay === delay).length;
    },
    restore() {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  };
}

async function drainZeroDelayRequest(state, timers) {
  let guard = 0;
  while (state.requestPromise && timers.runNext(0) && guard < 50) {
    guard += 1;
    await Promise.resolve();
  }
  if (state.requestPromise) await state.requestPromise;
  await Promise.resolve();
}

async function runVisibleRefreshInterval(timers, ms = 30000) {
  let elapsed = 0;
  let guard = 0;
  while (elapsed < ms && guard < 200) {
    const delay = Math.min(250, ms - elapsed);
    assert.equal(timers.runNext(delay), true);
    elapsed += delay;
    guard += 1;
    await Promise.resolve();
  }
}

function priceAttemptsRenderEmpty(slot) {
  return Object.prototype.hasOwnProperty.call(slot.targeting || {}, 'price_rule');
}

const NATIVE_ANCHOR_V6_ROUND_LADDERS = [
  [3, 1],
  [5, 3, 1],
  [8, 5, 3, 1],
  [15, 8, 5, 3, 1]
];

const NATIVE_ANCHOR_V6_TARGETING_POLICY = {
  control: ['exp_group', 'exp_key', 'slot_name', 'refresh_round'],
  variant: ['exp_group', 'exp_key', 'slot_name', 'refresh_round', 'price_rule']
};

function nativeAnchorV6Config(adUnitType) {
  return {
    slotKey: adUnitType === 'anchor' ? 'anchor' : 'ad-leaderboard',
    adUnitName: `/23360556473/jobguidematch.com_${adUnitType === 'anchor' ? 'Anchor' : 'Native'}`,
    adUnitType,
    sizes: [[320, 50], [728, 90]],
    waterfall: NATIVE_ANCHOR_V6_ROUND_LADDERS[0],
    retryLimit: NATIVE_ANCHOR_V6_ROUND_LADDERS[0].length,
    retryDelayMs: 0,
    requestTimeoutMs: 1000,
    refreshEnabled: true,
    refreshDelayMs: 30000,
    maximumRefreshes: 4,
    refreshLadders: NATIVE_ANCHOR_V6_ROUND_LADDERS.slice(1),
    refreshRoundTargetingKey: 'refresh_round',
    targetingPolicy: NATIVE_ANCHOR_V6_TARGETING_POLICY,
    experiment: {
      expKey: 'ads_exp_v6',
      key: 'ads_exp_v6',
      variantPercentage: 0.8,
      control: { enabled: true },
      variant: {
        baseFloor: NATIVE_ANCHOR_V6_ROUND_LADDERS[0][0],
        ladder: NATIVE_ANCHOR_V6_ROUND_LADDERS[0],
        expKey: 'ads_exp_v6'
      }
    }
  };
}

function assertV6RoundSnapshots(snapshots, { adUnitType, round, ladder }) {
  const expectedRound = String(Math.min(round, 3));
  assert.deepEqual(snapshots, ladder.map(price => ({
    exp_group: 'variant',
    exp_key: 'ads_exp_v6',
    slot_name: adUnitType,
    refresh_round: expectedRound,
    price_rule: String(price)
  })).concat([{
    exp_group: 'variant',
    exp_key: 'ads_exp_v6',
    slot_name: adUnitType,
    refresh_round: expectedRound
  }]));
}

function assertDisplayStillFilled(state, element) {
  assert.equal(state.layoutState, 'filled');
  assert.equal(state.filled, true);
  assert.equal(state.stopped, true);
  assert.equal(element.hidden, false);
  assert.equal(element.style.display, '');
  assert.equal(element.dataset.poSlotState, 'filled');
  assert.equal(element.classList.contains('po-slot--empty'), false);
}

test('sets page_url before enabling GPT services', async () => {
  const href = 'https://quiz-rush.com/quiz/1960s-tv/?utm_source=test';
  const { adapter, fake } = adapterFor({ slots: {}, experiment: { enabled: false } }, { href });

  await adapter.definePlacement({
    slotKey: 'ad-leaderboard',
    elementId: 'ad-leaderboard',
    config: {
      slotKey: 'ad-leaderboard',
      adUnitName: '/23360556473/quiz-rush.com_ad-leaderboard',
      adUnitType: 'native',
      sizes: 'fluid',
      retryLimit: 1
    }
  });

  assert.equal(fake.calls.setConfig.length, 1);
  assert.deepEqual(fake.calls.setConfig[0].adsenseAttributes, { page_url: href });
  assert.equal(Object.prototype.hasOwnProperty.call(fake.calls.setConfig[0], 'disableInitialLoad'), false);
  assert.equal(fake.calls.setConfig[0].singleRequest, false);
  assert.equal(fake.calls.setConfig[0].collapseDiv, 'DISABLED');
  assert.deepEqual(fake.calls.pubadsSet, [['page_url', href]]);
  assert.ok(fake.calls.services.indexOf('setConfig') > -1);
  assert.ok(fake.calls.services.indexOf('setConfig') < fake.calls.services.indexOf('enableServices'));
  assert.ok(fake.calls.services.indexOf('pubads.set:page_url') < fake.calls.services.indexOf('enableServices'));
  assert.deepEqual(fake.calls.display, ['ad-leaderboard']);
  assert.equal(fake.calls.refresh.length, 0);
});

test('native v6 display refresh uses progressive ladders with stable refresh_round per opportunity', async () => {
  const timers = installManualTimers();
  try {
    const element = createFakeElement('ad-leaderboard');
    const { adapter, fake } = adapterFor({
      exp_group: 'variant',
      siteKey: 'jobguidematch.com',
      experiment: { enabled: true, expKey: 'ads_exp_v5' },
      slots: {}
    }, { renderEmpty: priceAttemptsRenderEmpty, elements: { 'ad-leaderboard': element } });

    const state = await adapter.definePlacement({
      slotKey: 'ad-leaderboard',
      elementId: 'ad-leaderboard',
      config: nativeAnchorV6Config('native')
    });

    await drainZeroDelayRequest(state, timers);
    assertV6RoundSnapshots(fake.calls.refreshTargeting.map(item => item.slot), {
      adUnitType: 'native',
      round: 0,
      ladder: NATIVE_ANCHOR_V6_ROUND_LADDERS[0]
    });

    for (let round = 1; round <= 4; round += 1) {
      await runVisibleRefreshInterval(timers);
      await drainZeroDelayRequest(state, timers);
      const ladder = NATIVE_ANCHOR_V6_ROUND_LADDERS[Math.min(round, 3)];
      assertV6RoundSnapshots(fake.calls.refreshTargeting.slice(-ladder.length - 1).map(item => item.slot), {
        adUnitType: 'native',
        round,
        ladder
      });
    }

    assert.equal(timers.pendingCount(30000), 0);
  } finally {
    timers.restore();
  }
});

test('anchor v6 display refresh uses the same progressive ladders and round targeting', async () => {
  const timers = installManualTimers();
  try {
    const element = createFakeElement('ad-anchor');
    const { adapter, fake } = adapterFor({
      exp_group: 'variant',
      siteKey: 'jobguidematch.com',
      experiment: { enabled: true, expKey: 'ads_exp_v5' },
      slots: {}
    }, { renderEmpty: priceAttemptsRenderEmpty, elements: { 'ad-anchor': element } });

    const state = await adapter.definePlacement({
      slotKey: 'anchor',
      elementId: 'ad-anchor',
      config: nativeAnchorV6Config('anchor')
    });

    await drainZeroDelayRequest(state, timers);
    assertV6RoundSnapshots(fake.calls.refreshTargeting.map(item => item.slot), {
      adUnitType: 'anchor',
      round: 0,
      ladder: NATIVE_ANCHOR_V6_ROUND_LADDERS[0]
    });

    for (let round = 1; round <= 4; round += 1) {
      await runVisibleRefreshInterval(timers);
      await drainZeroDelayRequest(state, timers);
      const ladder = NATIVE_ANCHOR_V6_ROUND_LADDERS[Math.min(round, 3)];
      assertV6RoundSnapshots(fake.calls.refreshTargeting.slice(-ladder.length - 1).map(item => item.slot), {
        adUnitType: 'anchor',
        round,
        ladder
      });
    }

    assert.equal(timers.pendingCount(30000), 0);
  } finally {
    timers.restore();
  }
});

test('native and anchor v6 control requests carry refresh_round without price_rule', async () => {
  for (const adUnitType of ['native', 'anchor']) {
    const timers = installManualTimers();
    try {
      const elementId = adUnitType === 'anchor' ? 'ad-anchor' : 'ad-leaderboard';
      const element = createFakeElement(elementId);
      const { adapter, fake } = adapterFor({
        exp_group: 'control',
        siteKey: 'jobguidematch.com',
        experiment: { enabled: true, expKey: 'ads_exp_v5' },
        slots: {}
      }, { renderEmpty: false, elements: { [elementId]: element } });

      const state = await adapter.definePlacement({
        slotKey: adUnitType === 'anchor' ? 'anchor' : 'ad-leaderboard',
        elementId,
        config: nativeAnchorV6Config(adUnitType)
      });

      await drainZeroDelayRequest(state, timers);
      assert.deepEqual(fake.calls.refreshTargeting.map(item => item.slot), [{
        exp_group: 'control',
        exp_key: 'ads_exp_v6',
        slot_name: adUnitType,
        refresh_round: '0'
      }]);
      assert.equal(Object.prototype.hasOwnProperty.call(fake.calls.refreshTargeting[0].slot, 'price_rule'), false);

      await runVisibleRefreshInterval(timers);
      await drainZeroDelayRequest(state, timers);
      assert.deepEqual(fake.calls.refreshTargeting.slice(-1).map(item => item.slot), [{
        exp_group: 'control',
        exp_key: 'ads_exp_v6',
        slot_name: adUnitType,
        refresh_round: '1'
      }]);
      assert.equal(Object.prototype.hasOwnProperty.call(fake.calls.refreshTargeting.at(-1).slot, 'price_rule'), false);
    } finally {
      timers.restore();
    }
  }
});

test('native refresh pending request stays on the publisher slot owner', async () => {
  const timers = installManualTimers();
  try {
    const element = createFakeElement('ad-leaderboard');
    const renderEmpty = (slot, index) => index === 0 ? false : 'pending';
    const { adapter, fake } = adapterFor({
      exp_group: 'variant',
      siteKey: 'jobguidematch.com',
      experiment: { enabled: true, expKey: 'ads_exp_v5' },
      slots: {}
    }, { renderEmpty, elements: { 'ad-leaderboard': element } });

    const state = await adapter.definePlacement({
      slotKey: 'ad-leaderboard',
      elementId: 'ad-leaderboard',
      config: nativeAnchorV6Config('native')
    });
    if (state.requestPromise) await state.requestPromise;
    const activeSlot = state.slot;

    await runVisibleRefreshInterval(timers);
    await Promise.resolve();

    assert.equal(fake.calls.defineSlot.length, 1);
    assert.equal(state.slot, activeSlot);
    assert.equal(state.requestPromise != null, true);
    assert.equal(state.layoutState, 'requesting');
    assert.equal(element.hidden, false);
    assert.equal(fake.calls.destroySlots.length, 0);
    assert.deepEqual(fake.calls.refreshTargeting.at(-1).slot, {
      exp_group: 'variant',
      exp_key: 'ads_exp_v6',
      slot_name: 'native',
      refresh_round: '1',
      price_rule: '5'
    });

    assert.equal(timers.runNext(1000), true);
    if (state.requestPromise) await state.requestPromise;
  } finally {
    timers.restore();
  }
});

test('native variant round1 waterfall executes on the original publisher slot', async () => {
  const timers = installManualTimers();
  try {
    const element = createFakeElement('ad-leaderboard');
    const { adapter, fake } = adapterFor({
      exp_group: 'variant',
      siteKey: 'jobguidematch.com',
      experiment: { enabled: true, expKey: 'ads_exp_v5' },
      slots: {}
    }, { renderEmpty: (slot, index) => index === 0 ? false : true, elements: { 'ad-leaderboard': element } });

    const state = await adapter.definePlacement({
      slotKey: 'ad-leaderboard',
      elementId: 'ad-leaderboard',
      config: nativeAnchorV6Config('native')
    });
    if (state.requestPromise) await state.requestPromise;
    const activeSlot = state.slot;
    const initialOpportunityId = state.opportunity.opportunityId;

    await runVisibleRefreshInterval(timers);
    await drainZeroDelayRequest(state, timers);

    assert.equal(fake.calls.defineSlot.length, 1);
    assert.equal(fake.calls.defineSlot[0], activeSlot);
    assert.deepEqual(fake.calls.display, ['ad-leaderboard']);
    assert.deepEqual(fake.calls.refresh.slice(-4).map(batch => batch[0]), [activeSlot, activeSlot, activeSlot, activeSlot]);
    assertV6RoundSnapshots(fake.calls.refreshTargeting.slice(-4).map(item => item.slot), {
      adUnitType: 'native',
      round: 1,
      ladder: NATIVE_ANCHOR_V6_ROUND_LADDERS[1]
    });
    assert.equal(state.slot, activeSlot);
    assert.equal(state.activeRefreshRound, 1);
    assert.equal(state.completedRefreshes, 1);
    assert.equal(state.displayRefreshIndex, 1);
    assert.equal(state.layoutState, 'empty');
    assert.equal(state.filled, false);
    assert.notEqual(state.opportunity.opportunityId, initialOpportunityId);
    assert.equal(state.opportunity.requestCount, 4);
    assert.equal(state.opportunity.completionReason, 'unavailable');
    assert.equal(fake.calls.destroySlots.length, 0);
  } finally {
    timers.restore();
  }
});

test('anchor variant round1 waterfall executes on the original publisher slot', async () => {
  const timers = installManualTimers();
  try {
    const element = createFakeElement('ad-anchor');
    const { adapter, fake } = adapterFor({
      exp_group: 'variant',
      siteKey: 'jobguidematch.com',
      experiment: { enabled: true, expKey: 'ads_exp_v5' },
      slots: {}
    }, { renderEmpty: (slot, index) => index === 0 ? false : true, elements: { 'ad-anchor': element } });

    const state = await adapter.definePlacement({
      slotKey: 'anchor',
      elementId: 'ad-anchor',
      config: nativeAnchorV6Config('anchor')
    });
    if (state.requestPromise) await state.requestPromise;
    const activeSlot = state.slot;
    const initialOpportunityId = state.opportunity.opportunityId;

    await runVisibleRefreshInterval(timers);
    await drainZeroDelayRequest(state, timers);

    assert.equal(fake.calls.defineSlot.length, 1);
    assert.equal(fake.calls.defineSlot[0], activeSlot);
    assert.deepEqual(fake.calls.display, ['ad-anchor']);
    assert.deepEqual(fake.calls.refresh.slice(-4).map(batch => batch[0]), [activeSlot, activeSlot, activeSlot, activeSlot]);
    assertV6RoundSnapshots(fake.calls.refreshTargeting.slice(-4).map(item => item.slot), {
      adUnitType: 'anchor',
      round: 1,
      ladder: NATIVE_ANCHOR_V6_ROUND_LADDERS[1]
    });
    assert.equal(state.slot, activeSlot);
    assert.equal(state.activeRefreshRound, 1);
    assert.equal(state.completedRefreshes, 1);
    assert.equal(state.displayRefreshIndex, 1);
    assert.equal(state.layoutState, 'empty');
    assert.equal(state.filled, false);
    assert.notEqual(state.opportunity.opportunityId, initialOpportunityId);
    assert.equal(state.opportunity.requestCount, 4);
    assert.equal(state.opportunity.completionReason, 'unavailable');
    assert.equal(fake.calls.destroySlots.length, 0);
  } finally {
    timers.restore();
  }
});

test('failed native refresh ladder and fallback do not create a hidden owner', async () => {
  const timers = installManualTimers();
  try {
    const element = createFakeElement('ad-leaderboard');
    const { adapter, fake } = adapterFor({
      exp_group: 'variant',
      siteKey: 'jobguidematch.com',
      experiment: { enabled: true, expKey: 'ads_exp_v5' },
      slots: {}
    }, { renderEmpty: (slot, index) => index === 0 ? false : true, elements: { 'ad-leaderboard': element } });

    const state = await adapter.definePlacement({
      slotKey: 'ad-leaderboard',
      elementId: 'ad-leaderboard',
      config: nativeAnchorV6Config('native')
    });
    if (state.requestPromise) await state.requestPromise;
    const activeSlot = state.slot;

    await runVisibleRefreshInterval(timers);
    await drainZeroDelayRequest(state, timers);

    assert.equal(state.slot, activeSlot);
    assert.equal(Object.prototype.hasOwnProperty.call(state, 'pendingDisplayPreload'), false);
    assert.equal(state.activeRefreshRound, 1);
    assert.equal(state.completedRefreshes, 1);
    assert.equal(state.displayRefreshIndex, 1);
    assert.equal(state.layoutState, 'empty');
    assert.equal(state.filled, false);
    assert.equal(fake.calls.defineSlot.length, 1);
    assert.equal(fake.calls.destroySlots.flat().includes(activeSlot), false);
    assertV6RoundSnapshots(fake.calls.refreshTargeting.slice(1).map(item => item.slot), {
      adUnitType: 'native',
      round: 1,
      ladder: NATIVE_ANCHOR_V6_ROUND_LADDERS[1]
    });

    const explicitRefresh = adapter.requestDisplaySlot(state);
    await drainZeroDelayRequest(state, timers);
    await explicitRefresh;
    assert.equal(fake.calls.defineSlot.length, 1);
    assert.equal(state.activeRefreshRound, 2);
    assert.equal(fake.calls.refreshTargeting.at(-1).slot.refresh_round, '2');
  } finally {
    timers.restore();
  }
});

test('successful native refresh keeps the same slot and commits the refresh round', async () => {
  const timers = installManualTimers();
  try {
    const element = createFakeElement('ad-leaderboard');
    const { adapter, fake } = adapterFor({
      exp_group: 'variant',
      siteKey: 'jobguidematch.com',
      experiment: { enabled: true, expKey: 'ads_exp_v5' },
      slots: {}
    }, {
      renderEmpty: (slot, index) => index === 0 ? false : index === 1,
      elements: { 'ad-leaderboard': element }
    });

    const state = await adapter.definePlacement({
      slotKey: 'ad-leaderboard',
      elementId: 'ad-leaderboard',
      config: nativeAnchorV6Config('native')
    });
    if (state.requestPromise) await state.requestPromise;
    const oldSlot = state.slot;

    await runVisibleRefreshInterval(timers);
    assert.equal(state.slot, oldSlot);
    assert.equal(fake.calls.defineSlot.length, 1);
    assert.equal(state.layoutState, 'requesting');
    assert.equal(element.hidden, false);

    assert.equal(timers.runNext(0), true);
    if (state.requestPromise) await state.requestPromise;

    assert.equal(state.slot, oldSlot);
    assert.equal(state.activeRefreshRound, 1);
    assert.equal(state.completedRefreshes, 1);
    assert.equal(state.displayRefreshIndex, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(state, 'pendingDisplayPreload'), false);
    assertDisplayStillFilled(state, element);
    assert.equal(fake.calls.destroySlots.flat().includes(oldSlot), false);
    assert.deepEqual(fake.calls.refreshTargeting.slice(-2).map(item => item.slot), [
      {
        exp_group: 'variant',
        exp_key: 'ads_exp_v6',
        slot_name: 'native',
        refresh_round: '1',
        price_rule: '5'
      },
      {
        exp_group: 'variant',
        exp_key: 'ads_exp_v6',
        slot_name: 'native',
        refresh_round: '1',
        price_rule: '3'
      }
    ]);
  } finally {
    timers.restore();
  }
});

test('anchor refresh uses the same single-slot lifecycle as native', async () => {
  const timers = installManualTimers();
  try {
    const element = createFakeElement('ad-anchor');
    const { adapter, fake } = adapterFor({
      exp_group: 'variant',
      siteKey: 'jobguidematch.com',
      experiment: { enabled: true, expKey: 'ads_exp_v5' },
      slots: {}
    }, { renderEmpty: false, elements: { 'ad-anchor': element } });

    const state = await adapter.definePlacement({
      slotKey: 'anchor',
      elementId: 'ad-anchor',
      config: nativeAnchorV6Config('anchor')
    });
    if (state.requestPromise) await state.requestPromise;
    const oldSlot = state.slot;

    await runVisibleRefreshInterval(timers);
    if (state.requestPromise) await state.requestPromise;

    assert.equal(state.slot, oldSlot);
    assert.equal(state.activeRefreshRound, 1);
    assert.equal(fake.calls.defineSlot.length, 1);
    assert.equal(fake.calls.destroySlots.flat().includes(oldSlot), false);
    assertDisplayStillFilled(state, element);
    assert.deepEqual(fake.calls.refreshTargeting.at(-1).slot, {
      exp_group: 'variant',
      exp_key: 'ads_exp_v6',
      slot_name: 'anchor',
      refresh_round: '1',
      price_rule: '5'
    });
  } finally {
    timers.restore();
  }
});

test('control refresh uses one publisher slot and clears price_rule on no fill', async () => {
  const timers = installManualTimers();
  try {
    const element = createFakeElement('ad-leaderboard');
    const { adapter, fake } = adapterFor({
      exp_group: 'control',
      siteKey: 'jobguidematch.com',
      experiment: { enabled: true, expKey: 'ads_exp_v5' },
      slots: {}
    }, { renderEmpty: (slot, index) => index === 0 ? false : true, elements: { 'ad-leaderboard': element } });

    const state = await adapter.definePlacement({
      slotKey: 'ad-leaderboard',
      elementId: 'ad-leaderboard',
      config: nativeAnchorV6Config('native')
    });
    if (state.requestPromise) await state.requestPromise;
    const activeSlot = state.slot;

    await runVisibleRefreshInterval(timers);
    await drainZeroDelayRequest(state, timers);

    assert.equal(state.slot, activeSlot);
    assert.equal(state.activeRefreshRound, 1);
    assert.equal(state.layoutState, 'empty');
    assert.equal(state.filled, false);
    assert.equal(fake.calls.defineSlot.length, 1);
    assert.equal(fake.calls.destroySlots.flat().includes(activeSlot), false);
    assert.deepEqual(fake.calls.refreshTargeting.slice(-1).map(item => item.slot), [{
      exp_group: 'control',
      exp_key: 'ads_exp_v6',
      slot_name: 'native',
      refresh_round: '1'
    }]);
  } finally {
    timers.restore();
  }
});

test('initial native preload prepares state and waits for direct reveal request', async () => {
  const timers = installManualTimers();
  try {
    const element = createFakeElement('ad-leaderboard');
    element.style.display = 'none';
    element.offsetWidth = 0;
    element.offsetHeight = 0;
    const { adapter, fake } = adapterFor({
      exp_group: 'variant',
      siteKey: 'jobguidematch.com',
      experiment: { enabled: true, expKey: 'ads_exp_v5' },
      slots: {}
    }, { renderEmpty: false, elements: { 'ad-leaderboard': element } });

    const preload = await adapter.preloadDisplaySlot({
      slotKey: 'ad-leaderboard',
      elementId: 'ad-leaderboard',
      config: nativeAnchorV6Config('native')
    });
    const state = preload.state;
    const preparedOpportunityId = state.opportunity && state.opportunity.opportunityId;

    assert.equal(preload.status, 'prepared');
    assert.equal(state.initialPreloadPrepared, true);
    assert.equal(state.slot, null);
    assert.equal(state.opportunity.state, 'PREPARED');
    assert.equal(state.opportunity.preloadMode, 'preparation');
    assert.equal(state.opportunity.requestCount, 0);
    assert.equal(Object.prototype.hasOwnProperty.call(state, 'pendingDisplayPreload'), false);
    assert.equal(fake.calls.defineSlot.length, 0);
    assert.deepEqual(fake.calls.display, []);
    assert.deepEqual(fake.calls.refreshTargeting, []);
    assert.equal(element.children.length, 0);
    assert.deepEqual(state.sequence, [3, 1]);
    assert.equal(state.maxAttempts, 3);
    assert.equal(state.refreshTimer, null);
    assert.equal(timers.pendingCount(250), 0);

    element.style.display = '';
    element.offsetWidth = 728;
    element.offsetHeight = 90;
    const reveal = await adapter.revealDisplayState(state);

    assert.equal(reveal.status, 'filled');
    assert.equal(fake.calls.defineSlot.length, 1);
    assert.equal(fake.calls.defineSlot[0].divId, 'ad-leaderboard');
    assert.equal(state.opportunity.opportunityId, preparedOpportunityId);
    assert.equal(state.opportunity.requestCount, 1);
    assert.equal(state.opportunity.preloadMode, 'preparation');
    assert.equal(state.opportunity.completionReason, 'filled');
    assert.deepEqual(fake.calls.display, ['ad-leaderboard']);
    assert.deepEqual(fake.calls.refreshTargeting.map(item => item.slot), [{
      exp_group: 'variant',
      exp_key: 'ads_exp_v6',
      slot_name: 'native',
      refresh_round: '0',
      price_rule: '3'
    }]);
    assert.equal(state.slot, fake.calls.defineSlot[0]);
    assert.equal(state.activeRefreshRound, 0);
    assert.equal(state.completedRefreshes, 0);
    assert.equal(state.displayRefreshIndex, 0);
    assert.equal(state.hasFilledOnce, true);
    assert.equal(state.refreshVisibleMs, 0);
    assert.equal(state.refreshTimer != null, true);

    await runVisibleRefreshInterval(timers, 15000);
    assert.equal(fake.calls.defineSlot.length, 1);
    assert.equal(state.refreshVisibleMs, 15000);

    await runVisibleRefreshInterval(timers, 15000);
    if (state.requestPromise) await state.requestPromise;

    assert.equal(fake.calls.defineSlot.length, 1);
    assert.equal(fake.calls.defineSlot[0].divId, 'ad-leaderboard');
    assert.equal(state.activeRefreshRound, 1);
    assert.equal(state.refreshVisibleMs, 0);
    assert.deepEqual(fake.calls.refreshTargeting.at(-1).slot, {
      exp_group: 'variant',
      exp_key: 'ads_exp_v6',
      slot_name: 'native',
      refresh_round: '1',
      price_rule: '5'
    });
  } finally {
    timers.restore();
  }
});

test('prepared initial preload does not auto-request when parent becomes visible before reveal', async () => {
  const timers = installManualTimers();
  try {
    const article = createFakeElement('article');
    article.style.display = 'none';
    const element = createFakeElement('ad-leaderboard');
    article.appendChild(element);
    const { adapter, fake } = adapterFor({
      exp_group: 'variant',
      siteKey: 'jobguidematch.com',
      experiment: { enabled: true, expKey: 'ads_exp_v5' },
      slots: {}
    }, { renderEmpty: false, elements: { 'ad-leaderboard': element } });

    const preload = await adapter.preloadDisplaySlot({
      slotKey: 'ad-leaderboard',
      elementId: 'ad-leaderboard',
      config: nativeAnchorV6Config('native')
    });
    const state = preload.state;
    const preparedOpportunityId = state.opportunity && state.opportunity.opportunityId;

    assert.equal(preload.status, 'prepared');
    assert.equal(state.opportunity.state, 'PREPARED');
    assert.equal(state.opportunity.requestCount, 0);
    assert.equal(Object.prototype.hasOwnProperty.call(state, 'pendingDisplayPreload'), false);
    assert.equal(element.children.length, 0);
    assert.equal(fake.calls.defineSlot.length, 0);
    assert.deepEqual(fake.calls.display, []);

    article.style.display = '';
    const observedState = await adapter.definePlacement({
      slotKey: 'ad-leaderboard',
      elementId: 'ad-leaderboard',
      config: nativeAnchorV6Config('native')
    });

    assert.equal(observedState, state);
    assert.equal(fake.calls.defineSlot.length, 0);
    assert.deepEqual(fake.calls.display, []);
    assert.equal(state.slot, null);
    assert.equal(state.requestStarted, false);

    const reveal = await adapter.revealDisplayState(state);

    assert.equal(reveal.status, 'filled');
    assert.equal(fake.calls.defineSlot.length, 1);
    assert.equal(fake.calls.defineSlot[0].divId, 'ad-leaderboard');
    assert.equal(state.opportunity.opportunityId, preparedOpportunityId);
    assert.equal(state.opportunity.requestCount, 1);
    assert.deepEqual(fake.calls.display, ['ad-leaderboard']);
    assert.equal(state.activeRefreshRound, 0);
    assert.equal(state.refreshVisibleMs, 0);
  } finally {
    timers.restore();
  }
});

test('variant reveal after prepared initial preload executes round0 in the real publisher div', async () => {
  const timers = installManualTimers();
  try {
    const element = createFakeElement('ad-leaderboard');
    element.style.display = 'none';
    element.offsetWidth = 0;
    element.offsetHeight = 0;
    const { adapter, fake } = adapterFor({
      exp_group: 'variant',
      siteKey: 'jobguidematch.com',
      experiment: { enabled: true, expKey: 'ads_exp_v5' },
      slots: {}
    }, { renderEmpty: (slot, index) => index < 2, elements: { 'ad-leaderboard': element } });

    const preload = await adapter.preloadDisplaySlot({
      slotKey: 'ad-leaderboard',
      elementId: 'ad-leaderboard',
      config: nativeAnchorV6Config('native')
    });
    const state = preload.state;

    assert.equal(preload.status, 'prepared');
    assert.equal(Object.prototype.hasOwnProperty.call(state, 'pendingDisplayPreload'), false);
    assert.equal(state.filled, false);
    assert.equal(state.displayed, false);
    assert.equal(fake.calls.defineSlot.length, 0);
    assert.equal(element.children.length, 0);
    assert.equal(state.activeRefreshRound, 0);
    assert.equal(state.completedRefreshes, 0);
    assert.equal(state.displayRefreshIndex, 0);
    assert.equal(state.refreshTimer, null);

    element.style.display = '';
    element.offsetWidth = 728;
    element.offsetHeight = 90;
    const revealPromise = adapter.revealDisplayState(state);
    await drainZeroDelayRequest(state, timers);
    const reveal = await revealPromise;

    assert.equal(reveal.status, 'filled');
    assert.equal(fake.calls.defineSlot.length, 1);
    assert.equal(fake.calls.defineSlot[0].divId, 'ad-leaderboard');
    assert.deepEqual(fake.calls.display, ['ad-leaderboard']);
    assert.equal(fake.calls.defineSlot.some(slot => slot.divId.startsWith('poexp-preload-')), false);
    assert.equal(state.filled, true);
    assert.equal(state.displayed, true);
    assert.equal(state.activeRefreshRound, 0);
    assert.equal(state.completedRefreshes, 0);
    assert.equal(state.displayRefreshIndex, 0);
    assertV6RoundSnapshots(fake.calls.refreshTargeting.map(item => item.slot), {
      adUnitType: 'native',
      round: 0,
      ladder: NATIVE_ANCHOR_V6_ROUND_LADDERS[0]
    });
    assert.equal(state.refreshTimer != null, true);
  } finally {
    timers.restore();
  }
});

test('control reveal after prepared initial preload sends one unpriced request to the real div', async () => {
  const timers = installManualTimers();
  try {
    const element = createFakeElement('ad-anchor');
    element.style.display = 'none';
    element.offsetWidth = 0;
    element.offsetHeight = 0;
    const { adapter, fake } = adapterFor({
      exp_group: 'control',
      siteKey: 'jobguidematch.com',
      experiment: { enabled: true, expKey: 'ads_exp_v5' },
      slots: {}
    }, { renderEmpty: false, innerWidth: 1024, elements: { 'ad-anchor': element } });

    const preload = await adapter.preloadDisplaySlot({
      slotKey: 'anchor',
      elementId: 'ad-anchor',
      config: nativeAnchorV6Config('anchor')
    });
    const state = preload.state;

    assert.equal(preload.status, 'prepared');
    assert.equal(fake.calls.defineSlot.length, 0);

    element.style.display = '';
    element.offsetWidth = 728;
    element.offsetHeight = 90;
    const reveal = await adapter.revealDisplayState(state);

    assert.equal(reveal.status, 'filled');
    assert.equal(fake.calls.defineSlot.length, 1);
    assert.equal(fake.calls.defineSlot[0].divId, 'ad-anchor');
    assert.deepEqual(fake.calls.refreshTargeting.map(item => item.slot), [{
      exp_group: 'control',
      exp_key: 'ads_exp_v6',
      slot_name: 'anchor',
      refresh_round: '0'
    }]);
    assert.equal(Object.prototype.hasOwnProperty.call(fake.calls.refreshTargeting[0].slot, 'price_rule'), false);
  } finally {
    timers.restore();
  }
});

test('initial no-fill recovery retries round0 when blank placement becomes visible again', async () => {
  const timers = installManualTimers();
  try {
    const reserve = createFakeElement('reserve');
    let top = 1800;
    reserve.offsetWidth = 336;
    reserve.offsetHeight = 280;
    reserve.getBoundingClientRect = () => ({
      left: 0,
      top,
      right: 336,
      bottom: top + 280,
      width: 336,
      height: 280
    });
    const element = createFakeElement('ad-incontent');
    element.style.display = 'none';
    element.offsetWidth = 0;
    element.offsetHeight = 0;
    element.getBoundingClientRect = () => ({
      left: 0,
      top,
      right: Number(element.offsetWidth) || 0,
      bottom: top + (Number(element.offsetHeight) || 0),
      width: Number(element.offsetWidth) || 0,
      height: Number(element.offsetHeight) || 0
    });
    reserve.appendChild(element);
    const { adapter, fake } = adapterFor({
      exp_group: 'variant',
      siteKey: 'jobguidematch.com',
      experiment: { enabled: true, expKey: 'ads_exp_v5' },
      slots: {}
    }, {
      renderEmpty: (slot, index) => index < 3,
      innerWidth: 1024,
      elements: { 'ad-incontent': element }
    });

    const preload = await adapter.preloadDisplaySlot({
      slotKey: 'native-incontent',
      elementId: 'ad-incontent',
      config: Object.assign(nativeAnchorV6Config('native'), {
        slotKey: 'native-incontent',
        sizes: [[300, 250], [336, 280]]
      })
    });
    const state = preload.state;
    assert.equal(preload.status, 'prepared');

    element.style.display = '';
    element.offsetWidth = 336;
    element.offsetHeight = 280;
    const revealPromise = adapter.revealDisplayState(state);
    await drainZeroDelayRequest(state, timers);
    const reveal = await revealPromise;

    assert.equal(reveal.status, 'unavailable');
    assert.equal(state.filled, false);
    assert.equal(state.hasFilledOnce, false);
    assert.equal(state.activeRefreshRound, 0);
    assert.equal(state.completedRefreshes, 0);
    assert.equal(state.displayRefreshIndex, 0);
    assert.equal(state.refreshTimer, null);
    assert.equal(state.initialNoFillRecoveryTimer != null, true);
    assertV6RoundSnapshots(fake.calls.refreshTargeting.map(item => item.slot), {
      adUnitType: 'native',
      round: 0,
      ladder: NATIVE_ANCHOR_V6_ROUND_LADDERS[0]
    });

    top = 0;
    assert.equal(timers.runNext(250), true);
    if (state.requestPromise) await state.requestPromise;

    assert.equal(state.filled, true);
    assert.equal(state.hasFilledOnce, true);
    assert.equal(state.activeRefreshRound, 0);
    assert.equal(state.completedRefreshes, 0);
    assert.equal(state.displayRefreshIndex, 0);
    assert.equal(state.refreshTimer != null, true);
    assert.deepEqual(fake.calls.refreshTargeting.at(-1).slot, {
      exp_group: 'variant',
      exp_key: 'ads_exp_v6',
      slot_name: 'native',
      refresh_round: '0',
      price_rule: '3'
    });
  } finally {
    timers.restore();
  }
});

test('display refresh visible-time timer pauses while out of viewport and resumes without resetting', async () => {
  const timers = installManualTimers();
  try {
    const element = createFakeElement('ad-leaderboard');
    let top = 0;
    element.getBoundingClientRect = () => ({
      left: 0,
      top,
      right: 728,
      bottom: top + 90,
      width: 728,
      height: 90
    });
    const { adapter, fake } = adapterFor({
      exp_group: 'variant',
      siteKey: 'jobguidematch.com',
      experiment: { enabled: true, expKey: 'ads_exp_v5' },
      slots: {}
    }, { renderEmpty: false, innerWidth: 1024, elements: { 'ad-leaderboard': element } });

    const state = await adapter.definePlacement({
      slotKey: 'ad-leaderboard',
      elementId: 'ad-leaderboard',
      config: nativeAnchorV6Config('native')
    });
    if (state.requestPromise) await state.requestPromise;

    await runVisibleRefreshInterval(timers, 15000);
    top = 1000;
    await runVisibleRefreshInterval(timers, 30000);
    assert.equal(fake.calls.defineSlot.length, 1);
    assert.equal(state.refreshVisibleMs, 15000);

    top = 0;
    await runVisibleRefreshInterval(timers, 15000);
    if (state.requestPromise) await state.requestPromise;
    assert.equal(fake.calls.defineSlot.length, 1);
    assert.equal(state.activeRefreshRound, 1);
  } finally {
    timers.restore();
  }
});

test('display refresh visible-time timer pauses when the document is hidden', async () => {
  const timers = installManualTimers();
  try {
    const element = createFakeElement('ad-leaderboard');
    const { adapter, fake } = adapterFor({
      exp_group: 'variant',
      siteKey: 'jobguidematch.com',
      experiment: { enabled: true, expKey: 'ads_exp_v5' },
      slots: {}
    }, { renderEmpty: false, innerWidth: 1024, elements: { 'ad-leaderboard': element } });

    const state = await adapter.definePlacement({
      slotKey: 'ad-leaderboard',
      elementId: 'ad-leaderboard',
      config: nativeAnchorV6Config('native')
    });
    if (state.requestPromise) await state.requestPromise;

    await runVisibleRefreshInterval(timers, 15000);
    adapter.document.visibilityState = 'hidden';
    await runVisibleRefreshInterval(timers, 30000);
    assert.equal(fake.calls.defineSlot.length, 1);
    assert.equal(state.refreshVisibleMs, 15000);

    adapter.document.visibilityState = 'visible';
    await runVisibleRefreshInterval(timers, 15000);
    if (state.requestPromise) await state.requestPromise;
    assert.equal(fake.calls.defineSlot.length, 1);
    assert.equal(state.activeRefreshRound, 1);
  } finally {
    timers.restore();
  }
});

test('display refresh visible-time timer pauses during fullscreen rewarded or interstitial overlay', async () => {
  const timers = installManualTimers();
  try {
    const element = createFakeElement('ad-leaderboard');
    const { adapter, fake } = adapterFor({
      exp_group: 'variant',
      siteKey: 'jobguidematch.com',
      experiment: { enabled: true, expKey: 'ads_exp_v5' },
      slots: {}
    }, { renderEmpty: false, innerWidth: 1024, elements: { 'ad-leaderboard': element } });

    const state = await adapter.definePlacement({
      slotKey: 'ad-leaderboard',
      elementId: 'ad-leaderboard',
      config: nativeAnchorV6Config('native')
    });
    if (state.requestPromise) await state.requestPromise;

    await runVisibleRefreshInterval(timers, 15000);
    adapter.setFullscreenOverlayActive(true);
    await runVisibleRefreshInterval(timers, 30000);
    assert.equal(fake.calls.defineSlot.length, 1);
    assert.equal(state.refreshVisibleMs, 15000);

    adapter.setFullscreenOverlayActive(false);
    await runVisibleRefreshInterval(timers, 15000);
    if (state.requestPromise) await state.requestPromise;
    assert.equal(fake.calls.defineSlot.length, 1);
    assert.equal(state.activeRefreshRound, 1);
  } finally {
    timers.restore();
  }
});

test('native variant final fallback preserves attribution and clears only price rule', async () => {
  const { adapter, fake } = adapterFor({
    exp_group: 'variant',
    experiment: { enabled: true, expKey: 'ads_exp_v4' },
    targetingPolicy: { variant: ['exp_group', 'exp_key', 'slot_name', 'price_rule'] },
    globalTargeting: { po_global: '1' },
    slots: {}
  }, { renderEmpty: true });

  await adapter.definePlacement({
    slotKey: 'ad-leaderboard',
    elementId: 'ad-leaderboard',
    config: {
      slotKey: 'ad-leaderboard',
      adUnitName: '/23360556473/quiz-rush.com_ad-leaderboard',
      adUnitType: 'native',
      sizes: 'fluid',
      waterfall: [30],
      retryLimit: 1,
      retryDelayMs: 0,
      requestTimeoutMs: 1000
    }
  });
  await new Promise(resolve => setTimeout(resolve, 10));

  assert.deepEqual(fake.calls.refreshTargeting, [
    {
      slot: {
        exp_group: 'variant',
        exp_key: 'ads_exp_v4',
        slot_name: 'native',
        price_rule: '30'
      },
      page: { po_global: '1' }
    },
    {
      slot: {
        exp_group: 'variant',
        exp_key: 'ads_exp_v4',
        slot_name: 'native'
      },
      page: { po_global: '1' }
    }
  ]);
});

test('anchor variant final fallback preserves attribution and clears only price rule', async () => {
  const timers = installManualTimers();
  try {
    const { adapter, fake } = adapterFor({
      exp_group: 'variant',
      experiment: { enabled: true, expKey: 'ads_exp_v4' },
      targetingPolicy: { variant: ['exp_group', 'exp_key', 'slot_name', 'price_rule'] },
      slots: {}
    }, { renderEmpty: true });

    const state = await adapter.definePlacement({
      slotKey: 'anchor',
      elementId: null,
      config: {
        slotKey: 'anchor',
        adUnitName: '/23360556473/quiz-rush.com_Anchor',
        adUnitType: 'anchor',
        sizes: [[320, 50], [728, 90]],
        targeting: { publisher_context: 'keep-me' },
        waterfall: [8, 5],
        retryLimit: 2,
        retryDelayMs: 0,
        requestTimeoutMs: 1000
      }
    });

    await drainZeroDelayRequest(state, timers);

    assert.deepEqual(fake.calls.refreshTargeting, [
      {
        slot: {
          publisher_context: 'keep-me',
          exp_group: 'variant',
          exp_key: 'ads_exp_v4',
          slot_name: 'anchor',
          price_rule: '8'
        },
        page: {}
      },
      {
        slot: {
          publisher_context: 'keep-me',
          exp_group: 'variant',
          exp_key: 'ads_exp_v4',
          slot_name: 'anchor',
          price_rule: '5'
        },
        page: {}
      },
      {
        slot: {
          publisher_context: 'keep-me',
          exp_group: 'variant',
          exp_key: 'ads_exp_v4',
          slot_name: 'anchor'
        },
        page: {}
      }
    ]);
  } finally {
    timers.restore();
  }
});

test('interstitial variant final fallback preserves attribution and clears only price rule', async () => {
  const timers = installManualTimers();
  try {
    const { adapter, fake } = adapterFor({
      exp_group: 'variant',
      experiment: { enabled: true, expKey: 'ads_exp_v4' },
      targetingPolicy: { variant: ['exp_group', 'exp_key', 'slot_name', 'price_rule'] },
      slots: {
        interstitial: {
          slotKey: 'interstitial',
          adUnitName: '/23360556473/quiz-rush.com_Interstitial',
          adUnitType: 'interstitial',
          integrationMode: 'both',
          targeting: { publisher_context: 'keep-me' },
          waterfall: [15, 8],
          retryLimit: 2,
          retryDelayMs: 0,
          interstitialTimeoutMs: 1000
        }
      }
    }, { interstitialEmpty: true });

    let result = null;
    const request = adapter.requestInterstitial('interstitial').then(value => {
      result = value;
      return value;
    });

    await Promise.resolve();
    await Promise.resolve();

    let guard = 0;
    while (!result && timers.runNext(0) && guard < 20) {
      guard += 1;
      await Promise.resolve();
    }
    if (!result) await request;

    assert.equal(result.status, 'unavailable');
    assert.deepEqual(fake.calls.refreshTargeting, [
      {
        slot: {
          publisher_context: 'keep-me',
          exp_group: 'variant',
          exp_key: 'ads_exp_v4',
          slot_name: 'interstitial',
          price_rule: '15'
        },
        page: {}
      },
      {
        slot: {
          publisher_context: 'keep-me',
          exp_group: 'variant',
          exp_key: 'ads_exp_v4',
          slot_name: 'interstitial',
          price_rule: '8'
        },
        page: {}
      },
      {
        slot: {
          publisher_context: 'keep-me',
          exp_group: 'variant',
          exp_key: 'ads_exp_v4',
          slot_name: 'interstitial'
        },
        page: {}
      }
    ]);
  } finally {
    timers.restore();
  }
});

test('allows several DOM slots to share one GAM ad-unit path', async () => {
  const sharedPath = '/23360556473/quiz-rush.com_Native';
  const { adapter, fake } = adapterFor({
    slots: {},
    experiment: { enabled: false },
    targetingPolicy: { control: ['exp_group'], variant: ['exp_group', 'exp_key', 'slot_name', 'price_rule'] }
  });

  const configs = [
    ['ad-leaderboard', 'ad-leaderboard'],
    ['ad-incontent', 'ad-incontent'],
    ['ad-results', 'ad-results']
  ].map(([slotKey, divId]) => ({
    slotKey,
    divId,
    config: {
      slotKey,
      adUnitName: sharedPath,
      adUnitType: 'native',
      sizes: 'fluid',
      retryLimit: 1
    }
  }));

  for (const item of configs) {
    await adapter.definePlacement({
      slotKey: item.slotKey,
      elementId: item.divId,
      config: item.config
    });
  }

  assert.equal(fake.calls.defineSlot.length, 3);
  assert.deepEqual(fake.calls.defineSlot.map(slot => slot.path), [sharedPath, sharedPath, sharedPath]);
  assert.deepEqual(fake.calls.defineSlot.map(slot => slot.divId), ['ad-leaderboard', 'ad-incontent', 'ad-results']);
  assert.deepEqual(fake.calls.defineSlot.map(slot => slot.sizes), ['fluid', 'fluid', 'fluid']);
});

test('resolves publisher div-id slot keys against current runtime aliases', () => {
  const { adapter } = adapterFor({
    experiment: { enabled: false },
    slots: {
      'native-results': {
        slotKey: 'native-results',
        adUnitName: '/23360556473/quiz-rush.com_Native',
        adUnitType: 'native',
        domId: 'ad-results',
        domSelector: '#ad-results',
        sizes: 'fluid'
      }
    }
  });

  const config = adapter.slotConfig('ad-results', 'native', {
    selector: '#ad-results',
    aliases: ['native-results']
  });

  assert.equal(config.adUnitName, '/23360556473/quiz-rush.com_Native');
  assert.equal(config.slotKey, 'native-results');
});

test('slot lookup prefers sized native aliases over fluid duplicate DOM records', () => {
  const { adapter } = adapterFor({
    experiment: { enabled: false },
    slots: {
      'ad-leaderboard': {
        slotKey: 'ad-leaderboard',
        adUnitName: '/23360556473/jobguidematch.com_Native',
        adUnitType: 'native',
        domId: 'ad-leaderboard',
        domSelector: '#ad-leaderboard',
        sizes: 'fluid'
      },
      'native-leaderboard': {
        slotKey: 'native-leaderboard',
        adUnitName: '/23360556473/jobguidematch.com_Native',
        adUnitType: 'native',
        domId: 'ad-leaderboard',
        domSelector: '#ad-leaderboard',
        sizes: [[320, 50], [728, 90]]
      }
    }
  });

  const config = adapter.slotConfig('ad-leaderboard', 'native', {
    selector: '#ad-leaderboard',
    aliases: ['native-leaderboard']
  });

  assert.equal(config.slotKey, 'native-leaderboard');
  assert.deepEqual(config.sizes, [[320, 50], [728, 90]]);
});

test('protects duplicate display slots by resolved DOM div ID', async () => {
  const { adapter, fake } = adapterFor({ slots: {}, experiment: { enabled: false } });
  const config = {
    slotKey: 'native-results',
    adUnitName: '/23360556473/quiz-rush.com_Native',
    adUnitType: 'native',
    sizes: 'fluid',
    retryLimit: 1
  };

  const first = await adapter.definePlacement({ slotKey: 'ad-results', elementId: 'ad-results', config });
  const second = await adapter.definePlacement({ slotKey: 'ad-results-copy', elementId: 'ad-results', config });

  assert.equal(first, second);
  assert.equal(fake.calls.defineSlot.length, 1);
  assert.deepEqual(fake.calls.display, ['ad-results']);
});

test('never passes a flat numeric size array to defineSlot', async () => {
  const { adapter, fake } = adapterFor({ slots: {}, experiment: { enabled: false } });

  await adapter.definePlacement({
    slotKey: 'ad-anchor',
    elementId: 'ad-anchor',
    config: {
      slotKey: 'ad-anchor',
      adUnitName: '/23360556473/quiz-rush.com_Anchor',
      adUnitType: 'anchor',
      sizes: [320, 50, 728, 90],
      retryLimit: 1
    }
  });

  assert.deepEqual(fake.calls.defineSlot[0].sizes, [[320, 50], [728, 90]]);
});

test('sends only mobile leaderboard size on mobile viewports', async () => {
  const { adapter, fake } = adapterFor({ slots: {}, experiment: { enabled: false } }, { innerWidth: 390 });

  await adapter.definePlacement({
    slotKey: 'ad-leaderboard',
    elementId: 'ad-leaderboard',
    config: {
      slotKey: 'ad-leaderboard',
      adUnitName: '/23360556473/quiz-rush.com_ad-leaderboard',
      adUnitType: 'native',
      sizes: [[320, 50], [728, 90]],
      retryLimit: 1
    }
  });

  assert.deepEqual(fake.calls.defineSlot[0].sizes, [[320, 50]]);
});

test('sends only desktop leaderboard size on desktop viewports', async () => {
  const { adapter, fake } = adapterFor({ slots: {}, experiment: { enabled: false } }, { innerWidth: 1024 });

  await adapter.definePlacement({
    slotKey: 'ad-leaderboard',
    elementId: 'ad-leaderboard',
    config: {
      slotKey: 'ad-leaderboard',
      adUnitName: '/23360556473/quiz-rush.com_ad-leaderboard',
      adUnitType: 'native',
      sizes: [[320, 50], [728, 90]],
      retryLimit: 1
    }
  });

  assert.deepEqual(fake.calls.defineSlot[0].sizes, [[728, 90]]);
});

test('collapses display div after final no-fill', async () => {
  const element = createFakeElement('ad-leaderboard');
  const { adapter } = adapterFor({
    slots: {},
    experiment: { enabled: false }
  }, {
    renderEmpty: true,
    elements: { 'ad-leaderboard': element }
  });

  const state = await adapter.definePlacement({
    slotKey: 'ad-leaderboard',
    elementId: 'ad-leaderboard',
    config: {
      slotKey: 'ad-leaderboard',
      adUnitName: '/23360556473/quiz-rush.com_ad-leaderboard',
      adUnitType: 'native',
      sizes: [[320, 50], [728, 90]],
      retryLimit: 1,
      requestTimeoutMs: 1000
    }
  });

  if (state.requestPromise) await state.requestPromise;

  assert.equal(state.layoutState, 'empty');
  assert.equal(state.collapsed, true);
  assert.equal(element.hidden, true);
  assert.equal(element.style.display, 'none');
  assert.equal(element.dataset.poSlotState, 'empty');
  assert.equal(element.dataset.poSlotCollapsed, 'true');
  assert.equal(element.classList.contains('po-slot--empty'), true);
});

test('keeps empty display div reserved when runtime disables collapse', async () => {
  const element = createFakeElement('ad-leaderboard');
  const { adapter } = adapterFor({
    slots: {},
    experiment: { enabled: false }
  }, {
    renderEmpty: true,
    elements: { 'ad-leaderboard': element }
  });

  const state = await adapter.definePlacement({
    slotKey: 'ad-leaderboard',
    elementId: 'ad-leaderboard',
    config: {
      slotKey: 'ad-leaderboard',
      adUnitName: '/23360556473/quiz-rush.com_ad-leaderboard',
      adUnitType: 'native',
      sizes: [[320, 50], [728, 90]],
      collapseEmpty: false,
      retryLimit: 1,
      requestTimeoutMs: 1000
    }
  });

  if (state.requestPromise) await state.requestPromise;

  assert.equal(state.layoutState, 'empty');
  assert.equal(state.collapsed, false);
  assert.equal(element.hidden, false);
  assert.equal(element.style.display, '');
  assert.equal(element.dataset.poSlotState, 'empty');
  assert.equal(element.dataset.poSlotCollapsed, 'false');
  assert.equal(element.classList.contains('po-slot--empty'), true);
});

test('public slot status returns placement state and request sizes only', async () => {
  const element = createFakeElement('ad-leaderboard');
  const { adapter } = adapterFor({
    slots: {},
    experiment: { enabled: false }
  }, {
    innerWidth: 390,
    renderEmpty: false,
    elements: { 'ad-leaderboard': element }
  });

  const state = await adapter.definePlacement({
    slotKey: 'ad-leaderboard',
    elementId: 'ad-leaderboard',
    config: {
      slotKey: 'ad-leaderboard',
      adUnitName: '/23360556473/quiz-rush.com_ad-leaderboard',
      adUnitType: 'native',
      sizes: [[320, 50], [728, 90]],
      waterfall: [300],
      retryLimit: 1,
      requestTimeoutMs: 1000
    }
  });
  if (state.requestPromise) await state.requestPromise;

  const status = adapter.publicSlotStatus(state);
  assert.deepEqual(status, {
    slotKey: 'ad-leaderboard',
    domId: 'ad-leaderboard',
    type: 'native',
    state: 'filled',
    filled: true,
    collapsed: false,
    sizes: [[320, 50]]
  });
  assert.equal(JSON.stringify(status).includes('waterfall'), false);
  assert.equal(JSON.stringify(status).includes('price_rule'), false);
  assert.equal(JSON.stringify(status).includes('/23360556473'), false);
});

test('keeps native content sizes that fit the mobile viewport', async () => {
  const { adapter, fake } = adapterFor({ slots: {}, experiment: { enabled: false } }, { innerWidth: 390 });

  await adapter.definePlacement({
    slotKey: 'ad-incontent',
    elementId: 'ad-incontent',
    config: {
      slotKey: 'ad-incontent',
      adUnitName: '/23360556473/quiz-rush.com_ad-incontent',
      adUnitType: 'native',
      sizes: [[300, 250], [336, 280]],
      retryLimit: 1
    }
  });

  assert.deepEqual(fake.calls.defineSlot[0].sizes, [[300, 250], [336, 280]]);
});

test('uses fluid for missing native sizes without inventing 300x250', async () => {
  const { adapter, fake } = adapterFor({ slots: {}, experiment: { enabled: false } });

  await adapter.definePlacement({
    slotKey: 'ad-results',
    elementId: 'ad-results',
    config: {
      slotKey: 'ad-results',
      adUnitName: '/23360556473/quiz-rush.com_Native',
      adUnitType: 'native',
      retryLimit: 1
    }
  });

  assert.equal(fake.calls.defineSlot[0].sizes, 'fluid');
});

test('uses out-of-page APIs for interstitial and rewarded slots', async () => {
  const { adapter, fake } = adapterFor({
    experiment: { enabled: false },
    slots: {
      interstitial: {
        slotKey: 'interstitial',
        adUnitName: '/23360556473/quiz-rush.com_Interstitial',
        adUnitType: 'interstitial',
        sizes: [300, 250],
        retryLimit: 1,
        requestTimeoutMs: 20
      },
      rewarded: {
        slotKey: 'rewarded',
        adUnitName: '/23360556473/quiz-rush.com_Rewarded',
        adUnitType: 'rewarded',
        sizes: [300, 250],
        retryLimit: 1,
        rewardedRequestTimeoutMs: 20
      }
    }
  });

  const interstitial = await adapter.requestInterstitial();
  const rewarded = await adapter.requestRewarded();

  assert.equal(interstitial.status, 'closed');
  assert.equal(rewarded.status, 'granted');
  assert.equal(fake.calls.defineSlot.length, 0);
  assert.deepEqual(fake.calls.defineOutOfPageSlot.map(slot => slot.format), ['INTERSTITIAL', 'REWARDED']);
});

test('does not generate price_rule targeting without a runtime-selected variant', async () => {
  const { adapter, fake } = adapterFor({
    experiment: { enabled: true, expKey: 'ads_exp_v4' },
    targetingPolicy: { variant: ['exp_group', 'exp_key', 'slot_name', 'price_rule'] },
    slots: {}
  });

  await adapter.definePlacement({
    slotKey: 'ad-results',
    elementId: 'ad-results',
    config: {
      slotKey: 'ad-results',
      adUnitName: '/23360556473/quiz-rush.com_Native',
      adUnitType: 'native',
      sizes: 'fluid',
      waterfall: [300],
      retryLimit: 1
    }
  });

  assert.equal(fake.calls.defineSlot[0].targeting.exp_group, undefined);
  assert.equal(fake.calls.defineSlot[0].targeting.price_rule, undefined);
});
