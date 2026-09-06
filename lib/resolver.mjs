export const PROJECT_ALIASES = {
  'suno-bridge': ['suno bridge', 'shinobiwan-suno-bridge', 'suno bridge v0.3'],
  'shino-os': ['shino-os', 'shino os', 'jarvis-powered shino-os'],
  'studio': ['shinobiwan-studio', 'studio', 'shinobiwan studio'],
  'french-tranquille': ['tran-french-teacher', 'french tranquille', 'french teacher'],
  'risotools': ['risotools', 'shinoastea', 'astea'],
  'touch-plus': ['touch_plus_source_code', 'touch+ revival', 'touch plus', 'mediapipe benchmark', 'phase 2c'],
  'launchpad': ['shinobiwan-launchpad', 'launchpad', 'launchpad-app'],
  'music': ['shinobiwan music', 'dead air', 'pretty from both sides', 'machine fever', 'velvet hammer', 'soundcloud', 'suno track']
};

function norm(value = '') {
  return String(value).toLowerCase().replace(/[_/\\-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function resolveProject(text, projects, manualMappings = {}) {
  const raw = String(text || '');
  const n = norm(raw);
  for (const [sourceKey, projectId] of Object.entries(manualMappings || {})) {
    if (sourceKey && raw.includes(sourceKey)) return projects.find(p => p.id === projectId) || null;
  }

  for (const project of projects) {
    const aliases = [project.name, project.repo, ...(PROJECT_ALIASES[project.id] || [])].filter(Boolean);
    if (aliases.some(alias => n.includes(norm(alias)))) return project;
  }
  return null;
}
