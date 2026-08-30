import { createRuntimeClient, DEFAULT_RUNTIME_CONFIG_URL } from './runtime-client.js';
import { createLogger, bool } from './logger.js';
import { createInteractionLock, createSessionGuard } from './session-guard.js';
import { PriceOptimiserRuntimeAdapter } from './price-optimiser-runtime.js';
import { isRenderablePlacementElement, setupPlacements } from './placements.js';
import { setupInterstitials } from './interstitial.js';
import { setupRewarded } from './rewarded.js';
import { onDocumentReady } from './dom.js';

export function readScriptOptions(defaults = {}) {
  const documentRef = defaults.documentRef || (typeof document !== 'undefined' ? document : null);
  const windowRef = defaults.windowRef || (typeof window !== 'undefined' ? window : null);
  const locationRef = defaults.locationRef || (windowRef && windowRef.location);
  const script = documentRef && (
    documentRef.currentScript ||
    documentRef.querySelector(`script[src*="${defaults.bundleName || ''}"]`)
  );

  const dataset = script && script.dataset ? script.dataset : {};
  return {
    siteKey: dataset.poSite || dataset.siteKey || defaults.siteKey,
    runtimeConfigUrl: dataset.poRuntimeConfigUrl || dataset.runtimeConfigUrl || dataset.remoteConfigUrl || defaults.runtimeConfigUrl || DEFAULT_RUNTIME_CONFIG_URL,
    autoInit: bool(dataset.autoInit, defaults.autoInit !== false),
    debug: bool(dataset.debug, defaults.debug === true || queryDebugEnabled(locationRef)),
    jobCardSelector: dataset.jobCardSelector || defaults.jobCardSelector
  };
}

function safeDefinition(definition) {
  if (!definition || !definition.siteKey) {
    throw new Error('createExperience requires a siteKey');
  }
  return Object.assign({
    placements: [],
    interstitials: [],
    rewarded: []
  }, definition);
}

function queryDebugEnabled(locationRef) {
  if (!locationRef) return false;
  try {
    const href = typeof locationRef === 'string' ? locationRef : locationRef.href;
    const search = typeof locationRef === 'object' && locationRef.search != null
      ? String(locationRef.search)
      : (href ? new URL(href).search : '');
    if (!search) return false;
    return new URLSearchParams(search).get('po_debug') === '1';
  } catch (_) {
    return false;
  }
}

