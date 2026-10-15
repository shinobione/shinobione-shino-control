// Pure selectors shared by the local UI and Node regression checks.
export const HQ_MAX_DATA_BYTES = 6_000_000;
export const HQ_MAX_BACKUP_BYTES = 7_500_000;
export const UNIVERSES = {
  MUSIC:{name:'SHINOBIWAN',label:'Music',color:'#bb9eff',glyph:'♫'},
  DEV:{name:'SHINO LAB',label:'Dev',color:'#80b6ff',glyph:'⌘'},
  WORK:{name:'FIELD OPS',label:'Work',color:'#e9bd73',glyph:'▧'},
  PERSONAL:{name:'SHINO LIFE',label:'Personal',color:'#80cfb3',glyph:'◈'}
};
export const ACTION_STATUSES = {TODO:'À faire',IN_PROGRESS:'En cours',WAITING:'En attente',BLOCKED:'Bloquée',DONE:'Terminée'};
export function localDate(now = new Date()) {
  if (typeof now === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(now)) return now;
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['https:','http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
export function projectUniverse(project, hq = {}) {
  const explicit = hq.projectUniverses?.[project.id];
  if (Object.hasOwn(UNIVERSES,explicit)) return explicit;
  const raw = String(project.universe || '').toUpperCase();
  if (/PERSONAL|PERSONNEL|LIFE/.test(raw)) return 'PERSONAL';
  if (/RISO|KYOCERA|FIELD|WORK/.test(raw)) return 'WORK';
  if (/MUSIC|AUDIO/.test(raw)) return 'MUSIC';
  return 'DEV';
}
const fold = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const statusRank = {IN_PROGRESS:0,TODO:1,BLOCKED:2,WAITING:3,DONE:4};
export function compareActions(a,b) {
  return a.priority.localeCompare(b.priority) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999') ||
    (statusRank[a.status]-statusRank[b.status]) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}
export function isOverdue(action, today = localDate()) {
  return action.status !== 'DONE' && Boolean(action.dueDate && action.dueDate < localDate(today));
}
export function matchesDate(date, filter, today = localDate()) {
  today = localDate(today);
  if (!filter || filter === 'ALL') return true;
  if (filter === 'undated') return !date;
  if (!date) return false;
  if (filter === 'overdue') return date < today;
  if (filter === 'today') return date === today;
  if (filter === 'week') {
    const end = new Date(`${today}T12:00:00`);
    end.setDate(end.getDate()+7);
    return date >= today && date <= localDate(end);
  }
  return true;
}
export function selectActions(actions = [], filters = {}, today = localDate()) {
  const result = actions.filter(a => (!filters.universe || filters.universe === 'ALL' || a.universe === filters.universe) &&
    (!filters.status || filters.status === 'ALL' || a.status === filters.status) &&
    (!filters.priority || filters.priority === 'ALL' || a.priority === filters.priority) &&
    (!filters.projectId || a.projectId === filters.projectId) &&
    (!filters.query || fold(`${a.title} ${a.description} ${a.category} ${a.projectId || ''}`).includes(fold(filters.query))) &&
    matchesDate(a.dueDate,filters.date,today) && (filters.date !== 'overdue' || a.status !== 'DONE'));
  return result.sort(filters.sort === 'newest' ? (a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id) :
    filters.sort === 'due' ? (a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999')||compareActions(a,b) : compareActions);
}
export function selectPriorities(actions = []) {
  return actions.filter(a=>a.status !== 'DONE').sort(compareActions).slice(0,3);
}
export function selectDeadlines(hq, today = localDate()) {
  return [
    ...(hq.actions || []).filter(a=>a.status !== 'DONE' && a.dueDate).map(a=>({id:a.id,title:a.title,date:a.dueDate,universe:a.universe,collection:'actions',kind:'Tâche'})),
    ...(hq.contacts || []).filter(c=>c.followUpDate).map(c=>({id:c.id,title:c.name,date:c.followUpDate,universe:c.universe,collection:'contacts',kind:'Relance'})),
    ...(hq.deliverables || []).filter(d=>d.status !== 'DONE' && d.targetDate).map(d=>({id:d.id,title:d.title,date:d.targetDate,universe:d.universe,collection:'deliverables',kind:d.type || 'Livrable'}))
  ].filter(d=>d.date >= localDate(today)).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
}
