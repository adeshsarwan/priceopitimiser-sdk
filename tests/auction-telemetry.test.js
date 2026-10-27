import test from 'node:test';
import assert from 'node:assert/strict';
import { PriceOptimiserRuntimeAdapter } from '../src/core/price-optimiser-runtime.js';
import { createAuctionTelemetry } from '../src/core/telemetry.js';

function wait(ms = 0) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function drain(state, ticks = 8) {
  for (let index = 0; index < ticks; index += 1) await wait(0);
  if (state && state.requestPromise) await state.requestPromise;
  await wait(0);
}

function createFakeElement(id, options = {}) {
  const element = {
    id,
    hidden: Boolean(options.hidden),
    style: Object.assign({ display: '', visibility: '' }, options.style || {}),
    parentNode: null,
    parentElement: null,
    offsetWidth: options.offsetWidth == null ? 728 : options.offsetWidth,
    offsetHeight: options.offsetHeight == null ? 90 : options.offsetHeight,
    dataset: {},
    attributes: {},
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
    getBoundingClientRect() {
      const width = Number(this.offsetWidth) || 0;
      const height = Number(this.offsetHeight) || 0;
      return { left: 0, top: 0, right: width, bottom: height, width, height };
    }
  };
  return element;
}

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
    clearTargeting(key) {
      if (key == null) this.targeting = {};
      else delete this.targeting[key];
      return this;
    },
    getSlotElementId() {
      return this.divId || '';
    }
  };
}

function createFakeGpt({ renderDecisions = [] } = {}) {
  const listeners = new Map();
  const slotsByDivId = new Map();
  const calls = {
    defineSlot: [],
    display: [],
    refresh: [],
    targeting: []
  };
  let requestIndex = 0;

  const emit = (name, event) => {
    for (const listener of Array.from(listeners.get(name) || [])) listener(event);
  };
  const nextDecision = slot => {
    if (typeof renderDecisions === 'function') return renderDecisions(slot, requestIndex++);
    const decision = renderDecisions[Math.min(requestIndex, renderDecisions.length - 1)];
    requestIndex += 1;
    return decision;
  };
  const requestSlot = slot => {
    calls.targeting.push(Object.assign({}, slot.targeting));
    emit('slotRequested', { slot });
    emit('slotResponseReceived', { slot });
    const decision = nextDecision(slot);
    if (decision === 'pending') return;
    emit('slotRenderEnded', {
      slot,
      isEmpty: Boolean(decision),
      creativeId: decision ? null : 'creative-1',
      lineItemId: decision ? null : 'line-1',
      advertiserId: decision ? null : 'advertiser-1'
    });
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
      const slot = createFakeSlot({ path, sizes, divId });
      slotsByDivId.set(divId, slot);
      calls.defineSlot.push(slot);
      return slot;
    },
    display(slotOrDivId) {
      calls.display.push(slotOrDivId);
      requestSlot(typeof slotOrDivId === 'string' ? slotsByDivId.get(slotOrDivId) : slotOrDivId);
    },
    setConfig() {},
    enableServices() {}
  };

  return { googletag, pubads, calls, emit };
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

function telemetryRuntime(expGroup = 'variant', overrides = {}) {
  return Object.assign({
    siteKey: 'jobguidematch.com',
    exp_group: expGroup,
    experiment: { enabled: true, expKey: 'ads_exp_v5', variantPercentage: 0.8 },
    telemetry: {
      enabled: true,
      endpoint: 'https://priceoptimiser1.thebesads.test/telemetry/auction-events',
      sampleRate: 1,
      maxBatchSize: 100,
      maxQueueSize: 300,
      flushIntervalMs: 60000
    },
    slots: {}
  }, overrides);
}

function nativeAnchorConfig(type = 'native', overrides = {}) {
  const isAnchor = type === 'anchor';
  return Object.assign({
    slotKey: isAnchor ? 'anchor' : 'native-leaderboard',
    adUnitName: `/23360556473/jobguidematch.com_${isAnchor ? 'Anchor' : 'Native'}`,
    adUnitType: type,
    domId: isAnchor ? 'ad-anchor' : 'ad-leaderboard',
    domSelector: isAnchor ? '#ad-anchor' : '#ad-leaderboard',
    sizes: isAnchor ? [[320, 50], [728, 90]] : [[320, 50], [728, 90]],
    waterfall: [3, 1],
    retryLimit: 2,
    retryDelayMs: 0,
    requestTimeoutMs: 1000,
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
      variant: { enabled: true, baseFloor: 3, ladder: [3, 1], expKey: 'ads_exp_v6' }
    }
  }, overrides);
}

