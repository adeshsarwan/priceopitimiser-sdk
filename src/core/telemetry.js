const SCHEMA_VERSION = 1;
const DEFAULT_MAX_BATCH_SIZE = 30;
const DEFAULT_MAX_QUEUE_SIZE = 300;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024;
const DEFAULT_SDK_VERSION = '0.1.0';

const EVENT_FIELDS = new Set([
  'schema_version',
  'event_id',
  'opportunity_id',
  'session_id',
  'timestamp',
  'monotonic_timestamp',
  'site',
  'sdk_version',
  'page_path',
  'slot_name',
  'publisher_div_id',
  'gpt_slot_id',
  'ad_unit_path',
  'exp_key',
  'exp_group',
  'refresh_round',
  'attempt_number',
  'price_rule',
  'is_fallback',
  'event_type',
  'request_method',
  'change_correlator',
  'visibility_state',
  'document_hidden',
  'slot_visibility',
  'request_started_at',
  'slot_requested_at',
  'slot_response_received_at',
  'slot_render_ended_at',
  'duration_ms',
  'filled',
  'is_empty',
  'creative_id',
  'line_item_id',
  'advertiser_id',
  'targeting_snapshot',
  'error_code',
  'error_message_safe',
  'opportunity_source',
  'request_to_slot_requested_ms',
  'request_to_response_ms',
  'request_to_render_ms',
  'previous_render_to_next_request_ms',
  'attempt_duration_ms',
  'opportunity_total_duration_ms',
  'overlap_detected',
  'previous_attempt_number',
  'late_event',
  'status',
  'reason'
]);

const TARGETING_FIELDS = new Set([
  'exp_key',
  'exp_group',
  'slot_name',
  'refresh_round',
  'price_rule'
]);

function value(source, ...keys) {
  if (!source) return undefined;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) return source[key];
  }
  return undefined;
}

function objectValue(source, ...keys) {
  const found = value(source, ...keys);
  return found && typeof found === 'object' && !Array.isArray(found) ? found : null;
}

