import { createHash } from 'node:crypto';
import { HqError, validateHq } from './hq-store.mjs';

const checksum = hq => createHash('sha256').update(JSON.stringify(hq)).digest('hex');
export function buildHqBackup(hq,{now=new Date().toISOString()}={}) {
  validateHq(hq,[],{strictRefs:false});
  const copy=structuredClone(hq);
  return {format:'shino-hq-backup',version:1,createdAt:now,sha256:checksum(copy),hq:copy};
}
export function restoreHqBackup(state,backup) {
  if (!backup || backup.format !== 'shino-hq-backup' || backup.version !== 1) throw new HqError('Invalid HQ backup format');
  if (typeof backup.sha256 !== 'string' || backup.sha256 !== checksum(backup.hq)) throw new HqError('HQ backup checksum mismatch');
  const restored=validateHq(backup.hq,state.projects || []);
  state.hq=restored;
  return restored;
}