function adapterFor({ expGroup = 'variant', type = 'native', renderDecisions = [false], runtimeOverrides = {}, configOverrides = {}, displayPreloadMode, href } = {}) {
  const fake = createFakeGpt({ renderDecisions });
  const posts = [];
  let now = 0;
  const elementId = type === 'anchor' ? 'ad-anchor' : 'ad-leaderboard';
  const element = createFakeElement(elementId);
  const windowRef = {
    googletag: fake.googletag,
    __publisherExperienceSlots: {},
    sessionStorage: { getItem() { return null; }, setItem() {} },
    location: locationFor(href || 'https://jobguidematch.com/worldwide/?q=secret'),
    innerWidth: 1024,
    innerHeight: 900,
    performance: { now: () => { now += 5; return now; } },
    navigator: {},
    addEventListener() {},
    removeEventListener() {},
    getComputedStyle(item) {
      return item.style || {};
    },
    fetch: async (url, options) => {
      posts.push({ url, payload: JSON.parse(options.body), options });
      return { ok: true, status: 204 };
    }
  };
  const documentRef = {
    visibilityState: 'visible',
    hidden: false,
    documentElement: { clientWidth: 1024, clientHeight: 900 },
    head: { appendChild() {} },
    addEventListener() {},
    removeEventListener() {},
    createElement() {
      return createFakeElement('');
    },
    getElementById(id) {
      return id === elementId ? element : null;
    },
    querySelector(selector) {
      return selector === `#${elementId}` ? element : null;
    }
  };
  const adapter = new PriceOptimiserRuntimeAdapter({
    windowRef,
    documentRef,
    runtime: telemetryRuntime(expGroup, runtimeOverrides),
    logger: { debug() {}, warn() {} },
    displayPreloadMode
  });
  return {
    adapter,
    fake,
    posts,
    element,
    config: nativeAnchorConfig(type, configOverrides),
    elementId
  };
}

async function flushEvents(adapter, posts) {
  await adapter.telemetry.flushNow();
  await adapter.telemetry.settle();
  return posts.flatMap(post => post.payload.events);
}

function eventsOf(events, type) {
  return events.filter(event => event.event_type === type);
}

test('variant Native successful high floor emits one opportunity without fallback', async () => {
  const { adapter, posts, config } = adapterFor({ renderDecisions: [false] });
  const state = await adapter.definePlacement({ slotKey: 'native-leaderboard', elementId: 'ad-leaderboard', config });
  if (state.requestPromise) await state.requestPromise;
  const events = await flushEvents(adapter, posts);
  const requests = eventsOf(events, 'gam_request_started');

  assert.equal(eventsOf(events, 'opportunity_created').length, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].request_method, 'display');
  assert.equal(requests[0].attempt_number, 1);
  assert.equal(requests[0].price_rule, '3');
  assert.equal(eventsOf(events, 'attempt_filled').length, 1);
  assert.equal(eventsOf(events, 'fallback_started').length, 0);
  assert.equal(eventsOf(events, 'opportunity_completed').at(-1).status, 'filled');
});

