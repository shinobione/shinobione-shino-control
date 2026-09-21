import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('public/app.js','utf8');
const css=fs.readFileSync('public/drag-drop.css','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const server=fs.readFileSync('server-entry.mjs','utf8');

assert.match(app,/function bindControlDragDrop\(/,'drag-drop binding missing');
assert.match(app,/function beginControlDrag\(/,'drag bootstrap missing');
assert.match(app,/data-drag-project/,'project cards are not draggable');
assert.match(app,/data-drop-status/,'status board drop targets missing');
assert.match(app,/data-drop-group/,'group drop targets missing');
assert.match(app,/data-drop-auto/,'AUTO drop action missing');
assert.match(app,/data-drop-pin/,'pin drop action missing');
assert.match(app,/data-drag-source/,'source rows are not draggable');
assert.match(app,/data-drag-discovered/,'discovered source drag support missing');
assert.match(app,/data-source-drop-project/,'project list source drop targets missing');
assert.match(app,/data-source-drop-detach/,'source detach drop zone missing');
assert.match(app,/await moveManagedSource\(payload\.id,projectId\)/,'source drag does not reuse guarded move API');
assert.match(app,/await assignDiscoveredSource\(payload\.id,projectId\)/,'discovered drag does not use assignment API');
assert.match(app,/statusOverride:null/,'AUTO status reset is not wired');
assert.match(app,/dragSuppressUntil/,'click suppression after drag missing');

assert.match(server,/hasOwnProperty\.call\(payload, 'statusOverride'\)/,'server cannot explicitly clear status override');
assert.match(server,/hasOwnProperty\.call\(payload, 'group'\)/,'server cannot explicitly clear project group');

assert.match(css,/Drag & Drop Interaction Layer v1/);
assert.match(css,/\.board-column\.is-drop-over/);
assert.match(css,/\.manager-project-row\.is-drop-over/);
assert.match(css,/\.source-detach-drop\.is-drop-over/);
assert.match(css,/\.project-dnd-shelf/);
assert.match(html,/drag-drop\.css/);

console.log('drag-drop checks passed');
