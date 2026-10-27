import test from 'node:test';
import assert from 'node:assert/strict';
import { createExperience, readScriptOptions } from '../src/core/bootstrap.js';

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
    }
  };
}

function createFakeElement(id, options = {}) {
  const children = [];
  return {
    id,
    hidden: Boolean(options.hidden),
    dataset: {},
    style: Object.assign({ display: '', visibility: '' }, options.style || {}),
    attributes: {},
    children,
    parentNode: null,
    offsetWidth: options.offsetWidth == null ? 728 : options.offsetWidth,
    offsetHeight: options.offsetHeight == null ? 90 : options.offsetHeight,
    classList: {
      add() {},
      remove() {}
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
      children.push(child);
      this.firstChild = children[0] || null;
      return child;
    },
    removeChild(child) {
      const index = children.indexOf(child);
      if (index !== -1) children.splice(index, 1);
      if (child) child.parentNode = null;
      this.firstChild = children[0] || null;
      return child;
    },
    getBoundingClientRect() {
      const top = options.top == null ? 0 : options.top;
      return {
        left: 0,
        top,
        right: Number(this.offsetWidth) || 0,
        bottom: top + (Number(this.offsetHeight) || 0),
        width: Number(this.offsetWidth) || 0,
        height: Number(this.offsetHeight) || 0
      };
    }
  };
}

function createFakeGpt({ renderEmpty = false } = {}) {
  const listeners = new Map();
  const slotsByDivId = new Map();
  let renderIndex = 0;
  const calls = {
    defineSlot: [],
    defineOutOfPageSlot: [],
    display: [],
    refresh: [],
    refreshTargeting: [],
    rewardedVisible: []
  };
  const emit = (name, event) => {
    for (const listener of listeners.get(name) || []) listener(event);
  };
  const requestSlot = slot => {
    if (!slot) return;
    if (slot.format === 'REWARDED') {
      emit('rewardedSlotReady', {
        slot,
        makeRewardedVisible() {
          calls.rewardedVisible.push(slot);
          emit('rewardedSlotGranted', { slot, payload: { type: 'publisher-owned' } });
          emit('rewardedSlotClosed', { slot });
        }
      });
      return;
    }
    if (slot.format === 'INTERSTITIAL') {
      emit('gameManualInterstitialSlotReady', {
        slot,
        makeGameManualInterstitialVisible() {}
      });
      emit('gameManualInterstitialSlotClosed', { slot });
      return;
    }
    calls.refreshTargeting.push(Object.assign({}, slot.targeting));
    const decision = Array.isArray(renderEmpty)
      ? renderEmpty[Math.min(renderIndex, renderEmpty.length - 1)]
      : (typeof renderEmpty === 'function' ? renderEmpty(slot, renderIndex) : renderEmpty);
    renderIndex += 1;
    if (decision === 'pending') return;
    emit('slotRenderEnded', { slot, isEmpty: Boolean(decision) });
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
      for (const slot of slots) {
        requestSlot(slot);
      }
    },
    set() {
      return this;
    }
  };
  return {
    calls,
    googletag: {
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
      display(slotOrDivId) {
        calls.display.push(slotOrDivId);
        requestSlot(typeof slotOrDivId === 'string' ? slotsByDivId.get(slotOrDivId) : slotOrDivId);
      },
      setConfig() {},
      enableServices() {}
    }
  };
}

function fakeDocument(elements = {}, readyState = 'complete') {
  const listeners = new Map();
  const body = createFakeElement('body');
  return {
    readyState,
    currentScript: null,
    body,
    documentElement: {
      clientWidth: undefined
    },
    head: { appendChild() {} },
    querySelector(selector) {
      return elements[selector] || null;
    },
    getElementById(id) {
      return elements[id] || elements[`#${id}`] || null;
    },
    createElement() {
      return createFakeElement('');
    },
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    removeEventListener(name) {
      listeners.delete(name);
    }
  };
}

function fakeWindow(googletag, innerWidth) {
  return {
    googletag,
    sessionStorage: {
      getItem() {
        return null;
      },
      setItem() {}
    },
    location: {
      href: 'https://quiz-rush.com/',
      pathname: '/'
    },
    innerWidth,
    addEventListener() {},
    removeEventListener() {}
  };
}

function fakeFetch(runtime) {
  return async () => ({
    ok: true,
    json: async () => runtime
  });
}

function jobGuideNativeRuntimeSlot(slotKey, domId, sizes) {
  return {
    slotKey,
    adUnitName: '/23360556473/jobguidematch.com_Native',
    adUnitType: 'native',
    domId,
    domSelector: `#${domId}`,
    sizes,
    waterfall: [3, 1],
    retryLimit: 2,
    retryDelayMs: 0,
    refreshEnabled: true,
    refreshDelayMs: 30000,
    maximumRefreshes: 3,
    refreshLadders: [[5, 3, 1], [8, 5, 3, 1], [15, 8, 5, 3, 1]],
    refreshRoundTargetingKey: 'refresh_round',
    targetingPolicy: {
      control: ['exp_group', 'exp_key', 'slot_name', 'refresh_round'],
      variant: ['exp_group', 'exp_key', 'slot_name', 'refresh_round', 'price_rule']
    },
    experiment: {
      enabled: true,
      expKey: 'ads_exp_v6',
      key: 'ads_exp_v6',
      variantPercentage: 0.8,
      control: { enabled: true, expKey: 'ads_exp_v6' },
      variant: {
        baseFloor: 3,
        ladder: [3, 1],
        refreshLadders: [[5, 3, 1], [8, 5, 3, 1], [15, 8, 5, 3, 1]],
        expKey: 'ads_exp_v6'
      }
    }
  };
}

