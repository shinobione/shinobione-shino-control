# Security Policy

SHINO // CONTROL is a local-first project dashboard and synchronization tool. The supported deployment model is the current `main` branch running on loopback (`127.0.0.1` / `localhost`) with the bundled Chrome Collector.

## Supported version

Security fixes are applied to the latest version on `main`. Older branches, historical UI iterations and superseded Collector versions are not maintained for security fixes.

## Reporting a vulnerability

Please do not disclose a suspected vulnerability in a public issue, pull request or discussion.

Use GitHub's private vulnerability reporting / Security Advisory flow for this repository when available. Include:

- the affected route, component or file;
- reproduction steps;
- expected and observed behavior;
- impact;
- browser / OS / Node version when relevant;
- a minimal proof of concept, if safe to provide.

If private reporting is unavailable, contact the repository owner privately before publishing details.

## Security boundaries

CONTROL is designed for loopback-only use. A non-loopback deployment is unsupported. The only supported HTTP authorization boundary is a local listener with strict Host, Origin and browser request-metadata checks; the installed Chrome Collector ID is explicitly allowlisted. The old `SHINO_CONTROL_TOKEN` bearer mode is retired and its environment variable is ignored. The Collector may connect only to local HTTP endpoints (`127.0.0.1` or `localhost`).

These checks reduce remote and cross-origin browser exposure; they do **not** authenticate or isolate untrusted native processes running on the same machine. Do not expose the loopback port through a proxy, tunnel or port forward, and do not run CONTROL on a machine that already executes untrusted local code. GitHub sync credentials are separate and must never be embedded in the public snapshot.

The Chrome Collector is expected to keep ChatGPT API/session access inside Chrome's isolated extension world. Conversation data must not be bridged through page-visible `window.postMessage` channels.

Runtime state is private local data and must not be committed. The public GitHub Pages snapshot is sanitized and must not contain private ChatGPT URLs, notes, local paths, tokens or private sync diagnostics.

## Dependency and CI policy

GitHub Actions used by this repository are pinned to full commit SHAs. Dependabot tracks GitHub Actions updates so pinned revisions can be reviewed before adoption.

Security-sensitive changes should include regression coverage and should not be merged while required checks are failing.
