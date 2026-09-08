(() => {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    try {
      const requestUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      const url = new URL(requestUrl, location.href);
      if (url.pathname !== '/api/state' || !response.ok) return response;

      const data = await response.clone().json();
      const hidden = new Set((data.projects || [])
        .filter(p => p.radarHidden || p.id === 'shino-codes' || p.id === 'astrid-admin')
        .map(p => p.id));
      if (!hidden.size) return response;

      data.projects = (data.projects || []).filter(p => !hidden.has(p.id));
      data.derived = (data.derived || []).filter(d => !hidden.has(d.projectId));
      data.sources = (data.sources || []).filter(s => !hidden.has(s.projectId));
      data.evidence = (data.evidence || []).filter(e => !hidden.has(e.projectId));

      const headers = new Headers(response.headers);
      headers.delete('content-length');
      headers.delete('content-encoding');
      headers.set('content-type','application/json; charset=utf-8');
      return new Response(JSON.stringify(data), { status:response.status, statusText:response.statusText, headers });
    } catch {
      return response;
    }
  };
})();
