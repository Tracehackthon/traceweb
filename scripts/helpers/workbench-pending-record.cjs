// Read-only evidence for single-request E2E journeys. Never prefer the legacy
// key and accidentally conceal a second request in the per-command outbox.
module.exports=async page=>page.evaluate(()=>{
  const prefix='trace-workbench-pending:'+(location.pathname.startsWith('/app/demo')?'demo':'personal');
  const keys=Object.keys(localStorage).filter(key=>key===prefix||key.startsWith(prefix+':request-v1:')).sort();
  if(keys.length>1)throw Error('Single-request journey has multiple recovery records; inspect all, do not pick one.');
  return keys.length?localStorage.getItem(keys[0]):null;
});
