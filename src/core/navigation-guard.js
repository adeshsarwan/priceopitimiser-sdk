import { safeClosest } from './dom.js';

const ADMIN_SELECTOR = [
  '[contenteditable="true"]',
  '[data-po-bypass]',
  '[data-po-no-intercept]',
  '[data-admin]',
  '[data-editor]',
  '.admin',
  '.editor',
  '.wp-admin',
  '.no-interstitial',
  '.no-rewarded'
].join(',');

export function isModifiedClick(event) {
  return Boolean(
    event &&
    (event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (event.button != null && event.button !== 0))
  );
}

export function isHttpUrl(url) {
  return Boolean(url && (url.protocol === 'http:' || url.protocol === 'https:'));
}

export function samePageAnchor(url, locationRef) {
  if (!url || !locationRef) return false;
  return Boolean(url.hash && url.origin === locationRef.origin && url.pathname === locationRef.pathname && url.search === locationRef.search);
}

export function shouldBypassLink(link, event, { locationRef } = {}) {
  if (!link || isModifiedClick(event)) return true;
  if (safeClosest(link, ADMIN_SELECTOR)) return true;
  if (link.hasAttribute && link.hasAttribute('download')) return true;
  if (link.target && link.target !== '_self') return true;

  const rawHref = link.getAttribute && link.getAttribute('href');
  if (!rawHref || rawHref === '#') return true;

  let url;
  try {
    url = new URL(rawHref, locationRef && locationRef.href ? locationRef.href : 'https://example.com/');
  } catch (_) {
    return true;
  }

  if (!isHttpUrl(url)) return true;
  if (samePageAnchor(url, locationRef)) return true;
  return false;
}

export function shouldSample(probability, randomValue = Math.random()) {
  const p = Math.max(0, Math.min(1, Number(probability)));
  if (p <= 0) return false;
  if (p >= 1) return true;
  return Number(randomValue) < p;
}

export function createLinkNavigation(link, windowRef) {
  const href = link && link.getAttribute && link.getAttribute('href');
  if (!href || !windowRef) return null;

  return {
    href,
    resume() {
      if (link.target && link.target !== '_self' && typeof windowRef.open === 'function') {
        windowRef.open(href, link.target);
        return;
      }
      windowRef.location.href = href;
    }
  };
}

export function isExternalHttpDestination(href, locationRef) {
  try {
    const url = new URL(href, locationRef && locationRef.href ? locationRef.href : 'https://example.com/');
    return isHttpUrl(url) && (!locationRef || url.origin !== locationRef.origin);
  } catch (_) {
    return false;
  }
}
