import test from 'node:test';
import assert from 'node:assert/strict';

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
    clearTargeting(key) {
      if (key) delete this.targeting[key];
      else this.targeting = {};
      return this;
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
    parentElement: null,
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
      child.parentElement = this;
      children.push(child);
      this.firstChild = children[0] || null;
      return child;
    },
    removeChild(child) {
      const index = children.indexOf(child);
      if (index !== -1) children.splice(index, 1);
      if (child) {
        child.parentNode = null;
        child.parentElement = null;
      }
      this.firstChild = children[0] || null;
      return child;
    },
    dispatchEvent(event) {
      return !event.defaultPrevented;
    },
    closest(selector) {
      if (!selector) return null;
      if (selector.includes(`#${this.id}`)) return this;
      return null;
    },
    getBoundingClientRect() {
      const top = options.top == null ? 0 : options.top;
      const width = Number(this.offsetWidth) || 0;
      const height = Number(this.offsetHeight) || 0;
      return {
        left: 0,
        top,
        right: width,
        bottom: top + height,
        width,
        height
      };
    }
  };
}

function createFakeDocument(elements, currentScript) {
  const listeners = new Map();
  const documentRef = {
    readyState: 'complete',
    currentScript,
    body: createFakeElement('body'),
    documentElement: {
      clientWidth: 1024,
      clientHeight: 768
    },
    head: {
      appendChild() {}
    },
    querySelector(selector) {
      if (selector.startsWith('script[src*=')) return currentScript;
      return elements[selector] || null;
    },
    getElementById(id) {
      return elements[id] || elements[`#${id}`] || null;
    },
    createElement() {
      return createFakeElement('');
    },
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
    },
    removeEventListener(name, listener) {
      if (listeners.has(name)) listeners.get(name).delete(listener);
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) || []) listener(event);
      return !event.defaultPrevented;
    },
    listenerCount(name) {
      return listeners.get(name) ? listeners.get(name).size : 0;
    }
  };
  documentRef.body.parentNode = documentRef;
  documentRef.body.parentElement = null;
  return documentRef;
}

function createFakeWindow(googletag, documentRef) {
  const listeners = new Map();
  const storage = new Map();
  return {
    document: documentRef,
    googletag,
    sessionStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      }
    },
    location: {
      href: 'https://jobguidematch.com/find/apply/acme?utm=1',
      hostname: 'jobguidematch.com',
      origin: 'https://jobguidematch.com',
      pathname: '/find/apply/acme',
      search: '?utm=1'
    },
    innerWidth: 1024,
    innerHeight: 768,
    screen: { width: 1024 },
    getComputedStyle(element) {
      return element && element.style ? element.style : {};
    },
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
    },
    removeEventListener(name, listener) {
      if (listeners.has(name)) listeners.get(name).delete(listener);
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) || []) listener(event);
      return !event.defaultPrevented;
    },
    listenerCount(name) {
      return listeners.get(name) ? listeners.get(name).size : 0;
    }
  };
}

function createFakeGpt({ renderEmpty } = {}) {
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
    for (const listener of Array.from(listeners.get(name) || [])) listener(event);
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
    calls.refreshTargeting.push({
      slot,
      divId: slot.divId || null,
      targeting: Object.assign({}, slot.targeting)
    });
    const decision = typeof renderEmpty === 'function' ? renderEmpty(slot, renderIndex) : renderEmpty;
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
      for (const slot of slots) requestSlot(slot);
    },
    set() {
      return this;
    },
    listenerCount(name) {
      return listeners.get(name) ? listeners.get(name).size : 0;
    }
  };
  return {
    calls,
    pubads,
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

function jobGuideRuntime() {
  const displayExperiment = {
    enabled: true,
    expKey: 'ads_exp_v6',
    key: 'ads_exp_v6',
    variantPercentage: 1,
    variant: {
      baseFloor: 3,
      ladder: [3, 1],
      refreshLadders: [[5, 3, 1]],
      expKey: 'ads_exp_v6'
    },
    control: {
      enabled: true,
      expKey: 'ads_exp_v6'
    }
  };
  const displayPolicy = {
    control: ['exp_group', 'exp_key', 'slot_name', 'refresh_round'],
    variant: ['exp_group', 'exp_key', 'slot_name', 'refresh_round', 'price_rule']
  };
  return {
    siteKey: 'jobguidematch.com',
    exp_group: 'variant',
    experiment: { enabled: true, expKey: 'ads_exp_v5', key: 'ads_exp_v5', variantPercentage: 1 },
    targetingPolicy: { variant: ['exp_group', 'exp_key', 'slot_name', 'refresh_round', 'price_rule'] },
    slots: {
      'native-leaderboard': {
        slotKey: 'native-leaderboard',
        adUnitName: '/23360556473/jobguidematch.com_Native',
        adUnitType: 'native',
        domId: 'ad-leaderboard',
        domSelector: '#ad-leaderboard',
        sizes: [[320, 50], [728, 90]],
        waterfall: [3, 1],
        retryLimit: 2,
        retryDelayMs: 0,
        refreshEnabled: true,
        refreshDelayMs: 30000,
        maximumRefreshes: 1,
        refreshLadders: [[5, 3, 1]],
        refreshRoundTargetingKey: 'refresh_round',
        targetingPolicy: displayPolicy,
        experiment: displayExperiment
      },
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
        maximumRefreshes: 1,
        refreshLadders: [[5, 3, 1]],
        refreshRoundTargetingKey: 'refresh_round',
        targetingPolicy: displayPolicy,
        experiment: displayExperiment
      },
      rewarded: {
        slotKey: 'rewarded',
        adUnitName: '/23360556473/jobguidematch.com_Rewarded',
        adUnitType: 'rewarded',
        waterfall: [300],
        retryLimit: 1,
        maximumRewardedAttempts: 1,
        rewardedAttemptTimeoutMs: 500,
        rewardedRequestTimeoutMs: 500,
        experiment: {
          enabled: true,
          expKey: 'ads_exp_v5',
          key: 'ads_exp_v5',
          variantPercentage: 1
        }
      }
    }
  };
}

