import { ensureElementId, routeMatches, safeQuerySelector } from './dom.js';

function value(source, ...keys) {
  if (!source) return undefined;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) return source[key];
  }
  return undefined;
}

function booleanValue(input, fallback) {
  if (input === undefined || input === null || input === '') return fallback;
  if (input === true || input === 1) return true;
  if (input === false || input === 0) return false;
  const text = String(input).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(text)) return true;
  if (['false', '0', 'no', 'off'].includes(text)) return false;
  return fallback;
}

function numberValue(input, fallback) {
  const numeric = Number(input);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function displaySlotType(type) {
  const value = String(type || '').toLowerCase();
  return value && value !== 'interstitial' && value !== 'rewarded';
}

function selectorId(selector) {
  if (typeof selector !== 'string') return null;
  const trimmed = selector.trim();
  if (!trimmed.startsWith('#') || /[\s>+~:[.]/u.test(trimmed.slice(1))) return null;
  return trimmed.slice(1);
}

function selectorFromRuntime(slotConfig) {
  if (!slotConfig) return null;
  if (slotConfig.domSelector) return slotConfig.domSelector;
  if (slotConfig.dom_id) return `#${slotConfig.dom_id}`;
  if (slotConfig.domId) return `#${slotConfig.domId}`;
  return null;
}

function runtimeKeyFor(runtimeSlotKey, slotConfig) {
  return String(value(slotConfig, 'slotKey', 'slot_key') || runtimeSlotKey || '');
}

function configuredSizes(slotConfig) {
  return value(slotConfig, 'sizes', 'sizesJson', 'sizes_json');
}

function hasConcreteSizes(slotConfig) {
  const sizes = configuredSizes(slotConfig);
  if (sizes == null) return false;
  if (Array.isArray(sizes)) {
    return sizes.length > 0 && !sizes.some(item => String(item).trim && String(item).trim().toLowerCase() === 'fluid');
  }
  const text = String(sizes).trim().toLowerCase();
  return Boolean(text && text !== 'fluid' && !text.includes('"fluid"') && /\d/.test(text));
}

function hasFluidSizes(slotConfig) {
  const sizes = configuredSizes(slotConfig);
  if (sizes == null) return false;
  if (Array.isArray(sizes)) return sizes.some(item => String(item).trim && String(item).trim().toLowerCase() === 'fluid');
  return String(sizes).trim().toLowerCase() === 'fluid';
}

function runtimeSlotScore(placement, runtimeSlotKey, slotConfig) {
  const aliases = [
    placement.slotKey,
    ...(Array.isArray(placement.aliases) ? placement.aliases : [])
  ].filter(Boolean).map(String);
  const runtimeKey = runtimeKeyFor(runtimeSlotKey, slotConfig);
  const placementType = String(placement.adUnitType || '').toLowerCase();
  const runtimeType = String(slotConfig.adUnitType || slotConfig.ad_unit_type || runtimeSlotKey || '').toLowerCase();
  const runtimeSelector = selectorFromRuntime(slotConfig);
  const runtimeDomId = slotConfig.domId || slotConfig.dom_id || selectorId(runtimeSelector);
  const placementDomId = selectorId(placement.selector);

  let score = 0;
  if (placementType) score += runtimeType === placementType ? 100 : -100;
  if (aliases.includes(String(runtimeSlotKey)) || aliases.includes(runtimeKey)) score += 30;
  if (placement.slotKey === runtimeSlotKey || placement.slotKey === runtimeKey) score += 4;
  if ((placementDomId && runtimeDomId === placementDomId) || (placement.selector && runtimeSelector === placement.selector)) score += 20;
  if (hasConcreteSizes(slotConfig)) score += 60;
  if (hasFluidSizes(slotConfig)) score -= 30;
  if (runtimeType && (String(runtimeSlotKey).startsWith(`${runtimeType}-`) || runtimeKey.startsWith(`${runtimeType}-`))) score += 8;
  if (runtimeType && (String(runtimeSlotKey) === runtimeType || runtimeKey === runtimeType)) score += 10;
  return score;
}

function preferredRuntimeMatch(placement, current, candidate) {
  if (!current) return candidate;
  const currentScore = runtimeSlotScore(placement, current.key, current.config);
  const candidateScore = runtimeSlotScore(placement, candidate.key, candidate.config);
  return candidateScore > currentScore ? candidate : current;
}

function placementPriority(placement) {
  const key = String(placement && placement.slotKey || '').toLowerCase();
  const type = String(placement && placement.adUnitType || '').toLowerCase();
  if (type === 'anchor' || key.includes('anchor')) return 0;
  if (key.includes('leaderboard')) return 1;
  return 2;
}

function visibilityFirstFor(config) {
  return booleanValue(value(config, 'visibilityFirst', 'visibility_first', 'lazyLoad', 'lazy_load'), false);
}

function lazyLoadMarginPxFor(config) {
  return Math.max(0, numberValue(value(config, 'lazyLoadMarginPx', 'lazy_load_margin_px', 'visibilityMarginPx', 'visibility_margin_px'), 300));
}

function arrayValue(input) {
  if (Array.isArray(input)) return input;
  if (input == null || input === '') return [];
  return [input];
}

function publisherControlledPreloadRoutes(definition, placement, config) {
  return [
    ...arrayValue(value(config, 'publisherControlledPreloadRoutes', 'publisher_controlled_preload_routes')),
    ...arrayValue(value(placement, 'publisherControlledPreloadRoutes', 'publisher_controlled_preload_routes')),
    ...arrayValue(value(definition, 'publisherControlledPreloadRoutes', 'publisher_controlled_preload_routes'))
  ].filter(Boolean);
}

function publisherControlsPreloadOnRoute(definition, placement, config, windowRef) {
  const routes = publisherControlledPreloadRoutes(definition, placement, config);
  if (!routes.length) return false;
  const pathname = windowRef && windowRef.location && windowRef.location.pathname || '/';
  return routes.some(pattern => routeMatches(pattern, pathname));
}

function viewportHeightFor(documentRef, windowRef) {
  return numberValue(
    windowRef && windowRef.innerHeight,
    numberValue(documentRef && documentRef.documentElement && documentRef.documentElement.clientHeight, null)
  );
}

function isNearViewport(element, documentRef, windowRef, marginPx) {
  if (!element || typeof element.getBoundingClientRect !== 'function') return true;
  const viewportHeight = viewportHeightFor(documentRef, windowRef);
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return true;
  const rect = element.getBoundingClientRect();
  if (!rect) return true;
  return Number(rect.bottom) >= -marginPx && Number(rect.top) <= viewportHeight + marginPx;
}

function viewportStatusFor(element, documentRef, windowRef, marginPx) {
  if (!element || typeof element.getBoundingClientRect !== 'function') return 'unknown';
  const viewportHeight = viewportHeightFor(documentRef, windowRef);
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return 'unknown';
  const rect = element.getBoundingClientRect();
  if (!rect) return 'unknown';
  const top = Number(rect.top);
  const bottom = Number(rect.bottom);
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return 'unknown';
  if (bottom >= 0 && top <= viewportHeight) return 'visible';
  if (bottom >= -marginPx && top <= viewportHeight + marginPx) return 'near';
  return 'far';
}

function isAnchorPlacement(placement, config) {
  const key = String(placement && placement.slotKey || '').toLowerCase();
  const type = String(config && (config.adUnitType || config.ad_unit_type) || placement && placement.adUnitType || '').toLowerCase();
  return type === 'anchor' || key.includes('anchor');
}

function requestStartPriority(item) {
  if (!item || item.viewportStatus === 'unknown') return placementPriority(item && item.placement);
  if (isAnchorPlacement(item.placement, item.config)) return 1;
  if (item.viewportStatus === 'visible') return 0;
  if (item.viewportStatus === 'near') return 2;
  return 3;
}

function compareRequestStart(left, right) {
  const leftPriority = requestStartPriority(left);
  const rightPriority = requestStartPriority(right);
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;

  const leftPlacementPriority = placementPriority(left && left.placement);
  const rightPlacementPriority = placementPriority(right && right.placement);
  if (leftPlacementPriority !== rightPlacementPriority) return leftPlacementPriority - rightPlacementPriority;

  return left.index - right.index;
}

function intersectionObserverCtor(windowRef) {
  if (windowRef && typeof windowRef.IntersectionObserver === 'function') return windowRef.IntersectionObserver;
  if (typeof globalThis !== 'undefined' && typeof globalThis.IntersectionObserver === 'function') return globalThis.IntersectionObserver;
  return null;
}

function elementStyleValue(element, windowRef, property) {
  try {
    const computed = windowRef && typeof windowRef.getComputedStyle === 'function'
      ? windowRef.getComputedStyle(element)
      : null;
    const value = computed && computed[property] != null ? computed[property] : element && element.style && element.style[property];
    return String(value || '').trim().toLowerCase();
  } catch (_) {
    const value = element && element.style && element.style[property];
    return String(value || '').trim().toLowerCase();
  }
}

export function isRenderablePlacementElement(element, windowRef) {
  if (!element) return false;
  let current = element;
  const seen = new Set();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current.hidden) return false;
    const display = elementStyleValue(current, windowRef, 'display');
    if (display === 'none') return false;
    const visibility = elementStyleValue(current, windowRef, 'visibility');
    if (visibility === 'hidden' || visibility === 'collapse') return false;
    if (current.nodeType === 9) break;
    current = current.parentElement || current.parentNode || null;
  }
  return true;
}

