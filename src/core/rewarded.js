import { routeMatches, safeClosest } from './dom.js';
import { createLinkNavigation, isExternalHttpDestination, shouldBypassLink } from './navigation-guard.js';

function dispatchLifecycleEvent(documentRef, name, detail, { cancelable = false } = {}) {
  const event = new CustomEvent(name, {
    bubbles: true,
    cancelable,
    detail
  });
  documentRef.dispatchEvent(event);
  if (detail && detail.trigger && typeof detail.trigger.dispatchEvent === 'function') {
    detail.trigger.dispatchEvent(new CustomEvent(name, {
      bubbles: true,
      cancelable,
      detail
    }));
  }
  return !event.defaultPrevented;
}

function ruleApplies(rule, windowRef) {
  return routeMatches(rule.when && rule.when.routePattern, windowRef.location && windowRef.location.pathname);
}

function fallbackName(rule, status) {
  if (status === 'unavailable' || status === 'timeout') return 'publisherExperience:rewardedUnavailable';
  if (status === 'declined') return 'publisherExperience:rewardedDeclined';
  return `publisherExperience:rewarded${status}`;
}

async function runRewarded({ rule, adapter, lock, logger, documentRef, trigger, navigation }) {
  if (!lock.acquire('rewarded')) {
    dispatchLifecycleEvent(documentRef, 'publisherExperience:rewardedBusy', { id: rule.id, trigger }, { cancelable: false });
    return { status: 'busy' };
  }

  let continued = false;
  const continueNavigation = () => {
    if (continued) return;
    continued = true;
    navigation && navigation.resume();
  };
  const lifecycleBase = {
    id: rule.id,
    trigger,
    href: navigation ? navigation.href : null,
    continueNavigation,
    continueWithoutReward: continueNavigation
  };

  try {
    const result = await adapter.requestRewarded(rule.slotKey || 'rewarded', {
      ready: event => dispatchLifecycleEvent(documentRef, 'publisherExperience:rewardedReady', Object.assign({}, lifecycleBase, { event })),
      granted: event => dispatchLifecycleEvent(documentRef, 'publisherExperience:rewardedGranted', Object.assign({}, lifecycleBase, { event, reward: event.payload || null })),
      videoCompleted: event => dispatchLifecycleEvent(documentRef, 'publisherExperience:rewardedVideoCompleted', Object.assign({}, lifecycleBase, { event })),
      closed: event => dispatchLifecycleEvent(documentRef, 'publisherExperience:rewardedClosed', Object.assign({}, lifecycleBase, { event }))
    });

    logger && logger.debug('rewarded completed', { id: rule.id, status: result.status });

    if (result.status === 'granted') {
      dispatchLifecycleEvent(documentRef, 'publisherExperience:rewardedSuccess', Object.assign({}, lifecycleBase, {
        reward: result.reward || null
      }));
      if (rule.action === 'navigate_after_grant' && navigation) navigation.resume();
      return result;
    }

    dispatchLifecycleEvent(documentRef, fallbackName(rule, result.status), Object.assign({}, lifecycleBase, {
      status: result.status
    }), { cancelable: true });
    dispatchLifecycleEvent(documentRef, 'publisherExperience:rewardedFallback', Object.assign({}, lifecycleBase, {
      status: result.status
    }), { cancelable: true });
    return result;
  } catch (error) {
    logger && logger.warn('rewarded failed', { id: rule.id, message: error.message });
    dispatchLifecycleEvent(documentRef, 'publisherExperience:rewardedFallback', Object.assign({}, lifecycleBase, {
      status: 'error',
      error
    }), { cancelable: true });
    return { status: 'error', error };
  } finally {
    lock.release('rewarded');
  }
}

function setupRewardedRule(context, rule) {
  const { documentRef, windowRef } = context;
  const selector = rule.when && rule.when.selector;
  if (!selector) return () => {};

  const onClick = event => {
    const trigger = safeClosest(event.target, selector);
    if (!trigger || !ruleApplies(rule, windowRef)) return;

    const link = safeClosest(trigger, 'a[href]') || safeClosest(event.target, 'a[href]');
    let navigation = null;

    if (link) {
      if (shouldBypassLink(link, event, { locationRef: windowRef.location })) return;
      const href = link.getAttribute('href');
      if (rule.requireExternal && !isExternalHttpDestination(href, windowRef.location)) return;
      navigation = createLinkNavigation(link, windowRef);
    }

    event.preventDefault();
    runRewarded(Object.assign({}, context, { rule, trigger, navigation }));
  };

  documentRef.addEventListener('click', onClick, true);
  return () => documentRef.removeEventListener('click', onClick, true);
}

export function setupRewarded(context) {
  const cleanup = [];
  for (const rule of context.definition.rewarded || []) {
    if (!rule || !rule.id || !rule.when) continue;
    cleanup.push(setupRewardedRule(context, rule));
  }
  return () => cleanup.forEach(fn => fn && fn());
}

export { dispatchLifecycleEvent, runRewarded };