function installFakeBrowser() {
  const elements = {
    '#ad-leaderboard': createFakeElement('ad-leaderboard', {
      style: { display: '', visibility: '' },
      offsetWidth: 728,
      offsetHeight: 90
    }),
    '#ad-anchor': createFakeElement('ad-anchor', {
      style: { display: '', visibility: '' },
      offsetWidth: 728,
      offsetHeight: 90
    })
  };
  const rewardDestination = createFakeElement('reward-destination', {
    style: { display: 'none', visibility: '' },
    offsetWidth: 728,
    offsetHeight: 90
  });
  rewardDestination.appendChild(elements['#ad-leaderboard']);
  rewardDestination.appendChild(elements['#ad-anchor']);
  const currentScript = {
    src: 'https://priceoptimiser1.thebesads.com/experiences/jobguidematch.com.js',
    dataset: {
      poSite: 'wrong.example',
      autoInit: 'true'
    }
  };
  const fake = createFakeGpt({
    renderEmpty(slot) {
      return String(slot && slot.divId || '') === 'ad-leaderboard';
    }
  });
  const documentRef = createFakeDocument(elements, currentScript);
  const windowRef = createFakeWindow(fake.googletag, documentRef);
  const fetchCalls = [];
  const fetchRef = async url => {
    fetchCalls.push(String(url));
    return {
      ok: true,
      json: async () => jobGuideRuntime()
    };
  };
  return { elements, fake, documentRef, windowRef, fetchCalls, fetchRef, rewardDestination };
}

class FakeCustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.bubbles = Boolean(options.bubbles);
    this.cancelable = Boolean(options.cancelable);
    this.detail = options.detail || null;
    this.defaultPrevented = false;
  }

  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true;
  }
}

function restoreGlobal(name, value) {
  if (value === undefined) delete globalThis[name];
  else globalThis[name] = value;
}

