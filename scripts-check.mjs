import fs from 'node:fs';
import { deriveAll } from './lib/derive.mjs';
const s = deriveAll(JSON.parse(fs.readFileSync('./data/state.json','utf8')));
for (const d of s.derived) console.log(`${d.projectId.padEnd(18)} ${d.status.padEnd(11)} ${d.confidence.padEnd(6)} ${d.nextAction}`);
const expected = { 'suno-bridge':'NEEDS TEST','shino-os':'NEEDS TEST','studio':'STABLE','french-tranquille':'STABLE','touch-plus':'BLOCKED' };
for (const [id,status] of Object.entries(expected)) {
  const got = s.derived.find(d=>d.projectId===id)?.status;
  if (got !== status) throw new Error(`${id}: expected ${status}, got ${got}`);
}
console.log('Derived-state checks PASS');
