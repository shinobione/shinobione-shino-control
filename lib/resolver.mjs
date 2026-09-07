export const PROJECT_ALIASES = {
  'control': ['shino control', 'shino // control', 'project radar', 'resume hub', 'site de suivi projets', 'shinobione-shino-control'],
  'shino-codes': ['shino codes', 'coding projects', 'dev projects'],
  'shino-sync': ['shino sync', 'shino-sync', 'extension shino sync'],
  'suno-bridge': ['suno bridge', 'shinobiwan-suno-bridge', 'suno bridge v0.3', 'extension suno bridge'],
  'shino-os': ['shino-os', 'shino os', 'jarvis-powered shino-os'],
  'studio': ['shinobiwan-studio', 'studio', 'shinobiwan studio', 'shinobiwan studio project'],
  'french-tranquille': ['tran-french-teacher', 'french tranquille', 'french teacher'],
  'risotools': ['risotools', 'shinoastea', 'astea', 'riso'],
  'touch-plus': ['touch_plus_source_code', 'touch+ revival', 'touch plus', 'touchplus', 'mediapipe benchmark', 'phase 2c'],
  'launchpad': ['shinobiwan-launchpad', 'launchpad', 'launchpad-app', 'launchpad pwa'],
  'music': ['shinobiwan music', 'music', 'dead air', 'pretty from both sides', 'machine fever', 'velvet hammer', 'music - proposition', 'music - choix', 'suno track'],
  'astrid-admin': ['aide avec mon ex conjointe', 'ex conjointe astrid', 'astrid mediation', 'astrid médiation']
};

const GENERIC_ALIASES = new Set(['music', 'studio', 'riso', 'astea', 'launchpad']);

function norm(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_/\\-]+/g, ' ')
    .replace(/[^a-z0-9+ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function basename(repo = '') {
  return String(repo).split('/').pop() || '';
}

function occurrences(haystack, needle) {
  if (!needle || !haystack) return 0;
  let count = 0, pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count += 1;
    pos += Math.max(needle.length, 1);
    if (count >= 8) break;
  }
  return count;
}

function aliasSet(project) {
  return [
    project.name,
    project.repo,
    basename(project.repo),
    ...(PROJECT_ALIASES[project.id] || [])
  ].filter(Boolean);
}

export function resolveProjectDetailed(input, projects, manualMappings = {}, sourceKey = '') {
  const titleRaw = typeof input === 'string' ? '' : String(input?.title || '');
  const projectTitleRaw = typeof input === 'string' ? '' : String(input?.projectTitle || '');
  const transcriptRaw = typeof input === 'string' ? String(input) : String(input?.transcript || '');
  const raw = typeof input === 'string' ? String(input) : `${titleRaw}\n${projectTitleRaw}\n${transcriptRaw}`;
  const title = norm(titleRaw);
  const projectTitle = norm(projectTitleRaw);
  const transcript = norm(transcriptRaw);

  const manualId = sourceKey && manualMappings?.[sourceKey];
  if (manualId) {
    const project = projects.find(p => p.id === manualId) || null;
    return project ? { project, score: 1000, titleScore: 1000, reason: 'manual mapping' } : null;
  }

  let best = null;
  for (const project of projects) {
    let score = 0;
    let titleScore = 0;
    const reasons = [];
    const aliases = aliasSet(project);

    for (const rawAlias of aliases) {
      const alias = norm(rawAlias);
      if (!alias || alias.length < 3) continue;
      const generic = GENERIC_ALIASES.has(alias) || alias.length <= 5;

      if (title) {
        if (title === alias) {
          const v = generic ? 115 : 145;
          titleScore = Math.max(titleScore, v);
          reasons.push(`title exact:${rawAlias}`);
        } else if (title.includes(alias)) {
          const v = generic ? 82 : 118;
          titleScore = Math.max(titleScore, v);
          reasons.push(`title contains:${rawAlias}`);
        }
      }

      if (projectTitle) {
        if (projectTitle === alias) {
          const v = generic ? 72 : 96;
          score += v;
          reasons.push(`project exact:${rawAlias}`);
        } else if (projectTitle.includes(alias)) {
          const v = generic ? 46 : 70;
          score += v;
          reasons.push(`project contains:${rawAlias}`);
        }
      }

      const n = occurrences(transcript, alias);
      if (n) {
        let v = (generic ? 5 : 12) * Math.min(n, 5);
        if (project.repo && norm(project.repo) === alias) v = Math.max(v, 82);
        else if (project.repo && norm(basename(project.repo)) === alias) v = Math.max(v, 68);
        score += v;
        reasons.push(`body:${rawAlias}×${n}`);
      }
    }

    score += titleScore;

    if (project.repo && raw.toLowerCase().includes(`github.com/${String(project.repo).toLowerCase()}`)) {
      score += 95;
      reasons.push('explicit repo URL');
    }

    if (!best || score > best.score) {
      best = { project, score, titleScore, reason: reasons.slice(0, 6).join(', ') || 'no signal' };
    }
  }

  if (!best || best.score < 55) return null;
  return best;
}

export function resolveProject(input, projects, manualMappings = {}, sourceKey = '') {
  return resolveProjectDetailed(input, projects, manualMappings, sourceKey)?.project || null;
}
