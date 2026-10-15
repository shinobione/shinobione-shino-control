// Only reviewed frontend assets can enter the public Pages artifact.
// Private downloads, local state, backups and unlisted public/ files are never copied.
export const PUBLIC_ARTIFACTS = Object.freeze([
  'index.html','app.js','site-bootstrap.js','state-filter.js','build-info.js',
  'focus-engine.js','focus-now.js','focus-now.css','sync-health.js','sync-health.css',
  'radar-copy-cleaner.js','styles.css','ui-v3.css','ui-v10.css','ui-premium.css',
  'project-manager.css','source-manager.css','drag-drop.css',
  'hq.js','hq-model.js','hq-views.js','hq.css','control-route.js','favicon.svg','favicon-32.png',
  'assets/control-hero-v9.svg','assets/project-hero-v9.svg','assets/control-mountains.svg',
  'assets/project-workflow-art.svg','assets/dashboard-premium.webp','assets/project-premium.webp',
  'assets/ui/backgrounds/dashboard-hero-master.avif','assets/ui/backgrounds/project-hero-master.avif',
  'assets/ui/brand/brand-emblem.avif'
]);
