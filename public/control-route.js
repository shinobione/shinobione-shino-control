// Data refreshes preserve CONTROL's current subview. Explicit hash navigation selects a route.
export function controlRoute({hash='',staticMode=false,projects=[],current=null}={}) {
  if(current)return current;
  if(staticMode)return {view:'radar',modalProject:null};
  if(hash==='#control'||hash.startsWith('#control/')){
    let projectId='';try{projectId=decodeURIComponent(hash.split('/')[1] || '');}catch{}
    return {view:'radar',modalProject:projects.some(p=>p.id===projectId)?projectId:null};
  }
  return {view:'hq',modalProject:null};
}
