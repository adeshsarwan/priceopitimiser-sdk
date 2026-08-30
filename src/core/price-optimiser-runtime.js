import { normalizeSizes } from './sizes.js';

const GPT_SRC = 'https://securepubads.g.doubleclick.net/tag/js/gpt.js';
const DISPLAY_MODES = new Set(['waterfall_only', 'both', 'auto_placement', 'publisher_sdk']);
const OUT_OF_PAGE_FORMATS = {
  anchor: 'BOTTOM_ANCHOR',
  interstitial: 'INTERSTITIAL',
  rewarded: 'REWARDED'
};

function value(source, ...keys) {
  if (!source) return undefined;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) {
      return source[key];
    }
  }
  return undefined;
}

function objectValue(source, ...keys) {
  const found = value(source, ...keys);
  return found && typeof found === 'object' && !Array.isArray(found) ? found : null;
}

function arrayValue(source, ...keys) {
  const found = value(source, ...keys);
  if (Array.isArray(found)) return found;
  if (typeof found === 'string') {
    try {
      const parsed = JSON.parse(found);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return found.split(',').map(part => Number(part.trim())).filter(Number.isFinite);
    }
  }
  return [];
}

function numberValue(...values) {
  for (const item of values) {
    const numeric = Number(item);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function priceValue(item) {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    return numberValue(value(item, 'price', 'floor', 'value', 'priceRuleValue', 'price_rule_value'));
  }
  return numberValue(item);
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

function cleanGroup(group) {
  const value = String(group || '').trim().toLowerCase();
  if (value === 'control' || value === 'variant') return value;
  return null;
}

function storageGet(storage, key) {
  try {
    return storage && storage.getItem(key);
  } catch (_) {
    return null;
  }
}

function storageSet(storage, key, value) {
  try {
    storage && storage.setItem(key, value);
  } catch (_) {
    /* Experiment assignment persistence is best-effort when storage is unavailable. */
  }
}

function runtimeSiteKey(runtime) {
  const explicit = value(runtime, 'siteKey', 'site_key');
  if (explicit) return explicit;

  const site = value(runtime, 'site');
  if (typeof site === 'string') return site;
  if (site && typeof site === 'object') return value(site, 'siteKey', 'site_key', 'domain');
  return null;
}

function experimentAssignmentStorageKey(siteKey, expKey) {
  const site = String(siteKey || '').trim();
  const experiment = String(expKey || '').trim();
  if (!site || !experiment) return null;
  return `po_exp:${site}:${experiment}:group`;
}

function selectedExperiment(runtime, options = {}) {
  const experiment = options.experimentConfig || objectValue(runtime, 'experiment') || {};
  const explicitGroup = cleanGroup(
    value(runtime, 'exp_group', 'expGroup', 'selectedArm', 'selected_arm') ||
    value(experiment, 'exp_group', 'expGroup', 'group', 'selectedArm', 'selected_arm')
  );
  const expKey = value(runtime, 'exp_key', 'expKey') || value(experiment, 'expKey', 'key', 'exp_key') || null;

  if (explicitGroup) return { expGroup: explicitGroup, expKey };
  if (experiment.enabled === false || experiment.enabled === 0) return { expGroup: 'control', expKey };
  const variantPercentage = numberValue(value(experiment, 'variantPercentage', 'variant_percentage'));
  if (!Number.isFinite(variantPercentage)) return { expGroup: null, expKey };

  const probability = Math.max(0, Math.min(1, variantPercentage));
  if (probability >= 1) return { expGroup: 'variant', expKey };
  if (probability <= 0) return { expGroup: 'control', expKey };

  const siteKey = options.siteKey || runtimeSiteKey(runtime);
  const storageKey = experimentAssignmentStorageKey(siteKey, expKey);
  const persistedGroup = storageKey ? cleanGroup(storageGet(options.storage, storageKey)) : null;
  if (persistedGroup) return { expGroup: persistedGroup, expKey };

  const random = typeof options.random === 'function' ? options.random : Math.random;
  const assignedGroup = Number(random()) < probability ? 'variant' : 'control';
  if (storageKey) storageSet(options.storage, storageKey, assignedGroup);
  return { expGroup: assignedGroup, expKey };
}

function experimentConfigFor(runtime, config) {
  const preselected = objectValue(config, 'selectedExperiment', 'selected_experiment');
  if (preselected) return preselected;

  const runtimeExperiment = objectValue(runtime, 'experiment') || {};
  const slotExperiment = objectValue(config, 'experiment') || {};
  const expKey = value(config, 'experimentKey', 'experiment_key', 'exp_key', 'expKey') ||
    value(slotExperiment, 'expKey', 'key', 'exp_key');

  if (!expKey) return runtimeExperiment;

  return Object.assign({}, runtimeExperiment, slotExperiment, {
    enabled: value(slotExperiment, 'enabled') ?? value(config, 'experimentEnabled', 'experiment_enabled') ?? value(runtimeExperiment, 'enabled'),
    expKey,
    key: expKey,
    variantPercentage: value(slotExperiment, 'variantPercentage', 'variant_percentage') ??
      value(config, 'variantPercentage', 'variant_percentage') ??
      value(runtimeExperiment, 'variantPercentage', 'variant_percentage')
  });
}

function adUnitType(config, fallback) {
  return String(value(config, 'adUnitType', 'ad_unit_type', 'slotType', 'slot_type') || fallback || '').trim().toLowerCase();
}

function adUnitPath(config) {
  return value(config, 'adUnitName', 'ad_unit_name', 'adUnitCode', 'ad_unit_code') || null;
}

function selectorId(selector) {
  if (typeof selector !== 'string') return null;
  const trimmed = selector.trim();
  if (!trimmed.startsWith('#') || /[\s>+~:[.]/u.test(trimmed.slice(1))) return null;
  return trimmed.slice(1);
}

function selectorFromRuntime(slotConfig) {
  const selector = value(slotConfig, 'domSelector', 'dom_selector');
  if (selector) return selector;
  const domId = value(slotConfig, 'domId', 'dom_id');
  return domId ? `#${domId}` : null;
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

function runtimeSlotScore({ key, config, requestedSlotKey, preferredType, placement }) {
  const runtimeKey = String(value(config, 'slotKey', 'slot_key') || key || '');
  const aliases = [
    requestedSlotKey,
    ...(placement && Array.isArray(placement.aliases) ? placement.aliases : [])
  ].filter(Boolean).map(String);
  const selector = placement && placement.selector;
  const selectorDomId = selectorId(selector);
  const runtimeSelector = selectorFromRuntime(config);
  const runtimeDomId = value(config, 'domId', 'dom_id') || selectorId(runtimeSelector);
  const type = adUnitType(config, key);
  const wantedType = preferredType ? String(preferredType).toLowerCase() : '';

  let score = 0;
  if (wantedType) score += type === wantedType ? 100 : -100;
  if (aliases.includes(String(key)) || aliases.includes(runtimeKey)) score += 30;
  if (requestedSlotKey === key || requestedSlotKey === runtimeKey) score += 4;
  if ((selectorDomId && runtimeDomId === selectorDomId) || (selector && runtimeSelector === selector)) score += 20;
  if (hasConcreteSizes(config)) score += 60;
  if (hasFluidSizes(config)) score -= 30;
  if (type && (String(key).startsWith(`${type}-`) || runtimeKey.startsWith(`${type}-`))) score += 8;
  if (type && (String(key) === type || runtimeKey === type)) score += 10;
  return score;
}

function preferredRuntimeSlot(current, candidate, context) {
  if (!current) return candidate;
  const currentScore = runtimeSlotScore(Object.assign({}, context, current));
  const candidateScore = runtimeSlotScore(Object.assign({}, context, candidate));
  return candidateScore > currentScore ? candidate : current;
}

function slotNameForTargeting(config, fallback) {
  const explicit = value(config, 'slot_name', 'slotName');
  if (explicit) return String(explicit);

  const raw = String(adUnitType(config, fallback) || fallback || '').toLowerCase();
  if (raw.includes('anchor')) return 'anchor';
  if (raw.includes('interstitial')) return 'interstitial';
  if (raw.includes('native')) return 'native';
  if (raw.includes('rewarded')) return 'rewarded';
  return 'banner';
}

function targetingValue(rawValue) {
  return Array.isArray(rawValue) ? rawValue.map(String) : String(rawValue);
}

function setTargeting(target, key, rawValue) {
  if (!target || !key || rawValue == null) return;
  const valueToSet = targetingValue(rawValue);
  if (target.setConfig) {
    target.setConfig({ targeting: { [key]: valueToSet } });
    return;
  }
  target.setTargeting && target.setTargeting(key, valueToSet);
}

function clearTargeting(target, keys) {
  if (!target) return;
  if (target.setConfig) {
    if (!keys) {
      target.setConfig({ targeting: null });
      return;
    }
    target.setConfig({ targeting: Object.fromEntries(keys.map(key => [key, null])) });
    return;
  }
  if (target.clearTargeting) {
    if (!keys) {
      target.clearTargeting();
      return;
    }
    for (const key of keys) target.clearTargeting(key);
  }
}

function applyTargetingObject(target, targeting, appliedKeys, { skipKeys } = {}) {
  if (!targeting || typeof targeting !== 'object' || Array.isArray(targeting)) return;
  for (const [key, targetingValue] of Object.entries(targeting)) {
    if (skipKeys && skipKeys.has(key)) continue;
    setTargeting(target, key, targetingValue);
    if (targetingValue != null && appliedKeys) appliedKeys.add(key);
  }
}

function runtimePolicyFor(runtime, expGroup) {
  const policy = objectValue(runtime, 'targetingPolicy', 'targeting_policy');
  if (!policy || !expGroup || !Array.isArray(policy[expGroup])) return null;
  return new Set(policy[expGroup]);
}

function targetingPolicyFor(runtime, config, expGroup) {
  const slotExperiment = objectValue(config, 'experiment') || {};
  const candidates = [
    objectValue(config, 'targetingPolicy', 'targeting_policy'),
    objectValue(slotExperiment, 'targetingPolicy', 'targeting_policy'),
    objectValue(runtime, 'targetingPolicy', 'targeting_policy')
  ];
  for (const policy of candidates) {
    if (policy && expGroup && Array.isArray(policy[expGroup])) return new Set(policy[expGroup]);
  }
  return null;
}

function priceTargetingKeys(targetingKey) {
  return Array.from(new Set([targetingKey, 'price_rule'].filter(Boolean)));
}

function experimentTargetingFor({ runtime, cfg, experiment, state }) {
  const selectedArm = armConfigFor(cfg, experiment && experiment.expGroup);
  const configuredGroup = cleanGroup(
    value(runtime, 'exp_group', 'expGroup') ||
    value(cfg, 'exp_group', 'expGroup')
  );
  const expGroup = configuredGroup || cleanGroup(experiment && experiment.expGroup);
  const expKey = value(runtime, 'exp_key', 'expKey') ||
    (selectedArm ? value(selectedArm, 'exp_key', 'expKey') : null) ||
    value(cfg, 'exp_key', 'expKey') ||
    (experiment && experiment.expKey) ||
    null;
  const explicitSlotName = value(cfg, 'slot_name', 'slotName');
  const slotName = explicitSlotName || slotNameForTargeting(cfg, state && state.name);

  return {
    expGroup,
    expKey,
    slotName,
    hasExperiment: Boolean(expGroup && expKey),
    hasConfiguredGroup: Boolean(configuredGroup),
    hasConfiguredSlotName: Boolean(explicitSlotName)
  };
}

function shouldApplyExperimentTargeting(targeting, policy, key) {
  if (!targeting) return false;
  if (targeting.hasExperiment) return true;
  if (key === 'exp_group' && targeting.hasConfiguredGroup) return true;
  if (key === 'slot_name' && targeting.hasConfiguredSlotName) return true;
  return Boolean(policy && policy.has(key));
}

function applyExperimentTargeting(slot, targeting, policy) {
  if (!slot || !targeting) return;
  if (targeting.expGroup && shouldApplyExperimentTargeting(targeting, policy, 'exp_group')) {
    setTargeting(slot, 'exp_group', targeting.expGroup);
  }
  if (targeting.expKey && shouldApplyExperimentTargeting(targeting, policy, 'exp_key')) {
    setTargeting(slot, 'exp_key', targeting.expKey);
  }
  if (targeting.slotName && shouldApplyExperimentTargeting(targeting, policy, 'slot_name')) {
    setTargeting(slot, 'slot_name', targeting.slotName);
  }
}

function refreshRoundTargetingKeyFor(config, policy) {
  const slotExperiment = objectValue(config, 'experiment') || {};
  const explicitKey = value(config, 'refreshRoundTargetingKey', 'refresh_round_targeting_key') ||
    value(slotExperiment, 'refreshRoundTargetingKey', 'refresh_round_targeting_key');
  if (explicitKey) return String(explicitKey);

  const explicitEnabled = booleanValue(
    value(config, 'refreshRoundTargeting', 'refresh_round_targeting') ??
      value(slotExperiment, 'refreshRoundTargeting', 'refresh_round_targeting'),
    null
  );
  if (explicitEnabled === true) return 'refresh_round';
  if (explicitEnabled === false) return null;
  return policy && policy.has('refresh_round') ? 'refresh_round' : null;
}

function refreshRoundForState(state) {
  if (!state || !state.unit || state.unit.type === 'interstitial' || state.unit.type === 'rewarded') return null;
  const round = Math.max(0, Math.floor(numberValue(state.displayRefreshIndex, state.completedRefreshes, 0) || 0));
  return Math.min(round, 3);
}

function applyRefreshRoundTargeting(slot, state, policy) {
  const key = refreshRoundTargetingKeyFor(state && state.cfg, policy);
  const round = refreshRoundForState(state);
  if (!key || round == null) return;
  setTargeting(slot, key, round);
}

function armConfigFor(config, expGroup) {
  if (!config || !expGroup) return null;
  return objectValue(config, expGroup) ||
    (objectValue(config, 'experiment') && objectValue(config.experiment, expGroup));
}

function priceSequenceFor(config, expGroup) {
  const selectedArm = armConfigFor(config, expGroup);
  const raw = arrayValue(config, 'waterfall', 'priceRuleWaterfall', 'price_rule_waterfall');
  const armRaw = selectedArm ? arrayValue(selectedArm, 'waterfall', 'ladder', 'priceRuleWaterfall', 'price_rule_waterfall') : [];
  const fallbackRaw = arrayValue(config, 'ladder');
  const source = raw.length ? raw : (armRaw.length ? armRaw : fallbackRaw);
  return source.map(priceValue).filter(value => Number.isFinite(value) && value > 0);
}

function priceSequenceListValue(source, ...keys) {
  const found = value(source, ...keys);
  let groups = [];
  if (Array.isArray(found)) {
    groups = found;
  } else if (typeof found === 'string') {
    try {
      const parsed = JSON.parse(found);
      groups = Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      groups = found.split(';').map(group => group.split(','));
    }
  }

  return groups
    .map(group => Array.isArray(group)
      ? group.map(priceValue).filter(value => Number.isFinite(value) && value > 0)
      : [])
    .filter(group => group.length);
}

function refreshLaddersFor(config, expGroup) {
  const selectedArm = armConfigFor(config, expGroup);
  const raw = priceSequenceListValue(config, 'refreshLadders', 'refresh_ladders', 'refreshWaterfalls', 'refresh_waterfalls');
  const armRaw = selectedArm ? priceSequenceListValue(selectedArm, 'refreshLadders', 'refresh_ladders', 'refreshWaterfalls', 'refresh_waterfalls') : [];
  const source = raw.length ? raw : armRaw;
  return source.map(group => group.slice(0, 20));
}

function pricedAttemptLimit(config, type, sequenceLength, expGroup) {
  if (expGroup !== 'variant') return 0;

  const explicit = type === 'rewarded'
    ? numberValue(value(config, 'maximumRewardedAttempts', 'maximum_rewarded_attempts'), value(config, 'maxAttempts', 'max_attempts'), value(config, 'retryLimit', 'retry_limit'))
    : numberValue(value(config, 'maxAttempts', 'max_attempts'), value(config, 'retryLimit', 'retry_limit'));
  if (explicit != null) return Math.max(0, Math.min(Math.floor(explicit), sequenceLength, 20));
  return Math.max(0, Math.min(sequenceLength, 20));
}

function displayRefreshEnabledFor(config, refreshLadders) {
  if (!refreshLadders.length) return false;
  const explicit = booleanValue(value(config, 'refreshEnabled', 'refresh_enabled'), null);
  if (explicit != null) return explicit;
  return true;
}

function displayRefreshDelayFor(config) {
  const explicit = numberValue(value(config, 'refreshDelayMs', 'refresh_delay_ms'));
  if (explicit != null) return Math.max(0, explicit);
  return 30000;
}

function displayRefreshLimitFor(config, refreshLadders) {
  const explicit = numberValue(value(config, 'maximumRefreshes', 'maximum_refreshes', 'maxRefreshes', 'max_refreshes'));
  if (explicit != null) return Math.max(0, Math.min(Math.floor(explicit), 20));
  return refreshLadders.length;
}

function retryDelayFor(config, type) {
  const explicit = numberValue(
    value(config, 'retryDelayMs', 'retry_delay_ms'),
    value(config, 'retryAfterMs', 'retry_after_ms'),
    value(config, 'retryTimeoutMs', 'retry_timeout_ms')
  );
  if (explicit != null) return Math.max(0, explicit);
  return type === 'interstitial' ? 0 : 2500;
}

function requestTimeoutFor(config, type, override) {
  const explicit = numberValue(
    override,
    type === 'rewarded' ? value(config, 'rewardedRequestTimeoutMs', 'rewarded_request_timeout_ms') : undefined,
    type === 'interstitial' ? value(config, 'interstitialTimeoutMs', 'interstitial_timeout_ms') : undefined,
    value(config, 'requestTimeoutMs', 'request_timeout_ms')
  );
  if (explicit != null) return Math.max(1, explicit);
  if (type === 'rewarded') return 15000;
  if (type === 'interstitial') return 10000;
  return 12000;
}

function rewardedAttemptTimeoutFor(config) {
  const explicit = numberValue(
    value(config, 'rewardedAttemptTimeoutMs', 'rewarded_attempt_timeout_ms'),
    value(config, 'retryTimeoutMs', 'retry_timeout_ms'),
    value(config, 'retryDelayMs', 'retry_delay_ms')
  );
  if (explicit != null && explicit > 0) return Math.max(250, explicit);
  return 2500;
}

function eventMatchesSlot(slot, event) {
  return Boolean(event && event.slot === slot);
}

function modeAllowsSdk(config, runtime) {
  const mode = String(value(config, 'integrationMode', 'integration_mode', 'configuredIntegrationMode', 'configured_integration_mode') ||
    value(runtime, 'integrationMode', 'integration_mode') ||
    'waterfall_only').toLowerCase();
  return DISPLAY_MODES.has(mode);
}

function withSelectedArm(config, expGroup) {
  if (!expGroup) return Object.assign({}, config);
  const arm = objectValue(config, expGroup) ||
    (objectValue(config, 'experiment') && objectValue(config.experiment, expGroup));
  return Object.assign({}, config, arm || {}, { selectedArm: expGroup });
}

function hasOwnSizes(config) {
  return Object.prototype.hasOwnProperty.call(config || {}, 'sizes') ||
    Object.prototype.hasOwnProperty.call(config || {}, 'sizesJson') ||
    Object.prototype.hasOwnProperty.call(config || {}, 'sizes_json');
}

function currentViewportWidth(windowRef, documentRef) {
  return numberValue(
    windowRef && windowRef.innerWidth,
    documentRef && documentRef.documentElement && documentRef.documentElement.clientWidth,
    windowRef && windowRef.screen && windowRef.screen.width
  );
}

function isNumericSizePair(size) {
  return Array.isArray(size) &&
    size.length === 2 &&
    Number.isFinite(Number(size[0])) &&
    Number.isFinite(Number(size[1]));
}

function cloneSizePairs(sizes) {
  return sizes.map(size => [Number(size[0]), Number(size[1])]);
}

function sizesForViewport(sizes, viewportWidth) {
  if (!Array.isArray(sizes) || !Number.isFinite(viewportWidth) || viewportWidth <= 0) return sizes;
  if (!sizes.every(isNumericSizePair)) return sizes;

  const pairs = cloneSizePairs(sizes);
  const fitting = pairs.filter(([width]) => width <= viewportWidth);
  const candidates = fitting.length
    ? fitting
    : [pairs.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])[0]];

  if (viewportWidth < 768) {
    const mobile = candidates.filter(([width]) => width <= 480);
    return mobile.length ? mobile : candidates;
  }

  const desktop = candidates.filter(([width]) => width >= 728);
  return desktop.length ? desktop : candidates;
}

const DISPLAY_LAYOUT_STATES = ['reserved', 'requesting', 'filled', 'empty'];
const DEFAULT_REWARDED_PRELOAD_TTL_MS = 45000;
const DISPLAY_VISIBILITY_TICK_MS = 250;

class AdOpportunity {
  constructor({
    opportunityId,
    site,
    adUnitPath,
    divId,
    slotName,
    format,
    country,
    experimentKey,
    experimentGroup,
    ladder,
    refreshIndex = 0,
    preloadMode = 'none',
    createdAt
  }) {
    this.opportunityId = opportunityId;
    this.site = site || null;
    this.adUnitPath = adUnitPath || null;
    this.divId = divId || null;
    this.slotName = slotName || null;
    this.format = format || null;
    this.country = country || null;
    this.experimentKey = experimentKey || null;
    this.experimentGroup = experimentGroup || null;
    this.ladder = Array.isArray(ladder) ? ladder.slice() : [];
    this.ladderIndex = 0;
    this.priceRule = null;
    this.refreshIndex = refreshIndex;
    this.preloadMode = preloadMode;
    this.createdAt = createdAt || Date.now();
    this.requestCount = 0;
    this.gptSlot = null;
    this.state = 'INITIAL';
    this.completionReason = null;
  }

  transition(state, updates = {}) {
    this.state = state;
    Object.assign(this, updates);
    return this;
  }

  snapshot(extra = {}) {
    return Object.assign({
      opportunityId: this.opportunityId,
      site: this.site,
      adUnitPath: this.adUnitPath,
      divId: this.divId,
      slotName: this.slotName,
      format: this.format,
      country: this.country,
      experimentKey: this.experimentKey,
      experimentGroup: this.experimentGroup,
      ladderIndex: this.ladderIndex,
      priceRule: this.priceRule,
      refreshIndex: this.refreshIndex,
      preloadMode: this.preloadMode,
      requestCount: this.requestCount,
      state: this.state,
      completionReason: this.completionReason
    }, extra);
  }
}

function cssToken(value) {
  return String(value || 'unknown').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

function dataAttributeName(key) {
  return `data-${key.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`)}`;
}

function setElementData(element, key, rawValue) {
  if (!element) return;
  const stringValue = rawValue == null ? '' : String(rawValue);
  if (element.dataset) {
    element.dataset[key] = stringValue;
    return;
  }
  element.setAttribute && element.setAttribute(dataAttributeName(key), stringValue);
}

function publicSizes(sizes) {
  if (sizes === 'fluid') return 'fluid';
  if (!Array.isArray(sizes)) return null;
  if (!sizes.every(isNumericSizePair)) return null;
  return cloneSizePairs(sizes);
}

function sizeSummary(sizes) {
  if (sizes === 'fluid') return 'fluid';
  if (!Array.isArray(sizes) || !sizes.every(isNumericSizePair)) return '';
  return sizes.map(([width, height]) => `${Number(width)}x${Number(height)}`).join(',');
}

function timerUnref(timer) {
  if (timer && typeof timer.unref === 'function') timer.unref();
  return timer;
}

function elementStyleValue(element, key, windowRef) {
  if (!element) return '';
  try {
    const computed = windowRef && typeof windowRef.getComputedStyle === 'function'
      ? windowRef.getComputedStyle(element)
      : null;
    const raw = computed && computed[key] != null
      ? computed[key]
      : element.style && element.style[key];
    return String(raw || '').trim().toLowerCase();
  } catch (_) {
    return String(element.style && element.style[key] || '').trim().toLowerCase();
  }
}

function elementRect(element) {
  if (!element || typeof element.getBoundingClientRect !== 'function') return null;
  const rect = element.getBoundingClientRect();
  return rect && typeof rect === 'object' ? rect : null;
}

function elementIsCssRenderable(element, windowRef) {
  let current = element;
  const visited = new Set();
  while (current && !visited.has(current)) {
    visited.add(current);
    if (current.hidden) return false;
    if (elementStyleValue(current, 'display', windowRef) === 'none') return false;
    const visibility = elementStyleValue(current, 'visibility', windowRef);
    if (visibility === 'hidden' || visibility === 'collapse') return false;
    current = current.parentElement || current.parentNode || null;
  }
  return true;
}

function elementHasMeaningfulSize(element, fallbackSizes, windowRef) {
  if (!element) return false;
  if (!elementIsCssRenderable(element, windowRef)) return false;

  const rect = elementRect(element);
  if (rect) {
    const width = numberValue(rect.width, Number(rect.right) - Number(rect.left));
    const height = numberValue(rect.height, Number(rect.bottom) - Number(rect.top));
    return Number(width) > 0 && Number(height) > 0;
  }

  const offsetWidth = numberValue(element.offsetWidth);
  const offsetHeight = numberValue(element.offsetHeight);
  if (offsetWidth != null || offsetHeight != null) return Number(offsetWidth) > 0 && Number(offsetHeight) > 0;

  if (fallbackSizes === 'fluid') return true;
  if (Array.isArray(fallbackSizes) && fallbackSizes.some(isNumericSizePair)) {
    return fallbackSizes.some(([width, height]) => Number(width) > 0 && Number(height) > 0);
  }

  return true;
}

function viewportDimension(windowRef, documentRef, key) {
  const docElement = documentRef && documentRef.documentElement;
  if (key === 'width') {
    return numberValue(windowRef && windowRef.innerWidth, docElement && docElement.clientWidth);
  }
  return numberValue(windowRef && windowRef.innerHeight, docElement && docElement.clientHeight);
}

function elementViewportRatio(element, documentRef, windowRef) {
  const rect = elementRect(element);
  if (!rect) return 1;

  const width = numberValue(rect.width, Number(rect.right) - Number(rect.left));
  const height = numberValue(rect.height, Number(rect.bottom) - Number(rect.top));
  if (!(Number(width) > 0 && Number(height) > 0)) return 0;

  const viewportWidth = viewportDimension(windowRef, documentRef, 'width');
  const viewportHeight = viewportDimension(windowRef, documentRef, 'height');
  if (!(Number(viewportWidth) > 0 && Number(viewportHeight) > 0)) return 1;

  const left = Math.max(0, Number(rect.left));
  const top = Math.max(0, Number(rect.top));
  const right = Math.min(Number(viewportWidth), Number(rect.right));
  const bottom = Math.min(Number(viewportHeight), Number(rect.bottom));
  const visibleWidth = Math.max(0, right - left);
  const visibleHeight = Math.max(0, bottom - top);
  return (visibleWidth * visibleHeight) / (Number(width) * Number(height));
}

function intersectionObserverCtor(windowRef) {
  if (windowRef && typeof windowRef.IntersectionObserver === 'function') return windowRef.IntersectionObserver;
  if (typeof globalThis !== 'undefined' && typeof globalThis.IntersectionObserver === 'function') return globalThis.IntersectionObserver;
  return null;
}

export class PriceOptimiserRuntimeAdapter {
  constructor({ windowRef, documentRef, runtime, logger, random }) {
    this.window = windowRef;
    this.document = documentRef;
    this.runtime = runtime || {};
    this.logger = logger;
    this.random = random;
    this.experimentSelections = new Map();
    this.registry = this.window.__publisherExperienceSlots || {};
    this.pageTargetingKeys = new Set();
    this.refreshTimers = new Set();
    this.displayLifecycleTimers = new Set();
    this.rewardedPreloads = new Map();
    this.opportunityCounter = 0;
    this.fullscreenOverlayDepth = 0;
    this.window.__publisherExperienceSlots = this.registry;
    this.experiment = this.selectExperimentForConfig(null);
  }

  get googletag() {
    this.window.googletag = this.window.googletag || { cmd: [] };
    return this.window.googletag;
  }

  runtimeSlots() {
    return this.runtime && this.runtime.slots ? this.runtime.slots : {};
  }

  selectExperimentForConfig(config) {
    const experimentConfig = experimentConfigFor(this.runtime, config);
    const expKey = value(experimentConfig, 'expKey', 'key', 'exp_key') || '';
    const siteKey = runtimeSiteKey(this.runtime) || '';
    const cacheKey = `${siteKey}:${expKey}`;
    if (this.experimentSelections.has(cacheKey)) return this.experimentSelections.get(cacheKey);

    const selected = selectedExperiment(this.runtime, {
      experimentConfig,
      siteKey,
      storage: this.window && this.window.localStorage,
      random: this.random
    });
    this.experimentSelections.set(cacheKey, selected);
    return selected;
  }

  configWithSelectedArm(config) {
    const experiment = this.selectExperimentForConfig(config);
    return Object.assign(withSelectedArm(config, experiment.expGroup), {
      selectedExperiment: experiment
    });
  }

  resolveRuntimeSlot({ slotKey, preferredType, placement } = {}) {
    const slots = this.runtimeSlots();
    const aliases = [
      slotKey,
      ...(placement && Array.isArray(placement.aliases) ? placement.aliases : [])
    ].filter(Boolean).map(String);
    const selector = placement && placement.selector;
    const selectorDomId = selectorId(selector);
    const context = { requestedSlotKey: slotKey, preferredType, placement };
    let selected = null;
    const seen = new Set();

    const consider = (key, config) => {
      if (!config || config.enabled === false || seen.has(key)) return;
      seen.add(key);
      selected = preferredRuntimeSlot(selected, { key, config }, context);
    };

    for (const key of aliases) {
      if (slots[key]) consider(key, slots[key]);
    }

    for (const [key, config] of Object.entries(slots)) {
      if (aliases.includes(String(value(config, 'slotKey', 'slot_key') || key))) consider(key, config);
    }

    if (selectorDomId || selector) {
      for (const [key, config] of Object.entries(slots)) {
        const domSelector = selectorFromRuntime(config);
        const domId = value(config, 'domId', 'dom_id') || selectorId(domSelector);
        if ((selectorDomId && domId === selectorDomId) || (selector && domSelector === selector)) {
          consider(key, config);
        }
      }
    }

    if (selected) return selected;

    if (preferredType) {
      const typed = Object.entries(slots).filter(([, config]) => {
        return adUnitType(config) === String(preferredType).toLowerCase() && config.enabled !== false;
      });
      if (typed.length === 1) return { key: typed[0][0], config: typed[0][1] };
    }

    return null;
  }

  slotConfig(slotKey, preferredType, placement) {
    const resolved = this.resolveRuntimeSlot({ slotKey, preferredType, placement });
    if (!resolved || !resolved.config || resolved.config.enabled === false) return null;
    return this.configWithSelectedArm(Object.assign({}, resolved.config, {
      slotKey: value(resolved.config, 'slotKey', 'slot_key') || resolved.key,
      resolvedSlotKey: resolved.key
    }));
  }

  ensureGpt() {
    if (this.window.__publisherExperienceGptPromise) return this.window.__publisherExperienceGptPromise;

    this.window.__publisherExperienceGptPromise = new Promise((resolve, reject) => {
      const g = this.googletag;
      if (g.apiReady || g.pubadsReady) {
        resolve(g);
        return;
      }

      const existing = this.document.querySelector(`script[src="${GPT_SRC}"]`);
      const wait = () => {
        if (this.googletag.apiReady || this.googletag.pubadsReady) {
          resolve(this.googletag);
          return;
        }
        setTimeout(wait, 50);
      };

      if (existing) {
        wait();
        return;
      }

      const script = this.document.createElement('script');
      script.async = true;
      script.src = GPT_SRC;
      script.onload = wait;
      script.onerror = () => reject(new Error('GPT load failed'));
      this.document.head.appendChild(script);
    });

    return this.window.__publisherExperienceGptPromise;
  }

  configureServicesOnce() {
    const g = this.googletag;
    if (this.window.__publisherExperienceGptConfigured) return;
    this.window.__publisherExperienceGptConfigured = true;

    try {
      const pageUrl = this.window && this.window.location && this.window.location.href;
      const pageTargeting = value(this.runtime, 'globalTargeting', 'global_targeting', 'pageTargeting', 'page_targeting');
      if (g.setConfig) {
        const config = {
          singleRequest: false,
          collapseDiv: 'DISABLED'
        };
        if (pageUrl && /^https?:\/\//i.test(pageUrl)) {
          config.adsenseAttributes = { page_url: pageUrl };
        }
        if (pageTargeting && typeof pageTargeting === 'object' && !Array.isArray(pageTargeting)) {
          config.targeting = {};
          for (const [key, rawTargetingValue] of Object.entries(pageTargeting)) {
            if (rawTargetingValue == null) continue;
            config.targeting[key] = targetingValue(rawTargetingValue);
            this.pageTargetingKeys.add(key);
          }
        }
        g.setConfig(config);
      } else {
        applyTargetingObject(g.pubads && g.pubads(), pageTargeting, this.pageTargetingKeys);
      }
      if (pageUrl && /^https?:\/\//i.test(pageUrl) && g.pubads && g.pubads().set) {
        g.pubads().set('page_url', pageUrl);
      }
      g.enableServices && g.enableServices();
    } catch (error) {
      this.logger && this.logger.warn('GPT service configuration skipped', { message: error.message });
    }
  }

  async withGpt(callback) {
    await this.ensureGpt();
    return new Promise(resolve => {
      this.googletag.cmd.push(() => {
        this.configureServicesOnce();
        resolve(callback(this.googletag));
      });
    });
  }

  canonicalUnit(slotKey, rawConfig, elementId) {
    const type = adUnitType(rawConfig, slotKey);
    const gamPath = adUnitPath(rawConfig);
    const runtimeSlotKey = value(rawConfig, 'resolvedSlotKey', 'slotKey', 'slot_key') || slotKey;
    const rawSizes = hasOwnSizes(rawConfig) ? value(rawConfig, 'sizes', 'sizesJson', 'sizes_json') : undefined;
    const normalizedSizes = type === 'interstitial' || type === 'rewarded'
      ? null
      : normalizeSizes(rawSizes, { adUnitType: type, slotKey: runtimeSlotKey });
    const sizes = sizesForViewport(normalizedSizes, currentViewportWidth(this.window, this.document));

    return {
      slotKey,
      runtimeSlotKey,
      type,
      gamPath,
      sizes,
      divId: elementId || null,
      collapseEmpty: booleanValue(value(rawConfig, 'collapseEmpty', 'collapse_empty'), true),
      enabled: rawConfig.enabled !== false
    };
  }

  createState(name, slot, cfg, unit, options = {}) {
    const type = unit.type || adUnitType(cfg, name);
    const experiment = this.selectExperimentForConfig(cfg);
    const sequence = priceSequenceFor(cfg, experiment.expGroup);
    const pricedAttempts = pricedAttemptLimit(cfg, type, sequence.length, experiment.expGroup);
    const baseSequence = sequence.slice(0, pricedAttempts);
    const refreshLadders = type === 'interstitial' || type === 'rewarded'
      ? []
      : refreshLaddersFor(cfg, experiment.expGroup);
    const refreshEnabled = type === 'interstitial' || type === 'rewarded'
      ? false
      : displayRefreshEnabledFor(cfg, refreshLadders);
    const state = {
      name,
      slot,
      cfg,
      unit,
      experiment,
      opportunity: null,
      attempt: 0,
      maxAttempts: experiment.expGroup === 'variant' ? pricedAttempts + 1 : 1,
      retryDelayMs: retryDelayFor(cfg, type),
      requestTimeoutMs: requestTimeoutFor(cfg, type),
      sequence: baseSequence.slice(),
      baseSequence,
      baseMaxAttempts: experiment.expGroup === 'variant' ? pricedAttempts + 1 : 1,
      refreshLadders,
      displayRefreshIndex: 0,
      completedRefreshes: 0,
      refreshEnabled,
      refreshDelayMs: displayRefreshDelayFor(cfg),
      maximumRefreshes: refreshEnabled ? displayRefreshLimitFor(cfg, refreshLadders) : 0,
      refreshTimer: null,
      refreshVisibleMs: 0,
      refreshVisibleSince: null,
      refreshIntersectionRatio: 1,
      refreshObserver: null,
      activeRefreshRound: 0,
      initialPreloadPrepared: false,
      initialRevealRequested: false,
      hasFilledOnce: false,
      initialNoFillRecoveryTimer: null,
      initialNoFillRecoveryWasEligible: false,
      filled: false,
      stopped: false,
      displayed: false,
      requestStarted: false,
      requestPromise: null,
      layoutState: unit.divId ? 'reserved' : null,
      collapsed: false,
      originalDisplay: undefined
    };
    state.opportunity = options.opportunity || this.createOpportunity(state, {
      preloadMode: options.preloadMode,
      refreshIndex: options.refreshIndex
    });
    if (slot) this.attachOpportunitySlot(state, slot);
    if (options.opportunity) this.traceOpportunity(state, 'continued');
    else this.traceOpportunity(state, 'created');
    return state;
  }

  nextOpportunityId(state) {
    this.opportunityCounter += 1;
    const type = state && state.unit && state.unit.type || 'slot';
    const name = state && state.name || state && state.unit && state.unit.runtimeSlotKey || 'ad';
    return `${cssToken(type)}-${cssToken(name)}-${this.opportunityCounter.toString(36)}`;
  }

  countryForOpportunity() {
    const runtimeCountry = value(this.runtime, 'country', 'countryCode', 'country_code', 'geoCountry', 'geo_country');
    if (typeof runtimeCountry === 'string') return runtimeCountry || null;
    if (runtimeCountry && typeof runtimeCountry === 'object') {
      return value(runtimeCountry, 'country', 'countryCode', 'country_code', 'isoCode', 'iso_code') || null;
    }
    const geo = value(this.runtime, 'geo', 'geoContext', 'geo_context');
    if (geo && typeof geo === 'object') return value(geo, 'country', 'countryCode', 'country_code', 'isoCode', 'iso_code') || null;
    return null;
  }

  createOpportunity(state, overrides = {}) {
    const unit = state && state.unit || {};
    const cfg = state && state.cfg || {};
    const experiment = state && state.experiment || this.experiment || {};
    return new AdOpportunity({
      opportunityId: overrides.opportunityId || this.nextOpportunityId(state),
      site: runtimeSiteKey(this.runtime),
      adUnitPath: unit.gamPath,
      divId: unit.divId,
      slotName: slotNameForTargeting(cfg, state && state.name),
      format: unit.type,
      country: this.countryForOpportunity(),
      experimentKey: experiment.expKey,
      experimentGroup: experiment.expGroup,
      ladder: state && state.sequence ? state.sequence : [],
      refreshIndex: Math.max(0, Math.floor(numberValue(overrides.refreshIndex, state && state.displayRefreshIndex, 0) || 0)),
      preloadMode: overrides.preloadMode || 'none',
      createdAt: overrides.createdAt
    });
  }

  startOpportunity(state, overrides = {}) {
    if (!state) return null;
    state.opportunity = this.createOpportunity(state, overrides);
    if (state.slot) this.attachOpportunitySlot(state, state.slot);
    this.traceOpportunity(state, 'created');
    if (state.slot) this.transitionOpportunity(state, 'SLOT_DEFINED');
    return state.opportunity;
  }

  attachOpportunitySlot(state, slot) {
    if (!state || !state.opportunity) return;
    state.opportunity.gptSlot = slot || null;
  }

  transitionOpportunity(state, nextState, extra = {}) {
    if (!state || !state.opportunity) return;
    state.opportunity.transition(nextState, extra);
    this.traceOpportunity(state, nextState.toLowerCase(), extra);
  }

  recordOpportunityRequest(state, requestKind, floor) {
    if (!state || !state.opportunity) return;
    state.opportunity.requestCount += 1;
    state.opportunity.ladderIndex = Number.isFinite(Number(state.attempt)) ? Number(state.attempt) : 0;
    state.opportunity.priceRule = floor == null ? null : String(floor);
    state.opportunity.ladder = Array.isArray(state.sequence) ? state.sequence.slice() : [];
    state.opportunity.refreshIndex = Math.max(0, Math.floor(numberValue(state.displayRefreshIndex, 0) || 0));
    state.opportunity.transition('REQUESTED');
    this.traceOpportunity(state, `request #${state.opportunity.requestCount}`, { requestKind });
  }

  completeOpportunity(state, reason) {
    if (!state || !state.opportunity) return;
    state.opportunity.completionReason = reason || null;
    this.transitionOpportunity(state, 'COMPLETE', { completionReason: state.opportunity.completionReason });
  }

  traceOpportunity(state, event, extra = {}) {
    const opportunity = state && state.opportunity;
    if (!opportunity || !this.logger || !this.logger.debug) return;
    this.logger.debug(`PO opportunity ${event}`, opportunity.snapshot(Object.assign({
      placement: state && state.name || null
    }, extra)));
  }

  defineGptDisplaySlot(state) {
    if (!state || !state.unit) return null;
    const slot = this.googletag.defineSlot(state.unit.gamPath, state.unit.sizes, state.unit.divId);
    if (!slot) return null;
    slot.addService(this.googletag.pubads());
    state.slot = slot;
    this.attachOpportunitySlot(state, slot);
    this.transitionOpportunity(state, 'SLOT_DEFINED');
    return slot;
  }

  defineGptOutOfPageSlot(state, format) {
    if (!state || !state.unit || !format) return null;
    const slot = this.googletag.defineOutOfPageSlot(state.unit.gamPath, format);
    if (!slot) return null;
    slot.addService(this.googletag.pubads());
    state.slot = slot;
    this.attachOpportunitySlot(state, slot);
    this.transitionOpportunity(state, 'SLOT_DEFINED');
    return slot;
  }

  refreshGptSlot(state) {
    if (!state || !state.slot) return false;
    this.googletag.pubads().refresh([state.slot]);
    return true;
  }

  displayGptSlot(state) {
    if (!state || !state.slot) return false;
    if (state.unit && state.unit.divId) this.googletag.display(state.unit.divId);
    else this.googletag.display(state.slot);
    return true;
  }

  applyDisplayRequestSequence(state) {
    if (!state || !state.unit || state.unit.type === 'interstitial' || state.unit.type === 'rewarded') return;
    const experiment = state.experiment || this.experiment;
    if (experiment.expGroup !== 'variant') {
      state.sequence = [];
      state.maxAttempts = 1;
      return;
    }

    if (!state.displayRefreshIndex) {
      state.sequence = state.baseSequence.slice();
      state.maxAttempts = state.baseMaxAttempts;
      return;
    }

    const ladderIndex = Math.min(state.displayRefreshIndex - 1, Math.max(0, state.refreshLadders.length - 1));
    const sequence = (state.refreshLadders[ladderIndex] || state.baseSequence || []).slice(0, 20);
    state.sequence = sequence;
    state.maxAttempts = sequence.length + 1;
  }

  clearDisplayRefreshTimer(state) {
    if (!state || !state.refreshTimer) return;
    clearTimeout(state.refreshTimer);
    this.refreshTimers.delete(state.refreshTimer);
    state.refreshTimer = null;
  }

  clearInitialNoFillRecovery(state) {
    if (!state || !state.initialNoFillRecoveryTimer) return;
    clearTimeout(state.initialNoFillRecoveryTimer);
    this.displayLifecycleTimers.delete(state.initialNoFillRecoveryTimer);
    state.initialNoFillRecoveryTimer = null;
  }

  initialNoFillRecoveryEligible(state) {
    if (!state || state.filled || state.hasFilledOnce || state.requestPromise) return false;
    const element = this.elementForState(state);
    if (elementHasMeaningfulSize(element, state.unit && state.unit.sizes, this.window) &&
      elementViewportRatio(element, this.document, this.window) >= 0.5) return true;
    const parent = element && (element.parentElement || element.parentNode);
    return elementHasMeaningfulSize(parent, state.unit && state.unit.sizes, this.window) &&
      elementViewportRatio(parent, this.document, this.window) >= 0.5;
  }

  armInitialNoFillRecovery(state) {
    if (!state || state.hasFilledOnce || state.filled || state.initialNoFillRecoveryTimer) return false;
    state.initialNoFillRecoveryWasEligible = this.initialNoFillRecoveryEligible(state);

    const check = () => {
      state.initialNoFillRecoveryTimer = null;
      if (!state || state.hasFilledOnce || state.filled) return;
      const eligible = this.initialNoFillRecoveryEligible(state);
      if (eligible && !state.initialNoFillRecoveryWasEligible) {
        state.initialNoFillRecoveryWasEligible = true;
        this.requestDisplaySlot(state).catch(error => {
          this.logger && this.logger.warn('GAM initial no-fill recovery failed', {
            slot: state.name,
            runtimeSlotKey: state.unit && state.unit.runtimeSlotKey,
            message: error && error.message
          });
          this.armInitialNoFillRecovery(state);
        });
        return;
      }
      if (!eligible) state.initialNoFillRecoveryWasEligible = false;
      state.initialNoFillRecoveryTimer = timerUnref(setTimeout(check, DISPLAY_VISIBILITY_TICK_MS));
      this.displayLifecycleTimers.add(state.initialNoFillRecoveryTimer);
    };

    state.initialNoFillRecoveryTimer = timerUnref(setTimeout(check, DISPLAY_VISIBILITY_TICK_MS));
    this.displayLifecycleTimers.add(state.initialNoFillRecoveryTimer);
    return true;
  }

  setupDisplayRefreshObserver(state) {
    if (!state || state.refreshObserver || !state.unit || !state.unit.divId) return;
    const element = this.elementForState(state);
    if (!element) return;
    const Observer = intersectionObserverCtor(this.window);
    if (!Observer) {
      state.refreshIntersectionRatio = elementViewportRatio(element, this.document, this.window);
      return;
    }

    try {
      const observer = new Observer(entries => {
        const entry = entries && entries.find(item => item && item.target === element) || entries && entries[0];
        if (!entry) return;
        if (Number.isFinite(Number(entry.intersectionRatio))) {
          state.refreshIntersectionRatio = Number(entry.intersectionRatio);
        } else {
          state.refreshIntersectionRatio = entry.isIntersecting ? 1 : 0;
        }
      }, { root: null, threshold: [0, 0.5, 1] });
      observer.observe(element);
      state.refreshObserver = observer;
    } catch (_) {
      state.refreshIntersectionRatio = elementViewportRatio(element, this.document, this.window);
    }
  }

  teardownDisplayRefreshObserver(state) {
    if (!state || !state.refreshObserver) return;
    if (state.refreshObserver.disconnect) state.refreshObserver.disconnect();
    state.refreshObserver = null;
  }

  isFullscreenOverlayActive() {
    return this.fullscreenOverlayDepth > 0;
  }

  setFullscreenOverlayActive(active) {
    if (active) {
      this.fullscreenOverlayDepth += 1;
      return;
    }
    this.fullscreenOverlayDepth = Math.max(0, this.fullscreenOverlayDepth - 1);
  }

  displayRefreshVisibilityEligible(state) {
    if (!state || !state.unit || !state.unit.divId) return false;
    if (this.document && this.document.visibilityState === 'hidden') return false;
    if (this.isFullscreenOverlayActive()) return false;

    const element = this.elementForState(state);
    if (!elementHasMeaningfulSize(element, state.unit.sizes, this.window)) return false;

    if (state.refreshObserver) {
      return Number(state.refreshIntersectionRatio) >= 0.5;
    }

    return elementViewportRatio(element, this.document, this.window) >= 0.5;
  }

  nextDisplayRefreshRound(state) {
    const activeRound = Math.max(0, Math.floor(numberValue(state && state.activeRefreshRound, state && state.completedRefreshes, state && state.displayRefreshIndex, 0) || 0));
    return activeRound + 1;
  }

  scheduleNextDisplayRefreshTick(state, delayMs) {
    this.clearDisplayRefreshTimer(state);
    state.refreshTimer = timerUnref(setTimeout(() => {
      this.refreshTimers.delete(state.refreshTimer);
      state.refreshTimer = null;
      this.onDisplayRefreshTick(state, delayMs);
    }, delayMs));
    this.refreshTimers.add(state.refreshTimer);
  }

  scheduleDisplayRefresh(state) {
    if (!state || !state.unit || state.unit.type === 'interstitial' || state.unit.type === 'rewarded') return false;
    if (!state.refreshEnabled || state.refreshDelayMs <= 0 || state.maximumRefreshes <= 0) return false;
    if (this.nextDisplayRefreshRound(state) > state.maximumRefreshes) return false;
    this.setupDisplayRefreshObserver(state);
    this.scheduleNextDisplayRefreshTick(state, Math.min(DISPLAY_VISIBILITY_TICK_MS, state.refreshDelayMs));
    return true;
  }

  onDisplayRefreshTick(state, elapsedMs) {
    if (!state || state.stopped !== true || state.filled !== true) return;

    if (!this.displayRefreshVisibilityEligible(state)) {
      state.refreshVisibleSince = null;
      this.scheduleNextDisplayRefreshTick(state, DISPLAY_VISIBILITY_TICK_MS);
      return;
    }

    state.refreshVisibleMs += Math.max(0, Number(elapsedMs) || 0);
    if (state.refreshVisibleMs < state.refreshDelayMs) {
      this.scheduleNextDisplayRefreshTick(state, Math.min(DISPLAY_VISIBILITY_TICK_MS, state.refreshDelayMs - state.refreshVisibleMs));
      return;
    }

    state.refreshVisibleMs = 0;
    state.refreshVisibleSince = null;
    this.requestDisplayRefresh(state).catch(error => {
      this.logger && this.logger.warn('GAM auto refresh failed', {
        slot: state.name,
        runtimeSlotKey: state.unit && state.unit.runtimeSlotKey,
        message: error && error.message
      });
      this.scheduleDisplayRefresh(state);
    });
  }

  destroy() {
    for (const timer of this.refreshTimers) clearTimeout(timer);
    this.refreshTimers.clear();
    for (const timer of this.displayLifecycleTimers) clearTimeout(timer);
    this.displayLifecycleTimers.clear();
    for (const preload of this.rewardedPreloads.values()) {
      this.cleanupRewardedPreload(preload, { destroySlot: true });
    }
    this.rewardedPreloads.clear();
    for (const state of Object.values(this.registry || {})) {
      if (!state) continue;
      if (state.refreshTimer) state.refreshTimer = null;
      this.clearInitialNoFillRecovery(state);
      this.teardownDisplayRefreshObserver(state);
    }
  }

  rewardedPreloadKey(slotKey) {
    return String(slotKey || 'rewarded').trim() || 'rewarded';
  }

  destroyStateSlot(state) {
    if (!state || !state.slot) return;
    this.destroySlotOnly(state.slot);
    for (const [key, value] of Object.entries(this.registry || {})) {
      if (value === state) delete this.registry[key];
    }
  }

  destroySlotOnly(slot) {
    if (!slot) return;
    if (this.googletag.destroySlots) {
      try {
        this.googletag.destroySlots([slot]);
      } catch (_) {}
    }
  }

  cleanupRewardedPreload(preload, { destroySlot = false } = {}) {
    if (!preload || preload.cleaned) return;
    preload.cleaned = true;
    clearTimeout(preload.timer);
    clearTimeout(preload.retryTimer);
    clearTimeout(preload.attemptTimer);
    clearTimeout(preload.ttlTimer);
    clearTimeout(preload.consumeTimer);
    const pubads = preload.pubads;
    if (pubads && pubads.removeEventListener) {
      pubads.removeEventListener('rewardedSlotReady', preload.onReady);
      pubads.removeEventListener('rewardedSlotGranted', preload.onGranted);
      pubads.removeEventListener('rewardedSlotClosed', preload.onClosed);
      pubads.removeEventListener('rewardedSlotVideoCompleted', preload.onVideoCompleted);
      pubads.removeEventListener('slotRenderEnded', preload.onRender);
    }
    if (preload.overlayActive) {
      preload.overlayActive = false;
      this.setFullscreenOverlayActive(false);
    }
    if (destroySlot) this.destroyStateSlot(preload.state);
  }

  elementForState(state) {
    const divId = state && state.unit && state.unit.divId;
    if (!divId || !this.document) return null;
    if (typeof this.document.getElementById === 'function') return this.document.getElementById(divId);
    if (typeof this.document.querySelector === 'function') return this.document.querySelector(`#${divId}`);
    return null;
  }

  markDisplaySlotState(state, nextState) {
    if (!state || !state.unit || !state.unit.divId) return;
    state.layoutState = nextState;
    state.collapsed = nextState === 'empty' && state.unit.collapseEmpty !== false;

    const element = this.elementForState(state);
    if (!element) return;

    if (state.originalDisplay === undefined && element.style) {
      state.originalDisplay = element.style.display || '';
    }

    if (element.classList) {
      element.classList.add('po-slot');
      element.classList.add(`po-slot--${cssToken(state.unit.type)}`);
      for (const item of DISPLAY_LAYOUT_STATES) {
        element.classList.remove(`po-slot--${item}`);
      }
      element.classList.add(`po-slot--${nextState}`);
    }

    setElementData(element, 'poSlotKey', state.name || state.unit.slotKey || '');
    setElementData(element, 'poSlotType', state.unit.type || '');
    setElementData(element, 'poSlotState', nextState);
    setElementData(element, 'poSlotCollapsed', state.collapsed ? 'true' : 'false');
    setElementData(element, 'poSlotSizes', sizeSummary(state.unit.sizes));

    if (state.collapsed) {
      if (element.style) element.style.display = 'none';
      element.hidden = true;
      element.setAttribute && element.setAttribute('hidden', '');
      return;
    }

    element.hidden = false;
    element.removeAttribute && element.removeAttribute('hidden');
    if (element.style && element.style.display === 'none') {
      element.style.display = state.originalDisplay || '';
    }
  }

  publicSlotStatus(state) {
    const unit = state && state.unit ? state.unit : {};
    return {
      slotKey: state && state.name ? state.name : null,
      domId: unit.divId || null,
      type: unit.type || null,
      state: state && state.layoutState ? state.layoutState : null,
      filled: Boolean(state && state.filled),
      collapsed: Boolean(state && state.collapsed),
      sizes: publicSizes(unit.sizes)
    };
  }

  applyTargeting(state) {
    if (!state || !state.slot) return null;

    const cfg = state.cfg || {};
    const experiment = state.experiment || this.experiment;
    const policy = targetingPolicyFor(this.runtime, cfg, experiment.expGroup) ||
      runtimePolicyFor(this.runtime, experiment.expGroup);
    const allowDerived = key => policy && policy.has(key);
    const floor = state.sequence[state.attempt] ?? null;
    const targetingKey = value(cfg, 'targetingKey', 'targeting_key') || 'price_rule';
    const finalFallbackRequest = experiment.expGroup === 'variant' && state.sequence.length > 0 && floor == null;
    const priceKeys = priceTargetingKeys(targetingKey);
    const finalFallbackBlockedKeys = finalFallbackRequest ? new Set(priceKeys) : null;
    const experimentTargeting = experimentTargetingFor({
      runtime: this.runtime,
      cfg,
      experiment,
      state
    });
    const refreshRoundKey = refreshRoundTargetingKeyFor(state && state.cfg, policy);
    const refreshRound = refreshRoundForState(state);

    if (finalFallbackRequest) clearTargeting(state.slot, priceKeys);
    else clearTargeting(state.slot);

    if (finalFallbackRequest) {
      this.logger && this.logger.debug('GAM plain fallback request', {
        slot: state.name,
        runtimeSlotKey: state.unit && state.unit.runtimeSlotKey
      });
    }

    applyTargetingObject(
      state.slot,
      value(this.runtime, 'targeting', 'targetingValues', 'targeting_values'),
      null,
      { skipKeys: finalFallbackBlockedKeys }
    );
    applyTargetingObject(
      state.slot,
      value(cfg, 'targeting', 'targetingValues', 'targeting_values', 'keyValues', 'key_values'),
      null,
      { skipKeys: finalFallbackBlockedKeys }
    );

    applyExperimentTargeting(state.slot, experimentTargeting, policy);
    applyRefreshRoundTargeting(state.slot, state, policy);

    if (floor != null && experiment.expGroup === 'variant' && (allowDerived('price_rule') || allowDerived(targetingKey))) {
      setTargeting(state.slot, targetingKey, floor);
      if (targetingKey !== 'price_rule' && allowDerived('price_rule')) setTargeting(state.slot, 'price_rule', floor);
    }

    state.lastTargetingSnapshot = {
      exp_key: experimentTargeting.expKey || undefined,
      exp_group: experimentTargeting.expGroup || undefined,
      slot_name: experimentTargeting.slotName || undefined,
      refresh_round: refreshRoundKey && refreshRound != null ? String(refreshRound) : undefined,
      price_rule: floor != null && experiment.expGroup === 'variant' && (allowDerived('price_rule') || allowDerived(targetingKey))
        ? String(floor)
        : undefined
    };

    this.transitionOpportunity(state, 'TARGETING_APPLIED', {
      priceRule: state.lastTargetingSnapshot.price_rule || null,
      targeting: state.lastTargetingSnapshot
    });
    return floor;
  }

  refresh(state) {
    if (!state || state.stopped || state.filled) return false;
    const floor = this.applyTargeting(state);
    this.recordOpportunityRequest(state, 'refresh', floor);
    this.logger && this.logger.debug('GAM refresh', {
      slot: state.name,
      runtimeSlotKey: state.unit && state.unit.runtimeSlotKey,
      floor,
      attempt: state.attempt + 1,
      expGroup: (state.experiment || this.experiment).expGroup
    });
    this.logger && this.logger.debug('PO request sent', {
      placement: state.name,
      divId: state.unit && state.unit.divId,
      sizes: sizeSummary(state.unit && state.unit.sizes),
      attempt: state.attempt + 1,
      targeting: state.lastTargetingSnapshot || {}
    });
    this.refreshGptSlot(state);
    return true;
  }

  displayInitial(state) {
    if (!state || state.stopped || state.filled) return false;
    const floor = this.applyTargeting(state);
    this.recordOpportunityRequest(state, 'display', floor);
    this.logger && this.logger.debug('GAM display', {
      slot: state.name,
      runtimeSlotKey: state.unit && state.unit.runtimeSlotKey,
      floor,
      attempt: state.attempt + 1,
      expGroup: (state.experiment || this.experiment).expGroup
    });
    this.logger && this.logger.debug('PO request sent', {
      placement: state.name,
      divId: state.unit && state.unit.divId,
      sizes: sizeSummary(state.unit && state.unit.sizes),
      attempt: state.attempt + 1,
      targeting: state.lastTargetingSnapshot || {}
    });
    if (!state.displayed) {
      state.displayed = true;
      this.displayGptSlot(state);
    }
    return true;
  }

  defineDisplay(slotKey, elementId, rawConfig) {
    const cfg = this.configWithSelectedArm(rawConfig);
    if (!modeAllowsSdk(cfg, this.runtime)) return null;

    const unit = this.canonicalUnit(slotKey, cfg, elementId);
    if (!unit.enabled || !unit.gamPath || !unit.divId || unit.sizes == null) return null;

    const registryKey = `display:${unit.divId}`;
    if (this.registry[registryKey]) return this.registry[registryKey];

    const state = this.createState(slotKey, null, cfg, unit);
    if (!this.defineGptDisplaySlot(state)) return null;
    this.registry[registryKey] = state;
    this.markDisplaySlotState(state, 'reserved');
    return state;
  }

  defineDisplayPlaceholder(slotKey, elementId, rawConfig) {
    const cfg = this.configWithSelectedArm(rawConfig);
    if (!modeAllowsSdk(cfg, this.runtime)) return null;

    const unit = this.canonicalUnit(slotKey, cfg, elementId);
    if (!unit.enabled || !unit.gamPath || !unit.divId || unit.sizes == null) return null;
    if (unit.type === 'interstitial' || unit.type === 'rewarded') return null;

    const registryKey = `display:${unit.divId}`;
    if (this.registry[registryKey]) return this.registry[registryKey];

    const state = this.createState(slotKey, null, cfg, unit);
    this.registry[registryKey] = state;
    return state;
  }

  activateDisplayStateSlot(state) {
    if (!state || state.slot) return Boolean(state && state.slot);
    if (!state.unit || !state.unit.enabled || !state.unit.gamPath || !state.unit.divId || state.unit.sizes == null) return false;
    if (state.unit.type === 'interstitial' || state.unit.type === 'rewarded') return false;

    if (!this.defineGptDisplaySlot(state)) return false;
    this.markDisplaySlotState(state, state.layoutState || 'reserved');
    return true;
  }

  defineOutOfPage(slotKey, rawConfig, formatName, options = {}) {
    const cfg = this.configWithSelectedArm(rawConfig);
    if (!modeAllowsSdk(cfg, this.runtime)) return null;

    const unit = this.canonicalUnit(slotKey, cfg, null);
    const format = this.googletag.enums && this.googletag.enums.OutOfPageFormat && this.googletag.enums.OutOfPageFormat[formatName];
    if (!unit.enabled || !unit.gamPath || !this.googletag.defineOutOfPageSlot || !format) return null;

    const registryKey = `oop:${formatName}:${unit.runtimeSlotKey}:${unit.gamPath}`;
    if (this.registry[registryKey]) {
      if (!options.fresh) return this.registry[registryKey];
      if (this.googletag.destroySlots) {
        try {
          this.googletag.destroySlots([this.registry[registryKey].slot]);
        } catch (_) {}
      }
      delete this.registry[registryKey];
    }

    const state = this.createState(slotKey, null, cfg, unit, {
      opportunity: options.opportunity || null,
      preloadMode: options.preloadMode
    });
    if (!this.defineGptOutOfPageSlot(state, format)) return null;
    this.registry[registryKey] = state;
    return state;
  }

  async definePlacement({ slotKey, elementId, config }) {
    return this.withGpt(g => {
      const type = adUnitType(config, slotKey);
      const state = type === 'anchor' && !elementId
        ? this.defineOutOfPage(slotKey, config, OUT_OF_PAGE_FORMATS.anchor)
        : this.defineDisplay(slotKey, elementId, config);

      if (!state) return null;
      if (state.initialPreloadPrepared && !state.initialRevealRequested && !state.requestStarted && !state.filled) {
        return state;
      }
      if (!state.slot && !this.activateDisplayStateSlot(state)) return state;
      if (!state.requestStarted) {
        state.requestStarted = true;
        state.requestPromise = this.requestWithRetries(state).finally(() => {
          state.requestPromise = null;
        });
        state.requestPromise.catch(error => {
          this.logger && this.logger.warn('GAM request failed', { slot: slotKey, message: error.message });
        });
      }
      return state;
    });
  }

  requestInitialDisplayPreload(state) {
    if (!state || !state.unit || !state.unit.divId || state.unit.type === 'interstitial' || state.unit.type === 'rewarded') {
      return Promise.resolve({ status: 'unavailable', state });
    }
    if (state.filled && state.displayed) return Promise.resolve({ status: 'filled', state });
    if (state.requestPromise) return state.requestPromise;

    this.clearInitialNoFillRecovery(state);
    state.initialPreloadPrepared = true;
    state.initialRevealRequested = false;
    state.displayRefreshIndex = 0;
    state.completedRefreshes = 0;
    state.activeRefreshRound = 0;
    state.attempt = 0;
    state.stopped = false;
    state.filled = false;
    state.displayed = false;
    state.requestStarted = false;
    this.applyDisplayRequestSequence(state);
    if (!state.opportunity || state.opportunity.preloadMode !== 'preparation') {
      this.startOpportunity(state, { preloadMode: 'preparation', refreshIndex: 0 });
      this.transitionOpportunity(state, 'PREPARED', {
        ladder: state.sequence.slice(),
        refreshIndex: 0
      });
    } else {
      state.opportunity.preloadMode = 'preparation';
      state.opportunity.transition('PREPARED', {
        ladder: state.sequence.slice(),
        refreshIndex: 0
      });
      this.traceOpportunity(state, 'prepared');
    }
    this.logger && this.logger.debug('PO initial preload prepared', {
      placement: state.name,
      divId: state.unit && state.unit.divId,
      sizes: sizeSummary(state.unit && state.unit.sizes),
      refreshRound: 0,
      exp_group: state.experiment && state.experiment.expGroup,
      exp_key: state.experiment && state.experiment.expKey
    });
    return Promise.resolve({ status: 'prepared', reason: 'initial_preload_prepared', state });
  }

  preloadDisplayState(state) {
    if (!state || !state.unit || state.unit.type === 'interstitial' || state.unit.type === 'rewarded') {
      return Promise.resolve({ status: 'unavailable', state });
    }
    if (state.filled && state.displayed) return Promise.resolve({ status: 'filled', state });
    return this.requestInitialDisplayPreload(state);
  }

  async revealDisplayState(state) {
    if (!state || !state.unit || state.unit.type === 'interstitial' || state.unit.type === 'rewarded') {
      return { status: 'unavailable', state };
    }

    const element = this.elementForState(state);
    if (!elementHasMeaningfulSize(element, state.unit.sizes, this.window)) {
      return { status: 'not_renderable', reason: 'hidden_or_not_renderable', state };
    }
    state.initialRevealRequested = true;

    if (state.requestPromise) return state.requestPromise;
    if (state.filled && state.displayed) return { status: 'filled', state };
    return this.requestDisplaySlot(state);
  }

  async preloadDisplaySlot({ slotKey, elementId, config }) {
    return this.withGpt(() => {
      const state = this.defineDisplayPlaceholder(slotKey, elementId, config);
      if (!state) return Promise.resolve({ status: 'unavailable' });
      return this.preloadDisplayState(state);
    });
  }

  requestDisplaySlot(state) {
    if (!state || !state.unit || state.unit.type === 'interstitial' || state.unit.type === 'rewarded') {
      return Promise.resolve({ status: 'unavailable', state });
    }
    this.clearInitialNoFillRecovery(state);
    if (state.requestPromise) {
      return Promise.resolve({ status: 'busy', state });
    }
    if (!state.slot && !this.activateDisplayStateSlot(state)) {
      return Promise.resolve({ status: 'unavailable', state });
    }
    if (state.displayed && state.unit.divId && state.hasFilledOnce) {
      return this.requestDisplayRefresh(state);
    }

    this.clearDisplayRefreshTimer(state);
    const wasPreparedPreload = state.initialPreloadPrepared;
    state.attempt = 0;
    state.filled = false;
    state.stopped = false;
    state.initialPreloadPrepared = false;
    state.initialRevealRequested = true;
    this.applyDisplayRequestSequence(state);
    if (!state.opportunity || state.opportunity.state === 'COMPLETE') {
      this.startOpportunity(state, {
        preloadMode: wasPreparedPreload ? 'preparation' : 'none',
        refreshIndex: state.displayRefreshIndex
      });
    } else {
      state.opportunity.preloadMode = wasPreparedPreload ? 'preparation' : 'none';
      state.opportunity.transition('READY_TO_REQUEST', {
        ladder: state.sequence.slice(),
        refreshIndex: state.displayRefreshIndex
      });
      this.traceOpportunity(state, 'ready_to_request');
    }
    state.requestStarted = true;
    state.requestPromise = this.requestWithRetries(state).finally(() => {
      state.requestPromise = null;
    });
    return state.requestPromise;
  }

  requestDisplayRefresh(state) {
    if (!state || !state.slot || !state.unit || state.unit.type === 'interstitial' || state.unit.type === 'rewarded') {
      return Promise.resolve({ status: 'unavailable', state });
    }
    if (!state.displayed || !state.unit.divId) {
      return this.requestDisplaySlot(state);
    }

    if (state.requestPromise) return Promise.resolve({ status: 'busy', state });

    const refreshRound = this.nextDisplayRefreshRound(state);
    if (state.maximumRefreshes > 0 && refreshRound > state.maximumRefreshes) return Promise.resolve({ status: 'complete', state });

    this.clearDisplayRefreshTimer(state);
    state.displayRefreshIndex = refreshRound;
    state.attempt = 0;
    state.filled = false;
    state.stopped = false;
    state.requestStarted = true;
    state.initialPreloadPrepared = false;
    state.initialRevealRequested = true;
    this.applyDisplayRequestSequence(state);
    this.startOpportunity(state, {
      preloadMode: 'none',
      refreshIndex: refreshRound
    });

    const requestPromise = this.requestWithRetries(state).finally(() => {
      if (state.requestPromise === requestPromise) state.requestPromise = null;
    });

    state.requestPromise = requestPromise;
    return requestPromise;
  }

  requestWithRetries(state, { timeoutMs, scheduleRefresh = true } = {}) {
    return new Promise(resolve => {
      if (!state) {
        resolve({ status: 'unavailable' });
        return;
      }
      if (state.filled) {
        resolve({ status: 'filled', state });
        return;
      }
      if (state.stopped) {
        resolve({ status: 'unavailable', state });
        return;
      }

      const pubads = this.googletag.pubads();
      let done = false;
      let retryTimer = null;
      const finish = status => {
        if (done) return;
        done = true;
        if (status === 'filled') this.markDisplaySlotState(state, 'filled');
        if (status === 'unavailable' || status === 'timeout') this.markDisplaySlotState(state, 'empty');
        if (pubads.removeEventListener) pubads.removeEventListener('slotRenderEnded', onRender);
        clearTimeout(timer);
        clearTimeout(retryTimer);
        if (status === 'filled' && scheduleRefresh) {
          state.hasFilledOnce = true;
          this.clearInitialNoFillRecovery(state);
          state.activeRefreshRound = Math.max(0, Math.floor(numberValue(state.displayRefreshIndex, state.completedRefreshes, 0) || 0));
          state.completedRefreshes = state.activeRefreshRound;
          state.refreshVisibleMs = 0;
          state.refreshVisibleSince = null;
          this.scheduleDisplayRefresh(state);
        } else if ((status === 'unavailable' || status === 'timeout') && scheduleRefresh) {
          if (!state.hasFilledOnce) {
            state.activeRefreshRound = 0;
            state.completedRefreshes = 0;
            state.displayRefreshIndex = 0;
            this.armInitialNoFillRecovery(state);
          } else {
            state.activeRefreshRound = Math.max(0, Math.floor(numberValue(state.displayRefreshIndex, state.completedRefreshes, 0) || 0));
            state.completedRefreshes = state.activeRefreshRound;
          }
        }
        this.completeOpportunity(state, status);
        resolve({ status, state });
      };
      const onRender = event => {
        if (!eventMatchesSlot(state.slot, event)) return;
        this.logger && this.logger.debug('GAM render ended', {
          slot: state.name,
          runtimeSlotKey: state.unit && state.unit.runtimeSlotKey,
          divId: state.unit && state.unit.divId,
          isEmpty: Boolean(event.isEmpty),
          size: event.size || null,
          attempt: state.attempt + 1,
          maxAttempts: state.maxAttempts,
          targeting: state.lastTargetingSnapshot || {}
        });
        if (!event.isEmpty) {
          state.filled = true;
          state.stopped = true;
          finish('filled');
          return;
        }
        if (state.attempt >= state.maxAttempts - 1) {
          state.stopped = true;
          this.logger && this.logger.debug('GAM waterfall exhausted', {
            slot: state.name,
            runtimeSlotKey: state.unit && state.unit.runtimeSlotKey
          });
          finish('unavailable');
          return;
        }
        state.attempt += 1;
        this.logger && this.logger.debug('GAM retry scheduled', {
          slot: state.name,
          runtimeSlotKey: state.unit && state.unit.runtimeSlotKey,
          retryDelayMs: state.retryDelayMs,
          nextAttempt: state.attempt + 1
        });
        retryTimer = timerUnref(setTimeout(() => this.refresh(state), state.retryDelayMs));
      };
      const timer = timerUnref(setTimeout(() => finish('timeout'), requestTimeoutFor(state.cfg, state.unit && state.unit.type, timeoutMs)));

      pubads.addEventListener && pubads.addEventListener('slotRenderEnded', onRender);
      this.markDisplaySlotState(state, 'requesting');
      if (state.displayed) this.refresh(state);
      else this.displayInitial(state);
    });
  }

  async requestInterstitial(slotKey = 'interstitial') {
    const cfg = this.slotConfig(slotKey, 'interstitial');
    if (!cfg || cfg.enabled === false) return { status: 'unavailable' };

    return this.withGpt(g => {
      const state = this.defineOutOfPage(slotKey, cfg, OUT_OF_PAGE_FORMATS.interstitial);
      if (!state) return Promise.resolve({ status: 'unavailable' });

      return new Promise(resolve => {
        const pubads = g.pubads();
        let done = false;
        let retryTimer = null;
        let overlayActive = false;
        const activateOverlay = () => {
          if (overlayActive) return;
          overlayActive = true;
          this.setFullscreenOverlayActive(true);
        };
        const finish = status => {
          if (done) return;
          done = true;
          cleanup();
          resolve({ status, state });
        };
        const cleanup = () => {
          clearTimeout(timer);
          clearTimeout(retryTimer);
          pubads.removeEventListener && pubads.removeEventListener('slotRenderEnded', onRender);
          pubads.removeEventListener && pubads.removeEventListener('gameManualInterstitialSlotReady', onReady);
          pubads.removeEventListener && pubads.removeEventListener('gameManualInterstitialSlotClosed', onClosed);
          if (overlayActive) {
            overlayActive = false;
            this.setFullscreenOverlayActive(false);
          }
        };
        const onRender = event => {
          if (!eventMatchesSlot(state.slot, event)) return;
          if (!event.isEmpty) {
            state.filled = true;
            timerUnref(setTimeout(() => finish('shown'), numberValue(value(cfg, 'interstitialCloseTimeoutMs', 'interstitial_close_timeout_ms'), 8000)));
            return;
          }
          if (state.attempt >= state.maxAttempts - 1) {
            state.stopped = true;
            finish('unavailable');
            return;
          }
          state.attempt += 1;
          retryTimer = timerUnref(setTimeout(() => this.refresh(state), state.retryDelayMs));
        };
        const onReady = event => {
          if (!eventMatchesSlot(state.slot, event)) return;
          activateOverlay();
          if (event.makeGameManualInterstitialVisible) event.makeGameManualInterstitialVisible();
        };
        const onClosed = event => {
          if (!eventMatchesSlot(state.slot, event)) return;
          state.stopped = true;
          finish('closed');
        };
        const timer = timerUnref(setTimeout(() => finish('timeout'), requestTimeoutFor(cfg, 'interstitial')));

        pubads.addEventListener && pubads.addEventListener('slotRenderEnded', onRender);
        pubads.addEventListener && pubads.addEventListener('gameManualInterstitialSlotReady', onReady);
        pubads.addEventListener && pubads.addEventListener('gameManualInterstitialSlotClosed', onClosed);
        if (state.displayed) this.refresh(state);
        else this.displayInitial(state);
      });
    });
  }

  async preloadRewarded(slotKey = 'rewarded', options = {}) {
    const normalizedSlotKey = this.rewardedPreloadKey(slotKey);
    const existing = this.rewardedPreloads.get(normalizedSlotKey);
    if (existing && !existing.cleaned && !existing.consumed) {
      const existingPromise = existing.promise || Promise.resolve({ status: existing.status || 'unavailable' });
      return existingPromise.then(result => {
        if (result && result.status === 'ready' && options.ready && existing.readyEvent) options.ready(existing.readyEvent);
        return result;
      });
    }

    const cfg = this.slotConfig(normalizedSlotKey, 'rewarded');
    if (!cfg || cfg.enabled === false) return { status: 'unavailable' };

    return this.withGpt(g => {
      let state = this.defineOutOfPage(normalizedSlotKey, cfg, OUT_OF_PAGE_FORMATS.rewarded, {
        fresh: true,
        preloadMode: 'request_preload'
      });
      if (!state) return Promise.resolve({ status: 'unavailable' });
      this.transitionOpportunity(state, 'PRELOAD_REQUESTED');

      const pubads = g.pubads();
      const ttlMs = Math.max(1000, numberValue(options.ttlMs, value(cfg, 'rewardedPreloadTtlMs', 'rewarded_preload_ttl_ms'), DEFAULT_REWARDED_PRELOAD_TTL_MS));
      const attemptTimeoutMs = rewardedAttemptTimeoutFor(cfg);
      let resolvePreload;
      let resolved = false;

      const preload = {
        slotKey: normalizedSlotKey,
        cfg,
        state,
        pubads,
        ttlMs,
        status: 'loading',
        promise: null,
        readyEvent: null,
        readyAt: 0,
        granted: false,
        reward: null,
        overlayActive: false,
        consumed: false,
        cleaned: false,
        showLifecycle: null,
        showResolve: null,
        timer: null,
        retryTimer: null,
        attemptTimer: null,
        ttlTimer: null,
        consumeTimer: null,
        onReady: null,
        onGranted: null,
        onClosed: null,
        onVideoCompleted: null,
        onRender: null
      };

      const resolveOnce = result => {
        if (resolved) return;
        resolved = true;
        resolvePreload(result);
      };
      const finishPreload = result => {
        preload.status = result.status;
        if (result.status !== 'ready') this.completeOpportunity(state, result.status);
        this.cleanupRewardedPreload(preload, { destroySlot: result.status !== 'ready' });
        if (result.status !== 'ready') this.rewardedPreloads.delete(normalizedSlotKey);
        resolveOnce(result);
      };
      const expirePreload = () => {
        if (preload.consumed || preload.cleaned) return;
        preload.status = 'expired';
        this.completeOpportunity(state, 'expired');
        this.cleanupRewardedPreload(preload, { destroySlot: true });
        this.rewardedPreloads.delete(normalizedSlotKey);
      };
      const defineFreshAttempt = () => {
        const previous = state;
        const next = this.defineOutOfPage(normalizedSlotKey, cfg, OUT_OF_PAGE_FORMATS.rewarded, {
          fresh: true,
          opportunity: previous.opportunity
        });
        if (!next) return false;
        next.attempt = previous.attempt;
        next.maxAttempts = previous.maxAttempts;
        next.retryDelayMs = previous.retryDelayMs;
        next.requestTimeoutMs = previous.requestTimeoutMs;
        next.sequence = previous.sequence.slice();
        next.requestStarted = true;
        state = next;
        preload.state = next;
        return true;
      };
      const scheduleNextAttempt = reason => {
        if (preload.cleaned || preload.status === 'ready' || preload.granted || state.filled) return;
        clearTimeout(preload.attemptTimer);
        if (state.attempt >= state.maxAttempts - 1) {
          state.stopped = true;
          finishPreload({ status: 'unavailable' });
          return;
        }
        state.attempt += 1;
        this.logger && this.logger.debug('GAM rewarded preload retry scheduled', {
          slot: state.name,
          runtimeSlotKey: state.unit && state.unit.runtimeSlotKey,
          reason,
          nextAttempt: state.attempt + 1
        });
        preload.retryTimer = timerUnref(setTimeout(() => {
          if (preload.cleaned) return;
          if (!defineFreshAttempt()) {
            finishPreload({ status: 'unavailable' });
            return;
          }
          requestCurrentAttempt();
        }, 0));
      };
      const requestCurrentAttempt = () => {
        if (preload.cleaned) return;
        clearTimeout(preload.attemptTimer);
        preload.attemptTimer = timerUnref(setTimeout(() => scheduleNextAttempt('attempt-timeout'), attemptTimeoutMs));
        state.filled = false;
        state.stopped = false;
        state.requestStarted = true;
        const requested = state.displayed ? this.refresh(state) : this.displayInitial(state);
        if (!requested) finishPreload({ status: 'unavailable' });
      };

      preload.onReady = event => {
        if (!eventMatchesSlot(state.slot, event)) return;
        clearTimeout(preload.attemptTimer);
        clearTimeout(preload.timer);
        state.filled = true;
        preload.status = 'ready';
        preload.readyEvent = event;
        preload.readyAt = Date.now();
        this.transitionOpportunity(state, 'PRELOADED_READY');
        preload.ttlTimer = timerUnref(setTimeout(expirePreload, ttlMs));
        if (options.ready) options.ready(event);
        resolveOnce({ status: 'ready' });
      };
      preload.onGranted = event => {
        if (!eventMatchesSlot(state.slot, event)) return;
        preload.granted = true;
        preload.reward = event.payload || null;
        this.transitionOpportunity(state, 'REWARD_GRANTED');
        if (preload.consumed && preload.showLifecycle && preload.showLifecycle.granted) preload.showLifecycle.granted(event);
      };
      preload.onVideoCompleted = event => {
        if (!eventMatchesSlot(state.slot, event)) return;
        if (preload.consumed && preload.showLifecycle && preload.showLifecycle.videoCompleted) preload.showLifecycle.videoCompleted(event);
      };
      preload.onClosed = event => {
        if (!eventMatchesSlot(state.slot, event)) return;
        if (!preload.consumed) {
          expirePreload();
          return;
        }
        if (preload.showLifecycle && preload.showLifecycle.closed) preload.showLifecycle.closed(event);
        state.stopped = true;
        const result = preload.granted ? { status: 'granted', reward: preload.reward } : { status: 'declined' };
        const resolveShow = preload.showResolve;
        this.completeOpportunity(state, result.status);
        this.cleanupRewardedPreload(preload);
        this.rewardedPreloads.delete(normalizedSlotKey);
        if (resolveShow) resolveShow(Object.assign({ state }, result));
      };
      preload.onRender = event => {
        if (!eventMatchesSlot(state.slot, event)) return;
        clearTimeout(preload.attemptTimer);
        if (!event.isEmpty) {
          state.filled = true;
          return;
        }
        scheduleNextAttempt('empty-render');
      };
      preload.promise = new Promise(resolve => {
        resolvePreload = resolve;
      });
      preload.timer = timerUnref(setTimeout(() => finishPreload({ status: 'timeout' }), requestTimeoutFor(cfg, 'rewarded')));

      this.rewardedPreloads.set(normalizedSlotKey, preload);
      pubads.addEventListener && pubads.addEventListener('rewardedSlotReady', preload.onReady);
      pubads.addEventListener && pubads.addEventListener('rewardedSlotGranted', preload.onGranted);
      pubads.addEventListener && pubads.addEventListener('rewardedSlotClosed', preload.onClosed);
      pubads.addEventListener && pubads.addEventListener('rewardedSlotVideoCompleted', preload.onVideoCompleted);
      pubads.addEventListener && pubads.addEventListener('slotRenderEnded', preload.onRender);

      requestCurrentAttempt();
      return preload.promise;
    });
  }

  async consumeRewardedPreload(slotKey = 'rewarded', lifecycle = {}) {
    const normalizedSlotKey = this.rewardedPreloadKey(slotKey);
    let preload = this.rewardedPreloads.get(normalizedSlotKey);
    if (!preload || preload.cleaned || preload.consumed) return null;

    if (preload.status === 'loading' && preload.promise) {
      const result = await preload.promise;
      if (!result || result.status !== 'ready') return null;
      preload = this.rewardedPreloads.get(normalizedSlotKey);
      if (!preload || preload.cleaned || preload.consumed) return null;
    }

    if (preload.status !== 'ready' || !preload.readyEvent) return null;
    if (Date.now() - preload.readyAt > preload.ttlMs) {
      const expired = preload;
      this.cleanupRewardedPreload(expired, { destroySlot: true });
      this.rewardedPreloads.delete(normalizedSlotKey);
      return null;
    }

    preload.consumed = true;
    preload.showLifecycle = lifecycle || {};
    this.transitionOpportunity(preload.state, 'USER_REQUESTS_REWARD');
    clearTimeout(preload.ttlTimer);

    return new Promise(resolve => {
      preload.showResolve = resolve;
      preload.consumeTimer = timerUnref(setTimeout(() => {
        const result = { status: 'timeout', state: preload.state };
        this.completeOpportunity(preload.state, 'timeout');
        this.cleanupRewardedPreload(preload);
        this.rewardedPreloads.delete(normalizedSlotKey);
        resolve(result);
      }, requestTimeoutFor(preload.cfg, 'rewarded')));

      if (preload.showLifecycle && preload.showLifecycle.ready) preload.showLifecycle.ready(preload.readyEvent);
      if (preload.readyEvent.makeRewardedVisible) {
        if (!preload.overlayActive) {
          preload.overlayActive = true;
          this.setFullscreenOverlayActive(true);
        }
        this.transitionOpportunity(preload.state, 'SHOWING');
        preload.readyEvent.makeRewardedVisible();
      } else {
        clearTimeout(preload.consumeTimer);
        this.completeOpportunity(preload.state, 'unavailable');
        this.cleanupRewardedPreload(preload, { destroySlot: true });
        this.rewardedPreloads.delete(normalizedSlotKey);
        resolve({ status: 'unavailable', state: preload.state });
      }
    });
  }

  async requestRewarded(slotKey = 'rewarded', lifecycle = {}) {
    if (!lifecycle || lifecycle.usePreload !== false) {
      const preloaded = await this.consumeRewardedPreload(slotKey, lifecycle || {});
      if (preloaded) return preloaded;
    }
    return this.requestRewardedFresh(slotKey, lifecycle || {});
  }

  async requestRewardedFresh(slotKey = 'rewarded', lifecycle = {}) {
    const cfg = this.slotConfig(slotKey, 'rewarded');
    if (!cfg || cfg.enabled === false) return { status: 'unavailable' };

    return this.withGpt(g => {
      let state = this.defineOutOfPage(slotKey, cfg, OUT_OF_PAGE_FORMATS.rewarded, {
        fresh: true,
        preloadMode: 'none'
      });
      if (!state) return Promise.resolve({ status: 'unavailable' });

      return new Promise(resolve => {
        const pubads = g.pubads();
        let granted = false;
        let reward = null;
        let done = false;
        let retryTimer = null;
        let attemptTimer = null;
        let overlayActive = false;
        const attemptTimeoutMs = rewardedAttemptTimeoutFor(cfg);
        const activateOverlay = () => {
          if (overlayActive) return;
          overlayActive = true;
          this.setFullscreenOverlayActive(true);
        };
        const finish = result => {
          if (done) return;
          done = true;
          this.completeOpportunity(state, result.status);
          cleanup();
          resolve(Object.assign({ state }, result));
        };
        const cleanup = () => {
          clearTimeout(timer);
          clearTimeout(retryTimer);
          clearTimeout(attemptTimer);
          pubads.removeEventListener && pubads.removeEventListener('rewardedSlotReady', onReady);
          pubads.removeEventListener && pubads.removeEventListener('rewardedSlotGranted', onGranted);
          pubads.removeEventListener && pubads.removeEventListener('rewardedSlotClosed', onClosed);
          pubads.removeEventListener && pubads.removeEventListener('rewardedSlotVideoCompleted', onVideoCompleted);
          pubads.removeEventListener && pubads.removeEventListener('slotRenderEnded', onRender);
          if (overlayActive) {
            overlayActive = false;
            this.setFullscreenOverlayActive(false);
          }
        };
        const defineFreshAttempt = () => {
          const previous = state;
          const next = this.defineOutOfPage(slotKey, cfg, OUT_OF_PAGE_FORMATS.rewarded, {
            fresh: true,
            opportunity: previous.opportunity
          });
          if (!next) return false;
          next.attempt = previous.attempt;
          next.maxAttempts = previous.maxAttempts;
          next.retryDelayMs = previous.retryDelayMs;
          next.requestTimeoutMs = previous.requestTimeoutMs;
          next.sequence = previous.sequence.slice();
          next.requestStarted = true;
          state = next;
          return true;
        };
        const requestCurrentAttempt = () => {
          if (done) return;
          clearTimeout(attemptTimer);
          attemptTimer = timerUnref(setTimeout(() => scheduleNextAttempt('attempt-timeout'), attemptTimeoutMs));
          state.filled = false;
          state.stopped = false;
          state.requestStarted = true;
          const requested = state.displayed ? this.refresh(state) : this.displayInitial(state);
          if (!requested) finish({ status: 'unavailable' });
        };
        const scheduleNextAttempt = reason => {
          if (done || granted || state.filled) return;
          clearTimeout(attemptTimer);
          if (state.attempt >= state.maxAttempts - 1) {
            state.stopped = true;
            finish({ status: 'unavailable' });
            return;
          }
          state.attempt += 1;
          this.logger && this.logger.debug('GAM rewarded retry scheduled', {
            slot: state.name,
            runtimeSlotKey: state.unit && state.unit.runtimeSlotKey,
            reason,
            nextAttempt: state.attempt + 1
          });
          retryTimer = timerUnref(setTimeout(() => {
            if (done) return;
            if (!defineFreshAttempt()) {
              finish({ status: 'unavailable' });
              return;
            }
            requestCurrentAttempt();
          }, 0));
        };
        const onReady = event => {
          if (!eventMatchesSlot(state.slot, event)) return;
          clearTimeout(attemptTimer);
          state.filled = true;
          lifecycle.ready && lifecycle.ready(event);
          if (event.makeRewardedVisible) {
            activateOverlay();
            this.transitionOpportunity(state, 'SHOWING');
            event.makeRewardedVisible();
          }
        };
        const onGranted = event => {
          if (!eventMatchesSlot(state.slot, event)) return;
          granted = true;
          reward = event.payload || null;
          this.transitionOpportunity(state, 'REWARD_GRANTED');
          lifecycle.granted && lifecycle.granted(event);
        };
        const onVideoCompleted = event => {
          if (!eventMatchesSlot(state.slot, event)) return;
          lifecycle.videoCompleted && lifecycle.videoCompleted(event);
        };
        const onClosed = event => {
          if (!eventMatchesSlot(state.slot, event)) return;
          lifecycle.closed && lifecycle.closed(event);
          state.stopped = true;
          finish(granted ? { status: 'granted', reward } : { status: 'declined' });
        };
        const onRender = event => {
          if (!eventMatchesSlot(state.slot, event)) return;
          clearTimeout(attemptTimer);
          if (!event.isEmpty) {
            state.filled = true;
            return;
          }
          scheduleNextAttempt('empty-render');
        };
        const timer = timerUnref(setTimeout(() => finish({ status: 'timeout' }), requestTimeoutFor(cfg, 'rewarded')));

        pubads.addEventListener && pubads.addEventListener('rewardedSlotReady', onReady);
        pubads.addEventListener && pubads.addEventListener('rewardedSlotGranted', onGranted);
        pubads.addEventListener && pubads.addEventListener('rewardedSlotClosed', onClosed);
        pubads.addEventListener && pubads.addEventListener('rewardedSlotVideoCompleted', onVideoCompleted);
        pubads.addEventListener && pubads.addEventListener('slotRenderEnded', onRender);

        requestCurrentAttempt();
      });
    });
  }
}

export { eventMatchesSlot };
