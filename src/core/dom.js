export function normalizePath(pathname = '/') {
  const path = String(pathname || '/').split('?')[0].split('#')[0] || '/';
  return path.startsWith('/') ? path : `/${path}`;
}

export function routeMatches(pattern, pathname = '/') {
  if (!pattern || pattern === '*' || pattern === '/*') return true;

  const source = normalizePath(pattern);
  const path = normalizePath(pathname);
  const sourceParts = source.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);
  const trailingWildcard = sourceParts[sourceParts.length - 1] === '*';

  if (!trailingWildcard && sourceParts.length !== pathParts.length) return false;
  if (trailingWildcard && pathParts.length < sourceParts.length - 1) return false;

  for (let i = 0; i < sourceParts.length; i += 1) {
    const expected = sourceParts[i];
    if (expected === '*') {
      if (i === sourceParts.length - 1) return true;
      if (!pathParts[i]) return false;
      continue;
    }
    if (expected !== pathParts[i]) return false;
  }

  return true;
}

export function safeQuerySelector(documentRef, selector) {
  if (!documentRef || !selector || typeof selector !== 'string') return null;
  try {
    return documentRef.querySelector(selector);
  } catch (_) {
    return null;
  }
}

export function safeClosest(element, selector) {
  if (!element || !selector || typeof selector !== 'string' || typeof element.closest !== 'function') return null;
  try {
    return element.closest(selector);
  } catch (_) {
    return null;
  }
}

export function sanitizeElementId(value, prefix = 'po-experience-slot') {
  const cleaned = String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (cleaned) return cleaned;
  const rand = Math.random().toString(36).slice(2, 9);
  return `${prefix}-${rand}`;
}

export function ensureElementId(element, prefix = 'po-experience-slot') {
  if (!element) return null;
  const nextId = sanitizeElementId(element.id, prefix);
  if (element.id !== nextId) element.id = nextId;
  return element.id;
}

export function waitForElement(documentRef, selector, { timeoutMs = 8000, logger } = {}) {
  const found = safeQuerySelector(documentRef, selector);
  if (found) return Promise.resolve(found);
  if (!documentRef || !documentRef.documentElement || typeof MutationObserver === 'undefined') {
    return Promise.resolve(null);
  }

  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve(value);
    };

    const observer = new MutationObserver(() => {
      const match = safeQuerySelector(documentRef, selector);
      if (match) finish(match);
    });
    const timer = setTimeout(() => {
      logger && logger.debug('DOM target not found before timeout', { selector });
      finish(null);
    }, timeoutMs);

    observer.observe(documentRef.documentElement, { childList: true, subtree: true });
  });
}

export function onDocumentReady(documentRef, callback) {
  if (!documentRef) return () => {};
  if (documentRef.readyState === 'loading') {
    documentRef.addEventListener('DOMContentLoaded', callback, { once: true });
    return () => documentRef.removeEventListener('DOMContentLoaded', callback);
  }
  callback();
  return () => {};
}

export function installRouteWatcher(windowRef, callback) {
  if (!windowRef || !windowRef.history) return () => {};

  const notify = () => callback(normalizePath(windowRef.location && windowRef.location.pathname));
  const originalPushState = windowRef.history.pushState;
  const originalReplaceState = windowRef.history.replaceState;
  let patched = false;

  if (!windowRef.__publisherExperienceRouteWatcherPatched) {
    windowRef.history.pushState = function pushStatePatched(...args) {
      const result = originalPushState.apply(this, args);
      setTimeout(() => windowRef.dispatchEvent(new Event('publisherexperience:routechange')), 0);
      return result;
    };
    windowRef.history.replaceState = function replaceStatePatched(...args) {
      const result = originalReplaceState.apply(this, args);
      setTimeout(() => windowRef.dispatchEvent(new Event('publisherexperience:routechange')), 0);
      return result;
    };
    windowRef.__publisherExperienceRouteWatcherPatched = true;
    patched = true;
  }

  windowRef.addEventListener('popstate', notify);
  windowRef.addEventListener('publisherexperience:routechange', notify);

  return () => {
    windowRef.removeEventListener('popstate', notify);
    windowRef.removeEventListener('publisherexperience:routechange', notify);
    if (patched) {
      windowRef.history.pushState = originalPushState;
      windowRef.history.replaceState = originalReplaceState;
      windowRef.__publisherExperienceRouteWatcherPatched = false;
    }
  };
}