function placementMatchesRuntime(placement, runtimeSlotKey, slotConfig) {
  const aliases = [
    placement.slotKey,
    ...(Array.isArray(placement.aliases) ? placement.aliases : [])
  ].filter(Boolean).map(String);
  const runtimeKey = String(slotConfig.slotKey || slotConfig.slot_key || runtimeSlotKey);
  const runtimeSelector = selectorFromRuntime(slotConfig);
  const runtimeDomId = slotConfig.domId || slotConfig.dom_id || selectorId(runtimeSelector);
  const placementDomId = selectorId(placement.selector);

  return aliases.includes(String(runtimeSlotKey)) ||
    aliases.includes(runtimeKey) ||
    (runtimeDomId && aliases.includes(String(runtimeDomId))) ||
    (placementDomId && runtimeDomId === placementDomId) ||
    (placement.selector && runtimeSelector === placement.selector);
}

function mergePlacementCandidates(definition, runtime) {
  const candidates = new Map();

  for (const placement of definition.placements || []) {
    if (!placement || !placement.slotKey) continue;
    candidates.set(placement.slotKey, Object.assign({}, placement));
  }

  const runtimeSlots = runtime && runtime.slots ? runtime.slots : {};
  const runtimeEntries = Object.entries(runtimeSlots);
  const matchedRuntimeKeys = new Set();
  for (const placement of candidates.values()) {
    let selected = null;
    for (const [slotKey, slotConfig] of runtimeEntries) {
      const type = slotConfig.adUnitType || slotConfig.ad_unit_type || slotKey;
      if (!displaySlotType(type) || slotConfig.enabled === false) continue;
      if (!placementMatchesRuntime(placement, slotKey, slotConfig)) continue;
      matchedRuntimeKeys.add(slotKey);
      selected = preferredRuntimeMatch(placement, selected, { key: slotKey, config: slotConfig });
    }
    if (selected) {
      placement.runtimeConfig = selected.config;
      placement.runtimeSlotKey = selected.key;
      if (!placement.selector) placement.selector = selectorFromRuntime(selected.config);
    }
  }

  for (const [slotKey, slotConfig] of runtimeEntries) {
    if (matchedRuntimeKeys.has(slotKey)) continue;
    const type = slotConfig.adUnitType || slotConfig.ad_unit_type || slotKey;
    if (!displaySlotType(type) || slotConfig.enabled === false) continue;

    const existing = candidates.get(slotKey) || {};
    candidates.set(slotKey, Object.assign({
      slotKey,
      selector: selectorFromRuntime(slotConfig),
      runtimeConfig: slotConfig
    }, existing.runtimeConfig ? existing : Object.assign(existing, { runtimeConfig: slotConfig })));
  }

  return Array.from(candidates.values()).sort((left, right) => placementPriority(left) - placementPriority(right));
}

