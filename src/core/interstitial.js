import { installRouteWatcher, normalizePath, routeMatches, safeClosest } from './dom.js';
import { createLinkNavigation, shouldBypassLink, shouldSample } from './navigation-guard.js';

const DEFAULT_QUIZ_CONTINUE_SELECTOR = [
  '[data-po-journey-continue]',
  '[data-quiz-continue]',
  'a[href*="/q/6/"]',
  'button[type="submit"]',
  'input[type="submit"]'
].join(',');

function ruleApplies(rule, windowRef) {
  const pattern = rule.when && rule.when.routePattern;
  return routeMatches(pattern, windowRef.location && windowRef.location.pathname);
}

function quizAttemptKey(rule, windowRef) {
  const path = normalizePath(windowRef.location && windowRef.location.pathname);
  const match = path.match(/^\/quiz\/([^/]+)\/q\/5\/?$/);
  if (match) return `${rule.id}:quiz:${match[1]}`;
  return `${rule.id}:${path}`;
}

function sessionKey(rule, windowRef) {
  if (typeof rule.sessionKey === 'function') return rule.sessionKey({ rule, windowRef });
  if (rule.sharedSessionKey) return rule.sharedSessionKey;
  if (rule.sessionScope === 'quizAttempt') return quizAttemptKey(rule, windowRef);
  return rule.id;
}

async function runInterstitial({ rule, adapter, sessionGuard, lock, logger, windowRef, resume }) {
  if (!ruleApplies(rule, windowRef)) return false;
  if (rule.probability != null && !shouldSample(rule.probability, Math.random())) return false;

  const cap = rule.maxPerSession == null ? 1 : Number(rule.maxPerSession);
  const key = sessionKey(rule, windowRef);
  if (!sessionGuard.consume(key, cap)) return false;
  if (!lock.acquire('interstitial')) {
    resume && resume();
    return false;
  }

  try {
    const result = await adapter.requestInterstitial(rule.slotKey || 'interstitial');
    logger && logger.debug('interstitial completed', { id: rule.id, status: result.status });
  } catch (error) {
    logger && logger.warn('interstitial failed open', { id: rule.id, message: error.message });
  } finally {
    lock.release('interstitial');
    resume && resume();
  }

  return true;
}

function setupClickRule(context, rule) {
  const { documentRef, windowRef } = context;
  const selector = rule.when.selector || DEFAULT_QUIZ_CONTINUE_SELECTOR;

  const onClick = event => {
    const link = safeClosest(event.target, 'a[href]');
    const target = safeClosest(event.target, selector);
    if (!target || !ruleApplies(rule, windowRef)) return;

    const submitter = safeClosest(event.target, 'button[type="submit"], input[type="submit"]');
    if (submitter && submitter.form && !link) return;
    if (!link) return;

    let navigation = null;
    if (shouldBypassLink(link, event, { locationRef: windowRef.location })) return;
    navigation = createLinkNavigation(link, windowRef);

    event.preventDefault();
    runInterstitial(Object.assign({}, context, {
      rule,
      resume: navigation ? () => navigation.resume() : null
    }));
  };

  documentRef.addEventListener('click', onClick, true);
  return () => documentRef.removeEventListener('click', onClick, true);
}

function setupSubmitRule(context, rule) {
  const { documentRef, windowRef } = context;
  const resumedForms = new WeakSet();
  const formSelector = rule.when.formSelector || 'form';

  const onSubmit = event => {
    const form = event.target;
    if (!form || resumedForms.has(form) || !ruleApplies(rule, windowRef)) return;
    if (!safeClosest(form, formSelector)) return;

    event.preventDefault();
    const submitter = event.submitter || null;
    runInterstitial(Object.assign({}, context, {
      rule,
      resume: () => {
        resumedForms.add(form);
        if (typeof form.requestSubmit === 'function') form.requestSubmit(submitter || undefined);
        else if (typeof form.submit === 'function') form.submit();
      }
    }));
  };

  documentRef.addEventListener('submit', onSubmit, true);
  return () => documentRef.removeEventListener('submit', onSubmit, true);
}

function setupCustomEventRule(context, rule) {
  const { documentRef, windowRef } = context;
  if (!rule.when.event) return () => {};

  const onEvent = event => {
    if (!ruleApplies(rule, windowRef)) return;
    const resume = event.detail && typeof event.detail.resume === 'function'
      ? () => event.detail.resume()
      : null;
    if (event.cancelable) event.preventDefault();
    runInterstitial(Object.assign({}, context, { rule, resume }));
  };

  documentRef.addEventListener(rule.when.event, onEvent);
  return () => documentRef.removeEventListener(rule.when.event, onEvent);
}

function setupTimerRule(context, rule) {
  const { windowRef, logger } = context;
  if (!rule.when.afterMs) return () => {};
  let timer = null;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const arm = () => {
    clear();
    if (!ruleApplies(rule, windowRef)) return;
    timer = setTimeout(() => {
      runInterstitial(Object.assign({}, context, { rule, resume: null }));
    }, Math.max(0, Number(rule.when.afterMs)));
    logger && logger.debug('interstitial timer armed', { id: rule.id, afterMs: rule.when.afterMs });
  };

  const cleanupRouteWatcher = installRouteWatcher(windowRef, arm);
  arm();
  return () => {
    clear();
    cleanupRouteWatcher();
  };
}

export function setupInterstitials(context) {
  const cleanup = [];
  for (const rule of context.definition.interstitials || []) {
    if (!rule || !rule.id || !rule.when) continue;
    if (rule.when.selector) cleanup.push(setupClickRule(context, rule));
    if (rule.when.formSelector || (rule.when.selector || '').includes('submit')) cleanup.push(setupSubmitRule(context, rule));
    if (rule.when.event) cleanup.push(setupCustomEventRule(context, rule));
    if (rule.when.afterMs) cleanup.push(setupTimerRule(context, rule));
  }
  return () => cleanup.forEach(fn => fn && fn());
}

export { runInterstitial };
