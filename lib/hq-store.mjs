import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { UNIVERSES, ACTION_STATUSES, safeUrl } from '../public/hq-model.js';

export class HqError extends Error {
  constructor(message,status=400) { super(message); this.status=status; }
}
const fail = (message,status) => { throw new HqError(message,status); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function id(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value) || ['constructor','prototype','__proto__'].includes(value)) fail('Invalid HQ id');
  return value;
}
function text(value,field,max=2000,required=false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length>max || (required && !value.trim())) fail(`Invalid ${field}`);
  return value.trim();
}
function choice(value,choices,field) {
  if (!choices.includes(value)) fail(`Invalid ${field}`);
  return value;
}
function date(value,field) {
  if (!value) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T12:00:00Z`)) || new Date(`${value}T12:00:00Z`).toISOString().slice(0,10) !== value) fail(`Invalid ${field} date`);
  return value;
}
function timestamp(value,field) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail(`Invalid ${field}`);
  return new Date(value).toISOString();
}
function link(value,field) {
  if (!value) return '';
  const raw = text(value,field,2000);
  const result = safeUrl(raw);
  if (!result) fail(`Invalid ${field} URL (HTTP(S) without credentials required)`);
  return result;
}
function projectRef(value,projects,strictRefs=true) {
  if (value == null || value === '') return null;
  id(value);
  if (strictRefs && !projects.some(p=>p.id === value)) fail('Unknown CONTROL project');
  return value;
}
function valuesFor(collection,raw,projects,strictRefs=true) {
  if (!object(raw)) fail('Invalid HQ values');
  const universe = choice(raw.universe,Object.keys(UNIVERSES),'universe');
  if (collection === 'contacts') return {
    name:text(raw.name,'name',200,true),organization:text(raw.organization,'organization',200),universe,
    relationship:text(raw.relationship || 'Contact','relationship',100),lastContactDate:date(raw.lastContactDate,'last contact'),
    followUpDate:date(raw.followUpDate,'follow up'),note:text(raw.note,'note',6000),externalUrl:link(raw.externalUrl,'external')
  };
  const shared = {title:text(raw.title,'title',240,true),universe,projectId:projectRef(raw.projectId,projects,strictRefs),sourceUrl:link(raw.sourceUrl,'source')};
  if (collection === 'deliverables') return {
    ...shared,type:text(raw.type || 'Livrable','type',100),status:choice(raw.status || 'TODO',['TODO','IN_PROGRESS','BLOCKED','DONE'],'status'),targetDate:date(raw.targetDate,'target')
  };
  let amount = raw.amount == null || raw.amount === '' ? null : String(raw.amount);
  if (amount !== null && (!/^\d{1,10}(\.\d{1,2})?$/.test(amount) || !Number.isFinite(Number(amount)))) fail('Invalid amount');
  const currency = raw.currency || 'EUR';
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) fail('Invalid currency');
  return {...shared,description:text(raw.description,'description',6000),priority:choice(raw.priority || 'P2',['P1','P2','P3'],'priority'),
    status:choice(raw.status || 'TODO',Object.keys(ACTION_STATUSES),'status'),dueDate:date(raw.dueDate,'due'),category:text(raw.category,'category',100),amount,currency};
}
function emptyHq() {
  return {schemaVersion:1,actions:[],contacts:[],deliverables:[],activity:[],projectUniverses:{},settings:{studioUrl:''}};
}
// Validation reconstructs the allowed schema; it never copies arbitrary fields into a backup restore.
export function validateHq(raw,projects=[],{strictRefs=true}={}) {
  if (!object(raw) || raw.schemaVersion !== 1) fail('Unsupported HQ schema version');
  const out = emptyHq();
  for (const collection of ['actions','contacts','deliverables']) {
    if (!Array.isArray(raw[collection]) || raw[collection].length>100000) fail(`Invalid HQ ${collection}`);
    const ids = new Set();
    out[collection] = raw[collection].map(row=>{
      if (!object(row)) fail(`Invalid HQ ${collection} row`);
      const key = id(row.id);
      if (ids.has(key)) fail('Duplicate HQ id');
      ids.add(key);
      const values = valuesFor(collection,row,projects,strictRefs);
      if (!Number.isSafeInteger(row.revision) || row.revision<1) fail('Invalid HQ revision');
      const createdAt=timestamp(row.createdAt,'createdAt'),updatedAt=timestamp(row.updatedAt,'updatedAt');
      const result={id:key,...values,createdAt,updatedAt,revision:row.revision};
      if (collection === 'actions') result.closedAt = values.status === 'DONE' ? timestamp(row.closedAt,'closedAt') : null;
      return result;
    });
  }
  if (!Array.isArray(raw.activity) || raw.activity.length>100000) fail('Invalid HQ activity');
  const activityIds = new Set();
  out.activity=raw.activity.map(row=>{
    if (!object(row)) fail('Invalid HQ activity');
    const key=id(row.id);
    if (activityIds.has(key)) fail('Duplicate HQ activity id');
    activityIds.add(key);
    return {id:key,entityId:id(row.entityId),collection:choice(row.collection,['actions','contacts','deliverables','projects','settings'],'activity collection'),operation:choice(row.operation,['create','update','delete'],'activity operation'),at:timestamp(row.at,'activity date')};
  });
  if (raw.projectUniverses !== undefined && !object(raw.projectUniverses)) fail('Invalid HQ project universes');
  for (const [key,value] of Object.entries(raw.projectUniverses || {})) {
    projectRef(key,projects,strictRefs);
    out.projectUniverses[key]=choice(value,Object.keys(UNIVERSES),'universe');
  }
  if (raw.settings !== undefined && !object(raw.settings)) fail('Invalid HQ settings');
  out.settings.studioUrl=link(raw.settings?.studioUrl,'Studio');
  return out;
}
export function ensureHq(state) {
  if (state.hq === undefined) state.hq=emptyHq();
  // Reading existing data must also detect corruption, but cannot erase unknown fields or mutate rows.
  validateHq(state.hq,state.projects || [],{strictRefs:false});
  state.hq.projectUniverses ||= {};
  state.hq.settings ||= {studioUrl:''};
  return state.hq;
}
export function mutateHq(state,payload,{now=new Date().toISOString()}={}) {
  if (!object(payload)) fail('Invalid HQ request');
  const hq=ensureHq(state),key=id(payload.id),projects=state.projects || [];
  const collection=choice(payload.collection,['actions','contacts','deliverables','projects','settings'],'collection');
  const operation=choice(payload.operation,['create','update','delete'],'operation');
  const at=timestamp(now,'current date');
  if (collection === 'projects' || collection === 'settings') {
    if (operation !== 'update' || !object(payload.values)) fail('HQ preferences require update');
    if (collection === 'projects') {
      projectRef(key,projects);
      const universe=choice(payload.values.universe,Object.keys(UNIVERSES),'universe');
      if (hq.projectUniverses[key] === universe) return {changed:false};
      hq.projectUniverses[key]=universe;
    } else {
      if (key !== 'shortcuts') fail('Invalid HQ settings id');
      const studioUrl=link(payload.values.studioUrl,'Studio');
      if (hq.settings.studioUrl === studioUrl) return {changed:false};
      hq.settings.studioUrl=studioUrl;
    }
    hq.activity.push({id:randomUUID(),entityId:key,collection,operation,at});
    return {changed:true};
  }
  const rows=hq[collection],index=rows.findIndex(row=>row.id === key),existing=rows[index];
  if (operation !== 'create' && !existing) fail('HQ item not found',404);
  if (operation !== 'create' && payload.expectedRevision !== existing.revision) fail('Revision conflict: reload before saving',409);
  if (operation === 'delete') {
    if (payload.confirmId !== key) fail('Deletion confirmation required');
    rows.splice(index,1);
  } else {
    if (!object(payload.values)) fail('Invalid HQ values');
    const values=valuesFor(collection,{...(operation === 'update' ? existing : {}),...payload.values},projects);
    if (operation === 'create' && existing) {
      if (isDeepStrictEqual(values,valuesFor(collection,existing,projects))) return {changed:false,item:existing};
      fail('HQ id conflict',409);
    }
    const row={id:key,...values,createdAt:existing?.createdAt || at,updatedAt:at,revision:(existing?.revision || 0)+1};
    if (collection === 'actions') row.closedAt = values.status === 'DONE' ? existing?.closedAt || at : null;
    if (operation === 'create') rows.push(row); else rows[index]=row;
  }
  hq.activity.push({id:randomUUID(),entityId:key,collection,operation,at});
  return {changed:true,item:operation === 'delete' ? null : rows.find(row=>row.id === key)};
}