function observeVisiblePlacement({ placement, element, elementId, config, adapter, windowRef, marginPx, logger, onStateDefined }) {
  const Observer = intersectionObserverCtor(windowRef);
  if (!Observer) return false;

  const observed = element.__publisherExperienceVisibilitySlots || new Set();
  if (observed.has(placement.slotKey)) return true;
  observed.add(placement.slotKey);
  element.__publisherExperienceVisibilitySlots = observed;

  let observer = null;
  const defineVisible = () => {
    observed.delete(placement.slotKey);
    if (observer && observer.disconnect) observer.disconnect();
    Promise.resolve(adapter.definePlacement({
      slotKey: placement.slotKey,
      elementId,
      config
    })).then(state => {
      if (state && typeof onStateDefined === 'function') onStateDefined(state);
    }).catch(error => {
      logger && logger.warn && logger.warn('deferred placement setup failed', {
        slotKey: placement.slotKey,
        message: error && error.message
      });
    });
  };

  observer = new Observer(entries => {
    if (!entries || !entries.some(entry => entry && (entry.isIntersecting || Number(entry.intersectionRatio) > 0))) return;
    defineVisible();
  }, {
    root: null,
    rootMargin: `${marginPx}px 0px ${marginPx}px 0px`,
    threshold: 0
  });
  observer.observe(element);
  return true;
}

