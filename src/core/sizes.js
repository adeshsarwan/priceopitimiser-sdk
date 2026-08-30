const DISPLAY_SIZE_DEFAULTS = Object.freeze({
  native: 'fluid',
  banner: Object.freeze([[320, 50], [728, 90], [300, 250]]),
  sidebar: Object.freeze([[300, 250], [300, 600]]),
  anchor: Object.freeze([[320, 50], [728, 90]]),
  interstitial: null,
  rewarded: null
});

function cloneSizes(value) {
  if (!Array.isArray(value)) return value;
  return value.map(item => (Array.isArray(item) ? item.slice() : item));
}

function typeKey(adUnitType, slotKey) {
  const type = String(adUnitType || '').trim().toLowerCase();
  const key = String(slotKey || '').trim().toLowerCase();
  if (type === 'banner' && key.includes('sidebar')) return 'sidebar';
  if (type) return type;
  if (key.includes('native')) return 'native';
  if (key.includes('sidebar')) return 'sidebar';
  if (key.includes('anchor')) return 'anchor';
  if (key.includes('interstitial')) return 'interstitial';
  if (key.includes('rewarded')) return 'rewarded';
  return 'banner';
}

export function defaultSizesFor(adUnitType, slotKey) {
  const value = DISPLAY_SIZE_DEFAULTS[typeKey(adUnitType, slotKey)];
  return cloneSizes(value);
}

function numericValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}

function normalizePair(width, height, source) {
  const w = numericValue(width);
  const h = numericValue(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    throw new Error(`Invalid ad size pair: ${source}`);
  }
  return [w, h];
}

function parseXSize(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)$/i);
  if (!match) return null;
  return normalizePair(match[1], match[2], value);
}

function parseFlatNumbers(values, source) {
  if (values.length % 2 !== 0) {
    throw new Error(`Invalid ad size array with odd numeric length: ${source}`);
  }
  const pairs = [];
  for (let index = 0; index < values.length; index += 2) {
    pairs.push(normalizePair(values[index], values[index + 1], source));
  }
  return pairs;
}

function parseString(value, options, depth) {
  const trimmed = value.trim();
  if (!trimmed) return missingSizes(options);
  if (trimmed.toLowerCase() === 'fluid') return 'fluid';

  if (trimmed === 'null' || /^[\[{"]/u.test(trimmed)) {
    try {
      return normalizeSizes(JSON.parse(trimmed), Object.assign({}, options, { allowTypeDefault: false }), depth + 1);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid ad size JSON: ${trimmed}`);
      }
      throw error;
    }
  }

  const xParts = trimmed.split(/[\s,]+/u).filter(Boolean);
  if (xParts.length > 0 && xParts.every(part => parseXSize(part))) {
    return xParts.map(parseXSize);
  }

  if (trimmed.includes(',')) {
    const numbers = trimmed.split(',').map(part => numericValue(part));
    if (numbers.every(Number.isFinite)) return parseFlatNumbers(numbers, trimmed);
  }

  throw new Error(`Unsupported ad size configuration: ${trimmed}`);
}

function parseArray(value) {
  if (value.some(item => typeof item === 'string' && item.trim().toLowerCase() === 'fluid')) {
    return 'fluid';
  }

  if (value.every(Array.isArray)) {
    return value.map(item => {
      if (item.length !== 2) throw new Error(`Invalid ad size pair: ${JSON.stringify(item)}`);
      return normalizePair(item[0], item[1], JSON.stringify(item));
    });
  }

  if (value.every(item => parseXSize(item))) {
    return value.map(parseXSize);
  }

  const numeric = value.map(numericValue);
  if (numeric.every(Number.isFinite)) {
    return parseFlatNumbers(numeric, JSON.stringify(value));
  }

  throw new Error(`Unsupported ad size configuration: ${JSON.stringify(value)}`);
}

function missingSizes({ adUnitType, slotKey, allowTypeDefault = true } = {}) {
  if (!allowTypeDefault) return null;
  return defaultSizesFor(adUnitType, slotKey);
}

export function normalizeSizes(input, options = {}, depth = 0) {
  if (depth > 3) throw new Error('Invalid nested ad size configuration');
  if (input === null) return null;
  if (input === undefined) return missingSizes(options);

  if (typeof input === 'string') return parseString(input, options, depth);
  if (Array.isArray(input)) return parseArray(input);

  throw new Error(`Unsupported ad size configuration: ${String(input)}`);
}

export { DISPLAY_SIZE_DEFAULTS };
