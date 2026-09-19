import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const REPO_STATE_PATH = path.join(ROOT, 'data', 'state.json');
export const DEFAULT_RUNTIME_STATE_PATH = path.join(ROOT, 'data', 'state.local.json');

export function runtimeStatePath({ bootstrap = true } = {}) {
  const configured = String(process.env.SHINO_CONTROL_STATE || '').trim();
  const target = configured ? path.resolve(configured) : DEFAULT_RUNTIME_STATE_PATH;

  if (bootstrap && !fs.existsSync(target)) {
    if (!fs.existsSync(REPO_STATE_PATH)) {
      throw new Error(`CONTROL seed state not found: ${REPO_STATE_PATH}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive:true });
    fs.copyFileSync(REPO_STATE_PATH, target);
  }

  return target;
}

export function readRuntimeState() {
  return JSON.parse(fs.readFileSync(runtimeStatePath(), 'utf8'));
}

export function writeRuntimeState(state) {
  const target = runtimeStatePath();
  fs.writeFileSync(target, JSON.stringify(state, null, 2));
  return target;
}
