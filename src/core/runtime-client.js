const DEFAULT_RUNTIME_CONFIG_URL = 'https://priceoptimiser1.thebesads.com/v1/runtime-config';

export function createRuntimeClient({
  siteKey,
  runtimeConfigUrl = DEFAULT_RUNTIME_CONFIG_URL,
  fetchRef,
  locationRef,
  logger
}) {
  const fetchImpl = fetchRef || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
  const locationImpl = locationRef || (typeof location !== 'undefined' ? location : { href: 'https://example.com/', pathname: '/' });
  let currentRuntime = null;

  return {
    get current() {
      return currentRuntime;
    },
    async load(pathname = locationImpl.pathname || '/') {
      if (!fetchImpl) throw new Error('fetch unavailable');
      if (!siteKey) throw new Error('siteKey required');

      const url = new URL(runtimeConfigUrl, locationImpl.href || 'https://example.com/');
      url.searchParams.set('site', siteKey);
      url.searchParams.set('path', pathname || '/');

      const response = await fetchImpl(url.toString(), {
        credentials: 'omit',
        cache: 'no-store'
      });

      if (!response.ok) {
        const error = new Error(`runtime-config failed: ${response.status}`);
        error.status = response.status;
        throw error;
      }

      currentRuntime = await response.json();
      logger && logger.debug('runtime config loaded', {
        siteKey: currentRuntime.siteKey || currentRuntime.site || siteKey,
        pageKey: currentRuntime.pageKey || null,
        integrationMode: currentRuntime.integrationMode || null
      });
      return currentRuntime;
    }
  };
}

export { DEFAULT_RUNTIME_CONFIG_URL };