export async function setupPlacements({ definition, runtime, adapter, documentRef, windowRef, logger, onStateDefined }) {
  if (!runtime || !runtime.slots) return [];
  const candidates = mergePlacementCandidates(definition, runtime);
  const defined = [];
  const definedDivIds = new Set();
  const immediate = [];

  const rememberDefinedState = state => {
    if (!state) return;
    const divId = state.unit && state.unit.divId;
    if (divId) {
      if (definedDivIds.has(divId)) return;
      definedDivIds.add(divId);
    }
    defined.push(state);
  };

  for (const [index, placement] of candidates.entries()) {
    const config = placement.runtimeConfig || adapter.slotConfig(placement.slotKey, placement.adUnitType, placement);
    if (!config || config.enabled === false) continue;

    if (publisherControlsPreloadOnRoute(definition, placement, config, windowRef)) {
      logger && logger.debug('placement auto-init deferred for publisher preload route', {
        slotKey: placement.slotKey
      });
      continue;
    }

    const selector = placement.selector || selectorFromRuntime(config);
    let elementId = null;
    let viewportStatus = 'unknown';
    const marginPx = lazyLoadMarginPxFor(config);

    if (selector) {
      const element = safeQuerySelector(documentRef, selector);
      if (!element) {
        logger && logger.debug('placement element unavailable', { slotKey: placement.slotKey, selector });
        continue;
      }
      elementId = ensureElementId(element, `poexp-${placement.slotKey}`);
      if (!isRenderablePlacementElement(element, windowRef)) {
        const observed = observeVisiblePlacement({
          placement,
          element,
          elementId,
          config,
          adapter,
          windowRef,
          marginPx,
          logger,
          onStateDefined
        });
        logger && logger.debug(observed ? 'placement deferred until renderable' : 'placement skipped until renderable', {
          slotKey: placement.slotKey,
          selector
        });
        continue;
      }

      viewportStatus = viewportStatusFor(element, documentRef, windowRef, marginPx);
      if (visibilityFirstFor(config) && !isNearViewport(element, documentRef, windowRef, marginPx)) {
        const observed = observeVisiblePlacement({
          placement,
          element,
          elementId,
          config,
          adapter,
          windowRef,
          marginPx,
          logger,
          onStateDefined
        });
        if (observed) {
          logger && logger.debug('placement deferred until visible', { slotKey: placement.slotKey, selector });
          continue;
        }
      }
    }

    immediate.push({
      placement,
      elementId,
      config,
      viewportStatus,
      index
    });
  }

  immediate.sort(compareRequestStart);

  const pending = [];
  for (const item of immediate) {
    pending.push(adapter.definePlacement({
      slotKey: item.placement.slotKey,
      elementId: item.elementId,
      config: item.config
    }));
  }

  const states = await Promise.all(pending);
  for (const state of states) {
    rememberDefinedState(state);
  }

  return defined;
}