function jobGuideDisplayRuntime({ includeFluidDuplicates = true } = {}) {
  const nativeSlot = jobGuideNativeRuntimeSlot;
  const slots = {
    anchor: {
      slotKey: 'anchor',
      adUnitName: '/23360556473/jobguidematch.com_Anchor',
      adUnitType: 'anchor',
      domId: 'ad-anchor',
      domSelector: '#ad-anchor',
      sizes: [[320, 50], [728, 90]],
      waterfall: [3, 1],
      retryLimit: 2,
      retryDelayMs: 0,
      refreshEnabled: true,
      refreshDelayMs: 30000,
      maximumRefreshes: 3,
      refreshLadders: [[5, 3, 1], [8, 5, 3, 1], [15, 8, 5, 3, 1]],
      refreshRoundTargetingKey: 'refresh_round',
      targetingPolicy: {
        control: ['exp_group', 'exp_key', 'slot_name', 'refresh_round'],
        variant: ['exp_group', 'exp_key', 'slot_name', 'refresh_round', 'price_rule']
      },
      experiment: {
        enabled: true,
        expKey: 'ads_exp_v6',
        key: 'ads_exp_v6',
        variantPercentage: 0.8,
        control: { enabled: true, expKey: 'ads_exp_v6' },
        variant: {
          baseFloor: 3,
          ladder: [3, 1],
          refreshLadders: [[5, 3, 1], [8, 5, 3, 1], [15, 8, 5, 3, 1]],
          expKey: 'ads_exp_v6'
        }
      }
    },
    'native-incontent': nativeSlot('native-incontent', 'ad-incontent', [[300, 250], [336, 280]]),
    'native-leaderboard': nativeSlot('native-leaderboard', 'ad-leaderboard', [[320, 50], [728, 90]]),
    'native-results': nativeSlot('native-results', 'ad-results', [[300, 250], [336, 280]]),
    rewarded: {
      slotKey: 'rewarded',
      adUnitName: '/23360556473/jobguidematch.com_Rewarded',
      adUnitType: 'rewarded',
      waterfall: [300, 250, 180, 120, 80, 50, 30],
      experiment: {
        enabled: true,
        expKey: 'ads_exp_v5',
        key: 'ads_exp_v5',
        variantPercentage: 0.8
      }
    }
  };

  if (includeFluidDuplicates) {
    Object.assign(slots, {
      'ad-incontent': nativeSlot('ad-incontent', 'ad-incontent', 'fluid'),
      'ad-leaderboard': nativeSlot('ad-leaderboard', 'ad-leaderboard', 'fluid'),
      'ad-results': nativeSlot('ad-results', 'ad-results', 'fluid'),
      'ad-anchor': Object.assign({}, slots.anchor, { slotKey: 'ad-anchor' })
    });
  }

  return {
    siteKey: 'jobguidematch.com',
    exp_group: 'variant',
    experiment: { enabled: true, expKey: 'ads_exp_v5', key: 'ads_exp_v5', variantPercentage: 0.8 },
    targetingPolicy: { variant: ['exp_group', 'exp_key', 'slot_name', 'refresh_round', 'price_rule'] },
    slots
  };
}

function createJobGuideDisplayExperience({ includeFluidDuplicates = true, hidden = true, innerWidth = 1024, extraElements = {}, renderEmpty = false } = {}) {
  const fake = createFakeGpt({ renderEmpty });
  const hiddenStyle = hidden ? { display: 'none', visibility: '' } : { display: '', visibility: '' };
  const hiddenSize = hidden ? { offsetWidth: 0, offsetHeight: 0 } : {};
  const elements = {
    '#ad-anchor': createFakeElement('ad-anchor', Object.assign({ style: hiddenStyle }, hiddenSize)),
    '#ad-incontent': createFakeElement('ad-incontent', Object.assign({ style: hiddenStyle }, hiddenSize)),
    '#ad-leaderboard': createFakeElement('ad-leaderboard', Object.assign({ style: hiddenStyle }, hiddenSize)),
    '#ad-results': createFakeElement('ad-results', Object.assign({ style: hiddenStyle }, hiddenSize)),
    ...extraElements
  };
  const documentRef = fakeDocument(elements);
  documentRef.documentElement.clientWidth = innerWidth;
  const windowRef = Object.assign(fakeWindow(fake.googletag, innerWidth), {
    location: {
      href: 'https://jobguidematch.com/worldwide/',
      pathname: '/worldwide/'
    },
    getComputedStyle(element) {
      return element.style || {};
    }
  });
  const experience = createExperience({
    siteKey: 'jobguidematch.com',
    displayPreloadMode: 'real',
    placements: [],
    interstitials: [],
    rewarded: []
  }, {
    windowRef,
    documentRef,
    fetchRef: fakeFetch(jobGuideDisplayRuntime({ includeFluidDuplicates })),
    autoInit: false
  });

  return { experience, fake, elements };
}

function createPublicExperience(runtime, { innerWidth = 390 } = {}) {
  const fake = createFakeGpt();
  const documentRef = fakeDocument({
    '#ad-leaderboard': { id: 'ad-leaderboard' }
  });
  documentRef.documentElement.clientWidth = innerWidth;
  const windowRef = fakeWindow(fake.googletag, innerWidth);
  const experience = createExperience({
    siteKey: 'quiz-rush.com',
    placements: [
      { slotKey: 'ad-leaderboard', selector: '#ad-leaderboard', aliases: ['native-leaderboard'], adUnitType: 'native' }
    ],
    interstitials: [],
    rewarded: []
  }, {
    windowRef,
    documentRef,
    fetchRef: fakeFetch(runtime),
    autoInit: false
  });

  return { experience, fake };
}

test('public refresh uses runtime adapter without exposing optimisation data', async () => {
  const { experience, fake } = createPublicExperience({
    siteKey: 'quiz-rush.com',
    exp_group: 'variant',
    experiment: { enabled: true, expKey: 'ads_exp_v4' },
    targetingPolicy: { variant: ['exp_group', 'exp_key', 'slot_name', 'price_rule'] },
    slots: {
      'native-leaderboard': {
        slotKey: 'native-leaderboard',
        adUnitName: '/23360556473/quiz-rush.com_ad-leaderboard',
        adUnitType: 'native',
        domId: 'ad-leaderboard',
        domSelector: '#ad-leaderboard',
        sizes: 'fluid',
        waterfall: [20],
        retryLimit: 1
      }
    }
  });

  const result = await experience.refresh('ad-leaderboard');
  const status = experience.status();

  assert.equal(result.status, 'filled');
  assert.deepEqual(result, {
    status: 'filled',
    slotKey: 'ad-leaderboard',
    domId: 'ad-leaderboard',
    type: 'native'
  });
  assert.equal(fake.calls.defineSlot[0].targeting.price_rule, '20');
  assert.equal(fake.calls.defineSlot[0].targeting.exp_group, 'variant');
  assert.equal(fake.calls.defineSlot[0].targeting.slot_name, 'native');

  const publicJson = JSON.stringify({ result, status });
  assert.equal(publicJson.includes('waterfall'), false);
  assert.equal(publicJson.includes('price_rule'), false);
  assert.equal(publicJson.includes('adUnitName'), false);
  assert.equal(publicJson.includes('/23360556473'), false);
});

