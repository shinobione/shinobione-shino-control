import { deriveAll } from './derive.mjs';

const EVIDENCE_TYPES = {
  commits:['github_commit','github_truth','github_component'],
  prs:['github_pr'],
  workflows:['github_ci']
};

function repoKey(project) {
  return `${project.repo}${project.repoPath ? `:${project.repoPath}` : ''}`;
}

function sameRepository(a, b) {
  return a?.repo && b?.repo === a.repo && (b.repoPath || null) === (a.repoPath || null);
}

// Network I/O runs on a detached snapshot. Apply only GitHub-owned changes to
// the *latest* on-disk state, under the short mutation queue; never copy the
// staged projects, manual controls, ChatGPT sources/evidence, or derived cache.
export function commitGithubSync(current, baseline, staged, result) {
  current.settings ||= {};
  current.settings.githubCursors ||= {};
  current.sources ||= [];
  current.evidence ||= [];

  const dirtyProjectIds = [];
  const staleSkippedProjectIds = [];

  for (const item of result.results || []) {
    if (!item.ok) continue;
    const before = (baseline.projects || []).find(p => p.id === item.projectId);
    const live = (current.projects || []).find(p => p.id === item.projectId);
    if (!sameRepository(before, live)) {
      staleSkippedProjectIds.push(item.projectId);
      continue;
    }

    const key = repoKey(before);
    const cursor = staged.settings?.githubCursors?.[key];
    if (cursor) current.settings.githubCursors[key] = cursor;

    const stagedRepoSource = (staged.sources || []).find(s =>
      s.projectId === item.projectId && s.type === 'github_repo'
    );
    if (stagedRepoSource) {
      const liveRepoSource = current.sources.find(s =>
        s.projectId === item.projectId && s.type === 'github_repo'
      );
      if (liveRepoSource) {
        // Preserve manual assignment, archive flags, URL and all user fields.
        liveRepoSource.lastObservedAt = stagedRepoSource.lastObservedAt;
      } else if (!current.sources.some(s => s.id === stagedRepoSource.id)) {
        current.sources.push(structuredClone(stagedRepoSource));
      }
    }

    const changedKinds = new Set(item.changedKinds || []);
    if (changedKinds.has('commits')) {
      for (const source of staged.sources || []) {
        if (source.projectId !== item.projectId || source.type !== 'github_component') continue;
        const existing = current.sources.find(s =>
          s.id === source.id && s.projectId === item.projectId && s.type === 'github_component'
        );
        if (!existing) continue;
        existing.lastObservedAt = source.lastObservedAt;
        existing.state = source.state;
        existing.url = source.url;
      }
    }

    const types = [...changedKinds].flatMap(kind => EVIDENCE_TYPES[kind] || []);
    if (types.length) {
      const replace = new Set(types);
      current.evidence = current.evidence.filter(e =>
        !(e.projectId === item.projectId && e.liveSync === true && replace.has(e.sourceType))
      );
      current.evidence.push(...(staged.evidence || []).filter(e =>
        e.projectId === item.projectId && e.liveSync === true && replace.has(e.sourceType)
      ).map(e => structuredClone(e)));
      dirtyProjectIds.push(item.projectId);
    }
  }

  const summary = {
    ...(result.summary || {}),
    changed:dirtyProjectIds.length,
    dirtyProjectIds,
    staleSkippedProjectIds
  };
  current.settings.lastGithubSync = summary;
  if (dirtyProjectIds.length) deriveAll(current, {dirtyProjectIds});

  return {
    ...result,
    dirtyProjectIds,
    derivation:dirtyProjectIds.length ? current.settings.lastDerivation || null : null,
    summary
  };
}
