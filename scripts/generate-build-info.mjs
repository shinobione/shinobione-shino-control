import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = String(pkg.version || 'unknown');
const sha = String(process.env.GITHUB_SHA || '').slice(0, 8);
const target = path.join(ROOT, 'public', 'build-info.js');

const js = `(() => {
  const build = ${JSON.stringify({ version, sha })};
  window.SHINO_CONTROL_BUILD = build;
  const label = 'BUILD v' + build.version + (build.sha ? ' · ' + build.sha : '');
  function injectBuildLabel() {
    const foot = document.querySelector('.side-foot');
    if (!foot || foot.querySelector('[data-control-build]')) return;
    const el = document.createElement('div');
    el.dataset.controlBuild = 'true';
    el.textContent = label;
    el.style.marginTop = '9px';
    el.style.paddingTop = '8px';
    el.style.borderTop = '1px solid rgba(145,160,183,.18)';
    el.style.fontFamily = 'ui-monospace,SFMono-Regular,Menlo,monospace';
    el.style.fontSize = '10px';
    el.style.letterSpacing = '.08em';
    el.style.color = '#e2b24f';
    foot.appendChild(el);
  }
  injectBuildLabel();
  new MutationObserver(injectBuildLabel).observe(document.documentElement, { childList: true, subtree: true });
})();
`;

fs.writeFileSync(target, js);
console.log(`Build label asset ready: v${version}${sha ? ` · ${sha}` : ''}`);