test('readScriptOptions supports generic data-po-site attributes', () => {
  const options = readScriptOptions({
    bundleName: 'publisher-sdk.js',
    documentRef: {
      currentScript: {
        dataset: {
          poSite: 'quiz-rush.com',
          poRuntimeConfigUrl: 'https://priceoptimiser1.thebesads.com/v1/runtime-config',
          autoInit: 'false'
        }
      },
      querySelector() {
        return null;
      }
    }
  });

  assert.equal(options.siteKey, 'quiz-rush.com');
  assert.equal(options.runtimeConfigUrl, 'https://priceoptimiser1.thebesads.com/v1/runtime-config');
  assert.equal(options.autoInit, false);
});

test('readScriptOptions enables debug from po_debug query flag', () => {
  const options = readScriptOptions({
    bundleName: 'publisher-sdk.js',
    windowRef: {
      location: {
        href: 'https://jobguidematch.com/worldwide/?po_debug=1',
        search: '?po_debug=1'
      }
    },
    documentRef: {
      currentScript: {
        dataset: {}
      },
      querySelector() {
        return null;
      }
    }
  });

  assert.equal(options.debug, true);
});

test('generic runtime-config placements work without a site-specific placement map', async () => {
  const fake = createFakeGpt();
  const documentRef = fakeDocument({
    '#ad-leaderboard': { id: 'ad-leaderboard' }
  });
  documentRef.documentElement.clientWidth = 390;
  const windowRef = fakeWindow(fake.googletag, 390);
  const experience = createExperience({
    siteKey: 'quiz-rush.com',
    placements: [],
    interstitials: [],
    rewarded: []
  }, {
    windowRef,
    documentRef,
    fetchRef: fakeFetch({
      siteKey: 'quiz-rush.com',
      exp_group: 'variant',
      experiment: { enabled: true, expKey: 'ads_exp_v4' },
      targetingPolicy: { variant: ['exp_group', 'exp_key', 'slot_name', 'price_rule'] },
      slots: {
        'ad-leaderboard': {
          slotKey: 'ad-leaderboard',
          adUnitName: '/23360556473/quiz-rush.com_ad-leaderboard',
          adUnitType: 'native',
          domId: 'ad-leaderboard',
          domSelector: '#ad-leaderboard',
          sizes: [[320, 50], [728, 90]],
          waterfall: [20],
          retryLimit: 1
        }
      }
    }),
    autoInit: false
  });

  const result = await experience.refresh('ad-leaderboard');
  const slot = experience.status().slots[0];

  assert.equal(result.status, 'filled');
  assert.equal(fake.calls.defineSlot[0].path, '/23360556473/quiz-rush.com_ad-leaderboard');
  assert.equal(fake.calls.defineSlot[0].divId, 'ad-leaderboard');
  assert.deepEqual(fake.calls.defineSlot[0].sizes, [[320, 50]]);
  assert.deepEqual(slot, {
    slotKey: 'ad-leaderboard',
    domId: 'ad-leaderboard',
    type: 'native',
    state: 'filled',
    filled: true,
    collapsed: false,
    sizes: [[320, 50]]
  });
});

test('public status exposes viewport-filtered sizes without optimisation controls', async () => {
  const { experience } = createPublicExperience({
    siteKey: 'quiz-rush.com',
    exp_group: 'variant',
    experiment: { enabled: true, expKey: 'ads_exp_v4' },
    targetingPolicy: { variant: ['exp_group', 'exp_key', 'slot_name', 'price_rule'] },
    slots: {
      'native-leaderboard': {
        slotKey: 'native-leaderboard',
        adUnitName: '/23360556473/quiz-rush.com_ad-leaderboard',
        adUnitType: 'native',
        domId: 'ad-leaderboard',
        domSelector: '#ad-leaderboard',
        sizes: [[320, 50], [728, 90]],
        waterfall: [20],
        retryLimit: 1
      }
    }
  }, { innerWidth: 390 });

  await experience.refresh('ad-leaderboard');
  const slot = experience.status().slots[0];

  assert.deepEqual(slot, {
    slotKey: 'ad-leaderboard',
    domId: 'ad-leaderboard',
    type: 'native',
    state: 'filled',
    filled: true,
    collapsed: false,
    sizes: [[320, 50]]
  });

  const publicJson = JSON.stringify(slot);
  assert.equal(publicJson.includes('waterfall'), false);
  assert.equal(publicJson.includes('price_rule'), false);
  assert.equal(publicJson.includes('adUnitName'), false);
  assert.equal(publicJson.includes('/23360556473'), false);
});

test('public refresh rejects unknown slots without defining new inventory', async () => {
  const { experience, fake } = createPublicExperience({
    siteKey: 'quiz-rush.com',
    experiment: { enabled: false },
    slots: {}
  });

  const result = await experience.refresh('publisher-made-up-slot');

  assert.deepEqual(result, {
    status: 'invalid_slot',
    slotKey: 'publisher-made-up-slot'
  });
  assert.equal(fake.calls.defineSlot.length, 0);
  assert.equal(fake.calls.refresh.length, 0);
});

