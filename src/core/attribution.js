const ATTRIBUTION_KEYS = ['utm_source', 'utm_campaign'];
const SOURCE_TOKEN_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/u;
const CAMPAIGN_ID_PATTERN = /^\d+$/u;

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
    /* Paid traffic attribution persistence is best-effort when sessionStorage is unavailable. */
  }
}

function locationHostname(windowRef) {
  const location = windowRef && windowRef.location;
  if (!location) return '';
  if (location.hostname) return String(location.hostname);
  try {
    const href = typeof location === 'string' ? location : location.href;
    return href ? new URL(href, 'https://priceoptimiser.local/').hostname : '';
  } catch (_) {
    return '';
  }
}

function attributionStorageKey(siteKey, windowRef) {
  const site = String(siteKey || '').trim().toLowerCase() || locationHostname(windowRef) || 'default';
  return `po_attr:${site}:paid_campaign`;
}

function searchFromLocation(location) {
  if (!location) return '';
  if (typeof location === 'object' && location.search != null) return String(location.search || '');

  const href = typeof location === 'string' ? location : location.href;
  if (!href) return '';
  try {
    return new URL(href, 'https://priceoptimiser.local/').search;
  } catch (_) {
    const text = String(href);
    const queryIndex = text.indexOf('?');
    if (queryIndex === -1) return '';
    const hashIndex = text.indexOf('#', queryIndex);
    return text.slice(queryIndex, hashIndex === -1 ? undefined : hashIndex);
  }
}

export function normalizeUtmSource(rawValue) {
  if (rawValue == null) return null;
  const value = String(rawValue).trim().toLowerCase();
  if (!value || !SOURCE_TOKEN_PATTERN.test(value)) return null;
  return value;
}

export function normalizeUtmCampaign(rawValue) {
  if (rawValue == null) return null;
  const value = String(rawValue);
  if (!CAMPAIGN_ID_PATTERN.test(value)) return null;
  return value;
}

function cleanAttribution(input) {
  const output = {};
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const utmSource = normalizeUtmSource(source.utm_source);
  const utmCampaign = normalizeUtmCampaign(source.utm_campaign);
  if (utmSource) output.utm_source = utmSource;
  if (utmCampaign) output.utm_campaign = utmCampaign;
  return output;
}

function attributionFromLocation(location) {
  const search = searchFromLocation(location);
  if (!search || typeof URLSearchParams === 'undefined') return {};
  try {
    const params = new URLSearchParams(search);
    return cleanAttribution({
      utm_source: params.get('utm_source'),
      utm_campaign: params.get('utm_campaign')
    });
  } catch (_) {
    return {};
  }
}

function attributionFromStorage(storage, key) {
  const stored = storageGet(storage, key);
  if (!stored) return {};
  try {
    return cleanAttribution(JSON.parse(stored));
  } catch (_) {
    return {};
  }
}

function hasAttribution(attribution) {
  return Boolean(attribution && (attribution.utm_source || attribution.utm_campaign));
}

export function capturePaidTrafficAttribution({ windowRef, siteKey } = {}) {
  const storage = windowRef && windowRef.sessionStorage;
  const storageKey = attributionStorageKey(siteKey, windowRef);
  const stored = attributionFromStorage(storage, storageKey);
  if (hasAttribution(stored)) return stored;

  const captured = attributionFromLocation(windowRef && windowRef.location);
  if (hasAttribution(captured)) storageSet(storage, storageKey, JSON.stringify(captured));
  return captured;
}

export function paidTrafficAttributionEntries(attribution) {
  const clean = cleanAttribution(attribution);
  return ATTRIBUTION_KEYS
    .filter(key => clean[key] != null)
    .map(key => [key, clean[key]]);
}
