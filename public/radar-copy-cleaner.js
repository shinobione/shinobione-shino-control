import { cleanFocusSummary } from './focus-engine.js';

let scheduled = false;

function cleanNode(node, maxChars) {
  const raw = String(node?.textContent || '').trim();
  if (!raw) return;
  const cleaned = cleanFocusSummary(raw, maxChars);
  if (cleaned && cleaned !== raw) node.textContent = cleaned;
}

function cleanRadarCopy() {
  scheduled = false;

  document.querySelectorAll('.card .summary').forEach(node => cleanNode(node, 420));
  document.querySelectorAll('.card .resume p').forEach(node => cleanNode(node, 420));

  document.querySelectorAll('.modal .big-state').forEach(node => cleanNode(node, 760));
  document.querySelectorAll('.modal .resume-panel p').forEach(node => cleanNode(node, 520));
  document.querySelectorAll('.modal .event p').forEach(node => cleanNode(node, 520));
}

function scheduleCleanup() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(cleanRadarCopy);
}

scheduleCleanup();
const app = document.getElementById('app');
if (app) new MutationObserver(scheduleCleanup).observe(app, {childList:true, subtree:true});