test('public refresh rejects generic native and anchor tokens without requesting inventory', async () => {
  const { experience, fake } = createPublicExperience({
    siteKey: 'jobguidematch.com',
    experiment: { enabled: false },
    slots: {
      'native-leaderboard': {
        slotKey: 'native-leaderboard',
        adUnitName: '/23360556473/jobguidematch.com_Native',
        adUnitType: 'native',
        domId: 'ad-leaderboard',
        domSelector: '#ad-leaderboard',
        sizes: [[320, 50], [728, 90]]
      },
      anchor: {
        slotKey: 'anchor',
        adUnitName: '/23360556473/jobguidematch.com_Anchor',
        adUnitType: 'anchor',
        domId: 'ad-anchor',
        domSelector: '#ad-anchor',
        sizes: [[320, 50], [728, 90]]
      }
    }
  });

  const nativeResult = await experience.refresh('native');
  const anchorResult = await experience.refresh('anchor');

  assert.deepEqual(nativeResult, {
    status: 'invalid_slot',
    slotKey: 'native',
    warning: 'explicit_div_id_required'
  });
  assert.deepEqual(anchorResult, {
    status: 'invalid_slot',
    slotKey: 'anchor',
    warning: 'explicit_div_id_required'
  });
  assert.equal(fake.calls.defineSlot.length, 0);
  assert.equal(fake.calls.refresh.length, 0);
});

test('public preloadSlots rejects generic native and anchor tokens without requesting inventory', async () => {
  const fake = createFakeGpt();
  const hiddenStyle = { display: 'none', visibility: '' };
  const anchor = createFakeElement('ad-anchor', { style: hiddenStyle, offsetWidth: 0, offsetHeight: 0 });
  const leaderboard = createFakeElement('ad-leaderboard', { style: hiddenStyle, offsetWidth: 0, offsetHeight: 0 });
  const incontent = createFakeElement('ad-incontent', { style: hiddenStyle, offsetWidth: 0, offsetHeight: 0 });
  const documentRef = fakeDocument({
    '#ad-anchor': anchor,
    '#ad-leaderboard': leaderboard,
    '#ad-incontent': incontent
  });
  documentRef.documentElement.clientWidth = 390;
  const windowRef = Object.assign(fakeWindow(fake.googletag, 390), {
    getComputedStyle(element) {
      return element.style || {};
    }
  });
  const experience = createExperience({
    siteKey: 'quiz-rush.com',
    placements: [],
    interstitials: [],
    rewarded: []
  }, {
    windowRef,
    documentRef,
    fetchRef: fakeFetch({
      siteKey: 'quiz-rush.com',
      exp_group: 'variant',
      experiment: { enabled: true, expKey: 'ads_exp_v4' },
      targetingPolicy: { variant: ['exp_group', 'exp_key', 'slot_name', 'price_rule'] },
      slots: {
        anchor: {
          slotKey: 'anchor',
          adUnitName: '/23360556473/quiz-rush.com_anchor',
          adUnitType: 'anchor',
          domId: 'ad-anchor',
          domSelector: '#ad-anchor',
          sizes: [[320, 50], [728, 90]],
          waterfall: [8],
          retryLimit: 1
        },
        'native-leaderboard': {
          slotKey: 'native-leaderboard',
          adUnitName: '/23360556473/quiz-rush.com_native',
          adUnitType: 'native',
          domId: 'ad-leaderboard',
          domSelector: '#ad-leaderboard',
          sizes: [[320, 50], [728, 90]],
          waterfall: [8],
          retryLimit: 1
        },
        'native-incontent': {
          slotKey: 'native-incontent',
          adUnitName: '/23360556473/quiz-rush.com_native',
          adUnitType: 'native',
          domId: 'ad-incontent',
          domSelector: '#ad-incontent',
          sizes: [[300, 250]],
          waterfall: [8],
          retryLimit: 1
        },
        rewarded: {
          slotKey: 'rewarded',
          adUnitName: '/23360556473/quiz-rush.com_rewarded',
          adUnitType: 'rewarded'
        }
      }
    }),
    autoInit: false
  });

  const result = await experience.preloadSlots(['anchor', 'native']);

  assert.equal(result.status, 'complete');
  assert.deepEqual(result.results, [
    { status: 'invalid_slot', slotKey: 'anchor', warning: 'explicit_div_id_required' },
    { status: 'invalid_slot', slotKey: 'native', warning: 'explicit_div_id_required' }
  ]);
  assert.equal(fake.calls.defineSlot.length, 0);
  assert.equal(fake.calls.defineOutOfPageSlot.length, 0);
  assert.equal(fake.calls.refresh.length, 0);
});

test('public preloadSlots exact jobguidematch div IDs prefer sized mappings over duplicate runtime records', async () => {
  const fake = createFakeGpt();
  const elements = {
    '#ad-anchor': createFakeElement('ad-anchor', { style: { display: 'none', visibility: '' }, offsetWidth: 0, offsetHeight: 0 }),
    '#ad-incontent': createFakeElement('ad-incontent', { style: { display: 'none', visibility: '' }, offsetWidth: 0, offsetHeight: 0 }),
    '#ad-leaderboard': createFakeElement('ad-leaderboard', { style: { display: 'none', visibility: '' }, offsetWidth: 0, offsetHeight: 0 }),
    '#ad-results': createFakeElement('ad-results', { style: { display: 'none', visibility: '' }, offsetWidth: 0, offsetHeight: 0 })
  };
  const documentRef = fakeDocument(elements);
  documentRef.documentElement.clientWidth = 1024;
  const windowRef = Object.assign(fakeWindow(fake.googletag, 1024), {
    location: {
      href: 'https://jobguidematch.com/worldwide/',
      pathname: '/worldwide/'
    },
    getComputedStyle(element) {
      return element.style || {};
    }
  });
  const nativeRuntime = (slotKey, domId, sizes) => ({
    slotKey,
    adUnitName: '/23360556473/jobguidematch.com_Native',
    adUnitType: 'native',
    domId,
    domSelector: `#${domId}`,
    sizes,
    waterfall: [3, 1],
    retryLimit: 2
  });
  const experience = createExperience({
    siteKey: 'jobguidematch.com',
    placements: [],
    interstitials: [],
    rewarded: []
  }, {
    windowRef,
    documentRef,
    fetchRef: fakeFetch({
      siteKey: 'jobguidematch.com',
      exp_group: 'variant',
      experiment: { enabled: true, expKey: 'ads_exp_v5' },
      targetingPolicy: { variant: ['exp_group', 'exp_key', 'slot_name', 'refresh_round', 'price_rule'] },
      slots: {
        'ad-anchor': {
          slotKey: 'ad-anchor',
          adUnitName: '/23360556473/jobguidematch.com_Anchor',
          adUnitType: 'anchor',
          domId: 'ad-anchor',
          domSelector: '#ad-anchor',
          sizes: [[320, 50], [728, 90]],
          waterfall: [3, 1],
          retryLimit: 2
        },
        'ad-incontent': nativeRuntime('ad-incontent', 'ad-incontent', 'fluid'),
        'ad-leaderboard': nativeRuntime('ad-leaderboard', 'ad-leaderboard', 'fluid'),
        'ad-results': nativeRuntime('ad-results', 'ad-results', 'fluid'),
        anchor: {
          slotKey: 'anchor',
          adUnitName: '/23360556473/jobguidematch.com_Anchor',
          adUnitType: 'anchor',
          domId: 'ad-anchor',
          domSelector: '#ad-anchor',
          sizes: [[320, 50], [728, 90]],
          waterfall: [3, 1],
          retryLimit: 2
        },
        'native-incontent': nativeRuntime('native-incontent', 'ad-incontent', [[300, 250], [336, 280]]),
        'native-leaderboard': nativeRuntime('native-leaderboard', 'ad-leaderboard', [[320, 50], [728, 90]]),
        'native-results': nativeRuntime('native-results', 'ad-results', [[300, 250], [336, 280]])
      }
    }),
    autoInit: false
  });

  const result = await experience.preloadSlots(['ad-leaderboard', 'ad-incontent', 'ad-results', 'ad-anchor']);

  assert.equal(result.status, 'complete');
  assert.deepEqual(result.results.map(item => item.slotKey), ['native-leaderboard', 'native-incontent', 'native-results', 'anchor']);
  assert.deepEqual(result.results.map(item => item.status), ['prepared', 'prepared', 'prepared', 'prepared']);
  assert.equal(fake.calls.defineSlot.length, 0);
  assert.equal(fake.calls.defineSlot.some(slot => slot.sizes === 'fluid'), false);
  assert.equal(elements['#ad-leaderboard'].children.length, 0);
  assert.equal(elements['#ad-incontent'].children.length, 0);
  assert.equal(elements['#ad-results'].children.length, 0);
});

