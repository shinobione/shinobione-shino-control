// Explicit demo state only. Never reads or writes the normal CONTROL runtime database.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { ensureHq, mutateHq } from './lib/hq-store.mjs';
import { localDate } from './public/hq-model.js';

const root=path.dirname(fileURLToPath(import.meta.url));
const file=path.join(root,'.hq-local','demo-state.json');
const port=process.env.PORT || '4417';
if(!fs.existsSync(file)||process.argv.includes('--reset')){
  const date=offset=>{const d=new Date();d.setDate(d.getDate()+offset);return localDate(d);};
  const state={version:1,settings:{hqDemo:true},sources:[],evidence:[],discovered:[],projects:[
    {id:'demo-music',name:'DEMO · Prochaine sortie',universe:'MUSIC',kind:'MANUAL_PROJECT'},
    {id:'demo-dev',name:'DEMO · SHINO HQ',universe:'DEV',repo:'shinobione/shinobione-shino-control',control:{statusOverride:'NEEDS TEST'}},
    {id:'demo-work',name:'DEMO · Suivi interventions',universe:'WORK',kind:'MANUAL_PROJECT'},
    {id:'demo-personal',name:'DEMO · Organisation personnelle',universe:'PERSONAL',kind:'MANUAL_PROJECT'}
  ]};
  ensureHq(state);
  for(const [i,values] of [
    {title:'DEMO · Préparer le briefing du prochain morceau',universe:'MUSIC',projectId:'demo-music',priority:'P1',dueDate:date(1),category:'Morceau',description:'Données de démonstration. Le catalogue créatif reste dans Studio.'},
    {title:'DEMO · Valider le cockpit sur écran ultrawide',universe:'DEV',projectId:'demo-dev',priority:'P1',dueDate:date(0),sourceUrl:'https://github.com/shinobione/shinobione-shino-control'},
    {title:'DEMO · Préparer une fiche technique RISO',universe:'WORK',projectId:'demo-work',priority:'P2',dueDate:date(-1),category:'RISO',status:'BLOCKED',description:'Exemple générique sans client ni document confidentiel.'},
    {title:'DEMO · Classer les justificatifs du mois',universe:'PERSONAL',projectId:'demo-personal',priority:'P2',dueDate:date(3),category:'Administration'},
    {title:'DEMO · Noter un achat de fournitures',universe:'PERSONAL',priority:'P3',amount:'18.50',currency:'EUR',status:'DONE'},
    {title:'DEMO · Préparer les actions de promotion',universe:'MUSIC',priority:'P2',dueDate:date(5),category:'Promotion'}
  ].entries())mutateHq(state,{collection:'actions',operation:'create',id:`demo-action-${i}`,expectedGeneration:state.hq.generation,values});
  mutateHq(state,{collection:'contacts',operation:'create',id:'demo-contact',expectedGeneration:state.hq.generation,values:{name:'DEMO · Contact label',organization:'Organisation fictive',universe:'MUSIC',relationship:'Label',followUpDate:date(2),note:'Exemple explicitement fictif, aucune personne réelle.'}});
  mutateHq(state,{collection:'deliverables',operation:'create',id:'demo-delivery',expectedGeneration:state.hq.generation,values:{title:'DEMO · Briefing sortie',projectId:'demo-music',universe:'MUSIC',type:'Release',targetDate:date(7)}});
  fs.mkdirSync(path.dirname(file),{recursive:true});
  if(fs.existsSync(file))fs.copyFileSync(file,`${file}.bak`);
  fs.writeFileSync(file,JSON.stringify(state,null,2),{mode:0o600});
}
console.log(`DEMO HQ only → http://127.0.0.1:${port} · .hq-local/demo-state.json`);
const child=spawn(process.execPath,['server-entry.mjs'],{cwd:root,env:{...process.env,PORT:port,SHINO_CONTROL_STATE:file,SHINO_CONTROL_TOKEN:'',GITHUB_TOKEN:'',SHINO_CONTROL_EXTENSION_ID:''},stdio:'inherit'});
process.on('SIGINT',()=>child.kill());process.on('SIGTERM',()=>child.kill());
const [code]=await once(child,'exit');process.exitCode=code || 0;