function booleanValue(input, fallback = false) {
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

function clamp(valueToClamp, min, max) {
  if (!Number.isFinite(valueToClamp)) return min;
  return Math.max(min, Math.min(max, valueToClamp));
}

function safeString(valueToString, maxLength = 200) {
  if (valueToString == null) return undefined;
  return String(valueToString).replace(/[\r\n\t]+/g, ' ').slice(0, maxLength);
}

function pagePathFor(windowRef) {
  const pathname = windowRef && windowRef.location && windowRef.location.pathname;
  const clean = String(pathname || '/').split('?')[0].split('#')[0] || '/';
  return clean.startsWith('/') ? clean : `/${clean}`;
}

function monotonicNow(windowRef) {
  try {
    const perf = windowRef && windowRef.performance;
    if (perf && typeof perf.now === 'function') return Number(perf.now());
  } catch (_) {}
  return Date.now();
}

function randomId(windowRef, prefix) {
  try {
    const cryptoRef = windowRef && windowRef.crypto || (typeof crypto !== 'undefined' ? crypto : null);
    if (cryptoRef && typeof cryptoRef.randomUUID === 'function') return cryptoRef.randomUUID();
  } catch (_) {}
  randomId.counter = (randomId.counter || 0) + 1;
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${randomId.counter.toString(36)}-${random}`;
}

function hashString(input) {
  let hash = 2166136261;
  const text = String(input || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function defaultEndpointFor(runtimeConfigUrl, windowRef) {
  const source = runtimeConfigUrl || 'https://priceoptimiser1.thebesads.com/v1/runtime-config';
  try {
    const base = new URL(source, windowRef && windowRef.location && windowRef.location.href || 'https://priceoptimiser1.thebesads.com/');
    return `${base.origin}/telemetry/auction-events`;
  } catch (_) {
    return null;
  }
}

function telemetryConfig(runtime, { runtimeConfigUrl, windowRef } = {}) {
  const raw = objectValue(runtime, 'auctionTelemetry', 'auction_telemetry', 'telemetry') || {};
  const enabled = booleanValue(value(raw, 'enabled', 'auctionEventsEnabled', 'auction_events_enabled'), false);
  const endpoint = value(raw, 'endpoint', 'url') ||
    value(runtime, 'auctionTelemetryEndpoint', 'auction_telemetry_endpoint', 'telemetryEndpoint', 'telemetry_endpoint') ||
    (enabled ? defaultEndpointFor(runtimeConfigUrl, windowRef) : null);
  const sampleRateRaw = value(raw, 'sampleRate', 'sample_rate');
  const sampleRate = sampleRateRaw == null ? 1 : clamp(numberValue(sampleRateRaw, 1), 0, 1);
  const maxBatchSize = clamp(Math.floor(numberValue(value(raw, 'maxBatchSize', 'max_batch_size'), DEFAULT_MAX_BATCH_SIZE)), 1, 50);
  const maxQueueSize = clamp(Math.floor(numberValue(value(raw, 'maxQueueSize', 'max_queue_size'), DEFAULT_MAX_QUEUE_SIZE)), maxBatchSize, 1000);
  const flushIntervalMs = clamp(Math.floor(numberValue(value(raw, 'flushIntervalMs', 'flush_interval_ms'), DEFAULT_FLUSH_INTERVAL_MS)), 250, 60000);
  const maxPayloadBytes = clamp(Math.floor(numberValue(value(raw, 'maxPayloadBytes', 'max_payload_bytes'), DEFAULT_MAX_PAYLOAD_BYTES)), 4096, 256 * 1024);

  return {
    enabled: Boolean(enabled && endpoint),
    endpoint: endpoint || null,
    sampleRate,
    maxBatchSize,
    maxQueueSize,
    flushIntervalMs,
    maxPayloadBytes
  };
}

function sanitizeTargetingSnapshot(snapshot) {
  const output = {};
  const source = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : {};
  for (const key of TARGETING_FIELDS) {
    if (source[key] != null) output[key] = String(source[key]);
  }
  for (const [key, rawValue] of Object.entries(source)) {
    if (!/^po_/i.test(key) || rawValue == null) continue;
    output[key] = Array.isArray(rawValue) ? rawValue.map(item => safeString(item, 80)).filter(Boolean) : safeString(rawValue, 120);
  }
  return Object.keys(output).length ? output : undefined;
}

function sanitizeSlotVisibility(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return undefined;
  return {
    element_exists: Boolean(snapshot.element_exists),
    display: safeString(snapshot.display, 40),
    visibility: safeString(snapshot.visibility, 40),
    width: numberValue(snapshot.width, undefined),
    height: numberValue(snapshot.height, undefined),
    inside_viewport: snapshot.inside_viewport == null ? undefined : Boolean(snapshot.inside_viewport)
  };
}

function cleanEvent(input) {
  const output = {};
  for (const key of EVENT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    let eventValue = input[key];
    if (eventValue === undefined || eventValue === null) continue;
    if (key === 'targeting_snapshot') eventValue = sanitizeTargetingSnapshot(eventValue);
    else if (key === 'slot_visibility') eventValue = sanitizeSlotVisibility(eventValue);
    else if (key === 'error_message_safe') eventValue = safeString(eventValue, 180);
    else if (key === 'error_code' || key === 'event_type' || key === 'request_method' || key === 'change_correlator' || key === 'status' || key === 'reason') eventValue = safeString(eventValue, 80);
    else if (key.endsWith('_id') || key === 'site' || key === 'sdk_version' || key === 'page_path' || key === 'slot_name' || key === 'publisher_div_id' || key === 'ad_unit_path' || key === 'exp_key' || key === 'exp_group' || key === 'refresh_round' || key === 'price_rule' || key === 'opportunity_source') eventValue = safeString(eventValue, 160);
    if (eventValue !== undefined && eventValue !== null) output[key] = eventValue;
  }
  return output;
}

export function createAuctionTelemetry({
  windowRef,
  documentRef,
  runtime,
  runtimeConfigUrl,
  fetchRef,
  sdkVersion,
  logger
} = {}) {
  const config = telemetryConfig(runtime, { runtimeConfigUrl, windowRef });
  const sessionId = randomId(windowRef, 'po-session');
  const queue = [];
  const sampled = new Map();
  const inflight = new Set();
  let flushTimer = null;
  let destroyed = false;
  const site = value(runtime, 'siteKey', 'site_key', 'site') || null;
  const version = safeString(value(runtime, 'sdkVersion', 'sdk_version', 'buildId', 'build_id') || sdkVersion || DEFAULT_SDK_VERSION, 80);

  const clearFlushTimer = () => {
    if (!flushTimer) return;
    clearTimeout(flushTimer);
    flushTimer = null;
  };

  const shouldSampleOpportunity = opportunityId => {
    if (!config.enabled || !opportunityId) return false;
    if (sampled.has(opportunityId)) return sampled.get(opportunityId);
    let selected = true;
    if (config.sampleRate <= 0) selected = false;
    else if (config.sampleRate < 1) selected = (hashString(`${sessionId}:${opportunityId}`) / 0xffffffff) < config.sampleRate;
    sampled.set(opportunityId, selected);
    if (sampled.size > config.maxQueueSize) {
      const firstKey = sampled.keys().next().value;
      sampled.delete(firstKey);
    }
    return selected;
  };

  const eventBase = () => ({
    schema_version: SCHEMA_VERSION,
    event_id: randomId(windowRef, 'po-event'),
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    monotonic_timestamp: monotonicNow(windowRef),
    site,
    sdk_version: version,
    page_path: pagePathFor(windowRef)
  });

  const scheduleFlush = delayMs => {
    if (!config.enabled || destroyed || flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush().catch(() => {});
    }, Math.max(0, delayMs));
    if (flushTimer && typeof flushTimer.unref === 'function') flushTimer.unref();
  };

  const enqueue = event => {
    if (!config.enabled || destroyed) return;
    try {
      const opportunityId = event && event.opportunity_id;
      if (opportunityId && !shouldSampleOpportunity(opportunityId)) return;
      const nextEvent = cleanEvent(Object.assign(eventBase(), event));
      if (!nextEvent.event_type) return;
      queue.push(nextEvent);
      if (queue.length > config.maxQueueSize) queue.splice(0, queue.length - config.maxQueueSize);
      scheduleFlush(queue.length >= config.maxBatchSize ? 0 : config.flushIntervalMs);
    } catch (error) {
      logger && logger.debug && logger.debug('auction telemetry enqueue skipped', { message: error && error.message });
    }
  };

  async function flush({ preferBeacon = false } = {}) {
    if (!config.enabled || !queue.length) return false;
    clearFlushTimer();
    const batch = queue.splice(0, config.maxBatchSize);
    let body;
    try {
      body = JSON.stringify({ schema_version: SCHEMA_VERSION, events: batch });
      if (body.length > config.maxPayloadBytes && batch.length > 1) {
        const midpoint = Math.max(1, Math.floor(batch.length / 2));
        queue.unshift(...batch.slice(midpoint));
        body = JSON.stringify({ schema_version: SCHEMA_VERSION, events: batch.slice(0, midpoint) });
      }
    } catch (_) {
      return false;
    }

    try {
      const navigatorRef = windowRef && windowRef.navigator;
      if (preferBeacon && navigatorRef && typeof navigatorRef.sendBeacon === 'function') {
        const blob = typeof Blob !== 'undefined'
          ? new Blob([body], { type: 'application/json' })
          : body;
        if (navigatorRef.sendBeacon(config.endpoint, blob)) return true;
      }
    } catch (_) {}

    try {
      const fetchImpl = fetchRef ||
        (windowRef && typeof windowRef.fetch === 'function' ? windowRef.fetch.bind(windowRef) : null) ||
        (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
      if (!fetchImpl) return false;
      const request = fetchImpl(config.endpoint, {
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',
        keepalive: true,
        headers: { 'content-type': 'application/json' },
        body
      }).catch(() => null);
      inflight.add(request);
      request.finally(() => inflight.delete(request));
      return true;
    } catch (_) {
      return false;
    }
  }

  const flushOnLifecycle = () => {
    flush({ preferBeacon: true }).catch(() => {});
  };
  const flushOnHidden = () => {
    if (documentRef.hidden || documentRef.visibilityState === 'hidden') flushOnLifecycle();
  };

  const addLifecycleListeners = () => {
    if (!config.enabled || !windowRef || !documentRef) return;
    try {
      windowRef.addEventListener && windowRef.addEventListener('pagehide', flushOnLifecycle);
      documentRef.addEventListener && documentRef.addEventListener('visibilitychange', flushOnHidden);
    } catch (_) {}
  };

  addLifecycleListeners();

  return {
    get enabled() {
      return config.enabled;
    },
    get config() {
      return Object.assign({}, config);
    },
    get sessionId() {
      return sessionId;
    },
    get pendingCount() {
      return queue.length;
    },
    emit(event) {
      enqueue(event || {});
    },
    markSampled(opportunityId) {
      return shouldSampleOpportunity(opportunityId);
    },
    flush,
    async flushNow() {
      return flush();
    },
    async settle() {
      await Promise.allSettled(Array.from(inflight));
    },
    destroy() {
      destroyed = true;
      clearFlushTimer();
      try {
        windowRef && windowRef.removeEventListener && windowRef.removeEventListener('pagehide', flushOnLifecycle);
        documentRef && documentRef.removeEventListener && documentRef.removeEventListener('visibilitychange', flushOnHidden);
      } catch (_) {}
    }
  };
}

export { SCHEMA_VERSION as AUCTION_TELEMETRY_SCHEMA_VERSION };