test('public preloadSlots explicit ad-leaderboard preloads only the sized Native leaderboard placement', async () => {
  const { experience, fake, elements } = createJobGuideDisplayExperience();

  const result = await experience.preloadSlots(['ad-leaderboard']);

  assert.equal(result.status, 'complete');
  assert.deepEqual(result.results, [{
    status: 'filled',
    slotKey: 'native-leaderboard',
    domId: 'ad-leaderboard',
    type: 'native'
  }]);
  assert.equal(fake.calls.defineSlot.length, 1);
  assert.equal(fake.calls.defineSlot[0].divId, 'ad-leaderboard');
  assert.deepEqual(fake.calls.display, ['ad-leaderboard']);
  assert.equal(elements['#ad-leaderboard'].children.length, 0);
  assert.equal(fake.calls.defineSlot.some(slot => slot.sizes === 'fluid'), false);
});

test('public preloadSlots explicit Native div IDs resolve exactly those configured placements', async () => {
  const { experience, fake } = createJobGuideDisplayExperience();

  const result = await experience.preloadSlots(['ad-incontent', 'ad-results']);

  assert.equal(result.status, 'complete');
  assert.deepEqual(result.results.map(item => item.slotKey), ['native-incontent', 'native-results']);
  assert.deepEqual(result.results.map(item => item.status), ['filled', 'filled']);
  assert.deepEqual(fake.calls.defineSlot.map(slot => slot.divId), ['ad-incontent', 'ad-results']);
  assert.deepEqual(fake.calls.display, ['ad-incontent', 'ad-results']);
});

test('public preloadSlots explicit ad-anchor preloads only the configured Anchor placement', async () => {
  const { experience, fake } = createJobGuideDisplayExperience();

  const result = await experience.preloadSlots(['ad-anchor']);

  assert.equal(result.status, 'complete');
  assert.deepEqual(result.results, [{
    status: 'filled',
    slotKey: 'anchor',
    domId: 'ad-anchor',
    type: 'anchor'
  }]);
  assert.equal(fake.calls.defineSlot.length, 1);
  assert.equal(fake.calls.defineSlot[0].divId, 'ad-anchor');
  assert.deepEqual(fake.calls.display, ['ad-anchor']);
  assert.equal(fake.calls.defineOutOfPageSlot.length, 0);
});

test('public preloadSlots generic native and anchor tokens warn without requesting inventory', async () => {
  const { experience, fake } = createJobGuideDisplayExperience();

  const result = await experience.preloadSlots(['native', 'anchor']);

  assert.equal(result.status, 'complete');
  assert.deepEqual(result.results, [
    { status: 'invalid_slot', slotKey: 'native', warning: 'explicit_div_id_required' },
    { status: 'invalid_slot', slotKey: 'anchor', warning: 'explicit_div_id_required' }
  ]);
  assert.equal(fake.calls.defineSlot.length, 0);
  assert.equal(fake.calls.refresh.length, 0);
});

test('public revealSlots generic native and anchor tokens warn without requesting inventory', async () => {
  const { experience, fake } = createJobGuideDisplayExperience();

  const result = await experience.revealSlots(['native', 'anchor']);

  assert.equal(result.status, 'complete');
  assert.deepEqual(result.results, [
    { filled: false, reason: 'explicit_div_id_required', status: 'invalid_slot', slotKey: 'native', warning: 'explicit_div_id_required' },
    { filled: false, reason: 'explicit_div_id_required', status: 'invalid_slot', slotKey: 'anchor', warning: 'explicit_div_id_required' }
  ]);
  assert.equal(fake.calls.defineSlot.length, 0);
  assert.equal(fake.calls.refresh.length, 0);
});

test('public preloadSlots mixed explicit div IDs and generic tokens requests only explicit placements', async () => {
  const { experience, fake } = createJobGuideDisplayExperience();

  const result = await experience.preloadSlots(['ad-leaderboard', 'native', 'anchor']);

  assert.equal(result.status, 'complete');
  assert.deepEqual(result.results, [
    { status: 'invalid_slot', slotKey: 'native', warning: 'explicit_div_id_required' },
    { status: 'invalid_slot', slotKey: 'anchor', warning: 'explicit_div_id_required' },
    { status: 'filled', slotKey: 'native-leaderboard', domId: 'ad-leaderboard', type: 'native' }
  ]);
  assert.equal(fake.calls.defineSlot.length, 1);
  assert.equal(new Set(fake.calls.defineSlot.map(slot => slot.divId)).size, 1);
  assert.deepEqual(fake.calls.display, ['ad-leaderboard']);
  assert.equal(fake.calls.defineSlot.some(slot => slot.sizes === 'fluid'), false);
});

