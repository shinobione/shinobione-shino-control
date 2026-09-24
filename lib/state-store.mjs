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
    fs.copyFileSync(REPO_STATE_PATH, target, fs.constants.COPYFILE_EXCL);
  }

  return target;
}

export function readRuntimeState() {
  return JSON.parse(fs.readFileSync(runtimeStatePath(), 'utf8'));
}

export function writeRuntimeState(state) {
  const target = runtimeStatePath();
  const temp = `${target}.${process.pid}.tmp`;
  const backup = `${target}.bak`;
  const serialized = JSON.stringify(state, null, 2);
  JSON.parse(serialized);
  let descriptor;
  try {
    descriptor = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(descriptor, serialized, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    if (fs.existsSync(target)) {
      // Preserve a previously valid recovery snapshot if the live file is corrupt.
      JSON.parse(fs.readFileSync(target, 'utf8'));
      const backupTemp = `${backup}.${process.pid}.tmp`;
      try {
        fs.copyFileSync(target, backupTemp);
        fs.renameSync(backupTemp, backup);
      } finally {
        if (fs.existsSync(backupTemp)) fs.rmSync(backupTemp, {force:true});
      }
    }
    fs.renameSync(temp, target);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temp)) fs.rmSync(temp, {force:true});
  }
  return target;
}
