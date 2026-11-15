import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),postcss=require('postcss');
const web=new URL('../src/',import.meta.url),shared=new URL('../../../shared/ui-geometry.css',import.meta.url);
const files=['home.css','intro.css','video.css','style.css','matters/matters.css','product/chain.css','product/comparison.css','product/worksite.css','product/web.css','react/ui/trace-ui.css','react/settings-disclosure.css','react/project-lifecycle.css'].map(p=>new URL(p,web));
files.push(new URL('../../desktop-pet/src/client/style.css',import.meta.url),new URL('../../desktop-pet/src/desktop/native.css',import.meta.url));
test('one shared geometry owner supplies the 4px scale, minimum radii and full-round exceptions',()=>{
  const vars=new Map();postcss.parse(fs.readFileSync(shared,'utf8')).walkDecls(d=>{if(d.prop.startsWith('--'))vars.set(d.prop,d.value);});
  for(const [name,value]of Object.entries({chip:'4px',control:'8px',panel:'12px',card:'16px',dialog:'24px',pill:'9996px',circle:'50%'}))assert.equal(vars.get('--trace-radius-'+name),value);
  assert.equal(vars.get('--trace-space-unit'),'4px');assert.match(vars.get('--trace-radius-menu-item'),/max\(var\(--trace-radius-chip\), calc\(var\(--trace-radius-panel\) - var\(--trace-menu-inset\)\)\)/);
});
test('every owned rounded box uses the shared tokens, including legacy and native UI',()=>{
  let count=0;
  for(const file of files)postcss.parse(fs.readFileSync(file,'utf8')).walkDecls(d=>{
    if(/^border(?:-(?:top|bottom)-(?:left|right))?-radius$/.test(d.prop)){count++;assert.ok(d.value==='0'||d.value==='inherit'||d.value.includes('var(--trace-radius-'),`${file.pathname}:${d.source.start.line} ${d.value}`);}
    assert.ok(!/^--trace-radius-(chip|control|panel|card|dialog|pill|circle)$/.test(d.prop),'Duplicate geometry owner: '+file.pathname);
  });assert.ok(count>350);
});
test('corner-shape is strictly progressive and the embeddable overlay is scoped to Trace',()=>{
  for(const file of [shared,...files])postcss.parse(fs.readFileSync(file,'utf8')).walkDecls('corner-shape',d=>{let p=d.parent,guard=false;while(p){if(p.type==='atrule'&&p.name==='supports'&&p.params.includes('corner-shape'))guard=true;p=p.parent;}assert.ok(guard,'Unconditional corner-shape in '+file.pathname);assert.ok(['round','inherit','superellipse(1.25)'].includes(d.value));});
  const css=fs.readFileSync(shared,'utf8');assert.ok(css.includes('[data-trace-geometry]'));assert.ok(!css.includes(':where(*) {'));
  const overlay=fs.readFileSync(new URL('../../desktop-pet/src/client/TraceOverlay.tsx',import.meta.url),'utf8');assert.ok(overlay.includes('data-trace-geometry="true"'));
});
test('fixed authored spacing is on the grid; fluid values retain a previous-engine fallback',()=>{
  for(const file of files)postcss.parse(fs.readFileSync(file,'utf8')).walkDecls(d=>{
    if(!/^(padding|margin|gap|row-gap|column-gap)(-|$)/.test(d.prop))return;
    const raw=[...d.value.matchAll(/(-?\d+(?:\.\d+)?)px\b/g)].some(m=>Number(m[1])%4!==0);
    if(raw&&!d.value.includes('round(')){const next=d.next();assert.ok(next?.type==='decl'&&next.prop===d.prop&&next.value.includes('round('),`${file.pathname}:${d.source.start.line} off-grid spacing without fallback pair`);}
  });
});
test('all application entrypoints load the same geometry without changing a business schema',()=>{
  for(const p of ['web-main.js','main.js'])assert.ok(fs.readFileSync(new URL(p,web),'utf8').includes("../../../shared/ui-geometry.css"));
  for(const p of ['client/apply.tsx','desktop/renderer.tsx'])assert.ok(fs.readFileSync(new URL('../../desktop-pet/src/'+p,import.meta.url),'utf8').includes("../../../../shared/ui-geometry.css"));
});