test('public preloadSlots unknown explicit div ID warns without requesting arbitrary inventory', async () => {
  const unknown = createFakeElement('publisher-made-up-slot', {
    style: { display: 'none', visibility: '' },
    offsetWidth: 0,
    offsetHeight: 0
  });
  const { experience, fake } = createJobGuideDisplayExperience({
    extraElements: {
      '#publisher-made-up-slot': unknown
    }
  });

  const result = await experience.preloadSlots(['publisher-made-up-slot']);

  assert.equal(result.status, 'complete');
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].status, 'invalid_slot');
  assert.equal(result.results[0].slotKey, 'publisher-made-up-slot');
  assert.match(result.results[0].warning, /No configured Price Optimiser placement/);
  assert.equal(fake.calls.defineSlot.length, 0);
  assert.equal(fake.calls.refresh.length, 0);
});

test('public refreshSlots explicit div IDs refresh only requested placements', async () => {
  const { experience, fake } = createJobGuideDisplayExperience({
    includeFluidDuplicates: false,
    hidden: false
  });

  await experience.init();
  await Promise.resolve();
  const initialDefineCount = fake.calls.defineSlot.length;
  const initialDisplayCount = fake.calls.display.length;

  const result = await experience.refreshSlots(['ad-leaderboard', 'ad-incontent']);

  assert.equal(result.status, 'complete');
  assert.deepEqual(result.results.map(item => item.slotKey), ['native-leaderboard', 'native-incontent']);
  assert.equal(fake.calls.defineSlot.length, initialDefineCount);
  assert.equal(fake.calls.display.length, initialDisplayCount);
  assert.deepEqual(fake.calls.refresh.slice(-2).map(batch => batch[0].divId), [
    'ad-leaderboard',
    'ad-incontent'
  ]);
  assert.equal(fake.calls.defineSlot.some(slot => String(slot.divId || '').startsWith('poexp-preload-')), false);
});

test('public refreshSlots uses the same native variant round1 waterfall on the publisher slot', async () => {
  let noFillRefresh = false;
  const { experience, fake } = createJobGuideDisplayExperience({
    includeFluidDuplicates: false,
    hidden: false,
    renderEmpty(slot) {
      return noFillRefresh && String(slot && slot.divId || '') === 'ad-leaderboard';
    }
  });

  await experience.init();
  await Promise.resolve();
  const initialDefineCount = fake.calls.defineSlot.length;
  const initialDisplayCount = fake.calls.display.length;
  noFillRefresh = true;

  const refresh = experience.refreshSlots(['ad-leaderboard']);
  await new Promise(resolve => setTimeout(resolve, 10));
  const result = await refresh;

  assert.equal(result.status, 'complete');
  assert.deepEqual(result.results, [
    { status: 'unavailable', slotKey: 'native-leaderboard', domId: 'ad-leaderboard', type: 'native' }
  ]);
  assert.equal(fake.calls.defineSlot.length, initialDefineCount);
  assert.equal(fake.calls.display.length, initialDisplayCount);
  assert.equal(fake.calls.defineSlot.some(slot => String(slot.divId || '').startsWith('poexp-preload-')), false);
  assert.deepEqual(fake.calls.refresh.slice(-4).map(batch => batch[0].divId), [
    'ad-leaderboard',
    'ad-leaderboard',
    'ad-leaderboard',
    'ad-leaderboard'
  ]);
  assert.deepEqual(fake.calls.refreshTargeting.slice(-4), [
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
    },
    {
      exp_group: 'variant',
      exp_key: 'ads_exp_v6',
      slot_name: 'native',
      refresh_round: '1',
      price_rule: '1'
    },
    {
      exp_group: 'variant',
      exp_key: 'ads_exp_v6',
      slot_name: 'native',
      refresh_round: '1'
    }
  ]);
});

test('public refreshSlots generic native token warns without expanding inventory', async () => {
  const { experience, fake } = createJobGuideDisplayExperience();

  const result = await experience.refreshSlots(['native']);

  assert.equal(result.status, 'complete');
  assert.deepEqual(result.results, [
    { status: 'invalid_slot', slotKey: 'native', warning: 'explicit_div_id_required' }
  ]);
  assert.equal(fake.calls.defineSlot.length, 0);
  assert.equal(fake.calls.refresh.length, 0);
});

