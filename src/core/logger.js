export function bool(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return !['false', '0', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

export function createLogger({ debug = false, prefix = 'PublisherExperience' } = {}) {
  let enabled = Boolean(debug);
  return {
    get debugEnabled() {
      return enabled;
    },
    setDebug(value) {
      enabled = Boolean(value);
    },
    debug(...args) {
      if (enabled && typeof console !== 'undefined') {
        const log = console.log || console.debug;
        log && log.call(console, `[${prefix}]`, ...args);
      }
    },
    warn(...args) {
      if (enabled && typeof console !== 'undefined' && console.warn) {
        console.warn(`[${prefix}]`, ...args);
      }
    },
    error(...args) {
      if (typeof console !== 'undefined' && console.error) {
        console.error(`[${prefix}]`, ...args);
      }
    }
  };
}