async function waitForZeroDelayLadder() {
  for (let index = 0; index < 6; index += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

test('JobGuideMatch site entrypoint pins site identity and preserves owned ad lifecycles', async () => {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    fetch: globalThis.fetch,
    CustomEvent: globalThis.CustomEvent
  };
  const { elements, fake, documentRef, windowRef, fetchCalls, fetchRef, rewardDestination } = installFakeBrowser();

  globalThis.window = windowRef;
  globalThis.document = documentRef;
  globalThis.fetch = fetchRef;
  globalThis.CustomEvent = FakeCustomEvent;

  try {
    const moduleUrl = new URL('../src/sites/jobguidematch.js', import.meta.url);
    moduleUrl.searchParams.set('entrypoint-test', `${Date.now()}-${Math.random()}`);
    const { jobGuideMatch, jobGuideMatchExperience } = await import(moduleUrl.href);

    assert.equal(jobGuideMatchExperience.siteKey, 'jobguidematch.com');
    assert.equal(windowRef.PublisherExperienceSDK.jobGuideMatch, jobGuideMatch);
    assert.equal(windowRef.PublisherExperience, jobGuideMatch);
    assert.equal(windowRef.PriceOptimiserExperience, jobGuideMatch);

    const { runtime } = await jobGuideMatch.init();
    assert.equal(runtime.siteKey, 'jobguidematch.com');
    assert.equal(jobGuideMatch.status().siteKey, 'jobguidematch.com');
    assert.equal(fetchCalls.length, 1);
    assert.match(fetchCalls[0], /[?&]site=jobguidematch\.com(?:&|$)/);
    assert.equal(fetchCalls[0].includes('wrong.example'), false);

    const clickListeners = documentRef.listenerCount('click');
    const gptRenderListeners = fake.pubads.listenerCount('slotRenderEnded');
    await jobGuideMatch.init();
    assert.equal(fetchCalls.length, 1);
    assert.equal(documentRef.listenerCount('click'), clickListeners);
    assert.equal(fake.pubads.listenerCount('slotRenderEnded'), gptRenderListeners);

    const preloadPromise = jobGuideMatch.preloadSlots(['ad-leaderboard', 'ad-anchor']);
    await waitForZeroDelayLadder();
    const preloaded = await preloadPromise;
    assert.deepEqual(preloaded.results.map(item => [item.slotKey, item.domId, item.status]), [
      ['native-leaderboard', 'ad-leaderboard', 'no_fill'],
      ['anchor', 'ad-anchor', 'filled']
    ]);
    assert.deepEqual(fake.calls.defineSlot.map(slot => slot.divId), ['ad-leaderboard', 'ad-anchor']);
    assert.equal(fake.calls.defineSlot.some(slot => String(slot.divId || '').startsWith('poexp-preload-')), false);
    assert.deepEqual(fake.calls.display.filter(item => typeof item === 'string'), ['ad-leaderboard', 'ad-anchor']);
    assert.equal(fake.calls.refresh.length, 2);

    const rewardedPreload = await jobGuideMatch.preloadRewarded();
    assert.deepEqual(rewardedPreload, { status: 'ready' });
    assert.equal(fake.calls.defineOutOfPageSlot.length, 1);
    assert.equal(fake.calls.display.filter(item => item && item.format === 'REWARDED').length, 1);
    assert.equal(fake.calls.refresh.length, 2);

    const displayCountBeforeShow = fake.calls.display.length;
    const refreshCountBeforeShow = fake.calls.refresh.length;
    const reward = await jobGuideMatch.showRewarded();
    assert.equal(reward.status, 'granted');
    assert.equal(fake.calls.display.length, displayCountBeforeShow);
    assert.equal(fake.calls.refresh.length, refreshCountBeforeShow);
    assert.equal(fake.calls.rewardedVisible.length, 1);

    rewardDestination.style.display = '';
    for (const element of Object.values(elements)) {
      element.style.display = '';
      element.offsetWidth = 728;
      element.offsetHeight = 90;
    }

    const revealPromise = jobGuideMatch.revealSlots(['ad-leaderboard', 'ad-anchor']);
    await waitForZeroDelayLadder();
    const reveal = await revealPromise;
    assert.deepEqual(reveal.results.map(item => [item.slotKey, item.domId, item.status]), [
      ['native-leaderboard', 'ad-leaderboard', 'no_fill'],
      ['anchor', 'ad-anchor', 'filled']
    ]);
    assert.deepEqual(fake.calls.defineSlot.map(slot => slot.divId), ['ad-leaderboard', 'ad-anchor']);
    assert.equal(fake.calls.defineSlot.some(slot => String(slot.divId || '').startsWith('poexp-preload-')), false);
    assert.deepEqual(fake.calls.display.filter(item => typeof item === 'string'), ['ad-leaderboard', 'ad-anchor']);

    const nativeTargeting = fake.calls.refreshTargeting
      .filter(item => item.divId === 'ad-leaderboard')
      .map(item => item.targeting);
    assert.deepEqual(nativeTargeting, [
      {
        exp_group: 'variant',
        exp_key: 'ads_exp_v6',
        slot_name: 'native',
        refresh_round: '0',
        price_rule: '3'
      },
      {
        exp_group: 'variant',
        exp_key: 'ads_exp_v6',
        slot_name: 'native',
        refresh_round: '0',
        price_rule: '1'
      },
      {
        exp_group: 'variant',
        exp_key: 'ads_exp_v6',
        slot_name: 'native',
        refresh_round: '0'
      },
      {
        exp_group: 'variant',
        exp_key: 'ads_exp_v6',
        slot_name: 'native',
        refresh_round: '0',
        price_rule: '3'
      },
      {
        exp_group: 'variant',
        exp_key: 'ads_exp_v6',
        slot_name: 'native',
        refresh_round: '0',
        price_rule: '1'
      },
      {
        exp_group: 'variant',
        exp_key: 'ads_exp_v6',
        slot_name: 'native',
        refresh_round: '0'
      }
    ]);
    assert.equal(Object.prototype.hasOwnProperty.call(nativeTargeting.at(-1), 'price_rule'), false);

    const anchorTargeting = fake.calls.refreshTargeting
      .filter(item => item.divId === 'ad-anchor')
      .map(item => item.targeting);
    assert.deepEqual(anchorTargeting, [{
      exp_group: 'variant',
      exp_key: 'ads_exp_v6',
      slot_name: 'anchor',
      refresh_round: '0',
      price_rule: '3'
    }]);

    jobGuideMatch.destroy();
    assert.equal(documentRef.listenerCount('click'), 0);
  } finally {
    restoreGlobal('window', previous.window);
    restoreGlobal('document', previous.document);
    restoreGlobal('fetch', previous.fetch);
    restoreGlobal('CustomEvent', previous.CustomEvent);
  }
});
