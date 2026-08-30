function storageGet(storage, key) {
  try {
    return Number(storage && storage.getItem(key)) || 0;
  } catch (_) {
    return 0;
  }
}

function storageSet(storage, key, value) {
  try {
    storage && storage.setItem(key, String(value));
  } catch (_) {
    /* Session caps are best-effort when storage is unavailable. */
  }
}

export function createSessionGuard(namespace, storage) {
  const memory = new Map();
  const backing = storage || {
    getItem(key) {
      return memory.has(key) ? memory.get(key) : null;
    },
    setItem(key, value) {
      memory.set(key, value);
    }
  };

  const makeKey = key => `poexp:${namespace}:${key}`;

  return {
    key: makeKey,
    count(key) {
      return storageGet(backing, makeKey(key));
    },
    canUse(key, max = 1) {
      return this.count(key) < Math.max(0, Number(max || 0));
    },
    consume(key, max = 1) {
      if (!this.canUse(key, max)) return false;
      storageSet(backing, makeKey(key), this.count(key) + 1);
      return true;
    },
    reset(key) {
      storageSet(backing, makeKey(key), 0);
    }
  };
}

export function createInteractionLock() {
  let active = null;
  return {
    get active() {
      return active;
    },
    acquire(kind) {
      if (active) return false;
      active = kind;
      return true;
    },
    release(kind) {
      if (!kind || active === kind) active = null;
    }
  };
}