test('paid traffic attribution is sent to GAM but excluded from auction telemetry payloads', async () => {
  const { adapter, fake, posts, config } = adapterFor({
    href: 'https://jobguidematch.com/worldwide/?utm_source=gdisplay&utm_campaign=24175854605'
  });
  const state = await adapter.definePlacement({ slotKey: 'native-leaderboard', elementId: 'ad-leaderboard', config });
  if (state.requestPromise) await state.requestPromise;
  const events = await flushEvents(adapter, posts);
  const request = eventsOf(events, 'gam_request_started')[0];
  const serializedEvents = JSON.stringify(events);

  assert.equal(fake.calls.targeting[0].utm_source, 'gdisplay');
  assert.equal(fake.calls.targeting[0].utm_campaign, '24175854605');
  assert.equal(Object.prototype.hasOwnProperty.call(request.targeting_snapshot, 'utm_source'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(request.targeting_snapshot, 'utm_campaign'), false);
  assert.equal(serializedEvents.includes('utm_source'), false);
  assert.equal(serializedEvents.includes('24175854605'), false);
});

test('variant Native complete fallback keeps one opportunity id and removes price_rule', async () => {
  const { adapter, posts, config } = adapterFor({ renderDecisions: [true, true, true] });
  const state = await adapter.definePlacement({ slotKey: 'native-leaderboard', elementId: 'ad-leaderboard', config });
  await drain(state);
  const events = await flushEvents(adapter, posts);
  const opportunityIds = new Set(events.filter(event => event.opportunity_id).map(event => event.opportunity_id));
  const requests = eventsOf(events, 'gam_request_started');
  const fallback = requests[2];

  assert.equal(opportunityIds.size, 1);
  assert.deepEqual(requests.map(event => event.attempt_number), [1, 2, 3]);
  assert.deepEqual(requests.map(event => event.request_method), ['display', 'refresh', 'refresh']);
  assert.deepEqual(requests.map(event => event.price_rule || null), ['3', '1', null]);
  assert.equal(fallback.is_fallback, true);
  assert.equal(Object.prototype.hasOwnProperty.call(fallback, 'price_rule'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(fallback.targeting_snapshot, 'price_rule'), false);
  assert.equal(eventsOf(events, 'fallback_started').length, 1);
  assert.equal(eventsOf(events, 'fallback_completed').length, 1);
  assert.equal(eventsOf(events, 'opportunity_completed').at(-1).status, 'unavailable');
});

test('control opportunity emits one unpriced display request', async () => {
  const { adapter, posts, config } = adapterFor({ expGroup: 'control', renderDecisions: [false] });
  const state = await adapter.definePlacement({ slotKey: 'native-leaderboard', elementId: 'ad-leaderboard', config });
  if (state.requestPromise) await state.requestPromise;
  const events = await flushEvents(adapter, posts);
  const requests = eventsOf(events, 'gam_request_started');

  assert.equal(requests.length, 1);
  assert.equal(requests[0].exp_group, 'control');
  assert.equal(requests[0].request_method, 'display');
  assert.equal(Object.prototype.hasOwnProperty.call(requests[0], 'price_rule'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(requests[0].targeting_snapshot, 'price_rule'), false);
  assert.equal(eventsOf(events, 'fallback_started').length, 0);
  assert.equal(eventsOf(events, 'opportunity_completed').at(-1).status, 'filled');
});

test('Anchor fallback telemetry matches Native attempt sequencing', async () => {
  const { adapter, posts, config } = adapterFor({ type: 'anchor', renderDecisions: [true, true, false] });
  const state = await adapter.definePlacement({ slotKey: 'anchor', elementId: 'ad-anchor', config });
  await drain(state);
  const events = await flushEvents(adapter, posts);
  const requests = eventsOf(events, 'gam_request_started');

  assert.deepEqual(requests.map(event => [event.slot_name, event.attempt_number, event.price_rule || null]), [
    ['anchor', 1, '3'],
    ['anchor', 2, '1'],
    ['anchor', 3, null]
  ]);
  assert.equal(eventsOf(events, 'attempt_no_fill').length, 2);
  assert.equal(eventsOf(events, 'attempt_filled').length, 1);
  assert.equal(eventsOf(events, 'fallback_completed')[0].status, 'filled');
});

test('refresh round is stable through one refresh opportunity and scheduled refresh gets a new opportunity id', async () => {
  const { adapter, posts, config } = adapterFor({ renderDecisions: [false, true, true, true] });
  const state = await adapter.definePlacement({ slotKey: 'native-leaderboard', elementId: 'ad-leaderboard', config });
  if (state.requestPromise) await state.requestPromise;
  const initialOpportunityId = state.opportunity.opportunityId;
  const refreshPromise = adapter.requestDisplayRefresh(state, { opportunitySource: 'scheduled_refresh' });
  await drain(state);
  await refreshPromise;
  const events = await flushEvents(adapter, posts);
  const refreshRequests = eventsOf(events, 'gam_request_started').slice(1);

  assert.notEqual(state.opportunity.opportunityId, initialOpportunityId);
  assert.equal(eventsOf(events, 'refresh_opportunity_started').length, 1);
  assert.deepEqual(refreshRequests.map(event => event.refresh_round), ['1', '1', '1', '1']);
  assert.deepEqual(refreshRequests.map(event => event.opportunity_source), [
    'scheduled_refresh',
    'scheduled_refresh',
    'scheduled_refresh',
    'scheduled_refresh'
  ]);
});

test('real preload fill emits reveal without a second initial auction', async () => {
  const { adapter, fake, posts, config } = adapterFor({ renderDecisions: [false], displayPreloadMode: 'real' });
  const preload = await adapter.preloadDisplaySlot({ slotKey: 'native-leaderboard', elementId: 'ad-leaderboard', config });
  const state = preload.state;
  const displayCount = fake.calls.display.length;
  const refreshCount = fake.calls.refresh.length;
  const reveal = await adapter.revealDisplayState(state);
  const events = await flushEvents(adapter, posts);

  assert.equal(preload.status, 'filled');
  assert.equal(reveal.status, 'filled');
  assert.equal(fake.calls.display.length, displayCount);
  assert.equal(fake.calls.refresh.length, refreshCount);
  assert.equal(eventsOf(events, 'preload_started').length, 1);
  assert.equal(eventsOf(events, 'preload_completed').length, 1);
  assert.equal(eventsOf(events, 'reveal_started').length, 1);
  assert.equal(eventsOf(events, 'reveal_completed').length, 1);
  assert.equal(eventsOf(events, 'gam_request_started').length, 1);
});

test('preload no-fill reveal recovery is marked as reveal_recovery on the same opportunity', async () => {
  const { adapter, posts, config, element } = adapterFor({ renderDecisions: [true, true, true, false], displayPreloadMode: 'real' });
  const preloadPromise = adapter.preloadDisplaySlot({ slotKey: 'native-leaderboard', elementId: 'ad-leaderboard', config });
  await wait(0);
  const state = adapter.registry['display:ad-leaderboard'];
  await drain(state);
  const preload = await preloadPromise;
  const opportunityId = state.opportunity.opportunityId;
  const parent = createFakeElement('ad-shell');
  element.parentElement = parent;
  element.parentNode = parent;
  const reveal = await adapter.revealDisplayState(state);
  const events = await flushEvents(adapter, posts);
  const requests = eventsOf(events, 'gam_request_started');
  const recoveryRequest = requests.at(-1);

  assert.equal(preload.status, 'no_fill');
  assert.equal(reveal.status, 'filled');
  assert.equal(state.opportunity.opportunityId, opportunityId);
  assert.equal(new Set(events.filter(event => event.opportunity_id).map(event => event.opportunity_id)).size, 1);
  assert.equal(recoveryRequest.opportunity_source, 'reveal_recovery');
  assert.equal(recoveryRequest.price_rule, '3');
});

test('telemetry fetch rejection and HTTP failure do not change auction promises', async () => {
  const failureCases = [
    async () => { throw new Error('network down'); },
    async () => ({ ok: false, status: 500 })
  ];

  for (const fetchImpl of failureCases) {
    const { adapter, config } = adapterFor({ renderDecisions: [false] });
    adapter.window.fetch = fetchImpl;
    const state = await adapter.definePlacement({ slotKey: 'native-leaderboard', elementId: 'ad-leaderboard', config });
    const result = state.requestPromise ? await state.requestPromise : { status: 'filled' };

    assert.equal(result.status, 'filled');
    await adapter.telemetry.flushNow();
    await adapter.telemetry.settle();
  }
});

test('telemetry queue is bounded and batches events', async () => {
  const posts = [];
  const windowRef = {
    location: { pathname: '/worldwide/' },
    navigator: {},
    fetch: async (url, options) => {
      posts.push(JSON.parse(options.body));
      return { ok: true };
    }
  };
  const telemetry = createAuctionTelemetry({
    windowRef,
    documentRef: {},
    runtime: {
      siteKey: 'jobguidematch.com',
      telemetry: {
        enabled: true,
        endpoint: 'https://priceoptimiser1.thebesads.test/telemetry/auction-events',
        sampleRate: 1,
        maxBatchSize: 50,
        maxQueueSize: 60,
        flushIntervalMs: 60000
      }
    }
  });

  for (let index = 0; index < 80; index += 1) {
    telemetry.emit({ event_type: 'gam_request_started', opportunity_id: `opp-${index}` });
  }
  assert.equal(telemetry.pendingCount, 60);
  await telemetry.flushNow();
  await telemetry.settle();
  assert.equal(posts[0].events.length, 50);
  assert.equal(telemetry.pendingCount, 10);
  await telemetry.flushNow();
  await telemetry.settle();
  assert.equal(posts[1].events.length, 10);
});

test('opportunity sampling is deterministic and per-opportunity', () => {
  const telemetry = createAuctionTelemetry({
    windowRef: { location: { pathname: '/worldwide/' }, navigator: {} },
    documentRef: {},
    runtime: {
      siteKey: 'jobguidematch.com',
      telemetry: {
        enabled: true,
        endpoint: 'https://priceoptimiser1.thebesads.test/telemetry/auction-events',
        sampleRate: 0.5
      }
    }
  });

  assert.equal(telemetry.markSampled('native-opportunity-1'), telemetry.markSampled('native-opportunity-1'));
  assert.equal(telemetry.markSampled('native-opportunity-2'), telemetry.markSampled('native-opportunity-2'));
});

test('late GPT slotRenderEnded after timeout is represented without throwing', async () => {
  const { adapter, fake, posts, config } = adapterFor({
    renderDecisions: ['pending'],
    configOverrides: { requestTimeoutMs: 5 }
  });
  const state = await adapter.definePlacement({ slotKey: 'native-leaderboard', elementId: 'ad-leaderboard', config });
  await wait(10);
  await state.requestPromise;

  fake.emit('slotRenderEnded', { slot: state.slot, isEmpty: false, creativeId: 'late-creative' });
  const events = await flushEvents(adapter, posts);
  const lateRender = eventsOf(events, 'slot_render_ended').at(-1);

  assert.equal(eventsOf(events, 'timeout').length, 1);
  assert.equal(lateRender.late_event, true);
  assert.equal(lateRender.creative_id, 'late-creative');
});