export function createExperience(definitionInput, options = {}) {
  const definition = safeDefinition(definitionInput);
  const windowRef = options.windowRef || (typeof window !== 'undefined' ? window : null);
  const documentRef = options.documentRef || (typeof document !== 'undefined' ? document : null);
  if (!windowRef || !documentRef) {
    const unavailable = async () => ({ status: 'unavailable' });
    return {
      init: async () => null,
      destroy: () => {},
      refresh: unavailable,
      refreshAll: async () => ({ status: 'unavailable', results: [] }),
      refreshSlots: async () => ({ status: 'unavailable', results: [] }),
      preloadSlots: async () => ({ status: 'unavailable', results: [] }),
      revealSlots: async () => ({ status: 'unavailable', results: [] }),
      preloadRewarded: unavailable,
      showInterstitial: unavailable,
      showRewarded: unavailable,
      status: () => ({ loaded: false, siteKey: definition.siteKey, debug: false, slots: [] })
    };
  }

  const siteKey = options.siteKey || definition.siteKey;
  const logger = createLogger({
    debug: options.debug || queryDebugEnabled(windowRef.location),
    prefix: `PublisherExperience:${siteKey}`
  });
  const sessionGuard = createSessionGuard(siteKey, windowRef.sessionStorage);
  const lock = createInteractionLock();
  const cleanup = [];
  let initPromise = null;
  let currentRuntime = null;
  let currentAdapter = null;
  let placementStates = [];
  let placementSetupPromise = null;

  function placementIdentity(state) {
    if (!state) return null;
    const divId = state.unit && state.unit.divId;
    if (divId) return `div:${divId}`;
    const runtimeSlotKey = state.unit && state.unit.runtimeSlotKey;
    if (runtimeSlotKey) return `slot:${runtimeSlotKey}`;
    return state.name ? `name:${state.name}` : null;
  }

  function rememberPlacementStates(states = []) {
    const indexed = new Map();
    for (const state of placementStates) {
      const key = placementIdentity(state);
      if (key) indexed.set(key, state);
    }
    for (const state of states) {
      const key = placementIdentity(state);
      if (key) indexed.set(key, state);
    }
    placementStates = Array.from(indexed.values());
    return placementStates;
  }

  function setupCurrentPlacements() {
    if (!currentRuntime || !currentAdapter) return Promise.resolve(placementStates);
    let pending = setupPlacements({
      definition,
	      runtime: currentRuntime,
	      adapter: currentAdapter,
	      documentRef,
	      windowRef,
	      logger,
	      onStateDefined: state => rememberPlacementStates([state])
	    }).then(states => rememberPlacementStates(states)).catch(error => {
      logger.warn('placement setup failed', { message: error.message });
      return placementStates;
    });

    pending = pending.finally(() => {
      if (placementSetupPromise === pending) placementSetupPromise = null;
    });
    placementSetupPromise = pending;
    return pending;
  }

  async function ensureReady() {
    const result = await init();
    if (placementSetupPromise) await placementSetupPromise;
    return result || { runtime: currentRuntime, adapter: currentAdapter };
  }

  function normalizePublicSlotKey(slotKey) {
    return String(slotKey || '').trim().replace(/^#/, '');
  }

  function publicSlotResult(result, state) {
    return {
      status: result && result.status ? result.status : 'unavailable',
      slotKey: state && state.name ? state.name : null,
      domId: state && state.unit ? state.unit.divId || null : null,
      type: state && state.unit ? state.unit.type || null : null
    };
  }

  function publicRevealSlotResult(result, state) {
    const status = result && result.status ? result.status : 'unavailable';
    const output = publicSlotResult(result, state);
    output.filled = status === 'filled';

    if (status === 'unavailable') {
      output.status = 'no_fill';
      output.reason = 'no_fill';
    } else if (status === 'timeout') {
      output.status = 'request_failed';
      output.reason = 'timeout';
    } else if (status === 'error') {
      output.status = 'request_failed';
      output.reason = result && result.reason ? result.reason : 'request_failed';
    } else if (status === 'not_renderable') {
      output.reason = result && result.reason ? result.reason : 'hidden_or_not_renderable';
    } else {
      output.reason = result && result.reason ? result.reason : status;
    }

    return output;
  }

  function publicLifecycleResult(result) {
    const output = {
      status: result && result.status ? result.status : 'unavailable'
    };
    if (result && result.reward) output.reward = result.reward;
    return output;
  }

  function isDisplayState(state) {
    const type = String(state && state.unit && state.unit.type || '').toLowerCase();
    return Boolean(state && state.unit && state.unit.divId && type !== 'interstitial' && type !== 'rewarded');
  }

  function findPlacementState(slotKey) {
    const key = normalizePublicSlotKey(slotKey);
    if (!key) return null;
    return placementStates.find(state => {
      const unit = state.unit || {};
      const cfg = state.cfg || {};
      const candidates = [
        state.name,
        unit.slotKey,
        unit.runtimeSlotKey,
        unit.divId,
        cfg.slotKey,
        cfg.slot_key,
        cfg.resolvedSlotKey,
        cfg.domId,
        cfg.dom_id
      ].filter(Boolean).map(value => String(value));
      return candidates.includes(key);
    }) || null;
  }

  function normalizeRewardedRequest(slotKeyOrCallbacks, maybeCallbacks) {
    if (slotKeyOrCallbacks && typeof slotKeyOrCallbacks === 'object') {
      return { slotKey: 'rewarded', callbacks: slotKeyOrCallbacks };
    }
    return {
      slotKey: normalizePublicSlotKey(slotKeyOrCallbacks) || 'rewarded',
      callbacks: maybeCallbacks && typeof maybeCallbacks === 'object' ? maybeCallbacks : {}
    };
  }

  function normalizeRewardedPreloadRequest(slotKeyOrOptions, maybeOptions) {
    if (slotKeyOrOptions && typeof slotKeyOrOptions === 'object' && !Array.isArray(slotKeyOrOptions)) {
      return {
        slotKey: normalizePublicSlotKey(slotKeyOrOptions.slotKey) || 'rewarded',
        options: slotKeyOrOptions
      };
    }
    return {
      slotKey: normalizePublicSlotKey(slotKeyOrOptions) || 'rewarded',
      options: maybeOptions && typeof maybeOptions === 'object' ? maybeOptions : {}
    };
  }

  function notify(callback, payload) {
    if (typeof callback === 'function') callback(payload);
  }

  function configValue(source, ...keys) {
    if (!source) return undefined;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) return source[key];
    }
    return undefined;
  }

  function runtimeSlotType(slotKey, config) {
    return String(configValue(config, 'adUnitType', 'ad_unit_type', 'slotType', 'slot_type') || slotKey || '').trim().toLowerCase();
  }

  function isDisplayRuntimeSlot(slotKey, config) {
    const type = runtimeSlotType(slotKey, config);
    return Boolean(type && type !== 'interstitial' && type !== 'rewarded' && config && config.enabled !== false);
  }

  function normalizePreloadTokens(input) {
    const raw = Array.isArray(input) ? input : (input == null ? [] : [input]);
    return raw
      .map(item => {
        const value = normalizePublicSlotKey(item);
        return value ? { raw: value, key: value.toLowerCase() } : null;
      })
      .filter(Boolean)
      .filter((item, index, items) => items.findIndex(candidate => candidate.key === item.key) === index);
  }

  function runtimeDisplayDomId(slotKey, config) {
    const domSelector = configValue(config, 'domSelector', 'dom_selector');
    return configValue(config, 'domId', 'dom_id') || selectorDomId(domSelector) || null;
  }

  function runtimeSlotKeyCandidates(slotKey, config) {
    const candidates = [
      slotKey,
      configValue(config, 'slotKey', 'slot_key'),
      configValue(config, 'resolvedSlotKey', 'resolved_slot_key')
    ].filter(Boolean).map(item => String(item).replace(/^#/, '').toLowerCase());
    return candidates;
  }

  function documentHasElementId(rawToken) {
    if (!documentRef || typeof documentRef.getElementById !== 'function') return false;
    try {
      return Boolean(documentRef.getElementById(rawToken));
    } catch (_) {
      return false;
    }
  }

  function configuredDisplayDivIds(runtimeSlots) {
    const ids = new Set();
    for (const [slotKey, config] of Object.entries(runtimeSlots || {})) {
      if (!isDisplayRuntimeSlot(slotKey, config)) continue;
      const domId = runtimeDisplayDomId(slotKey, config);
      if (domId) ids.add(String(domId).toLowerCase());
    }
    return ids;
  }

  const disabledGenericDisplayTokens = new Set(['native', 'anchor']);

  function isDisabledGenericDisplayToken(slotKey) {
    return disabledGenericDisplayTokens.has(normalizePublicSlotKey(slotKey).toLowerCase());
  }

  function publicTokenMode(token, runtimeSlots) {
    if (isDisabledGenericDisplayToken(token.key)) return 'generic_disabled';
    const configuredDivs = configuredDisplayDivIds(runtimeSlots);
    if (configuredDivs.has(token.key) || documentHasElementId(token.raw)) return 'div';
    return 'slot';
  }

  function runtimeSlotMatchesPublicToken(slotKey, config, token, mode) {
    if (mode === 'all') return true;
    if (mode === 'div') {
      const domId = runtimeDisplayDomId(slotKey, config);
      return Boolean(domId && String(domId).toLowerCase() === token.key);
    }
    if (mode === 'generic_disabled') return false;
    return runtimeSlotKeyCandidates(slotKey, config).includes(token.key);
  }

  function selectorDomId(selector) {
    if (typeof selector !== 'string') return null;
    const trimmed = selector.trim();
    if (!trimmed.startsWith('#') || /[\s>+~:[.]/u.test(trimmed.slice(1))) return null;
    return trimmed.slice(1);
  }

  function runtimeDisplayIdentity(slotKey, config) {
    const type = runtimeSlotType(slotKey, config);
    const domId = runtimeDisplayDomId(slotKey, config);
    return domId ? `${type}:dom:${domId}` : `${type}:slot:${slotKey}`;
  }

  function configuredSizes(config) {
    return configValue(config, 'sizes', 'sizesJson', 'sizes_json');
  }

  function hasConcreteSizes(config) {
    const sizes = configuredSizes(config);
    if (sizes == null) return false;
    if (Array.isArray(sizes)) {
      return sizes.length > 0 && !sizes.some(item => String(item).trim && String(item).trim().toLowerCase() === 'fluid');
    }
    const text = String(sizes).trim().toLowerCase();
    return Boolean(text && text !== 'fluid' && !text.includes('"fluid"') && /\d/.test(text));
  }

  function hasFluidSizes(config) {
    const sizes = configuredSizes(config);
    if (sizes == null) return false;
    if (Array.isArray(sizes)) return sizes.some(item => String(item).trim && String(item).trim().toLowerCase() === 'fluid');
    return String(sizes).trim().toLowerCase() === 'fluid';
  }

  function runtimePreloadScore(slotKey, config) {
    const type = runtimeSlotType(slotKey, config);
    const configSlotKey = String(configValue(config, 'slotKey', 'slot_key') || slotKey || '');
    let score = 0;
    if (hasConcreteSizes(config)) score += 60;
    if (hasFluidSizes(config)) score -= 30;
    if (type && (String(slotKey) === type || configSlotKey === type)) score += 10;
    if (type && (String(slotKey).startsWith(`${type}-`) || configSlotKey.startsWith(`${type}-`))) score += 8;
    return score;
  }

  function preferredPublicSlotCandidate(current, candidate) {
    if (!current) return candidate;
    if (candidate.score > current.score) return Object.assign(candidate, { order: current.order });
    if (candidate.score < current.score) return current;
    const currentKey = String(current.slotKey || '');
    const candidateKey = String(candidate.slotKey || '');
    return candidateKey.localeCompare(currentKey) < 0
      ? Object.assign(candidate, { order: current.order })
      : current;
  }

  function publicSlotWarning(slotKey, warning) {
    return {
      status: 'invalid_slot',
      slotKey: normalizePublicSlotKey(slotKey) || null,
      warning
    };
  }

  function preferredPublicDisplaySlots(runtimeSlots, tokens) {
    const selected = new Map();
    const warnings = [];
    const tokenRequests = tokens.length ? tokens : [{ raw: '*', key: '*', mode: 'all' }];
    let order = 0;

    for (const request of tokenRequests) {
      const mode = request.mode || publicTokenMode(request, runtimeSlots);
      const matches = [];
      for (const [slotKey, config] of Object.entries(runtimeSlots)) {
        if (!isDisplayRuntimeSlot(slotKey, config)) continue;
        if (!runtimeSlotMatchesPublicToken(slotKey, config, request, mode)) continue;
        matches.push({ slotKey, config });
      }

      if (!matches.length) {
        if (mode !== 'all') {
          const warning = mode === 'generic_disabled'
            ? 'explicit_div_id_required'
            : mode === 'div'
            ? 'No configured Price Optimiser placement maps to this publisher div ID.'
            : 'No configured Price Optimiser display placement matches this identifier.';
          logger.warn('publisher preload/refresh ignored unknown slot', {
            slotKey: request.raw,
            resolutionMode: mode,
            warning
          });
          warnings.push(publicSlotWarning(request.raw, warning));
        }
        continue;
      }

      const matchesByIdentity = new Map();
      for (const match of matches) {
        const identity = runtimeDisplayIdentity(match.slotKey, match.config);
        const candidate = {
          slotKey: match.slotKey,
          config: match.config,
          score: runtimePreloadScore(match.slotKey, match.config),
          token: request.raw,
          mode,
          order: order++
        };
        matchesByIdentity.set(identity, preferredPublicSlotCandidate(matchesByIdentity.get(identity), candidate));
      }

      if (mode === 'div' && matches.length > 1) {
        logger.warn('publisher preload/refresh resolved duplicate div mapping deterministically', {
          divId: request.raw,
          candidates: matches.map(match => String(match.slotKey)),
          selected: Array.from(matchesByIdentity.values()).map(match => String(match.slotKey))
        });
      }

      for (const [identity, candidate] of matchesByIdentity) {
        selected.set(identity, preferredPublicSlotCandidate(selected.get(identity), candidate));
      }
    }

    return {
      slots: Array.from(selected.values()).sort((left, right) => left.order - right.order),
      warnings
    };
  }

  function queryRuntimeElement(config) {
    const selector = configValue(config, 'domSelector', 'dom_selector') ||
      (configValue(config, 'domId', 'dom_id') ? `#${configValue(config, 'domId', 'dom_id')}` : null);
    if (!selector || !documentRef || typeof documentRef.querySelector !== 'function') return { selector, element: null };
    try {
      return { selector, element: documentRef.querySelector(selector) };
    } catch (_) {
      return { selector, element: null };
    }
  }

  function ensureRuntimeElementId(element, slotKey) {
    if (!element) return null;
    const existing = String(element.id || '').trim();
    if (existing) return existing;
    const generated = `poexp-${String(slotKey || 'slot').replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'slot'}`;
    element.id = generated;
    return generated;
  }

  async function ensureDisplayStateForRuntimeSlot(slotKey, config, options = {}) {
    const lookupKeys = [
      slotKey,
      configValue(config, 'slotKey', 'slot_key'),
      configValue(config, 'resolvedSlotKey', 'resolved_slot_key'),
      configValue(config, 'domId', 'dom_id')
    ].filter(Boolean);
    for (const lookupKey of lookupKeys) {
      const existing = findPlacementState(lookupKey);
      if (existing && isDisplayState(existing)) return existing;
    }

    const type = runtimeSlotType(slotKey, config);
    const { selector, element } = queryRuntimeElement(config);
    if (selector && !element) return null;
    if (selector && !isRenderablePlacementElement(element, windowRef)) {
      if (!options.preloadHidden) return null;
      const elementId = ensureRuntimeElementId(element, slotKey);
      if (!elementId || !currentAdapter || typeof currentAdapter.preloadDisplaySlot !== 'function') return null;
      const result = await currentAdapter.preloadDisplaySlot({ slotKey, elementId, config });
      if (result && result.state) rememberPlacementStates([result.state]);
      return result && result.state && isDisplayState(result.state) ? result.state : null;
    }
    if (!selector && type !== 'anchor') return null;

    const elementId = ensureRuntimeElementId(element, slotKey);
    let state = null;
    if (options.preloadHidden && currentAdapter && typeof currentAdapter.preloadDisplaySlot === 'function') {
      const result = await currentAdapter.preloadDisplaySlot({ slotKey, elementId, config });
      state = result && result.state;
    } else {
      state = await currentAdapter.definePlacement({ slotKey, elementId, config });
    }
    if (state) rememberPlacementStates([state]);
    return state && isDisplayState(state) ? state : null;
  }

  async function resolvePublicDisplayStates(tokens, options = {}) {
    const runtimeSlots = currentRuntime && currentRuntime.slots ? currentRuntime.slots : {};
    const matched = [];
    const warnings = [];
    const seen = new Set();
    const resolution = preferredPublicDisplaySlots(runtimeSlots, tokens);
    warnings.push(...resolution.warnings);

    for (const { slotKey, config, token, mode } of resolution.slots) {
      const state = await ensureDisplayStateForRuntimeSlot(slotKey, config, options);
      const identity = placementIdentity(state);
      if (!state || !identity) {
        if (mode === 'div' || mode === 'slot') {
          const requested = token || slotKey;
          const warning = mode === 'div'
            ? 'Publisher div ID exists in config but is not present/renderable on this page.'
            : 'Configured display placement is not present/renderable on this page.';
          logger.warn('publisher preload/refresh skipped unavailable slot', {
            slotKey: requested,
            resolvedSlotKey: slotKey,
            resolutionMode: mode,
            warning
          });
          warnings.push(publicSlotWarning(requested, warning));
        }
        continue;
      }
      if (seen.has(identity)) continue;
      seen.add(identity);
      matched.push(state);
    }
    return { states: matched, warnings };
  }

  async function init() {
    if (initPromise) return initPromise;

    initPromise = (async () => {
      const runtimeClient = createRuntimeClient({
        siteKey,
        runtimeConfigUrl: options.runtimeConfigUrl,
        fetchRef: options.fetchRef,
        locationRef: windowRef.location,
        logger
      });

      let runtime = null;
      try {
        runtime = await runtimeClient.load(windowRef.location && windowRef.location.pathname);
      } catch (error) {
        logger.warn('runtime config unavailable, interactive requests will fail open', { message: error.message, status: error.status });
        runtime = { siteKey, slots: {}, formats: {}, debug: false };
      }

      const adapter = new PriceOptimiserRuntimeAdapter({
        windowRef,
        documentRef,
        runtime,
        logger
      });

      currentRuntime = runtime;
      currentAdapter = adapter;

      if (runtime.debug === true || runtime.debugEnabled === true) {
        logger.setDebug(true);
        logger.debug('runtime debug enabled');
      }

      setupCurrentPlacements();
      cleanup.push(onDocumentReady(documentRef, () => {
        setupCurrentPlacements();
      }));

      const context = {
        definition,
        runtime,
        adapter,
        documentRef,
        windowRef,
        sessionGuard,
        lock,
        logger
      };

      cleanup.push(setupInterstitials(context));
      cleanup.push(setupRewarded(context));

      logger.debug('experience initialized', {
        placements: definition.placements.length,
        interstitials: definition.interstitials.length,
        rewarded: definition.rewarded.length
      });

      return { runtime, adapter };
    })().catch(error => {
      initPromise = null;
      currentRuntime = null;
      currentAdapter = null;
      throw error;
    });

    return initPromise;
  }

	  function destroy() {
	    while (cleanup.length) {
	      const fn = cleanup.pop();
	      fn && fn();
	    }
	    if (currentAdapter && typeof currentAdapter.destroy === 'function') currentAdapter.destroy();
	    placementStates = [];
    placementSetupPromise = null;
    currentRuntime = null;
    currentAdapter = null;
    initPromise = null;
  }

  async function refresh(slotKey) {
    if (isDisabledGenericDisplayToken(slotKey)) {
      logger.warn('publisher refresh ignored generic display token', {
        slotKey,
        warning: 'explicit_div_id_required'
      });
      return { status: 'invalid_slot', slotKey: normalizePublicSlotKey(slotKey) || null, warning: 'explicit_div_id_required' };
    }
    await ensureReady();
    let state = findPlacementState(slotKey);
    if (!state) {
      await setupCurrentPlacements();
      state = findPlacementState(slotKey);
    }
    if (!state) return { status: 'invalid_slot', slotKey: normalizePublicSlotKey(slotKey) || null };
    if (!isDisplayState(state)) return publicSlotResult({ status: 'unsupported_slot_type' }, state);
    const result = await currentAdapter.requestDisplaySlot(state);
    return publicSlotResult(result, state);
  }

  async function refreshSlots(slotTypesOrKeys) {
    await ensureReady();
    const tokens = normalizePreloadTokens(slotTypesOrKeys);
    if (!tokens.length) return refreshAll();

    const { states, warnings } = await resolvePublicDisplayStates(tokens, { preloadHidden: false });
    const results = warnings.slice();
    results.push(...await Promise.all(states.map(async state => {
      const result = await currentAdapter.requestDisplaySlot(state);
      return publicSlotResult(result, state);
    })));
    return { status: 'complete', results };
  }

  async function refreshAll() {
    await ensureReady();
    await setupCurrentPlacements();
    const states = placementStates.filter(isDisplayState);
    const results = await Promise.all(states.map(async state => {
      const result = await currentAdapter.requestDisplaySlot(state);
      return publicSlotResult(result, state);
    }));
    return { status: 'complete', results };
  }

  async function preloadSlots(slotTypesOrKeys) {
    await ensureReady();
    const tokens = normalizePreloadTokens(slotTypesOrKeys);
    const { states, warnings } = await resolvePublicDisplayStates(tokens, { preloadHidden: true });
    const results = warnings.slice();
    results.push(...await Promise.all(states.map(async state => {
      const result = currentAdapter && typeof currentAdapter.preloadDisplayState === 'function'
        ? await currentAdapter.preloadDisplayState(state)
        : state.requestPromise
          ? await state.requestPromise
          : await currentAdapter.requestDisplaySlot(state);
      return publicSlotResult(result, state);
    })));
    return { status: 'complete', results };
  }

  async function revealSlots(slotTypesOrKeys) {
    await ensureReady();
    const tokens = normalizePreloadTokens(slotTypesOrKeys);
    const { states, warnings } = await resolvePublicDisplayStates(tokens, { preloadHidden: false });
    const results = warnings.map(warning => Object.assign({
      filled: false,
      reason: warning.warning || warning.status || 'invalid_slot'
    }, warning));
    results.push(...await Promise.all(states.map(async state => {
      try {
        const result = currentAdapter && typeof currentAdapter.revealDisplayState === 'function'
          ? await currentAdapter.revealDisplayState(state)
          : await currentAdapter.requestDisplaySlot(state);
        return publicRevealSlotResult(result, state);
      } catch (error) {
        logger.warn('publisher reveal failed', {
          slotKey: state && state.name,
          domId: state && state.unit && state.unit.divId,
          message: error && error.message
        });
        return publicRevealSlotResult({ status: 'error', reason: 'request_failed' }, state);
      }
    })));
    return { status: 'complete', results };
  }

  async function preloadRewarded(slotKeyOrOptions, maybeOptions) {
    const request = normalizeRewardedPreloadRequest(slotKeyOrOptions, maybeOptions);
    await ensureReady();
    try {
      const result = await currentAdapter.preloadRewarded(request.slotKey, {
        ttlMs: request.options.ttlMs,
        ready: event => notify(request.options.onReady, event)
      });
      const publicResult = publicLifecycleResult(result);
      if (publicResult.status !== 'ready') notify(request.options.onFallback, publicResult);
      return publicResult;
    } catch (error) {
      logger.warn('publisher rewarded preload failed', { message: error.message });
      const result = { status: 'error' };
      notify(request.options.onFallback, result);
      return result;
    }
  }

  async function showInterstitial(slotKey = 'interstitial') {
    await ensureReady();
    if (!lock.acquire('interstitial')) return { status: 'busy' };
    try {
      const result = await currentAdapter.requestInterstitial(normalizePublicSlotKey(slotKey) || 'interstitial');
      return publicLifecycleResult(result);
    } catch (error) {
      logger.warn('publisher interstitial failed', { message: error.message });
      return { status: 'error' };
    } finally {
      lock.release('interstitial');
    }
  }

  async function showRewarded(slotKeyOrCallbacks, maybeCallbacks) {
    const request = normalizeRewardedRequest(slotKeyOrCallbacks, maybeCallbacks);
    await ensureReady();
    if (!lock.acquire('rewarded')) {
      const result = { status: 'busy' };
      notify(request.callbacks.onFallback, result);
      return result;
    }

    try {
      const result = await currentAdapter.requestRewarded(request.slotKey, {
        usePreload: request.callbacks.usePreload,
        ready: event => notify(request.callbacks.onReady, event),
        granted: event => notify(request.callbacks.onGranted, { event, reward: event && event.payload ? event.payload : null }),
        videoCompleted: event => notify(request.callbacks.onVideoCompleted, event),
        closed: event => notify(request.callbacks.onClosed, event)
      });
      const publicResult = publicLifecycleResult(result);
      if (publicResult.status !== 'granted') notify(request.callbacks.onFallback, publicResult);
      return publicResult;
    } catch (error) {
      logger.warn('publisher rewarded failed', { message: error.message });
      const result = { status: 'error' };
      notify(request.callbacks.onFallback, result);
      return result;
    } finally {
      lock.release('rewarded');
    }
  }

  function status() {
    return {
      loaded: Boolean(currentRuntime && currentAdapter),
      siteKey,
      debug: logger.debugEnabled,
      slots: placementStates.map(state => (
        currentAdapter && typeof currentAdapter.publicSlotStatus === 'function'
          ? currentAdapter.publicSlotStatus(state)
          : {
              slotKey: state.name || null,
              domId: state.unit && state.unit.divId ? state.unit.divId : null,
              type: state.unit && state.unit.type ? state.unit.type : null
            }
      ))
    };
  }

  if (options.autoInit !== false) {
    init().catch(error => logger.error(error));
  }

  return { init, destroy, refresh, refreshSlots, refreshAll, preloadSlots, revealSlots, preloadRewarded, showInterstitial, showRewarded, status };
}
