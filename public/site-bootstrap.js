(() => {
  const host = String(location.hostname || '').toLowerCase();
  const staticMode = host.endsWith('github.io');
  window.SHINO_STATIC_MODE = staticMode;
  if (!staticMode) return;

  const nativeFetch = window.fetch.bind(window);
  const jsonHeaders = {'Content-Type':'application/json'};

  window.fetch = async (input, init = {}) => {
    const raw = typeof input === 'string' ? input : input?.url;
    const url = new URL(raw || '', location.href);
    const method = String(init?.method || 'GET').toUpperCase();

    if (method === 'GET' && url.pathname === '/api/state') {
      return nativeFetch(new URL('./state.json', location.href), {cache:'no-store'});
    }

    if (url.pathname.startsWith('/api/') && method !== 'GET') {
      return new Response(JSON.stringify({
        error:'GitHub Pages is read-only. State changes are published from the repository.'
      }), {status:405, headers:jsonHeaders});
    }

    return nativeFetch(input, init);
  };

  function decorateStaticUi() {
    document.documentElement.dataset.shinoHosting = 'github-pages';
    document.querySelectorAll('#syncBtn,#syncBtn2,[data-map],[data-ignore]').forEach(el => {
      el.style.display = 'none';
    });

    if (!document.getElementById('githubPagesBadge')) {
      const badge = document.createElement('div');
      badge.id = 'githubPagesBadge';
      badge.textContent = 'GITHUB PAGES · REPO SNAPSHOT';
      badge.style.cssText = [
        'position:fixed','right:14px','bottom:14px','z-index:9999',
        'font:700 10px system-ui','letter-spacing:.08em','padding:7px 10px',
        'border-radius:999px','background:#171d28','color:#e2b24f',
        'border:1px solid #3e4c61','box-shadow:0 8px 30px #0008'
      ].join(';');
      document.body.appendChild(badge);
    }
  }

  document.addEventListener('DOMContentLoaded', decorateStaticUi, {once:true});
  new MutationObserver(decorateStaticUi).observe(document.documentElement, {childList:true, subtree:true});
})();
