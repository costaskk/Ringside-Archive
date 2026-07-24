import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const appNode={innerHTML:''};
const fileNode={value:'',dataset:{},accept:'',files:[],click(){}};
const emptyList=[];
globalThis.document={
  querySelector(selector){if(selector==='#app')return appNode;if(selector==='#filePicker')return fileNode;return null;},
  querySelectorAll(){return emptyList;},
  body:{classList:{toggle(){}}}
};
Object.defineProperty(globalThis,'location',{value:{hash:'',search:'?noautoload=1',href:'http://localhost/?noautoload=1'},configurable:true});
Object.defineProperty(globalThis,'navigator',{value:{},configurable:true});
Object.defineProperty(globalThis,'window',{value:{open(){}},configurable:true});
globalThis.confirm=()=>false;
const store=new Map();
globalThis.localStorage={getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)};
const realFetch=globalThis.fetch;
globalThis.fetch=async input=>{
  const value=String(input);
  if(value.startsWith('./data/')){
    const body=await fs.readFile(path.join(root,value.slice(2)),'utf8');
    return new Response(body,{status:200,headers:{'content-type':'application/json'}});
  }
  return realFetch(input);
};
await import('../src/app.js?runtime-smoke=1');
await new Promise(resolve=>setTimeout(resolve,500));
if(!appNode.innerHTML.includes('Exact episodes, PPVs & supercards'))throw new Error('Main timeline did not render.');
if(appNode.innerHTML.includes('Archive failed to load'))throw new Error('Application rendered its failure screen.');
if(!appNode.innerHTML.includes('data-action="toggle-filters"'))throw new Error('Filters control is missing.');
if(!appNode.innerHTML.includes('data-open-record'))throw new Error('Record popout controls are missing.');
if(appNode.innerHTML.includes('programmeTimelineCard')||appNode.innerHTML.includes('Promotion Master Index'))throw new Error('Synthetic programme master indexes must not appear in Complete Timeline.');
const appSource=await fs.readFile(path.join(root,'src/app.js'),'utf8');
if(!appSource.includes('data-open-programme'))throw new Error('Programme popout controls are missing from Show Index.');
if(!appNode.innerHTML.includes('data-filter="yearFrom"')||!appNode.innerHTML.includes('data-filter="yearTo"'))throw new Error('Year-range filters are missing.');
if(!appNode.innerHTML.includes('Available in Plex')||!appNode.innerHTML.includes('Official/free YouTube'))throw new Error('Availability filters are missing.');
if(!appNode.innerHTML.includes('activeFilters')&&appNode.innerHTML.includes('Company:'))throw new Error('Active filter controls failed to render.');
console.log(`Runtime smoke passed: ${appNode.innerHTML.length.toLocaleString()} characters rendered.`);
