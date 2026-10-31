// Runs before module/style loading; only explicit current-workbench routes opt in.
(()=>{
  if(!['canvas','capabilities','collaboration'].includes(new URLSearchParams(location.search).get('view')))return;
  const key='trace-workbench:'+(location.pathname.startsWith('/app/demo')?'demo':'personal')+':appearance';
  let preference='system';try{const saved=JSON.parse(localStorage.getItem(key)||'null');if(['system','light','dark'].includes(saved))preference=saved;}catch{}
  const dark=preference==='dark'||(preference==='system'&&matchMedia('(prefers-color-scheme: dark)').matches),root=document.documentElement;
  root.dataset.traceAppearance=dark?'dark':'light';root.classList.add(dark?'dark':'light');root.style.colorScheme=dark?'dark':'light';
  // Exact Radix Sand 1 values, used only until the bundled semantic tokens load.
  const style=document.createElement('style');style.textContent='html[data-trace-appearance=light],html[data-trace-appearance=light] body{background:var(--trace-surface-workbench,#fdfdfc)}html[data-trace-appearance=dark],html[data-trace-appearance=dark] body{background:var(--trace-surface-workbench,#111110)}';document.head.append(style);
})();
