import {useEffect,useState} from 'react';

export type ThemePreference='system'|'light'|'dark';
const namespace=location.pathname.startsWith('/app/demo')?'demo':'personal';
const key='trace-workbench:'+namespace+':appearance';
const valid=(value:unknown):value is ThemePreference=>value==='system'||value==='light'||value==='dark';
export function useWorkbenchTheme(){
  const [preference,setPreference]=useState<ThemePreference>(()=>{try{const value=JSON.parse(localStorage.getItem(key)||'null');return valid(value)?value:'light';}catch{return 'light';}});
  useEffect(()=>{
    const root=document.documentElement,query=matchMedia('(prefers-color-scheme: dark)');
    const apply=()=>{const dark=preference==='dark'||(preference==='system'&&query.matches);root.dataset.traceAppearance=dark?'dark':'light';root.classList.toggle('dark',dark);root.classList.toggle('light',!dark);root.style.colorScheme=dark?'dark':'light';};
    apply();query.addEventListener('change',apply);
    return()=>{query.removeEventListener('change',apply);delete root.dataset.traceAppearance;root.classList.remove('dark','light');root.style.removeProperty('color-scheme');};
  },[preference]);
  const update=(value:ThemePreference)=>{setPreference(value);try{localStorage.setItem(key,JSON.stringify(value));}catch{window.dispatchEvent(new Event('trace-workbench-draft-storage-error'));}};
  return [preference,update] as const;
}