test('default public preloadSlots prepares hidden display slots without requesting GPT or the publisher div', async () => {
  const fake = createFakeGpt();
  const hiddenSlot = createFakeElement('ad-leaderboard', {
    style: { display: 'none', visibility: '' },
    offsetWidth: 0,
    offsetHeight: 0
  });
  const documentRef = fakeDocument({
    '#ad-leaderboard': hiddenSlot
  });
  documentRef.documentElement.clientWidth = 390;
  const windowRef = Object.assign(fakeWindow(fake.googletag, 390), {
    getComputedStyle(element) {
      return element.style || {};
    }
  });
  const experience = createExperience({
    siteKey: 'jobguidematch.com',
    placements: [],
    interstitials: [],
    rewarded: []
  }, {
    windowRef,
    documentRef,
    fetchRef: fakeFetch({
      siteKey: 'jobguidematch.com',
      exp_group: 'variant',
      experiment: { enabled: true, expKey: 'ads_exp_v6' },
      targetingPolicy: { variant: ['exp_group', 'exp_key', 'slot_name', 'price_rule'] },
      slots: {
        'native-leaderboard': {
          slotKey: 'native-leaderboard',
          adUnitName: '/23360556473/jobguidematch.com_Native',
          adUnitType: 'native',
          domId: 'ad-leaderboard',
          domSelector: '#ad-leaderboard',
          sizes: [[320, 50], [728, 90]],
          waterfall: [3, 1],
          retryLimit: 2
        }
      }
    }),
    autoInit: false
  });

  const hiddenResult = await experience.preloadSlots(['ad-leaderboard']);

  assert.equal(hiddenResult.status, 'complete');
  assert.deepEqual(hiddenResult.results, [{
    status: 'prepared',
    slotKey: 'native-leaderboard',
    domId: 'ad-leaderboard',
    type: 'native'
  }]);
  assert.equal(fake.calls.defineSlot.length, 0);
  assert.deepEqual(fake.calls.display, []);
  assert.equal(hiddenSlot.children.length, 0);
  assert.equal(hiddenSlot.style.display, 'none');

  hiddenSlot.style.display = '';
  hiddenSlot.offsetWidth = 728;
  hiddenSlot.offsetHeight = 90;
  const visibleResult = await experience.revealSlots(['ad-leaderboard']);

  assert.equal(visibleResult.status, 'complete');
  assert.deepEqual(visibleResult.results.map(item => item.slotKey), ['native-leaderboard']);
  assert.equal(visibleResult.results[0].status, 'filled');
  assert.equal(visibleResult.results[0].filled, true);
  assert.equal(visibleResult.results[0].reason, 'filled');
  assert.equal(fake.calls.defineSlot.length, 1);
  assert.equal(fake.calls.defineSlot[0].divId, 'ad-leaderboard');
  assert.deepEqual(fake.calls.display, ['ad-leaderboard']);
  assert.equal(hiddenSlot.children.length, 0);

  const refreshResult = await experience.refreshAll();

  assert.equal(refreshResult.status, 'complete');
  assert.equal(refreshResult.results[0].status, 'filled');
  assert.equal(fake.calls.defineSlot.length, 1);
});

test('public revealSlots reuses a successful real display preload in the publisher div', async () => {
  const { experience, fake, elements } = createJobGuideDisplayExperience({
    includeFluidDuplicates: false,
    hidden: true
  });
  const slot = elements['#ad-leaderboard'];

  const preload = await experience.preloadSlots(['ad-leaderboard']);

  assert.equal(preload.status, 'complete');
  assert.equal(preload.results[0].status, 'filled');
  assert.equal(fake.calls.defineSlot.length, 1);
  assert.equal(fake.calls.defineSlot[0].divId, 'ad-leaderboard');
  assert.equal(slot.children.length, 0);
  assert.deepEqual(fake.calls.display, ['ad-leaderboard']);

  slot.style.display = '';
  slot.offsetWidth = 728;
  slot.offsetHeight = 90;
  const displayCount = fake.calls.display.length;
  const refreshCount = fake.calls.refresh.length;
  const reveal = await experience.revealSlots(['ad-leaderboard']);

  assert.equal(reveal.status, 'complete');
  assert.deepEqual(reveal.results, [{
    status: 'filled',
    slotKey: 'native-leaderboard',
    domId: 'ad-leaderboard',
    type: 'native',
    filled: true,
    reason: 'preloaded_revealed'
  }]);
  assert.equal(fake.calls.defineSlot.length, 1);
  assert.equal(fake.calls.defineSlot[0].divId, 'ad-leaderboard');
  assert.equal(fake.calls.display.length, displayCount);
  assert.equal(fake.calls.refresh.length, refreshCount);
  assert.equal(fake.calls.defineSlot.some(slot => slot.divId.startsWith('poexp-preload-')), false);
  assert.equal(slot.children.length, 0);
});

test('public preloadSlots can request explicit divs hidden by an ancestor in real mode', async () => {
  const fake = createFakeGpt();
  const wrapper = createFakeElement('reward-page', {
    style: { display: 'none', visibility: '' },
    offsetWidth: 0,
    offsetHeight: 0
  });
  const hiddenByAncestorSlot = createFakeElement('ad-leaderboard', {
    style: { display: '', visibility: '' },
    offsetWidth: 728,
    offsetHeight: 90
  });
  wrapper.appendChild(hiddenByAncestorSlot);
  const documentRef = fakeDocument({
    '#ad-leaderboard': hiddenByAncestorSlot
  });
  documentRef.documentElement.clientWidth = 1024;
  const windowRef = Object.assign(fakeWindow(fake.googletag, 1024), {
    getComputedStyle(element) {
      return element.style || {};
    }
  });
  const experience = createExperience({
    siteKey: 'jobguidematch.com',
    displayPreloadMode: 'real',
    placements: [],
    interstitials: [],
    rewarded: []
  }, {
    windowRef,
    documentRef,
    fetchRef: fakeFetch({
      siteKey: 'jobguidematch.com',
      exp_group: 'variant',
      experiment: { enabled: true, expKey: 'ads_exp_v6' },
      targetingPolicy: { variant: ['exp_group', 'exp_key', 'slot_name', 'price_rule'] },
      slots: {
        'native-leaderboard': {
          slotKey: 'native-leaderboard',
          adUnitName: '/23360556473/jobguidematch.com_Native',
          adUnitType: 'native',
          domId: 'ad-leaderboard',
          domSelector: '#ad-leaderboard',
          sizes: [[320, 50], [728, 90]],
          waterfall: [3, 1],
          retryLimit: 2
        }
      }
    }),
    autoInit: false
  });

  const result = await experience.preloadSlots(['ad-leaderboard']);

  assert.equal(result.status, 'complete');
  assert.deepEqual(result.results, [{
    status: 'filled',
    slotKey: 'native-leaderboard',
    domId: 'ad-leaderboard',
    type: 'native'
  }]);
  assert.equal(fake.calls.defineSlot.length, 1);
  assert.equal(fake.calls.defineSlot[0].divId, 'ad-leaderboard');
  assert.deepEqual(fake.calls.display, ['ad-leaderboard']);
  assert.equal(hiddenByAncestorSlot.children.length, 0);
});

