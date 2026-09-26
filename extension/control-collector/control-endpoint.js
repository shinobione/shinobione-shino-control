// Collector destinations are local-only. The API path is supplied by the
// trusted background worker rather than by stored extension settings.
export function controlEndpointFor(configuredEndpoint, pathname) {
  let endpoint;
  try {
    endpoint = new URL(configuredEndpoint);
  } catch {
    throw new Error('CONTROL Collector endpoint must be an HTTP loopback URL');
  }
  if (endpoint.protocol !== 'http:' ||
      !['127.0.0.1','localhost'].includes(endpoint.hostname) ||
      endpoint.username || endpoint.password) {
    throw new Error('CONTROL Collector only supports HTTP loopback endpoints');
  }
  if (typeof pathname !== 'string' || !pathname.startsWith('/api/')) {
    throw new Error('CONTROL Collector API path is invalid');
  }
  endpoint.pathname = pathname;
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint.href;
}