test('public preloadSlots explicit intent overrides below-fold lazy timing in real mode', async () => {
  const fake = createFakeGpt();
  const belowFoldSlot = createFakeElement('ad-incontent', {
    top: 1800,
    offsetWidth: 336,
    offsetHeight: 280
  });
  const documentRef = fakeDocument({
    '#ad-incontent': belowFoldSlot
  });
  documentRef.documentElement.clientWidth = 390;
  const windowRef = Object.assign(fakeWindow(fake.googletag, 390), {
    innerHeight: 700,
    IntersectionObserver: class {
      observe() {}
      disconnect() {}
    },
    getComputedStyle(element) {
      return element.style || {};
    }
  });
  const experience = createExperience({
    siteKey: 'jobguidematch.com',
    displayPreloadMode: 'real',
    placements: [],
    interstitials: [],
    rewarded: []
  }, {
    windowRef,
    documentRef,
    fetchRef: fakeFetch({
      siteKey: 'jobguidematch.com',
      exp_group: 'variant',
      experiment: { enabled: true, expKey: 'ads_exp_v6' },
      targetingPolicy: { variant: ['exp_group', 'exp_key', 'slot_name', 'refresh_round', 'price_rule'] },
      slots: {
        'native-incontent': {
          slotKey: 'native-incontent',
          adUnitName: '/23360556473/jobguidematch.com_Native',
          adUnitType: 'native',
          domId: 'ad-incontent',
          domSelector: '#ad-incontent',
          sizes: [[300, 250], [336, 280]],
          waterfall: [3, 1],
          retryLimit: 2,
          visibilityFirst: true,
          lazyLoadMarginPx: 300
        }
      }
    }),
    autoInit: false
  });

  const result = await experience.preloadSlots(['ad-incontent']);

  assert.equal(result.status, 'complete');
  assert.deepEqual(result.results, [{
    status: 'filled',
    slotKey: 'native-incontent',
    domId: 'ad-incontent',
    type: 'native'
  }]);
  assert.equal(fake.calls.defineSlot.length, 1);
  assert.equal(fake.calls.defineSlot[0].divId, 'ad-incontent');
  assert.deepEqual(fake.calls.display, ['ad-incontent']);
  assert.equal(belowFoldSlot.children.length, 0);
});

test('public preloadRewarded caches a ready rewarded ad for the next showRewarded call', async () => {
  const { experience, fake } = createPublicExperience({
    siteKey: 'quiz-rush.com',
    experiment: { enabled: false },
    slots: {
      rewarded: {
        slotKey: 'rewarded',
        adUnitName: '/23360556473/quiz-rush.com_ad-rewarded',
        adUnitType: 'rewarded',
        rewardedRequestTimeoutMs: 1000
      }
    }
  });
  const callbacks = [];

  const preload = await experience.preloadRewarded({
    onReady: () => callbacks.push('preload-ready')
  });

  assert.deepEqual(preload, { status: 'ready' });
  assert.deepEqual(callbacks, ['preload-ready']);
  assert.equal(fake.calls.defineOutOfPageSlot.length, 1);
  assert.equal(fake.calls.rewardedVisible.length, 0);

  const reusedPreload = await experience.preloadRewarded({
    onReady: () => callbacks.push('preload-ready-again')
  });

  assert.deepEqual(reusedPreload, { status: 'ready' });
  assert.deepEqual(callbacks, ['preload-ready', 'preload-ready-again']);
  assert.equal(fake.calls.defineOutOfPageSlot.length, 1);
  assert.equal(fake.calls.rewardedVisible.length, 0);

  const result = await experience.showRewarded({
    onReady: () => callbacks.push('show-ready'),
    onGranted: detail => callbacks.push(`granted:${detail.reward.type}`),
    onClosed: () => callbacks.push('closed'),
    onFallback: detail => callbacks.push(`fallback:${detail.status}`)
  });

  assert.deepEqual(result, {
    status: 'granted',
    reward: { type: 'publisher-owned' }
  });
  assert.deepEqual(callbacks, ['preload-ready', 'preload-ready-again', 'show-ready', 'granted:publisher-owned', 'closed']);
  assert.equal(fake.calls.defineOutOfPageSlot.length, 1);
  assert.equal(fake.calls.rewardedVisible.length, 1);
});

test('display placements are set up before DOM ready when target already exists', async () => {
  const fake = createFakeGpt();
  const documentRef = fakeDocument({
    '#ad-anchor': { id: 'ad-anchor' }
  }, 'loading');
  const windowRef = fakeWindow(fake.googletag);
  const experience = createExperience({
    siteKey: 'quiz-rush.com',
    placements: [
      { slotKey: 'ad-anchor', selector: '#ad-anchor', aliases: ['anchor'], adUnitType: 'anchor' }
    ],
    interstitials: [],
    rewarded: []
  }, {
    windowRef,
    documentRef,
    fetchRef: fakeFetch({
      siteKey: 'quiz-rush.com',
      experiment: { enabled: false },
      slots: {
        anchor: {
          slotKey: 'anchor',
          adUnitName: '/23360556473/quiz-rush.com_ad-anchor',
          adUnitType: 'anchor',
          domId: 'ad-anchor',
          domSelector: '#ad-anchor',
          sizes: [[320, 50], [728, 90]]
        }
      }
    }),
    autoInit: false
  });

  await experience.init();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(fake.calls.defineSlot.length, 1);
  assert.equal(fake.calls.defineSlot[0].divId, 'ad-anchor');
  assert.deepEqual(fake.calls.defineSlot[0].sizes, [[320, 50], [728, 90]]);
});

test('public rewarded API exposes lifecycle callbacks without reward copy', async () => {
  const { experience, fake } = createPublicExperience({
    siteKey: 'quiz-rush.com',
    experiment: { enabled: false },
    slots: {
      rewarded: {
        slotKey: 'rewarded',
        adUnitName: '/23360556473/quiz-rush.com_ad-rewarded',
        adUnitType: 'rewarded',
        rewardedRequestTimeoutMs: 1000
      }
    }
  });
  const callbacks = [];

  const result = await experience.showRewarded({
    onReady: () => callbacks.push('ready'),
    onGranted: detail => callbacks.push(`granted:${detail.reward.type}`),
    onClosed: () => callbacks.push('closed'),
    onFallback: detail => callbacks.push(`fallback:${detail.status}`)
  });

  assert.deepEqual(result, {
    status: 'granted',
    reward: { type: 'publisher-owned' }
  });
  assert.deepEqual(callbacks, ['ready', 'granted:publisher-owned', 'closed']);
  assert.equal(fake.calls.defineOutOfPageSlot[0].format, 'REWARDED');
});
