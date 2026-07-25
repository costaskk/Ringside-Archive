import { storage } from './storage.js';
import { loadTvMazeFeed, normalizeEpisode, loadPromotionEpisodes, discoverTvMazeId } from './tvmaze.js';
import { escapeHtml as h, fmtDate, yearOf, downloadJson, normalize, debounce, icon } from './utils.js';
import { detailsFor, parseCompetitors, recordTraktPayload } from './records.js';
import { makeClientId, buildPlexMatches, plexWebUrl, createPlexPin, pollPlexPin, loadPlexResources, listPlexLibraries, scanPlexLibrary, updatePlexViewState, searchArtwork, searchArtworkBatch } from './integrations.js';
import { loadCloudConfig, consumeCloudAuthRedirect, updateCloudPassword, getCloudUser, signUpCloud, signInCloud, sendPasswordReset, signOutCloud, pullCloudState, pushCloudState, cloudApiHeaders, loadCloudIntegrations, saveCloudIntegration, deleteCloudIntegration } from './cloud.js';

const app = document.querySelector('#app');
const filePicker = document.querySelector('#filePicker');

const state = {
  data: null,
  view: 'exact',
  statuses: storage.statuses(),
  settings: { autoLoadEpisodes: true, ...storage.settings() },
  plexData: storage.plexData(),
  plexMatches: new Set(),
  plexLinks: new Map(),
  plexViewing: new Map(),
  trakt: storage.trakt(),
  artworkCache: storage.artwork(),
  reviews: storage.reviews(),
  feedMap: storage.feedMap(),
  filters: { query:'', region:'', promotion:'', kind:'', yearFrom:'1970', yearTo:'', wrestler:'', availability:'', hideWatched:false },
  selectedCompany: '',
  loadedEpisodes: new Map(),
  showArtwork: new Map(),
  visible: 24,
  filtersOpen: true,
  wrestlerSort: 'rating',
  wrestlerIndex: new Map(),
  autoArtworkRunning: false,
  autoArtworkTimer: null,
  modal: null,
  toast: '',
  syncMessage: '',
  libraryTab: 'all',
  autoEpisodeLoadStarted: false,
  autoEpisodeLoadComplete: false,
  plexMessage: '',
  traktMessage: '',
  traktDevice: null,
  traktPolling: false,
  artworkMessage: '',
  scanningArtwork: false,
  plexPin: null,
  cloud: { config:null, user:null, message:'', syncing:false, integrationsLoaded:false, recovery:false },
  deferredReady: false,
  recordCache: { episodes:null, exact:null, dirty:true },
  renderScheduled: false,
  lastRenderView: null,
  renderGeneration: 0,
  tasks: new Map(),
  actionSequence: 0
};

const CORE_DATA_FILES = ['promotions','programmes','major-events','recommendations','wrestlers','format-labels','custom-records','free-links','meta'];
const DEFERRED_DATA_FILES = ['artwork-overrides','artwork-catalog','event-details'];
const statusLabels = { unwatched:'Not started', watching:'Watching', watched:'Watched', skipped:'Skipped' };
const navItems = [
  ['exact','timeline','Complete Timeline'],['chronology','shows','Show Index'],['wrestlers','wrestlers','Wrestlers'],
  ['recommended','picks','Recommended'],['companies','companies','Companies'],['library','library','My Library']
];

async function fetchDataFile(name) {
  const response = await fetch(`./data/${name}.json`, { cache: 'default' });
  if (!response.ok) throw new Error(`Unable to load data/${name}.json`);
  return response.json();
}

function dataKey(name) { return name.replace(/-([a-z])/g,(_,c)=>c.toUpperCase()); }

async function loadData() {
  let data=null;
  try{
    const response=await fetch('./data/core.json',{cache:'default'});
    if(response.ok)data=await response.json();
  }catch{}
  if(!data){
    const results = await Promise.all(CORE_DATA_FILES.map(fetchDataFile));
    data = Object.fromEntries(CORE_DATA_FILES.map((name,index)=>[dataKey(name),results[index]]));
  }
  data.artworkOverrides = {};
  data.artworkCatalog = { programmes:{}, records:{}, episodes:{} };
  data.eventDetails = {};
  data.freeLinks = data.freeLinks || { records:{}, programmes:{}, recommendations:{} };
  data.freeLinks.records ||= {};
  data.freeLinks.programmes ||= {};
  data.freeLinks.recommendations ||= {};
  data.promotionMap = new Map(data.promotions.map(x=>[x.id,x]));
  data.programmeMap = new Map(data.programmes.map(x=>[x.id,x]));
  data.recommendationsByProgramme = new Map();
  data.recommendationsByDate = new Map();
  data.recommendationMap = new Map();
  for (const item of data.recommendations) {
    data.recommendationsByProgramme.set(item.programId,[...(data.recommendationsByProgramme.get(item.programId)||[]),item]);
    data.recommendationsByDate.set(item.date,[...(data.recommendationsByDate.get(item.date)||[]),item]);
    data.recommendationMap.set(item.id,item);
  }
  return data;
}

async function loadDeferredData() {
  if (state.deferredReady || !state.data) return;
  try {
    const results = await Promise.all(DEFERRED_DATA_FILES.map(fetchDataFile));
    for (let index=0; index<DEFERRED_DATA_FILES.length; index++) state.data[dataKey(DEFERRED_DATA_FILES[index])] = results[index];
    state.deferredReady = true;
    rebuildWrestlerIndex();
    renderViewOnly();
  } catch (error) {
    console.warn('Deferred archive data:', error.message);
  }
}

function promotion(id){ return state.data.promotionMap.get(id); }
function programme(id){ return state.data.programmeMap.get(id); }
function currentStatus(key) { return state.statuses[key] || 'unwatched'; }
function statusKey(record){ return record.itemKey || `event:${record.id}`; }
function invalidateRecordCache(){ state.recordCache={ episodes:null, exact:null, dirty:true }; if(state.data)state.data._recordByKey=null; }
function allLoadedEpisodes(){
  if(!state.recordCache.episodes) state.recordCache.episodes=[...state.loadedEpisodes.values()].flat();
  return state.recordCache.episodes;
}
function exactRecords(){
  if(!state.recordCache.exact||state.recordCache.dirty){
    // Complete Timeline contains only real dated records. Synthetic promotion-level
    // archive hubs belong in Companies/Show Index and must never masquerade as episodes.
    state.recordCache.exact=[...state.data.majorEvents,...state.data.customRecords,...allLoadedEpisodes()].sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.title).localeCompare(String(b.title)));
    state.recordCache.dirty=false;
  }
  return state.recordCache.exact;
}
function recordByKey(key){
  if(!state.data._recordByKey||state.recordCache.dirty){
    state.data._recordByKey=new Map([...state.data.majorEvents,...state.data.customRecords,...allLoadedEpisodes()].map(item=>[statusKey(item),item]));
  }
  return state.data._recordByKey.get(key)||null;
}
function captureViewportState(){
  const active=document.activeElement;
  const focus=active&&active!==document.body?{
    id:active.id||'',filter:active.dataset?.filter||'',selectionStart:Number.isInteger(active.selectionStart)?active.selectionStart:null,selectionEnd:Number.isInteger(active.selectionEnd)?active.selectionEnd:null
  }:null;
  const candidates=[...document.querySelectorAll('[data-scroll-key]')];
  const anchor=candidates.find(node=>node.getBoundingClientRect().bottom>86);
  return {x:window.scrollX||0,y:window.scrollY||0,key:anchor?.dataset.scrollKey||'',offset:anchor?.getBoundingClientRect().top||0,focus};
}
function restoreViewportState(snapshot,generation){
  if(!snapshot||generation!==state.renderGeneration)return;
  const restore=()=>{
    if(generation!==state.renderGeneration)return;
    let top=snapshot.y;
    if(snapshot.key){
      const node=[...document.querySelectorAll('[data-scroll-key]')].find(el=>el.dataset.scrollKey===snapshot.key);
      if(node)top=snapshot.y+(node.getBoundingClientRect().top-snapshot.offset);
    }
    window.scrollTo?.({left:snapshot.x,top:Math.max(0,top),behavior:'auto'});
    const f=snapshot.focus;
    if(f){
      const node=(f.id&&document.getElementById(f.id))||(f.filter&&document.querySelector(`[data-filter="${CSS.escape(f.filter)}"]`));
      if(node){node.focus({preventScroll:true});if(f.selectionStart!==null&&node.setSelectionRange)node.setSelectionRange(f.selectionStart,f.selectionEnd);}
    }
  };
  restore();(globalThis.requestAnimationFrame||((callback)=>setTimeout(callback,0)))(restore);
}
function scheduleRender(options={}){
  if(state.renderScheduled)return;
  state.renderScheduled=true;
  (globalThis.requestAnimationFrame||((callback)=>setTimeout(callback,0)))(()=>{state.renderScheduled=false;render(options);});
}
function onIdle(callback,timeout=1400){
  if(globalThis.requestIdleCallback)return requestIdleCallback(()=>callback(),{timeout});
  return setTimeout(callback,Math.min(timeout,800));
}
function renderToast(){
  document.querySelector('.toast')?.remove();
  if(!state.toast||!app)return;
  app.insertAdjacentHTML('beforeend',`<div class="toast"><span>${icon('check')}</span><span>${h(state.toast)}</span><button type="button">×</button></div>`);
  const toast=app.querySelector('.toast');toast?.querySelector('button')?.addEventListener('click',()=>{state.toast='';toast.remove();});
}
function showToast(message) {
  state.toast=message;renderToast();
  setTimeout(()=>{if(state.toast===message){state.toast='';document.querySelector('.toast')?.remove();}},3800);
}

const ASYNC_ACTIONS=new Set([
  'cloud-signin','cloud-signup','cloud-reset','cloud-update-password','cloud-sync','cloud-signout',
  'reload-all-episodes','discover-feeds','refresh-integration-config','trakt-connect','trakt-sync','trakt-disconnect',
  'plex-connect','plex-refresh-servers','plex-disconnect','plex-import-viewing','scan-visible-artwork'
]);
const ASYNC_LABELS={
  'cloud-signin':'Signing in','cloud-signup':'Creating account','cloud-reset':'Sending reset','cloud-update-password':'Updating password','cloud-sync':'Syncing account','cloud-signout':'Signing out',
  'reload-all-episodes':'Refreshing feeds','discover-feeds':'Discovering feeds','refresh-integration-config':'Checking configuration','trakt-connect':'Connecting Trakt','trakt-sync':'Importing Trakt','trakt-disconnect':'Disconnecting Trakt',
  'plex-connect':'Connecting Plex','plex-refresh-servers':'Refreshing servers','plex-disconnect':'Disconnecting Plex','plex-import-viewing':'Importing viewing','scan-visible-artwork':'Scanning artwork'
};
function taskKeyForElement(el,action=''){
  if(el?.dataset?.taskKey)return el.dataset.taskKey;
  if(el?.dataset?.loadProgramme)return `load-programme:${el.dataset.loadProgramme}`;
  if(el?.dataset?.discoverProgramme)return `discover-programme:${el.dataset.discoverProgramme}`;
  if(el?.dataset?.scanArt)return `scan-art:${el.dataset.scanArt}`;
  if(el?.dataset?.plexLoadServer)return `plex-libraries:${el.dataset.plexLoadServer}`;
  if(el?.dataset?.plexScanServer)return `plex-scan:${el.dataset.plexScanServer}`;
  return action||`task:${++state.actionSequence}`;
}
function taskLabelFor(key,fallback='Working'){
  const base=String(key||'').split(':')[0];
  if(key.startsWith('load-programme:'))return 'Loading episodes';
  if(key.startsWith('discover-programme:'))return 'Discovering feed';
  if(key.startsWith('scan-art:'))return 'Scanning artwork';
  if(key.startsWith('plex-libraries:'))return 'Loading libraries';
  if(key.startsWith('plex-scan:'))return 'Scanning libraries';
  return ASYNC_LABELS[key]||ASYNC_LABELS[base]||fallback;
}
function taskButtonKey(el,action=''){
  const key=taskKeyForElement(el,action);if(el)el.dataset.taskKey=key;return key;
}
function renderTaskDock(){
  document.querySelector('.asyncTaskDock')?.remove();
  const active=[...state.tasks.values()].filter(task=>task.status==='running');
  if(!active.length||!app)return;
  app.insertAdjacentHTML('beforeend',`<aside class="asyncTaskDock" aria-live="polite" aria-label="Background operations">${active.map(task=>`<div><span class="buttonSpinner" aria-hidden="true"></span><p><strong>${h(task.label)}</strong>${task.detail?`<small>${h(task.detail)}</small>`:''}</p>${Number.isFinite(task.progress)?`<b>${Math.max(0,Math.min(100,Math.round(task.progress)))}%</b>`:''}</div>`).join('')}</aside>`);
}
function applyTaskStateToButton(el){
  if(!el)return;
  const key=taskButtonKey(el,el.dataset.action||'');
  const task=state.tasks.get(key);
  if(task?.status==='running'){
    if(!el.dataset.idleHtml)el.dataset.idleHtml=el.innerHTML;
    el.disabled=true;el.setAttribute('aria-busy','true');el.classList.add('isLoading');
    el.innerHTML=`<span class="buttonSpinner" aria-hidden="true"></span><span>${h(task.buttonLabel||task.label)}</span>${Number.isFinite(task.progress)?`<small>${Math.round(task.progress)}%</small>`:''}`;
  }else if(el.dataset.idleHtml){
    el.innerHTML=el.dataset.idleHtml;delete el.dataset.idleHtml;el.disabled=false;el.removeAttribute('aria-busy');el.classList.remove('isLoading');
  }
}
function syncTaskButtons(){document.querySelectorAll('[data-task-key],[data-action],[data-load-programme],[data-discover-programme],[data-scan-art],[data-plex-load-server],[data-plex-scan-server]').forEach(applyTaskStateToButton);renderTaskDock();}
function updateTask(key,changes={}){
  const task=state.tasks.get(key);if(!task)return;
  Object.assign(task,changes);state.tasks.set(key,task);syncTaskButtons();
}
async function runButtonTask(el,key,runner,{label='',buttonLabel=''}={}){
  key=key||taskButtonKey(el);if(state.tasks.get(key)?.status==='running')return;
  const task={key,status:'running',label:label||taskLabelFor(key),buttonLabel:buttonLabel||label||taskLabelFor(key),detail:'',progress:null,startedAt:Date.now()};
  state.tasks.set(key,task);syncTaskButtons();
  try{return await runner(task);}catch(error){showToast(error?.message||'The operation failed.');throw error;}finally{state.tasks.delete(key);syncTaskButtons();}
}
async function runBackgroundTask(key,label,runner){
  if(state.tasks.get(key)?.status==='running')return;
  state.tasks.set(key,{key,status:'running',label,buttonLabel:label,detail:'',progress:null,startedAt:Date.now()});syncTaskButtons();
  try{await runner();updateTask(key,{detail:'Synced',progress:100});await new Promise(resolve=>setTimeout(resolve,450));}
  catch(error){showToast(`${label}: ${error?.message||'sync failed'}`);}
  finally{state.tasks.delete(key);syncTaskButtons();}
}
function setOperationMessage(scope,message){
  const property={episodes:'syncMessage',trakt:'traktMessage',plex:'plexMessage',artwork:'artworkMessage',cloud:null}[scope];
  if(property)state[property]=message;
  const selectors={episodes:'#episodeLoadStatus',trakt:'#traktOperationMessage',plex:'#plexOperationMessage',artwork:'#artworkOperationMessage',cloud:'#cloudOperationMessage'};
  let node=document.querySelector(selectors[scope]);
  if(!node&&scope==='episodes'){
    const host=document.querySelector('.exactCoverageBar>div');if(host){host.insertAdjacentHTML('beforeend','<div class="syncProgress" id="episodeLoadStatus"></div>');node=document.querySelector('#episodeLoadStatus');}
  }
  if(node){node.textContent=message||'';node.hidden=!message;}
}
function renderModalOnly(){
  const existing=document.querySelector('.modalBackdrop'),html=modal();
  if(existing&&html)existing.outerHTML=html;else if(existing)existing.remove();else if(html)app.insertAdjacentHTML('beforeend',html);
  document.body.classList.toggle('modalOpen',Boolean(state.modal));bind();renderToast();syncTaskButtons();
}
function closeModalOnly(){state.modal=null;document.querySelector('.modalBackdrop')?.remove();document.body.classList.remove('modalOpen');}
function patchConnectionIndicators(){document.querySelector('.connectionDot')?.classList.toggle('online',traktConnected()||plexConnected());}
function visualStateSignature(){
  return JSON.stringify([state.statuses,state.reviews,state.settings,state.plexData.matches||[],Boolean(state.trakt.cloudConnected),Boolean(state.plexData.cloudConnected)]);
}

async function apiJson(response, fallback='Request failed.') {
  const text=await response.text().catch(()=> '');
  let data={};
  if(text){try{data=JSON.parse(text);}catch{data={error:text.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,500)};}}
  if(!response.ok)throw new Error(data.error_description||data.error||data.message||`${fallback} (${response.status})`);
  return data;
}

function defaultFilters(){return {query:'',region:'',promotion:'',kind:'',yearFrom:'1970',yearTo:'',wrestler:'',availability:'',hideWatched:false};}
function companyArtworkKey(id){return `company:${id}`;}
function wrestlerArtworkKey(name){return `wrestler:${name}`;}
function hasArtworkResult(value){return Boolean(value&&(value.poster||value.backdrop||value.still||value.logo||value.headshot));}
function artworkLookupAllowed(key){const value=state.artworkCache[key];return !value?.notFoundUntil||Date.parse(value.notFoundUntil)<Date.now();}
function companyArtworkCandidates(promotionId){
  const p=promotion(promotionId);if(!p)return [];
  const local=state.artworkCache[companyArtworkKey(p.id)]||{};
  return [
    p.logo&&{url:p.logo,type:'logo',label:'Company logo',sourceUrl:p.logoSourceUrl},
    local.logo&&{url:local.logo,type:'logo',label:local.source||'Scanned company logo',sourceUrl:local.sourceUrl,cacheKey:companyArtworkKey(p.id)},
    local.poster&&{url:local.poster,type:'logo',label:local.source||'Scanned company image',sourceUrl:local.sourceUrl,cacheKey:companyArtworkKey(p.id)}
  ].filter(Boolean);
}
function wrestlerHeadshotCandidate(name){
  const local=state.artworkCache[wrestlerArtworkKey(name)]||{};
  const url=local.headshot||local.poster||'';
  return url?{url:displayArtworkUrl(url),label:local.source||'Wrestler headshot',sourceUrl:local.sourceUrl}:null;
}
function artworkLookupImage(kind,title,aliases=[]){
  const params=new URLSearchParams({render:'1',kind,title});
  if(aliases.length)params.set('aliases',aliases.slice(0,4).join('|'));
  return `./api/artwork/search?${params.toString()}`;
}
function officialSiteIcon(url){try{return url?new URL('/favicon.ico',url).href:'';}catch{return '';}}
function companyLogo(p,context='companyLogo'){
  const image=companyArtworkCandidates(p?.id)[0];
  const source=image?.url?displayArtworkUrl(image.url):artworkLookupImage('company',p?.name||p?.shortName||'Wrestling promotion',[p?.shortName,...(p?.aliases||[])].filter(Boolean));
  return `<div class="${context} hasImage" data-artwork-key="${h(companyArtworkKey(p?.id||''))}" style="--accent:${h(p?.color||'#d7a84f')}"><img src="${h(source)}" alt="${h(p?.name||'Promotion')} logo" loading="lazy" decoding="async" fetchpriority="low" referrerpolicy="no-referrer" onerror="this.remove();this.parentElement?.classList.remove('hasImage')"><span>${h(p?.shortName||'RA')}</span></div>`;
}
function wrestlerHeadshot(name,priority='lazy'){
  const image=wrestlerHeadshotCandidate(name);
  const source=image?.url||artworkLookupImage('wrestler',name);
  return `<div class="wrestlerHeadshot hasImage" data-artwork-key="${h(wrestlerArtworkKey(name))}"><img src="${h(source)}" alt="${h(name)} headshot" loading="${priority==='eager'?'eager':'lazy'}" decoding="async" fetchpriority="${priority==='eager'?'high':'low'}" referrerpolicy="no-referrer" onerror="this.remove();this.parentElement?.classList.remove('hasImage')"><span>${h(name.split(/\s+/).map(x=>x[0]).join('').slice(0,3))}</span></div>`;
}

function rebuildWrestlerIndex(){
  if(!state.data)return;
  const profiles=new Map(state.data.wrestlers.map(name=>[name,{name,normalized:normalize(name),events:new Map(),picks:new Map(),sourceRatings:[],programmeIds:new Set()}]));
  const normalizedProfiles=new Map([...profiles.values()].map(profile=>[profile.normalized,profile]));
  const addRecord=(profile,record)=>{
    if(!profile||!record)return;
    const key=statusKey(record);
    profile.events.set(key,{...record,_type:'event'});
    if(record.programId)profile.programmeIds.add(record.programId);
    const rating=Number(record.rating);
    if(Number.isFinite(rating)&&rating>0)profile.sourceRatings.push(rating);
  };
  const records=[...state.data.majorEvents,...state.data.customRecords,...allLoadedEpisodes()];
  for(const record of records){
    const details=detailsFor(record,state.data);
    const candidates=[...(record.wrestlers||[]),...(details.competitors||[])];
    const matched=new Set();
    for(const candidate of candidates){
      const normalized=normalize(candidate);
      const exact=normalizedProfiles.get(normalized);
      if(exact){addRecord(exact,record);matched.add(exact.name);continue;}
      for(const profile of profiles.values()){
        if(matched.has(profile.name))continue;
        if(normalized===profile.normalized||normalized.includes(profile.normalized)||profile.normalized.includes(normalized)){
          addRecord(profile,record);matched.add(profile.name);
        }
      }
    }
  }
  for(const pick of state.data.recommendations){
    for(const name of pick.wrestlers||[]){
      const profile=profiles.get(name)||normalizedProfiles.get(normalize(name));
      if(profile){profile.picks.set(pick.id,{...pick,_type:'pick'});if(pick.programId)profile.programmeIds.add(pick.programId);}
    }
  }
  for(const profile of profiles.values()){
    const unique=new Map();
    for(const item of [...profile.events.values(),...profile.picks.values()]){
      const dedupe=`${item.date||''}:${normalize(item.title||item.event||item.id)}`;
      const existing=unique.get(dedupe);
      if(!existing||item._type==='pick')unique.set(dedupe,item);
    }
    profile.items=[...unique.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date)));
    profile.appearances=profile.events.size;profile.curated=profile.picks.size;
  }
  state.wrestlerIndex=profiles;
}

function wrestlerMetrics(profile){
  const ratings=[...profile.sourceRatings];
  for(const [key] of profile.events){const rating=Number(state.reviews[key]?.rating);if(Number.isFinite(rating)&&rating>0)ratings.push(rating);}
  for(const pick of profile.picks.values()){
    const stars=Number(pick.archiveStars);
    if(Number.isFinite(stars)&&stars>0)ratings.push(stars*2);
  }
  const average=ratings.length?ratings.reduce((sum,value)=>sum+value,0)/ratings.length:null;
  const prominence=Math.min(9.9,5.4+Math.log10(1+profile.appearances+profile.curated*5)*1.75);
  const archiveScore=average==null?prominence:(average*.82+prominence*.18);
  return {average,archiveScore,ratings:ratings.length,appearances:profile.appearances,curated:profile.curated};
}

function editorialStars(item){
  const personal=Number(state.reviews[statusKey(item)]?.rating);
  if(Number.isFinite(personal)&&personal>0)return {stars:Math.min(5,personal/2),label:'Your rating'};
  const source=Number(item.rating);
  if(Number.isFinite(source)&&source>0)return {stars:Math.min(5,source/2),label:'Source rating'};
  const recommendation=item._type==='pick'?item:state.data.recommendations.find(rec=>rec.programId===item.programId&&rec.date===item.date&&normalize(rec.title)===normalize(item.title));
  if(recommendation){
    const stars=Number(recommendation.archiveStars||4.25);
    return {stars:Math.min(5,Math.max(0,stars)),label:recommendation.ratingLabel||'Archive editorial rating'};
  }
  return {stars:Math.min(5,3.4+Math.log10(1+(item._type==='event'?2:1))*0.7),label:'Archive significance rating'};
}
function relatedArchiveRecord(item){
  if(item._type==='event')return item;
  const candidates=[...state.data.majorEvents,...state.data.customRecords,...allLoadedEpisodes()].filter(record=>record.date===item.date&&(record.programId===item.programId||record.promotionId===item.promotionId));
  return candidates.sort((a,b)=>{
    const as=normalize(`${a.title} ${a.mainEvent||''}`).includes(normalize(item.title))?1:0;
    const bs=normalize(`${b.title} ${b.mainEvent||''}`).includes(normalize(item.title))?1:0;
    return bs-as;
  })[0]||null;
}
function topMatchesForProfile(profile){
  if(!profile)return [];
  const rows=profile.items.map(item=>({...item,_stars:editorialStars(item)}));
  const seen=new Set();
  return rows.filter(item=>{
    const key=`${item.date||''}:${normalize(item.title||item.event||item.id)}`;
    if(seen.has(key))return false;seen.add(key);return true;
  }).sort((a,b)=>b._stars.stars-a._stars.stars||Number(b._type==='pick')-Number(a._type==='pick')||String(b.date).localeCompare(String(a.date))).slice(0,10);
}
function showsForProfile(profile){
  if(!profile)return [];
  return [...profile.programmeIds].map(id=>programme(id)).filter(Boolean).sort((a,b)=>a.firstAirDate.localeCompare(b.firstAirDate)||a.name.localeCompare(b.name));
}
function starMarkup(value){
  const stars=Math.max(0,Math.min(5,Number(value)||0));
  return `<span class="starScale" aria-label="${stars.toFixed(2)} out of 5 stars"><span style="--rating:${(stars/5*100).toFixed(1)}%">★★★★★</span><b>${stars.toFixed(2)}</b></span>`;
}

function setView(view) {
  state.view=view;state.visible=24;state.modal=null;
  history.replaceState(null,'',`${location.pathname}${location.search}#${view}`);
  render({preserveScroll:false});window.scrollTo?.({top:0,left:0,behavior:'auto'});
  if(['exact','chronology'].includes(view)&&state.settings.autoLoadEpisodes&&!state.autoEpisodeLoadStarted)onIdle(()=>loadAllEpisodes(false),900);
}

function accountConnected(){ return Boolean(state.cloud.user?.id); }
function traktConnected(){ return Boolean(state.trakt.accessToken || (state.trakt.cloudConnected && accountConnected())); }
function plexConnected(){ return Boolean(state.plexData.token || (state.plexData.cloudConnected && accountConnected())); }
async function accountHeaders(extra={}){ return accountConnected()?cloudApiHeaders(extra):extra; }
let cloudSyncTimer=null;
function scheduleCloudSync(){
  if(!accountConnected() || state.settings.cloudAutoSync===false)return;
  clearTimeout(cloudSyncTimer);cloudSyncTimer=setTimeout(()=>syncCloudNow({quiet:true}).catch(()=>{}),1200);
}
function refreshStateFromStorage(){
  state.statuses=storage.statuses();state.settings={autoLoadEpisodes:true,...storage.settings()};state.reviews=storage.reviews();state.feedMap=storage.feedMap();state.artworkCache=storage.artwork();
}

function refreshPlexIndex(){
  const built=buildPlexMatches(state.data,state.plexData.items||[],Number(state.settings.plexWatchedThreshold||0.9));
  state.plexMatches=new Set([...(state.plexData.matches||[]),...built.matches]);
  state.plexLinks=built.links;state.plexViewing=built.viewing;
  state.plexData.matches=[...state.plexMatches];
}
function plexAvailable(item){
  if(item?.isProgrammeIndex)return state.plexMatches.has(`program:${item.programId}`);
  return state.plexMatches.has(statusKey(item));
}
function plexItemFor(item){
  if(item?.isProgrammeIndex)return state.plexLinks.get(`program:${item.programId}`)||null;
  return state.plexLinks.get(statusKey(item))||null;
}
function plexProgressFor(item){ return state.plexViewing.get(statusKey(item)) || null; }

async function syncCloudNow({quiet=false}={}){
  if(!accountConnected()||state.cloud.syncing)return;
  const before=quiet?visualStateSignature():'';
  state.cloud.syncing=true;if(!quiet){state.cloud.message='Synchronizing account data…';setOperationMessage('cloud',state.cloud.message);}
  try{
    const remote=await pullCloudState();
    if(remote?.state)storage.mergeCloudState(remote.state);
    refreshStateFromStorage();refreshPlexIndex();
    const meta=storage.cloudMeta();
    const saved=await pushCloudState(storage.cloudState(),Math.max(Number(meta.revision||0),Number(remote?.revision||0)));
    storage.saveCloudMeta({revision:Number(saved?.revision||remote?.revision||0),lastSyncAt:new Date().toISOString(),dirty:false});
    state.cloud.message=`Synced ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
  }catch(error){state.cloud.message=error.message;if(!quiet)showToast(error.message);}
  finally{
    state.cloud.syncing=false;
    if(state.modal?.type==='account'||state.modal?.type==='connections')renderModalOnly();
    if(before!==visualStateSignature())renderViewOnly();
  }
}

function applyPublicIntegrations(integrations=[]){
  const trakt=integrations.find(x=>x.provider==='trakt');
  if(trakt)state.trakt={...state.trakt,accessToken:null,refreshToken:null,cloudConnected:Boolean(trakt.connected),cloud:true,account:trakt.account||null,expiresAt:trakt.expiresAt||null};
  else if(!state.trakt.accessToken)state.trakt={...state.trakt,cloudConnected:false,cloud:false,account:null};
  storage.saveTrakt(state.trakt);
  const plex=integrations.find(x=>x.provider==='plex');
  if(plex){
    state.plexData={...state.plexData,...plex,cloudConnected:Boolean(plex.connected),token:null};
    const serverId=plex.selectedServer?.machineIdentifier;
    if(serverId&&Array.isArray(plex.sections))state.plexData.sectionsByServer={...(state.plexData.sectionsByServer||{}),[serverId]:plex.sections};
  }else if(!state.plexData.token)state.plexData={...state.plexData,cloudConnected:false};
  state.plexData=storage.savePlexData(state.plexData);refreshPlexIndex();
}
async function loadAccountIntegrations({migrate=true}={}){
  if(!accountConnected())return;
  try{
    const data=await loadCloudIntegrations();const integrations=data.integrations||[];applyPublicIntegrations(integrations);
    const hasTrakt=integrations.some(x=>x.provider==='trakt'&&x.connected),hasPlex=integrations.some(x=>x.provider==='plex'&&x.connected);
    if(migrate && !hasTrakt && state.trakt.accessToken){await saveCloudIntegration('trakt',state.trakt);}
    if(migrate && !hasPlex && state.plexData.token){await saveCloudIntegration('plex',state.plexData);}
    if(migrate && ((!hasTrakt&&state.trakt.accessToken)||(!hasPlex&&state.plexData.token))){const refreshed=await loadCloudIntegrations();applyPublicIntegrations(refreshed.integrations||[]);}
    state.cloud.integrationsLoaded=true;
  }catch(error){state.cloud.message=`Integration sync: ${error.message}`;}
}
async function finishAccountLogin(){
  state.cloud.user=await getCloudUser();
  if(!state.cloud.user)throw new Error('The account session could not be verified.');
  const switched=storage.prepareForAccount(state.cloud.user.id);
  if(switched){refreshStateFromStorage();state.plexData=storage.plexData();state.trakt=storage.trakt();refreshPlexIndex();}
  await syncCloudNow({quiet:true});await loadAccountIntegrations({migrate:true});
  state.cloud.message='Account connected across devices.';renderViewOnly();if(state.modal)renderModalOnly();
}
function normalizeFreeLinkEntry(value){
  if(!value)return null;
  if(typeof value==='string')return {url:value,label:'Watch free',service:'Free stream'};
  return value?.url?value:null;
}
function isSpecificFreeUrl(value){
  const url=String(value||'').trim();if(!url)return false;
  try{
    const parsed=new URL(url),host=parsed.hostname.toLowerCase().replace(/^www\./,'');
    const path=parsed.pathname.replace(/\/+$/,'')||'/';
    if(host==='youtu.be')return path.length>2;
    if(host==='youtube.com'||host==='m.youtube.com'){
      if(path==='/watch')return Boolean(parsed.searchParams.get('v'));
      if(path==='/playlist')return Boolean(parsed.searchParams.get('list'));
      return /^\/(live|shorts)\/[^/]+/.test(path);
    }
    if(host==='archive.org')return /^\/details\/[^/]+/.test(path);
    if(host==='dailymotion.com'||host==='dai.ly')return /\/(video\/)?[^/]+/.test(path)&&path!=='/';
    if(host==='vimeo.com')return /^\/\d+/.test(path);
    if(host==='vk.com')return /^\/video[-\d_]+/.test(path)||parsed.searchParams.has('z');
    if(host.endsWith('twitch.tv'))return /^\/videos\/\d+/.test(path);
    // Other official free platforms are allowed only when they point below the site root
    // and are not search, channel, account or category landing pages.
    if(path==='/'||/\/(search|results|channel|channels|user|users|category|categories)\/?$/i.test(path))return false;
    return path.split('/').filter(Boolean).length>=2;
  }catch{return false;}
}
function recommendationMatchForRecord(item){
  if(!item?.date)return null;
  const candidates=state.data.recommendationsByDate.get(item.date)||[];
  const itemText=normalize(`${item.title||''} ${item.mainEvent||''} ${item.description||''}`);
  return candidates.find(rec=>{
    if(rec.programId&&item.programId&&rec.programId!==item.programId)return false;
    const title=normalize(rec.title||rec.event||'');
    const words=title.split(' ').filter(word=>word.length>3);
    return title&&((itemText.includes(title)||title.includes(normalize(item.title||'')))||(words.length&&words.filter(word=>itemText.includes(word)).length>=Math.min(3,words.length)));
  })||null;
}
function specificFreeLinkFor(item,{programmeEntry=false,recommendation=false}={}){
  if(!item||!state.data?.freeLinks)return null;
  let entry=null;
  if(recommendation||item._type==='pick')entry=normalizeFreeLinkEntry(state.data.freeLinks.recommendations?.[item.id]);
  else if(programmeEntry||item.isProgrammeIndex)entry=normalizeFreeLinkEntry(state.data.freeLinks.programmes?.[item.id||item.programId]);
  else{
    entry=normalizeFreeLinkEntry(state.data.freeLinks.records?.[item.id]);
    if(!entry){const rec=recommendationMatchForRecord(item);if(rec)entry=normalizeFreeLinkEntry(state.data.freeLinks.recommendations?.[rec.id]);}
  }
  if(!entry){
    const direct=normalizeFreeLinkEntry(item.watchUrl||item.freeUrl||item.youtubeUrl);
    if(direct&&isSpecificFreeUrl(direct.url))entry=direct;
  }
  return entry&&isSpecificFreeUrl(entry.url)?entry:null;
}
function freeLinkAnchor(entry,label='Watch free ↗'){
  if(!entry)return '';
  const text=entry.label?`${entry.label} ↗`:label;
  return `<a class="freeWatchLink" href="${h(entry.url)}" target="_blank" rel="noreferrer noopener" title="${h(entry.publisher||entry.service||'Verified free source')}">${h(text)}</a>`;
}

function setStatus(key, status, options={}) {
  if (status === 'unwatched') delete state.statuses[key]; else state.statuses[key] = status;
  storage.saveStatuses(state.statuses,key);scheduleCloudSync();
  const item=recordByKey(key);
  if(item && options.syncExternal!==false && traktConnected() && (status==='watched'||status==='unwatched'))runBackgroundTask(`status-trakt:${key}`,'Syncing Trakt',()=>syncStatusToTrakt(item,status));
  if(item && options.syncExternal!==false && state.settings.pushWatchedToPlex && plexAvailable(item) && (status==='watched'||status==='unwatched'))runBackgroundTask(`status-plex:${key}`,'Syncing Plex',()=>syncStatusToPlex(item,status));
  renderViewOnly();if(state.modal)renderModalOnly();
}

function yearMatches(item){
  const year=yearOf(item.date || item.firstAirDate), from=Number(state.filters.yearFrom)||0, to=Number(state.filters.yearTo)||9999;
  return (!from || year>=from) && (!to || year<=to);
}
function competitorsFor(item){ return detailsFor(item,state.data).competitors; }
function matchFilters(item, type='record') {
  const f=state.filters, isProgrammeEntry=type==='programme'||item.isProgrammeIndex, p=promotion(item.promotionId), prog=isProgrammeEntry?(item.isProgrammeIndex?programme(item.programId):item):programme(item.programId);
  if (f.region && p?.region !== f.region) return false;
  if (f.promotion && item.promotionId !== f.promotion) return false;
  if (f.kind && item.kind !== f.kind) return false;
  if (!yearMatches(item)) return false;
  if (f.hideWatched && currentStatus(isProgrammeEntry?`program:${prog.id}`:statusKey(item)) === 'watched') return false;
  if (f.availability === 'youtube' && !specificFreeLinkFor(item,{programmeEntry:isProgrammeEntry})) return false;
  if (f.availability === 'plex' && !(isProgrammeEntry?state.plexMatches.has(`program:${prog.id}`):plexAvailable(item))) return false;
  if (f.availability === 'tvmaze' && !(item.tvMazeId || prog?.tvMazeId || state.feedMap[prog?.id] || String(item.id).startsWith('tvmaze:'))) return false;
  if (f.availability === 'recommended' && !state.data.recommendationsByProgramme.has(item.programId || item.id)) return false;
  if (f.availability === 'artwork' && !artworkCandidates(isProgrammeEntry?prog:item,isProgrammeEntry).length) return false;
  if (f.availability === 'missing-artwork' && artworkCandidates(isProgrammeEntry?prog:item,isProgrammeEntry).length) return false;
  if (f.wrestler) {
    const hay=normalize([item.title,item.name,item.event,item.mainEvent,item.description,item.why,competitorsFor(item).join(' ')].join(' '));
    if (!hay.includes(normalize(f.wrestler))) return false;
  }
  if (f.query) {
    const hay=normalize([item.title,item.name,item.event,item.mainEvent,item.description,item.location,item.venue,p?.name,p?.shortName,prog?.name,competitorsFor(item).join(' ')].join(' '));
    if (!hay.includes(normalize(f.query))) return false;
  }
  return true;
}

function overrideArtwork(item){
  const value=state.data.artworkOverrides[item.id] || state.data.artworkOverrides[item.programId];
  if(!value)return [];
  if(typeof value==='string')return [{url:value,type:'poster',label:'Verified override'}];
  if(Array.isArray(value))return value.map(x=>typeof x==='string'?{url:x,type:'poster',label:'Verified override'}:x);
  return [value.url&&{url:value.url,type:value.type||'poster',label:value.label||'Verified override',sourceUrl:value.sourceUrl},...(value.images||[])].filter(Boolean);
}
function catalogArtwork(item,isProgramme=false){
  const catalog=state.data.artworkCatalog||{};
  if(isProgramme)return catalog.programmes?.[item.id]||{};
  if(item.kind==='episode')return catalog.episodes?.[`${item.programId}:${item.season}:${item.number}`]||{};
  return catalog.records?.[item.id]||{};
}
function displayArtworkUrl(value){
  const url=String(value||'');
  if(!url)return '';
  try{
    const parsed=new URL(url,location.href);
    if(parsed.origin===location.origin)return parsed.href;
    const host=parsed.hostname.toLowerCase();
    if(host==='image.tmdb.org'||host==='static.tvmaze.com'||host==='upload.wikimedia.org'||host.endsWith('.wikimedia.org')||host.endsWith('.wikipedia.org')){
      return `./api/artwork/search?asset=${encodeURIComponent(parsed.href)}`;
    }
    return parsed.href;
  }catch{return url;}
}
function matchedPlexItems(built){
  const seen=new Set(),items=[];
  for(const item of built.links.values()){
    const key=String(item?.ratingKey||`${item?.machineIdentifier||''}:${item?.library||''}:${item?.title||''}:${item?.parentIndex||''}:${item?.index||''}`);
    if(!item||seen.has(key))continue;seen.add(key);items.push(item);
  }
  return items;
}
function artworkCandidates(item,isProgramme=false){
  if(!item)return [];
  const key=isProgramme?`program:${item.id}`:statusKey(item);
  const local=state.artworkCache[key]||state.artworkCache[item.id]||{};
  const catalog=catalogArtwork(item,isProgramme);
  const plex=plexItemFor(item);
  const values=[
    ...overrideArtwork(item),
    item.artwork&&{url:item.artwork,type:item.kind==='episode'?'episode':'poster',label:item.sourceLabel||'Source artwork'},
    item.showArtwork&&{url:item.showArtwork,type:'show',label:'Show artwork'},
    state.showArtwork.get(item.programId||item.id)&&{url:state.showArtwork.get(item.programId||item.id),type:'show',label:'TVMaze show artwork'},
    catalog.poster&&{url:catalog.poster,type:'poster',label:catalog.source||'Catalogue poster',sourceUrl:catalog.sourceUrl},
    catalog.backdrop&&{url:catalog.backdrop,type:'backdrop',label:catalog.source||'Catalogue backdrop',sourceUrl:catalog.sourceUrl},
    catalog.still&&{url:catalog.still,type:'episode',label:catalog.source||'Episode still',sourceUrl:catalog.sourceUrl},
    local.poster&&{url:local.poster,type:'poster',label:local.source||'Scanned poster',sourceUrl:local.sourceUrl,cacheKey:key},
    local.backdrop&&{url:local.backdrop,type:'backdrop',label:local.source||'Scanned backdrop',sourceUrl:local.sourceUrl,cacheKey:key},
    local.still&&{url:local.still,type:'episode',label:local.source||'Scanned still',sourceUrl:local.sourceUrl,cacheKey:key},
    plex?.thumbUrl&&{url:plex.thumbUrl,type:item.kind==='episode'?'episode':'poster',label:'Plex artwork'},
    plex?.artUrl&&{url:plex.artUrl,type:'backdrop',label:'Plex background'}
  ].filter(Boolean);
  const seen=new Set();return values.map(value=>({...value,url:displayArtworkUrl(value.url)})).filter(value=>value.url&&!seen.has(value.url)&&(seen.add(value.url),true));
}
function artwork(item, context='card', isProgramme=false) {
  const p=promotion(item.promotionId), candidates=artworkCandidates(item,isProgramme),key=isProgramme?`program:${item.id}`:statusKey(item);
  const src=candidates.find(x=>item.kind==='episode'&&x.type==='episode')?.url || candidates.find(x=>x.type==='poster')?.url || candidates[0]?.url || '';
  const title=item.title||item.name;
  return `<div class="artwork ${context} ${src?'hasImage':''}" data-artwork-key="${h(key)}" data-artwork-context="${h(context)}" data-artwork-programme="${isProgramme?'1':'0'}" style="--accent:${h(p?.color||'#d7a84f')}"><div class="artworkFallback artworkInner"><span>${h(p?.shortName||'Archive')}</span><strong>${h(title)}</strong></div>${src?`<img loading="lazy" decoding="async" fetchpriority="low" src="${h(src)}" alt="${h(title)} artwork" referrerpolicy="no-referrer" onerror="this.remove();this.parentElement?.classList.remove('hasImage')"/>`:''}</div>`;
}
function artworkGallery(item,isProgramme=false){
  const candidates=artworkCandidates(item,isProgramme);
  if(!candidates.length)return `<div class="sourceEmpty"><div><h4>No verified artwork found yet</h4><p>Use the no-key Wikipedia/Wikimedia scanner, add a TMDB key for richer season/episode art, import Plex, or add a verified override.</p></div><button data-scan-art="${h(isProgramme?`program:${item.id}`:statusKey(item))}">Scan artwork</button></div>`;
  return `<div class="artworkGallery">${candidates.map(image=>`<figure><img src="${h(image.url)}" alt="${h(image.label||'Artwork')}" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('figure')?.remove()"><figcaption>${image.sourceUrl?`<a href="${h(image.sourceUrl)}" target="_blank" rel="noreferrer">${h(image.label||image.type||'Artwork')} ↗</a>`:h(image.label||image.type||'Artwork')}${image.cacheKey?`<button class="textButton" data-reject-art="${h(image.cacheKey)}">Wrong image</button>`:''}</figcaption></figure>`).join('')}</div>`;
}

function artworkSourceForKey(key){
  if(key.startsWith('company:')){
    const p=promotion(key.slice(8)),candidate=companyArtworkCandidates(p?.id)[0];
    return candidate?.url?displayArtworkUrl(candidate.url):'';
  }
  if(key.startsWith('wrestler:'))return wrestlerHeadshotCandidate(key.slice(9))?.url||'';
  const entry=artworkEntryForKey(key);if(!entry)return '';
  const candidates=artworkCandidates(entry.item,key.startsWith('program:'));
  return candidates.find(candidate=>entry.item.kind==='episode'&&candidate.type==='episode')?.url||candidates.find(candidate=>candidate.type==='poster')?.url||candidates[0]?.url||'';
}
function patchArtworkElements(keys=[]){
  for(const key of new Set(keys.filter(Boolean))){
    const source=artworkSourceForKey(key);if(!source)continue;
    for(const node of document.querySelectorAll(`[data-artwork-key="${CSS.escape(key)}"]`)){
      node.querySelector('img')?.remove();
      const image=document.createElement('img');image.src=source;image.loading='lazy';image.decoding='async';image.referrerPolicy='no-referrer';image.alt='Verified artwork';
      image.onerror=()=>{image.remove();node.classList.remove('hasImage');};node.classList.add('hasImage');node.append(image);
    }
  }
}

function topbar() {
  return `<header class="topbar">
    <button class="brand" data-view="exact"><span class="brandMark">RA</span><span><strong>Ringside Archive</strong><small>Professional Wrestling Watch Tracker</small></span></button>
    <nav aria-label="Primary navigation">${navItems.map(([id,ic,label])=>`<button data-view="${id}" class="${state.view===id?'active':''}"><span class="navIcon">${icon(ic)}</span>${label}</button>`).join('')}</nav>
    <div class="topActions"><button class="accountButton" data-action="account"><span class="accountAvatar">${accountConnected()?h((state.cloud.user.email||'A').slice(0,1).toUpperCase()):'A'}</span>${accountConnected()?'Account synced':'Sign in'}</button><button class="connectionButton" data-action="connections"><span class="connectionDot ${traktConnected()||plexConnected()?'online':''}"></span>Connections</button><button class="primaryButton small" data-action="export">${icon('download')} Backup</button></div>
  </header>`;
}

function dashboard() {
  const records=exactRecords().filter(x=>matchFilters(x));
  const next=records.find(x=>currentStatus(statusKey(x))!=='watched') || records[0];
  const counts=state.data.meta.counts;
  const tracked=Object.keys(state.statuses).length, watched=Object.values(state.statuses).filter(x=>x==='watched').length;
  const percent=tracked ? Math.round(watched/tracked*100) : 0;
  if(!next) return '';
  const p=promotion(next.promotionId);
  return `<section class="dashboard">
    <article class="nextCard" style="--accent:${h(p?.color||'#d7a84f')}"><div class="nextContent"><div class="eyebrowRow"><span class="liveLabel"><i></i> Up next in chronology</span><span class="statusPill status-${currentStatus(statusKey(next))}">${statusLabels[currentStatus(statusKey(next))]}</span></div><span class="nextDate">${h(fmtDate(next.date))} • ${h(p?.shortName||'')}</span><h1>${h(next.title)}</h1><p>${h(next.description||next.mainEvent||'Open the record for card details, competitors, artwork and review notes.')}</p><div class="heroMeta"><span>${h(next.kind)}</span>${next.venue?`<span>${h(next.venue)}</span>`:''}${plexAvailable(next)?'<span>Plex available</span>':''}</div><div class="heroActions"><button class="primaryButton" data-open-record="${h(next.id)}">${icon('play')} Open card</button><button data-status-key="${h(statusKey(next))}" data-status="watched">${icon('check')} Mark watched</button></div></div>${artwork(next,'heroArtwork')}</article>
    <aside class="progressCard"><div class="progressHeading"><div><span class="eyebrow">Your archive</span><h2>Viewing progress</h2></div><strong>${percent}%</strong></div><div class="progressTrack"><span style="width:${percent}%"></span></div><div class="metricGrid"><div><strong>${counts.promotions}</strong><span>Promotions</span></div><div><strong>${counts.programmes}</strong><span>Programme families</span></div><div><strong>${counts.majorEvents}</strong><span>Dated major events</span></div><div><strong>${allLoadedEpisodes().length.toLocaleString()}</strong><span>Exact episodes</span></div></div><div class="connectionRail"><span class="${traktConnected()?'ready':''}"><b>T</b> Trakt</span><span class="${plexConnected()||state.plexMatches.size?'ready':''}"><b>›</b> Plex</span><span class="${state.autoEpisodeLoadComplete?'ready':''}"><b>TV</b> Episode feeds</span><span class="ready"><b>▶</b> Exact free links</span></div></aside>
  </section>`;
}

function catalogueStatement(){
  const byRegion=state.data.promotions.reduce((a,p)=>((a[p.region]??=[]).push(p),a),{});
  return `<section class="catalogueStatement"><div><span class="eyebrow">Verified programme catalogue</span><h2>From territory television to global streaming</h2><p>${state.data.programmes.length} actual television, streaming and event-series families are indexed. Promotion-level “master index” placeholders have been removed: companies now serve as the promotion hubs, while Complete Timeline contains only real dated episodes and events.</p></div><div class="statementStats"><span><strong>${byRegion['United States']?.length||0}</strong> U.S.</span><span><strong>${byRegion['Japan']?.length||0}</strong> Japan</span><span><strong>${byRegion['United Kingdom & Europe']?.length||0}</strong> UK / Europe</span><span><strong>${(byRegion['Mexico & Latin America']?.length||0)+(byRegion['Canada']?.length||0)+(byRegion['Australia']?.length||0)}</strong> Other</span></div></section>`;
}

function select(key,label,empty,options,value){return `<label><span>${label}</span><select data-filter="${key}"><option value="">${empty}</option>${options.map(([v,l])=>`<option value="${h(v)}" ${String(value)===String(v)?'selected':''}>${h(l)}</option>`).join('')}</select></label>`;}
function activeFilterBar(){
  const f=state.filters, chips=[];
  const p=f.promotion?promotion(f.promotion):null;
  if(f.query)chips.push(['query',`Search: ${f.query}`]);
  if(f.region)chips.push(['region',f.region]);
  if(p)chips.push(['promotion',`Company: ${p.shortName}`]);
  if(f.kind)chips.push(['kind',`Format: ${state.data.formatLabels[f.kind]||f.kind}`]);
  if(f.wrestler)chips.push(['wrestler',`Wrestler: ${f.wrestler}`]);
  if((f.yearFrom&&f.yearFrom!=='1970')||f.yearTo)chips.push(['years',`${f.yearFrom||'Any'}–${f.yearTo||'Present'}`]);
  if(f.availability)chips.push(['availability',`Availability: ${f.availability.replace(/-/g,' ')}`]);
  if(f.hideWatched)chips.push(['hideWatched','Hide watched']);
  if(!chips.length)return '';
  return `<div class="activeFilters"><span>Active filters</span>${chips.map(([key,label])=>`<button type="button" data-clear-filter="${h(key)}">${h(label)} <b>×</b></button>`).join('')}<button type="button" class="clearAllFilters" data-action="reset-filters">Reset all</button></div>`;
}
function filterPanel(){
  const f=state.filters, regions=[...new Set(state.data.promotions.map(p=>p.region))].sort();
  const kinds=[...new Set([...state.data.programmes.map(p=>p.kind),...state.data.majorEvents.map(e=>e.kind),'episode'])].sort();
  return `<section class="filterPanel ${state.filtersOpen?'':'collapsed'}"><div class="filterTop"><label class="searchField"><span class="navIcon">${icon('search')}</span><input id="searchInput" placeholder="Search show, company, wrestler, match or event…" value="${h(f.query)}" /></label><button type="button" class="filterToggle" data-action="toggle-filters" aria-expanded="${state.filtersOpen}">${icon('filter')} Filters ${state.filtersOpen?'▴':'▾'}</button><div class="resultSummary"><strong id="resultCount">—</strong> results</div></div><div class="filterGrid" aria-hidden="${state.filtersOpen?'false':'true'}">
    ${select('region','Region','All regions',regions.map(x=>[x,x]),f.region)}
    ${select('promotion','Company','All companies',state.data.promotions.map(p=>[p.id,`${p.shortName} — ${p.name}`]),f.promotion)}
    ${select('kind','Format','All formats',kinds.map(x=>[x,state.data.formatLabels[x]||x]),f.kind)}
    <label><span>From year</span><input class="yearInput" data-filter="yearFrom" type="number" min="1930" max="2100" value="${h(f.yearFrom)}" placeholder="1970"></label>
    <label><span>To year</span><input class="yearInput" data-filter="yearTo" type="number" min="1930" max="2100" value="${h(f.yearTo)}" placeholder="Present"></label>
    ${select('wrestler','Wrestler','All wrestlers',state.data.wrestlers.map(x=>[x,x]),f.wrestler)}
    ${select('availability','Availability','Any availability',[['plex','Available in Plex'],['youtube','Exact free video/link'],['artwork','Has artwork'],['missing-artwork','Missing artwork'],['tvmaze','Exact episode feed'],['recommended','Curated recommendation']],f.availability)}
    <label class="checkField"><input data-filter="hideWatched" type="checkbox" ${f.hideWatched?'checked':''}/><span>Hide watched</span></label><button type="button" class="resetButton" data-action="reset-filters">Reset all</button>
  </div>${activeFilterBar()}</section>`;
}

function exactView(){
  const filtered=exactRecords().filter(x=>matchFilters(x));
  const visible=filtered.slice(0,state.visible);
  queueMicrotask(()=>{const el=document.querySelector('#resultCount');if(el)el.textContent=filtered.length.toLocaleString();});
  return `<div class="viewHeader"><div><span class="eyebrow">Individual dated records</span><h2>Exact episodes, PPVs & supercards</h2></div><div class="viewControls"><span>${allLoadedEpisodes().length.toLocaleString()} exact weekly episodes loaded</span></div></div>
  <section class="exactChronologyView"><div class="exactCoverageBar"><div><span class="eyebrow">Unified watch chronology</span><h3>Television, PPVs, PLEs, tournaments & supercards</h3><p>Only individually dated records appear here. Show landing pages and company hubs remain available in Show Index and Companies without occupying artificial dates in the chronology. Use filters for company, wrestler, date range, YouTube, Plex or artwork.</p>${state.syncMessage?`<div class="syncProgress" id="episodeLoadStatus">${h(state.syncMessage)}</div>`:''}</div><div class="coverageActions"><button data-action="reload-all-episodes">Refresh all exact feeds</button><button data-action="discover-feeds">Discover more feeds</button><button data-action="scan-visible-artwork">Scan visible artwork</button></div></div>
  <div class="exactRecordsList">${visible.map(exactCard).join('')||empty('No records match the current filters.','Reset the filters or widen the year range.',true)}</div>${filtered.length>state.visible?`<div class="loadMoreRow"><button data-action="load-more">Show ${Math.min(50,filtered.length-state.visible)} more</button></div>`:''}</section>`;
}

function exactCard(e){
  const p=promotion(e.promotionId), prog=programme(e.programId), key=statusKey(e), status=currentStatus(key), plex=plexAvailable(e), plexState=plexProgressFor(e), freeLink=specificFreeLinkFor(e);
  const details=detailsFor(e,state.data);
  return `<article class="exactRecordCard ${status==='watched'?'isWatched':''}" style="--accent:${h(p?.color||'#d7a84f')}" data-scroll-key="${h(key)}" data-open-record="${h(e.id)}" role="button" tabindex="0"><div class="exactRecordDate"><strong>${h(String(e.date).slice(0,4))}</strong><span>${h(fmtDate(e.date).replace(/, \d{4}$/,''))}</span><small>${h(e.kind)}</small></div>${artwork(e,'exactRecordArtwork')}<div class="exactRecordMain"><div class="programmeKicker"><span>${h(p?.shortName||'')}</span><span>•</span><span>${h(e.code||prog?.name||'Exact record')}</span><b>${String(e.id).startsWith('tvmaze:')?'Exact episode':'Verified date'}</b></div><h3>${h(e.title)}</h3>${prog?.name&&prog.name!==e.title?`<p class="eventName">${h(prog.name)}</p>`:''}<p>${h(e.description||e.mainEvent||'Open for verified match details, competitors and review notes.')}</p><div class="exactRecordFacts"><span>${h(fmtDate(e.date))}</span>${e.venue?`<span>${h(e.venue)}</span>`:''}${e.location?`<span>${h(e.location)}</span>`:''}${e.runtime?`<span>${e.runtime} min</span>`:''}${details.competitors.length?`<span>${details.competitors.length} competitors</span>`:''}</div><div class="availabilityLights"><span class="light ${plex?'pickLight':''}"><i></i> Plex${plex?(plexState?.watched?' watched':plexState?.progress?` ${Math.round(plexState.progress*100)}%`:' available'):''}</span><span class="light ${freeLink?'pickLight':''}"><i></i> Exact free link</span><span class="light ${artworkCandidates(e).length?'pickLight':''}"><i></i> Artwork</span></div></div><div class="exactRecordActions"><span class="statusPill status-${status}">${statusLabels[status]}</span><div class="recordStatus">${['watched','watching','skipped'].map(s=>`<button class="${status===s?'active':''}" data-status-key="${h(key)}" data-status="${s}">${s==='watched'?'✓ ':''}${statusLabels[s]}</button>`).join('')}</div>${plexLinkButton(e)}<button data-open-record="${h(e.id)}">View details</button></div></article>`;
}
function plexLinkButton(item){const plex=plexItemFor(item),server=state.plexData.selectedServer||state.plexData.servers?.find(x=>x.machineIdentifier===plex?.machineIdentifier),url=plexWebUrl(plex,server,state.settings.plexLanBaseUrl);return url?`<a href="${h(url)}" target="_blank" rel="noreferrer">Open in Plex LAN ↗</a>`:'';}

function chronologyView(){
  const filtered=state.data.programmes.filter(p=>matchFilters(p,'programme'));
  const items=filtered.slice(0,state.visible);
  queueMicrotask(()=>{const el=document.querySelector('#resultCount');if(el)el.textContent=filtered.length.toLocaleString();});
  return `<div class="viewHeader"><div><span class="eyebrow">Programme-first catalogue</span><h2>Weekly shows, television, streaming & event series</h2></div><div class="viewControls"><span>${state.data.programmes.length} total programme families</span></div></div><section class="programmeGrid">${items.map(programmeCard).join('')||empty('No programmes found.','Try another company, year range or search term.',true)}</section>${filtered.length>state.visible?`<div class="loadMoreRow"><button data-action="load-more">Show more</button></div>`:''}`;
}
function programmeCard(p){
  const company=promotion(p.promotionId), status=currentStatus(`program:${p.id}`), loaded=state.loadedEpisodes.get(p.id)?.length||0, mapped=p.tvMazeId||state.feedMap[p.id], freeLink=specificFreeLinkFor(p,{programmeEntry:true});
  return `<article class="programmeCard" style="--accent:${h(company?.color||'#d7a84f')}" data-scroll-key="program:${h(p.id)}" data-open-programme="${h(p.id)}" role="button" tabindex="0">${artwork(p,'programmeArtwork',true)}<div class="programmeCardBody"><div class="programmeKicker"><span>${h(company?.shortName||'')}</span><span>•</span><span>${h(state.data.formatLabels[p.kind]||p.kind)}</span></div><h3>${h(p.name)}</h3><p>${h(p.description)}</p><div class="heroMeta"><span>${h(p.firstAirDate)}${p.endDate?` – ${h(p.endDate)}`:''}</span><span>${h(p.cadence)}</span>${mapped?`<span class="statusPill status-watching">${loaded?`${loaded.toLocaleString()} episodes`:'Exact feed'}</span>`:'<span>Index only</span>'}</div><div class="programmeCardActions"><button data-open-programme="${h(p.id)}">Open show</button>${freeLink?freeLinkAnchor(freeLink):''}<button data-status-key="program:${h(p.id)}" data-status="${status==='watched'?'unwatched':'watched'}">${status==='watched'?'Unwatch':'Watched'}</button></div></div></article>`;
}

function companiesView(){
  const items=state.data.promotions.filter(p=>{
    if(state.filters.region&&p.region!==state.filters.region)return false;
    if(state.filters.promotion&&p.id!==state.filters.promotion)return false;
    if(state.filters.query&&!normalize(`${p.name} ${p.shortName} ${p.description}`).includes(normalize(state.filters.query)))return false;
    return true;
  }).sort((a,b)=>a.shortName.localeCompare(b.shortName));
  const visibleItems=items.slice(0,state.visible);
  const programmeCounts=new Map(),eventCounts=new Map(),episodeCounts=new Map();
  for(const row of state.data.programmes)programmeCounts.set(row.promotionId,(programmeCounts.get(row.promotionId)||0)+1);
  for(const row of state.data.majorEvents)eventCounts.set(row.promotionId,(eventCounts.get(row.promotionId)||0)+1);
  for(const row of allLoadedEpisodes())episodeCounts.set(row.promotionId,(episodeCounts.get(row.promotionId)||0)+1);
  queueMicrotask(()=>{const el=document.querySelector('#resultCount');if(el)el.textContent=items.length.toLocaleString();});
  return `<div class="viewHeader"><div><span class="eyebrow">Promotion directory</span><h2>Companies, territories & lineages</h2></div><div class="viewControls"><button type="button" data-action="scan-visible-artwork">Scan visible logos</button></div></div><section class="cardGrid companyDirectory">${visibleItems.map(p=>`<article class="companyCard" style="--accent:${h(p.color)}">${companyLogo(p)}<div class="companySwatch"></div><span class="eyebrow">${h(p.region)}</span><h3>${h(p.shortName)}</h3><strong>${h(p.name)}</strong><p>${h(p.description)}</p><div class="heroMeta"><span>${programmeCounts.get(p.id)||0} programmes</span><span>${eventCounts.get(p.id)||0} events</span><span>${(episodeCounts.get(p.id)||0).toLocaleString()} episodes</span></div><div class="cardActions"><button type="button" data-company="${h(p.id)}">Open chronology</button>${p.officialUrl?`<a href="${h(p.officialUrl)}" target="_blank" rel="noreferrer">Official ↗</a>`:''}${p.youtubeUrl?`<a href="${h(p.youtubeUrl)}" target="_blank" rel="noreferrer">Official channel ↗</a>`:''}</div></article>`).join('')}</section>${items.length>visibleItems.length?`<div class="loadMoreRow"><button type="button" data-action="load-more">Show ${Math.min(50,items.length-visibleItems.length)} more companies</button></div>`:''}`;
}

function recommendedView(){
  const filtered=state.data.recommendations.filter(x=>matchFilters(x)),items=filtered.slice(0,state.visible);
  queueMicrotask(()=>{const el=document.querySelector('#resultCount');if(el)el.textContent=filtered.length.toLocaleString();});
  return `<div class="viewHeader"><div><span class="eyebrow">Curated paths</span><h2>Recommended matches, events & episodes</h2></div></div><section class="cardGrid">${items.map(x=>{const p=promotion(x.promotionId),key=`recommendation:${x.id}`,st=currentStatus(key),freeLink=specificFreeLinkFor(x,{recommendation:true});return `<article class="recommendationCard" style="--accent:${h(p?.color||'#d7a84f')}"><span class="eyebrow">${h(fmtDate(x.date))} • ${h(p?.shortName||'')}</span><h3>${h(x.title)}</h3><strong>${h(x.event)}</strong><div class="topMatchRating">${starMarkup(Number(x.archiveStars||4.25))}<small>${h(x.ratingLabel||'Archive editorial rating')}</small></div><p>${h(x.why)}</p><div class="wrestlerTags">${(x.wrestlers||[]).map(w=>`<button data-wrestler="${h(w)}">${h(w)}</button>`).join('')}</div><div class="cardActions">${freeLink?freeLinkAnchor(freeLink):''}${x.sourceUrl?`<a href="${h(x.sourceUrl)}" target="_blank">Source ↗</a>`:''}<button data-status-key="${key}" data-status="${st==='watched'?'unwatched':'watched'}">${st==='watched'?'Watched ✓':'Mark watched'}</button></div></article>`}).join('')}</section>`;
}

function careerItems(wrestler){return state.wrestlerIndex.get(wrestler)?.items||[];}
function sortedWrestlerProfiles(){
  const query=normalize(state.filters.query);
  const profiles=[...state.wrestlerIndex.values()].filter(profile=>{
    if(query&&!profile.normalized.includes(query))return false;
    const customYear=(state.filters.yearFrom&&state.filters.yearFrom!=='1970')||state.filters.yearTo;
    if(state.filters.promotion||state.filters.region||state.filters.kind||customYear||state.filters.availability||state.filters.hideWatched){
      return profile.items.some(item=>matchFilters(item));
    }
    return true;
  });
  const metrics=new Map(profiles.map(profile=>[profile.name,wrestlerMetrics(profile)]));
  profiles.sort((a,b)=>{
    const am=metrics.get(a.name),bm=metrics.get(b.name);
    if(state.wrestlerSort==='name')return a.name.localeCompare(b.name);
    if(state.wrestlerSort==='appearances')return bm.appearances-am.appearances||bm.curated-am.curated||a.name.localeCompare(b.name);
    if(state.wrestlerSort==='curated')return bm.curated-am.curated||bm.appearances-am.appearances||a.name.localeCompare(b.name);
    return bm.archiveScore-am.archiveScore||bm.curated-am.curated||bm.appearances-am.appearances||a.name.localeCompare(b.name);
  });
  for(const profile of profiles)profile.currentMetrics=metrics.get(profile.name);
  return profiles;
}

function wrestlersView(){
  if(state.filters.wrestler)return wrestlerCareer(state.filters.wrestler);
  const profiles=sortedWrestlerProfiles(),items=profiles.slice(0,state.visible);
  queueMicrotask(()=>{const el=document.querySelector('#resultCount');if(el)el.textContent=profiles.length.toLocaleString();});
  return `<div class="viewHeader"><div><span class="eyebrow">Career viewing routes</span><h2>Follow a wrestler chronologically</h2><p class="viewIntro">Sorted by Archive score by default. Archive score combines available source ratings, your own ratings, curated picks and matched appearances; it is not an external public ranking.</p></div><div class="viewControls"><button type="button" data-action="scan-visible-artwork">Scan visible headshots</button><label class="sortControl"><span>Sort wrestlers</span><select data-wrestler-sort><option value="rating" ${state.wrestlerSort==='rating'?'selected':''}>Rating: high to low</option><option value="appearances" ${state.wrestlerSort==='appearances'?'selected':''}>Most appearances</option><option value="curated" ${state.wrestlerSort==='curated'?'selected':''}>Most curated picks</option><option value="name" ${state.wrestlerSort==='name'?'selected':''}>Name A–Z</option></select></label></div></div><section class="wrestlerDirectory">${items.map(profile=>{const metrics=profile.currentMetrics||wrestlerMetrics(profile);return `<button type="button" class="wrestlerButton" data-wrestler="${h(profile.name)}">${wrestlerHeadshot(profile.name)}<div class="wrestlerCardBody"><div class="wrestlerRating"><strong>${metrics.archiveScore.toFixed(1)}</strong><span>Archive score</span></div><h3>${h(profile.name)}</h3><p>${metrics.appearances.toLocaleString()} matched records • ${metrics.curated} curated picks</p><small>${metrics.ratings?`${metrics.ratings} source, personal or editorial ratings included`:'No direct ratings yet; score uses archive prominence'}</small></div></button>`}).join('')}</section>${profiles.length>state.visible?`<div class="loadMoreRow"><button type="button" data-action="load-more">Show ${Math.min(50,profiles.length-state.visible)} more wrestlers</button></div>`:''}`;
}
function wrestlerCareer(w){
  const profile=state.wrestlerIndex.get(w),metrics=profile?wrestlerMetrics(profile):null;
  const items=careerItems(w).filter(item=>matchFilters(item));
  const topMatches=topMatchesForProfile(profile);
  const shows=showsForProfile(profile);
  const visibleCareer=items.slice(0,Math.max(40,state.visible));
  return `<section class="wrestlerProfileHero"><div class="wrestlerProfilePortrait">${wrestlerHeadshot(w,'eager')}</div><div class="wrestlerProfileIntro"><span class="eyebrow">Career viewing route</span><h1>${h(w)}</h1>${metrics?`<div class="profileMetricRow"><span><strong>${metrics.archiveScore.toFixed(1)}</strong><small>Archive score</small></span><span><strong>${metrics.appearances}</strong><small>Matched records</small></span><span><strong>${metrics.curated}</strong><small>Curated classics</small></span><span><strong>${shows.length}</strong><small>Programme families</small></span></div>`:''}<p>Explore the highest-rated matches, then continue into every indexed programme and dated appearance in Ringside Archive.</p><div class="modalActions"><button type="button" data-action="clear-wrestler">Back to wrestler directory</button><button type="button" data-action="reset-filters">Reset all filters</button></div></div></section>
  <section class="profileFeatureSection"><div class="sectionHeading"><div><span class="eyebrow">Archive editorial selection</span><h2>Top ${Math.min(10,topMatches.length)} matches</h2></div><small>Stars combine stored source ratings, your ratings and clearly labelled Ringside editorial ratings.</small></div><div class="topMatchGrid">${topMatches.map((item,index)=>{const related=relatedArchiveRecord(item),prog=programme(item.programId),p=promotion(item.promotionId),rating=item._stars,freeLink=specificFreeLinkFor(item,{recommendation:item._type==='pick'});return `<article class="topMatchCard" style="--accent:${h(p?.color||'#d7a84f')}"><span class="topMatchRank">${String(index+1).padStart(2,'0')}</span><div><span class="eyebrow">${h(fmtDate(item.date))} • ${h(p?.shortName||'Archive')}</span><h3>${h(item.title)}</h3>${item.event?`<strong>${h(item.event)}</strong>`:''}${item.why?`<p>${h(item.why)}</p>`:''}<div class="topMatchRating">${starMarkup(rating.stars)}<small>${h(rating.label)}</small></div><div class="cardActions">${related?`<button data-open-record="${h(related.id)}">Open archive record</button>`:prog?`<button data-open-programme="${h(prog.id)}">Open show</button>`:''}${freeLink?freeLinkAnchor(freeLink):''}${item.sourceUrl?`<a href="${h(item.sourceUrl)}" target="_blank" rel="noreferrer">Source ↗</a>`:''}</div></div></article>`}).join('')||empty('No rated matches are indexed yet.','As curated recommendations and ratings are added, they will appear here.')}</div></section>
  <section class="profileFeatureSection"><div class="sectionHeading"><div><span class="eyebrow">Programme appearances</span><h2>Shows featuring ${h(w)}</h2></div><strong>${shows.length}</strong></div><div class="appearanceShowGrid">${shows.map(show=>{const company=promotion(show.promotionId);return `<button type="button" class="appearanceShowCard" data-open-programme="${h(show.id)}" style="--accent:${h(company?.color||'#d7a84f')}">${companyLogo(company,'appearanceCompanyLogo')}<span><small>${h(company?.shortName||'')}</small><strong>${h(show.name)}</strong><em>${h(show.firstAirDate)}${show.endDate?` – ${h(show.endDate)}`:''}</em></span></button>`}).join('')||'<p class="sourceNote">No programme-family links have been indexed for this wrestler yet.</p>'}</div></section>
  <section class="profileFeatureSection"><div class="sectionHeading"><div><span class="eyebrow">Full archive path</span><h2>Chronological appearances</h2></div><strong>${items.length}</strong></div><div class="careerTimeline">${visibleCareer.map(x=>x._type==='event'?exactCard(x):`<article class="careerCard"><span class="eyebrow">${h(fmtDate(x.date))} • Curated pick</span><h3>${h(x.title)}</h3><strong>${h(x.event)}</strong><div class="topMatchRating">${starMarkup(editorialStars(x).stars)}</div><p>${h(x.why)}</p><div class="cardActions">${programme(x.programId)?`<button data-open-programme="${h(x.programId)}">Open show</button>`:''}${(()=>{const link=specificFreeLinkFor(x,{recommendation:true});return link?freeLinkAnchor(link):'';})()}</div></article>`).join('')||empty('No exact matches under the current filters.','Reset the company/year filters or return to the wrestler directory.',true)}</div>${items.length>visibleCareer.length?`<div class="loadMoreRow"><button type="button" data-action="load-more">Show ${Math.min(50,items.length-visibleCareer.length)} more appearances</button></div>`:''}</section>`;
}

function libraryView(){
  const entries=[];
  for(const [key,status] of Object.entries(state.statuses)){
    if(state.libraryTab!=='all'&&status!==state.libraryTab)continue;
    if(key.startsWith('event:')||key.startsWith('episode:')){const item=recordByKey(key);if(item)entries.push({key,status,item});}
    else if(key.startsWith('program:')){const item=state.data.programmes.find(x=>`program:${x.id}`===key);if(item)entries.push({key,status,item,programme:true});}
    else if(key.startsWith('recommendation:')){const item=state.data.recommendations.find(x=>`recommendation:${x.id}`===key);if(item)entries.push({key,status,item,recommendation:true});}
  }
  return `<div class="viewHeader"><div><span class="eyebrow">Local-first owner library</span><h2>Your progress and availability</h2></div></div><section class="libraryView"><article class="librarySummaryCard"><div class="libraryPulse"><span class="online"></span></div><div><span class="eyebrow">${accountConnected()?'Cloud account + local cache':'Stored in this browser'}</span><h3>${Object.keys(state.statuses).length} tracked items</h3><p>${accountConnected()?'Progress, reviews, Plex snapshots and integration connections follow this Ringside account across devices.':'Sign in to a Supabase-backed Ringside account for automatic multi-device progress, Plex and Trakt synchronization.'}</p></div><div class="libraryTools"><button data-action="export">Export backup</button><button data-action="import-backup">Import backup</button><button data-action="account">${accountConnected()?'Sync account':'Sign in'}</button><button data-action="connections">Connections</button><button class="dangerButton" data-action="clear-progress">Clear progress</button></div></article><div class="statusTabs">${['all','watching','watched','skipped'].map(x=>`<button data-library-tab="${x}" class="${state.libraryTab===x?'active':''}">${x==='all'?'All':statusLabels[x]}</button>`).join('')}</div><div class="exactRecordsList">${entries.map(e=>e.programme?programmeCard(e.item):e.recommendation?`<article class="careerCard"><h3>${h(e.item.title)}</h3><p>${h(e.item.why)}</p><button data-status-key="${h(e.key)}" data-status="unwatched">Remove</button></article>`:exactCard(e.item)).join('')||empty('Your library is empty.','Mark a programme, episode or event as watching, watched or skipped.')}</div></section>`;
}
function empty(title,body,reset=false){return `<div class="emptyState"><h3>${h(title)}</h3><p>${h(body)}</p>${reset?`<button type="button" data-action="reset-filters">Reset all filters</button>`:''}</div>`;}

function modal(){
  const m=state.modal;if(!m)return '';
  if(m.type==='programme')return programmeModal(programme(m.id));
  if(m.type==='record')return recordModal(exactRecords().find(x=>String(x.id)===String(m.id)));
  if(m.type==='connections')return connectionsModal();
  if(m.type==='account')return accountModal();
  return '';
}
function modalShell(title,body,wide=false){return `<div class="modalBackdrop" data-action="close-modal"><section class="modalPanel ${wide?'wide':''}" role="dialog" aria-modal="true" aria-label="${h(title)}"><button class="modalClose" data-action="close-modal">×</button><header class="modalHeader"><span class="eyebrow">Ringside Archive</span><h2>${h(title)}</h2></header><div class="modalBody">${body}</div></section></div>`;}
function recordModal(item){
  if(!item)return '';
  const p=promotion(item.promotionId),prog=programme(item.programId),details=detailsFor(item,state.data),key=statusKey(item),review=state.reviews[key]||{},plex=plexItemFor(item),plexState=plexProgressFor(item),freeLink=specificFreeLinkFor(item);
  const matches=details.matches.length?`<ol class="matchCardList">${details.matches.map((match,index)=>`<li><span>${h(match.order||`Match ${index+1}`)}</span><strong>${h(match.match||match.description||'')}</strong>${match.result?`<p>${h(match.result)}</p>`:''}</li>`).join('')}</ol>`:`<div class="sourceEmpty"><div><h4>No verified match list attached yet</h4><p>The archive confirms the record and date, but the recovered source does not include its individual matches.</p></div></div>`;
  const status=currentStatus(key);
  return modalShell(item.title,`<div class="detailHero">${artwork(item,'detailArtwork')}<div class="detailHeroText"><div class="programmeKicker"><span>${h(p?.name||'')}</span><span>•</span><span>${h(prog?.name||item.kind)}</span></div><h2>${h(item.title)}</h2><p class="detailLead">${h(item.description||item.mainEvent||'Exact dated archive record.')}</p><div class="detailFacts"><span><small>Date</small><strong>${h(fmtDate(item.date))}</strong></span>${item.code?`<span><small>Episode</small><strong>${h(item.code)}</strong></span>`:''}${item.venue?`<span><small>Venue</small><strong>${h(item.venue)}</strong></span>`:''}${item.location?`<span><small>Location</small><strong>${h(item.location)}</strong></span>`:''}${item.runtime?`<span><small>Runtime</small><strong>${item.runtime} min</strong></span>`:''}${item.rating?`<span><small>Source rating</small><strong>${item.rating}/10</strong></span>`:''}${plexState?`<span><small>Plex state</small><strong>${plexState.watched?'Watched':`${Math.round(plexState.progress*100)}% viewed`}</strong></span>`:''}</div><div class="modalActions"><button data-status-key="${h(key)}" data-status="${status==='watched'?'unwatched':'watched'}">${status==='watched'?'Remove watched':'Mark watched'}</button>${item.sourceUrl?`<a href="${h(item.sourceUrl)}" target="_blank">Source ↗</a>`:''}${freeLink?freeLinkAnchor(freeLink):''}${plex?plexLinkButton(item):''}</div></div></div>
    <section class="detailSection"><div class="sectionHeading"><div><span class="eyebrow">${details.completeCard?'All matches verified':'Known matches'}</span><h3>Matches</h3></div><small>${h(details.sourceNote)}</small></div>${matches}</section>
    <section class="detailSection"><div class="sectionHeading"><div><span class="eyebrow">Participants</span><h3>Wrestlers competing</h3></div><strong>${details.competitors.length}</strong></div><div class="wrestlerTags expanded">${details.competitors.map(w=>`<button data-wrestler="${h(w)}">${h(w)}</button>`).join('')||'<span>No competitors parsed from the available record.</span>'}</div></section>
    <section class="detailSection"><div class="sectionHeading"><div><span class="eyebrow">Review & notes</span><h3>Archive review</h3></div></div>${details.editorial?`<div class="editorialReview">${h(details.editorial).replace(/\n/g,'<br>')}</div>`:'<p class="sourceNote">No published or curated review is attached to this record yet.</p>'}<div class="personalReview"><label><span>Your rating</span><select id="reviewRating"><option value="">No rating</option>${Array.from({length:10},(_,i)=>i+1).map(n=>`<option value="${n}" ${Number(review.rating)===n?'selected':''}>${n}/10</option>`).join('')}</select></label><label><span>Your review</span><textarea id="reviewText" placeholder="Write private notes about the card or episode…">${h(review.text||'')}</textarea></label><button data-save-review="${h(key)}">Save review</button></div></section>
    <section class="detailSection"><div class="sectionHeading"><div><span class="eyebrow">Original visual assets</span><h3>Artwork</h3></div><button data-scan-art="${h(key)}">Scan again</button></div>${artworkGallery(item)}</section>`,true);
}
function programmeModal(p){
  if(!p)return '';
  const company=promotion(p.promotionId),loaded=state.loadedEpisodes.get(p.id)||[],status=currentStatus(`program:${p.id}`),mapped=p.tvMazeId||state.feedMap[p.id],freeLink=specificFreeLinkFor(p,{programmeEntry:true}),catalog={...(state.data.artworkCatalog?.programmes?.[p.id]||{}),...(state.artworkCache[`program:${p.id}`]||{})};
  const seasons=Object.entries(catalog.seasons||{});
  return modalShell(p.name,`<div class="detailHero">${artwork(p,'detailArtwork',true)}<div class="detailHeroText"><div class="programmeKicker"><span>${h(company?.name||'')}</span><span>•</span><span>${h(state.data.formatLabels[p.kind]||p.kind)}</span></div><h2>${h(p.name)}</h2><p class="detailLead">${h(p.description)}</p><div class="detailFacts"><span><small>First aired</small><strong>${h(p.firstAirDate)}</strong></span>${p.endDate?`<span><small>Final date</small><strong>${h(p.endDate)}</strong></span>`:''}<span><small>Cadence</small><strong>${h(p.cadence)}</strong></span><span><small>Exact episodes</small><strong>${loaded.length.toLocaleString()}</strong></span></div><div class="modalActions">${mapped?`<button data-load-programme="${h(p.id)}">${icon('refresh')} Refresh episodes</button>`:`<button data-discover-programme="${h(p.id)}">Discover exact feed</button>`}${p.officialUrl?`<a href="${h(p.officialUrl)}" target="_blank">Official ↗</a>`:''}${p.sourceUrl?`<a href="${h(p.sourceUrl)}" target="_blank" rel="noreferrer">Catalogue source ↗</a>`:''}${freeLink?freeLinkAnchor(freeLink):''}<button data-status-key="program:${h(p.id)}" data-status="${status==='watched'?'unwatched':'watched'}">${status==='watched'?'Remove watched':'Mark programme watched'}</button></div>${p.feedNote?`<p class="sourceNote">${h(p.feedNote)}</p>`:''}</div></div>
    <section class="detailSection"><div class="sectionHeading"><div><span class="eyebrow">Show and season visuals</span><h3>Artwork</h3></div><button data-scan-art="program:${h(p.id)}">Scan artwork</button></div>${artworkGallery(p,true)}${seasons.length?`<h4 class="subheading">Season artwork</h4><div class="seasonArtworkGrid">${seasons.map(([season,art])=>`<figure><img src="${h(art.poster||art.backdrop||'')}" alt="Season ${h(season)} artwork" loading="lazy"><figcaption>Season ${h(season)}</figcaption></figure>`).join('')}</div>`:''}</section>
    <section class="detailSection"><div class="sectionHeading"><div><span class="eyebrow">Complete episode index</span><h3>${loaded.length.toLocaleString()} exact episodes</h3></div></div>${loaded.length?`<div class="episodeRows">${loaded.map(episodeRow).join('')}</div>`:`<div class="emptyState"><h3>${mapped?'Episode feed loading or unavailable':'No exact feed mapped'}</h3><p>${mapped?'Refresh the feed to load dates, titles and episode artwork.':'The show remains fully indexed as a programme family. Use discovery to find an exact TVMaze match without inventing dates.'}</p></div>`}</section>`,true);
}
function episodeRow(e){const st=currentStatus(statusKey(e));return `<article class="episodeRow" data-open-record="${h(e.id)}" role="button" tabindex="0">${artwork(e,'episodeThumb')}<div class="episodeIdentity"><span>${h(e.code)}</span><h4>${h(e.title)}</h4><p>${h(fmtDate(e.date))}${e.runtime?` • ${e.runtime} min`:''}${plexAvailable(e)?` • Plex${plexProgressFor(e)?.watched?' watched':plexProgressFor(e)?.progress?` ${Math.round(plexProgressFor(e).progress*100)}%`:''}`:''}</p></div><p class="episodeSummary">${h(e.description)}</p><button class="${st==='watched'?'active':''}" data-status-key="${h(statusKey(e))}" data-status="${st==='watched'?'unwatched':'watched'}">${st==='watched'?'Watched ✓':'Mark watched'}</button></article>`;}

function accountModal(){
  const configured=Boolean(state.cloud.config?.supabaseConfigured),user=state.cloud.user;
  if(!configured)return modalShell('Ringside account',`<div class="accountSetup"><h3>Supabase setup required</h3><p>Accounts are optional for local use, but required for automatic cross-device progress plus roaming Plex and Trakt connections. Follow <code>supabase/schema.sql</code> and the README, then add the Supabase environment variables in Vercel.</p></div>`,true);
  if(state.cloud.recovery)return modalShell('Choose a new password',`<div class="authLayout recoveryLayout"><section><span class="eyebrow">Password recovery</span><h3>Secure your Ringside account</h3><p>The recovery link was accepted. Enter a new password to complete the reset.</p></section><section class="authForm"><label><span>New password</span><input id="accountNewPassword" type="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters"></label><label><span>Confirm password</span><input id="accountConfirmPassword" type="password" autocomplete="new-password" minlength="8" placeholder="Repeat the new password"></label><div class="modalActions"><button class="primaryButton" data-action="cloud-update-password">Update password</button></div><p class="sourceNote" id="cloudOperationMessage">${h(state.cloud.message||'After updating, this device remains signed in and your archive will synchronize.')}</p></section></div>`,true);
  if(user)return modalShell('Ringside account',`<div class="accountDashboard"><div class="accountIdentity"><span class="accountAvatar large">${h((user.email||'A').slice(0,1).toUpperCase())}</span><div><span class="eyebrow">Signed in</span><h3>${h(user.email||'Ringside account')}</h3><p>Viewing states, reviews and settings synchronize through Row Level Security. Plex and Trakt credentials plus the latest compact Plex match snapshot are encrypted server-side; artwork remains a regenerable device cache.</p></div></div><div class="cloudStatusGrid"><span><small>Cloud state</small><strong id="cloudOperationMessage">${h(state.cloud.message||'Ready')}</strong></span><span><small>Trakt</small><strong>${traktConnected()?'Connected':'Not connected'}</strong></span><span><small>Plex</small><strong>${plexConnected()?'Connected':'Not connected'}</strong></span><span><small>Auto sync</small><strong>${state.settings.cloudAutoSync===false?'Off':'On'}</strong></span></div><label class="settingToggle"><input type="checkbox" data-setting="cloudAutoSync" ${state.settings.cloudAutoSync===false?'':'checked'}><span><strong>Automatic account sync</strong><small>Pull on login/focus and synchronize changes after edits.</small></span></label><div class="modalActions"><button data-action="cloud-sync" ${state.cloud.syncing?'disabled':''}>Sync now</button><button data-action="connections">Manage Plex & Trakt</button><button class="dangerButton" data-action="cloud-signout">Sign out</button></div></div>`,true);
  return modalShell('Create or sign in to Ringside',`<div class="authLayout"><section><span class="eyebrow">One account on every device</span><h3>Sync the complete archive</h3><p>Your viewing progress, ratings, reviews, preferences and feed mappings follow the account. Encrypted server storage also keeps your Plex and Trakt connections available without exporting credentials; artwork is regenerated per device to keep cloud state small.</p><ul><li>Supabase Auth for email/password accounts</li><li>RLS-protected personal archive state</li><li>AES-256-GCM encrypted Plex and Trakt integrations</li><li>Automatic merge using per-record timestamps</li></ul></section><section class="authForm"><label><span>Email</span><input id="accountEmail" type="email" autocomplete="email" placeholder="you@example.com"></label><label><span>Password</span><input id="accountPassword" type="password" autocomplete="current-password" minlength="8" placeholder="At least 8 characters"></label><div class="modalActions"><button class="primaryButton" data-action="cloud-signin">Sign in</button><button data-action="cloud-signup">Create account</button><button data-action="cloud-reset">Reset password</button></div><p class="sourceNote" id="cloudOperationMessage">${h(state.cloud.message||'Email confirmation may be required depending on your Supabase Auth settings.')}</p></section></div>`,true);
}

function plexSectionsFor(server){return state.plexData.sectionsByServer?.[server.machineIdentifier]||((state.plexData.selectedServer?.machineIdentifier===server.machineIdentifier)?state.plexData.sections||[]:[]);}
function suggestedPlexSections(sections){
  const wrestling=/wrestl|wwe|wwf|wcw|ecw|aew|tna|impact|roh|njpw|nwa|lucha|puro|combat zone|world class|mid[- ]south/i;
  const likely=sections.filter(section=>wrestling.test(section.title||''));
  return (likely.length?likely:sections).map(section=>String(section.key));
}
function selectedPlexSectionsFor(server){
  const stored=state.plexData.selectedSectionKeysByServer?.[server.machineIdentifier];
  return Array.isArray(stored)&&stored.length?stored:suggestedPlexSections(plexSectionsFor(server));
}
function plexServerPanel(server){
  const sections=plexSectionsFor(server),selected=new Set(selectedPlexSectionsFor(server));
  return `<article class="plexServerCard"><div class="plexServerHeading"><div><strong>${h(server.name)}</strong><small>${server.owned?'Owned server':'Shared server'} • ${server.connections?.length||0} advertised connections</small></div><button type="button" data-plex-load-server="${h(server.machineIdentifier)}">${sections.length?'Refresh libraries':'Load libraries'}</button></div>${sections.length?`<div class="plexSectionList">${sections.map(section=>`<label><input type="checkbox" data-plex-section="${h(section.key)}" data-plex-section-server="${h(server.machineIdentifier)}" ${selected.has(String(section.key))?'checked':''}><span><strong>${h(section.title)}</strong><small>${h(section.type)}</small></span></label>`).join('')}</div><button type="button" class="primaryButton" data-plex-scan-server="${h(server.machineIdentifier)}">Scan selected libraries</button>`:'<p class="sourceNote">Load libraries first. The app will test every secure remote/relay connection and show a detailed error if none can be reached from Vercel.</p>'}</article>`;
}

function traktDeviceMarkup(){
  const device=state.traktDevice;
  if(!device)return '';
  const seconds=Math.max(0,Math.ceil((device.expiresAt-Date.now())/1000));
  return `<div class="traktDeviceCode" role="status" aria-live="polite"><div class="traktCodeHeader"><span class="connectionPulse"></span><strong>${h(device.status||'Waiting for authorization')}</strong><small id="traktCountdown">${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}</small></div><p>Open Trakt activation and enter this code:</p><button type="button" class="deviceCodeCopy" data-action="trakt-copy-code"><code>${h(device.userCode)}</code><span>Copy code</span></button><div class="modalActions"><a class="primaryButton" href="${h(device.verificationUrl)}" target="_blank" rel="noreferrer">Open Trakt activation ↗</a><button type="button" data-action="trakt-cancel">Cancel</button></div><p class="sourceNote">This code stays visible while Ringside checks authorization. You can safely switch tabs.</p></div>`;
}
function updateTraktCountdown(){
  const el=document.querySelector('#traktCountdown'),device=state.traktDevice;
  if(!el||!device)return;
  const seconds=Math.max(0,Math.ceil((device.expiresAt-Date.now())/1000));
  el.textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
}

function connectionsModal(){
  const servers=state.plexData.servers||[],traktOn=traktConnected(),plexOn=plexConnected();
  const config=state.cloud.config||{},diag=config.diagnostics||{};
  const traktReady=Boolean(config.traktConfigured),artworkReady=Boolean(config.tmdbConfigured);
  const accountNote=accountConnected()?`<div class="accountSyncNotice ready"><strong>Cross-device integration storage enabled</strong><span>Connected Plex/Trakt accounts and the latest Plex scan are attached to ${h(state.cloud.user.email||'this account')}.</span></div>`:`<div class="accountSyncNotice"><strong>Connections are device-local</strong><span>Sign in to a Ringside account before connecting Plex or Trakt to make them available on your other devices.</span><button data-action="account">Sign in</button></div>`;
  const diagnostics=`<div class="integrationDiagnostics"><span class="${traktReady?'ready':'missing'}"><b>Trakt</b>${traktReady?'Configured':'Missing Vercel variables'}</span><span class="${config.encryptedIntegrationStorage?'ready':'missing'}"><b>Roaming vault</b>${config.encryptedIntegrationStorage?'Configured':'Incomplete Supabase server setup'}</span><span class="${artworkReady?'ready':'optional'}"><b>TMDB artwork</b>${artworkReady?'Configured':'Optional — Wikipedia fallback active'}</span></div>`;
  return modalShell('Connections, sync & artwork',`${accountNote}${diagnostics}<div class="connectionGrid"><section class="connectionPanel"><h3>Trakt viewing sync</h3><p>Exact episodes and supported event records synchronize both ways. With a Ringside account, the Trakt refresh token is encrypted on the server and works from every signed-in device.</p><div class="modalActions">${traktOn?`<button data-action="trakt-sync">Import watched history</button><button data-action="trakt-disconnect">Disconnect</button>`:`<button data-action="trakt-connect" ${traktReady?'':'disabled'}>Connect Trakt</button>`}<button data-action="refresh-integration-config">Recheck configuration</button></div><p id="traktOperationMessage">${h(state.traktMessage||(traktOn?(state.trakt.account?.username?`Connected as ${state.trakt.account.username}.`:'Connected.'):(traktReady?'Ready to connect.':'Add TRAKT_CLIENT_ID and TRAKT_CLIENT_SECRET in Vercel, then redeploy.')))}</p>${!traktReady?`<p class="sourceNote">Detected: client ID ${diag.traktClientId?'✓':'✗'} • client secret ${diag.traktClientSecret?'✓':'✗'}.</p>`:''}${traktDeviceMarkup()}</section>
  <section class="connectionPanel"><h3>Plex library & viewing sync</h3><p>Match exact shows, seasons, episodes and event files. Import real Plex viewCount/viewOffset progress; optionally push Ringside watched changes back to Plex and forward Plex-watched matches to Trakt.</p><div class="modalActions">${plexOn?`<button data-action="plex-refresh-servers">Refresh servers</button><button data-action="plex-import-viewing">Import Plex viewing</button><button data-action="plex-disconnect">Disconnect</button>`:`<button data-action="plex-connect">Sign in to Plex</button>`}<button data-action="plex-import">Import local export</button></div><p id="plexOperationMessage">${h(state.plexMessage||`${state.plexMatches.size.toLocaleString()} archive keys matched from ${(state.plexData.items||[]).length.toLocaleString()} Plex items.`)}</p><div class="settingStack"><label class="settingToggle"><input type="checkbox" data-setting="autoImportPlexViewing" ${state.settings.autoImportPlexViewing?'checked':''}><span><strong>Import after each Plex scan</strong><small>Watched items become Watched; partial progress becomes Watching.</small></span></label><label class="settingToggle"><input type="checkbox" data-setting="pushWatchedToPlex" ${state.settings.pushWatchedToPlex?'checked':''}><span><strong>Push Ringside watched state to Plex</strong><small>Uses Plex scrobble/unscrobble only for exact matched items.</small></span></label><label class="settingToggle"><input type="checkbox" data-setting="syncPlexWatchedToTrakt" ${state.settings.syncPlexWatchedToTrakt?'checked':''}><span><strong>Forward Plex-watched matches to Trakt</strong><small>Only records that map exactly in both integrations are submitted.</small></span></label><label><span>Plex watched threshold</span><input id="plexThreshold" data-setting="plexWatchedThreshold" type="number" min="0.5" max="1" step="0.05" value="${h(state.settings.plexWatchedThreshold||0.9)}"></label><label><span>Plex LAN / Tailscale base URL</span><input data-setting="plexLanBaseUrl" type="url" placeholder="http://100.112.143.89:32400" value="${h(state.settings.plexLanBaseUrl||'http://100.112.143.89:32400')}"><small>Direct show and event links open your local Plex Web app. This address is never used for server-side scanning.</small></label></div>${servers.length?`<div class="serverList">${servers.map(plexServerPanel).join('')}</div>`:''}</section>
  <section class="connectionPanel"><h3>Artwork scanner</h3><p>TVMaze, TMDB, Wikipedia/Wikimedia and imported Plex metadata are layered with source attribution. Missing art remains labelled rather than fabricated.</p><div class="modalActions"><button data-action="scan-visible-artwork" ${state.scanningArtwork?'disabled':''}>Scan visible records</button></div><p id="artworkOperationMessage">${h(state.artworkMessage||`${Object.keys(state.artworkCache).length} cached artwork results.`)}</p></section>
  <section class="connectionPanel"><h3>Backup & recovery</h3><p>Account sync is automatic when configured, but a private JSON backup remains useful for offline recovery. Legacy backups can also migrate local Plex/Trakt connections into your signed-in account.</p><div class="modalActions"><button data-action="export">Export JSON</button><button data-action="import-backup">Import JSON</button><button data-action="cloud-sync" ${accountConnected()?'':'disabled'}>Sync account</button></div></section></div>`,true);
}

function footer(){return `<footer><div class="footerBrand"><span class="brandMark">RA</span><div><strong>Ringside Archive</strong><small>Account-synced, local-first project</small></div></div><p>Episode metadata uses verified feeds. Artwork retains source attribution and fallbacks are never presented as original. The Matches section distinguishes a fully verified match list from partial or unavailable card information. This product uses the TMDB API but is not endorsed or certified by TMDB. Wikipedia/Wikimedia results link back to their source page so image licensing can be checked.</p><span>Catalogue v5.6.0 • ${state.data.meta.counts.majorEvents.toLocaleString()} major events • ${state.data.programmes.length} programme families • ${allLoadedEpisodes().length.toLocaleString()} loaded episodes</span></footer>`;}
function mobileNav(){return `<nav class="mobileNav">${navItems.map(([id,ic,label])=>`<button data-view="${id}" class="${state.view===id?'active':''}"><span>${icon(ic)}</span>${label.replace('Complete ','')}</button>`).join('')}</nav>`;}

function currentViewContent(){
  let content='';
  if(state.view==='exact')content=exactView();
  if(state.view==='chronology')content=chronologyView();
  if(state.view==='wrestlers')content=wrestlersView();
  if(state.view==='recommended')content=recommendedView();
  if(state.view==='companies')content=companiesView();
  if(state.view==='library')content=libraryView();
  const overview=state.view==='exact'?`${dashboard()}${catalogueStatement()}`:'';
  const filters=['exact','chronology','wrestlers','companies','recommended'].includes(state.view)?filterPanel():'';
  return `${overview}${filters}${content}${footer()}`;
}
function renderViewOnly({preserveScroll=true}={}){
  if(!state.data)return;
  const main=document.querySelector('.appShell');if(!main){render({preserveScroll});return;}
  const viewport=preserveScroll?captureViewportState():null,generation=++state.renderGeneration;
  main.className=`appShell view-${state.view}`;main.innerHTML=currentViewContent();state.lastRenderView=state.view;
  bind();renderToast();syncTaskButtons();if(viewport)restoreViewportState(viewport,generation);
}
function render({preserveScroll=state.lastRenderView===state.view}={}){
  if(!state.data)return;
  const viewport=preserveScroll?captureViewportState():null;
  const generation=++state.renderGeneration;
  app.innerHTML=`${topbar()}<main class="appShell view-${h(state.view)}">${currentViewContent()}</main>${mobileNav()}${modal()}`;
  document.body.classList.toggle('modalOpen',Boolean(state.modal));
  state.lastRenderView=state.view;
  bind();renderToast();syncTaskButtons();
  if(viewport)restoreViewportState(viewport,generation);
}

function bind(){
  document.querySelectorAll('[data-view]').forEach(el=>el.onclick=()=>setView(el.dataset.view));
  document.querySelectorAll('[data-status-key]').forEach(el=>el.onclick=e=>{e.stopPropagation();setStatus(el.dataset.statusKey,el.dataset.status);});
  document.querySelectorAll('[data-open-programme]').forEach(el=>{el.onclick=e=>{if(el.tagName!=='BUTTON'&&e.target.closest('button,a'))return;state.modal={type:'programme',id:el.dataset.openProgramme};renderModalOnly();};el.onkeydown=e=>{if(e.key==='Enter'){state.modal={type:'programme',id:el.dataset.openProgramme};renderModalOnly();}};});
  document.querySelectorAll('[data-open-record]').forEach(el=>{el.onclick=e=>{if(el.tagName!=='BUTTON'&&e.target.closest('button,a,select,textarea,input'))return;state.modal={type:'record',id:el.dataset.openRecord};renderModalOnly();};el.onkeydown=e=>{if(e.key==='Enter'){state.modal={type:'record',id:el.dataset.openRecord};renderModalOnly();}};});
  document.querySelectorAll('[data-company]').forEach(el=>el.onclick=()=>{state.filters.promotion=el.dataset.company;state.filtersOpen=true;state.visible=24;setView('exact');});
  document.querySelectorAll('[data-wrestler]').forEach(el=>el.onclick=e=>{e.stopPropagation();state.filters.wrestler=el.dataset.wrestler;state.filtersOpen=true;state.modal=null;state.visible=24;setView('wrestlers');});
  document.querySelectorAll('[data-library-tab]').forEach(el=>el.onclick=()=>{state.libraryTab=el.dataset.libraryTab;renderViewOnly();});
  document.querySelectorAll('[data-filter]').forEach(el=>{const apply=()=>{state.filters[el.dataset.filter]=el.type==='checkbox'?el.checked:el.value;state.visible=24;renderViewOnly();};if(el.tagName==='INPUT'&&el.type==='number')el.oninput=debounce(apply,250);else el.onchange=apply;});
  const search=document.querySelector('#searchInput');if(search)search.oninput=debounce(()=>{state.filters.query=search.value;state.visible=24;renderViewOnly();},150);
  document.querySelectorAll('[data-load-programme]').forEach(el=>{const key=taskButtonKey(el);el.onclick=e=>{e.stopPropagation();runButtonTask(el,key,()=>loadProgramme(el.dataset.loadProgramme,true),{label:'Loading exact episodes'}).catch(()=>{});};});
  document.querySelectorAll('[data-discover-programme]').forEach(el=>{const key=taskButtonKey(el);el.onclick=e=>{e.stopPropagation();runButtonTask(el,key,()=>discoverProgramme(el.dataset.discoverProgramme),{label:'Discovering exact feed'}).catch(()=>{});};});
  document.querySelectorAll('[data-save-review]').forEach(el=>el.onclick=()=>saveReview(el.dataset.saveReview));
  document.querySelectorAll('[data-scan-art]').forEach(el=>{const key=taskButtonKey(el);el.onclick=()=>runButtonTask(el,key,()=>scanArtworkKey(el.dataset.scanArt),{label:'Scanning artwork'}).catch(()=>{});});
  document.querySelectorAll('[data-reject-art]').forEach(el=>el.onclick=e=>{e.preventDefault();e.stopPropagation();const key=el.dataset.rejectArt;if(!key)return;delete state.artworkCache[key];storage.saveArtwork(state.artworkCache);showToast('Incorrect scanned artwork removed. Run the scanner again to find a stricter match.');renderViewOnly();if(state.modal)renderModalOnly();});
  document.querySelectorAll('[data-clear-filter]').forEach(el=>el.onclick=()=>{const key=el.dataset.clearFilter;if(key==='years'){state.filters.yearFrom='';state.filters.yearTo='';}else if(key==='hideWatched')state.filters.hideWatched=false;else state.filters[key]='';state.visible=24;renderViewOnly();});
  document.querySelectorAll('[data-wrestler-sort]').forEach(el=>el.onchange=()=>{state.wrestlerSort=el.value;state.visible=24;renderViewOnly();});
  document.querySelectorAll('[data-plex-load-server]').forEach(el=>{const key=taskButtonKey(el);el.onclick=()=>runButtonTask(el,key,()=>loadPlexLibrariesForServer(el.dataset.plexLoadServer),{label:'Loading Plex libraries'}).catch(()=>{});});
  document.querySelectorAll('[data-plex-scan-server]').forEach(el=>{const key=taskButtonKey(el);el.onclick=()=>runButtonTask(el,key,()=>scanSelectedPlexServer(el.dataset.plexScanServer),{label:'Scanning selected libraries'}).catch(()=>{});});
  document.querySelectorAll('[data-plex-section]').forEach(el=>el.onchange=()=>{const serverId=el.dataset.plexSectionServer;const values=[...document.querySelectorAll('[data-plex-section]')].filter(input=>input.dataset.plexSectionServer===serverId&&input.checked).map(input=>String(input.dataset.plexSection));state.plexData.selectedSectionKeysByServer={...(state.plexData.selectedSectionKeysByServer||{}),[serverId]:values};storage.savePlexData(state.plexData);});
  document.querySelectorAll('[data-setting]').forEach(el=>el.onchange=()=>{let value=el.type==='checkbox'?el.checked:el.value;if(el.type==='number')value=Number(value);state.settings[el.dataset.setting]=value;storage.saveSettings(state.settings);refreshPlexIndex();scheduleCloudSync();if(!state.modal)renderViewOnly();});
  document.querySelectorAll('[data-action]').forEach(el=>{
    const action=el.dataset.action,key=taskButtonKey(el,action);
    el.onclick=e=>{
      if(ASYNC_ACTIONS.has(action))runButtonTask(el,key,()=>handleAction(action,e),{label:taskLabelFor(key)}).catch(()=>{});
      else handleAction(action,e).catch?.(()=>{});
    };
  });
  document.querySelectorAll('img').forEach(img=>img.onerror=()=>{img.style.display='none';img.parentElement?.classList.remove('hasImage');});
  const backdrop=document.querySelector('.modalBackdrop');if(backdrop)backdrop.onclick=e=>{if(e.target===backdrop)closeModalOnly();};
  syncTaskButtons();scheduleArtworkHydration();
}

async function loadProgramme(id,forceLive=false){
  const p=programme(id),mapped=state.feedMap[id]||p.tvMazeId;if(!mapped)throw new Error('No exact feed is mapped for this programme yet.');
  const taskKey=`load-programme:${id}`;setOperationMessage('episodes',`Loading ${p.name}…`);updateTask(taskKey,{detail:p.name});
  try{
    const feed=await loadTvMazeFeed(p,{forceLive,tvMazeId:mapped});
    state.showArtwork.set(p.id,feed.show?.image?.original||feed.show?.image?.medium||'');
    const episodes=(feed.episodes||[]).map(x=>normalizeEpisode(p,feed,x)).filter(Boolean);
    state.loadedEpisodes.set(p.id,episodes);invalidateRecordCache();rebuildWrestlerIndex();
    setOperationMessage('episodes',`${episodes.length.toLocaleString()} exact episodes loaded for ${p.name}.`);
    updateTask(taskKey,{detail:`${episodes.length.toLocaleString()} episodes`,progress:100});
    showToast(`${episodes.length.toLocaleString()} exact episodes loaded for ${p.name}.`);
    renderViewOnly();if(state.modal?.type==='programme'&&state.modal.id===id)renderModalOnly();
  }catch(error){setOperationMessage('episodes','');showToast(error.message);throw error;}
}
async function loadAllEpisodes(forceLive=false){
  if(state.autoEpisodeLoadStarted&&!forceLive)return;
  state.autoEpisodeLoadStarted=true;state.autoEpisodeLoadComplete=false;
  const taskKey='reload-all-episodes',feeds=state.data.programmes.filter(p=>p.tvMazeId||state.feedMap[p.id]);
  const queue=[...feeds];let done=0,totalEpisodes=0,lastPaint=0;
  const updateProgress=()=>{
    const percent=feeds.length?done/feeds.length*100:100;
    const message=`Loading exact weekly episodes: ${done}/${feeds.length} feeds • ${totalEpisodes.toLocaleString()} episodes`;
    setOperationMessage('episodes',message);updateTask(taskKey,{detail:`${done}/${feeds.length} feeds • ${totalEpisodes.toLocaleString()} episodes`,progress:percent});
    if(Date.now()-lastPaint>1200){lastPaint=Date.now();const counter=document.querySelector('.viewControls span');if(counter&&state.view==='exact')counter.textContent=`${totalEpisodes.toLocaleString()} exact weekly episodes loaded`;}
  };
  updateProgress();
  const worker=async()=>{while(queue.length){
    const p=queue.shift();
    try{
      const feed=await loadTvMazeFeed(p,{forceLive,tvMazeId:state.feedMap[p.id]||p.tvMazeId});
      state.showArtwork.set(p.id,feed.show?.image?.original||feed.show?.image?.medium||'');
      const episodes=(feed.episodes||[]).map(x=>normalizeEpisode(p,feed,x)).filter(Boolean);
      state.loadedEpisodes.set(p.id,episodes);invalidateRecordCache();totalEpisodes+=episodes.length;
    }catch(error){console.warn(error);}finally{done++;updateProgress();}
  }};
  await Promise.all(Array.from({length:Math.min(2,feeds.length)},worker));
  rebuildWrestlerIndex();state.autoEpisodeLoadComplete=true;
  const complete=`Loaded ${totalEpisodes.toLocaleString()} exact episodes from ${feeds.length} verified feeds.`;
  setOperationMessage('episodes',complete);updateTask(taskKey,{detail:complete,progress:100});renderViewOnly();if(state.modal?.type==='programme')renderModalOnly();
  setTimeout(()=>{if(state.autoEpisodeLoadComplete)setOperationMessage('episodes','');},4000);
}

async function discoverProgramme(id){
  const p=programme(id),taskKey=`discover-programme:${id}`;
  setOperationMessage('episodes',`Searching for an exact episode feed for ${p.name}…`);updateTask(taskKey,{detail:p.name});
  try{
    const match=await discoverTvMazeId(p);if(!match)throw new Error('No exact-title TVMaze feed was found.');
    state.feedMap[p.id]=match.tvMazeId;storage.saveFeedMap(state.feedMap);showToast(`Mapped ${p.name} to TVMaze show ${match.tvMazeId}.`);
    await loadProgramme(id);
  }catch(error){setOperationMessage('episodes','');showToast(error.message);throw error;}
}
async function discoverMoreFeeds(){
  const candidates=state.data.programmes.filter(p=>!p.tvMazeId&&!state.feedMap[p.id]&&['weekly','territory-tv','studio','streaming'].includes(p.kind));
  const taskKey='discover-feeds';let mapped=0,checked=0;
  setOperationMessage('episodes',`Discovering additional exact feeds: 0/${candidates.length}`);
  for(const p of candidates){
    try{const match=await discoverTvMazeId(p);if(match){state.feedMap[p.id]=match.tvMazeId;mapped++;await loadProgrammeQuiet(p,match.tvMazeId);}}catch{}
    checked++;const message=`Discovering additional exact feeds: ${checked}/${candidates.length} • ${mapped} exact matches`;
    setOperationMessage('episodes',message);updateTask(taskKey,{detail:message,progress:candidates.length?checked/candidates.length*100:100});
    await new Promise(r=>setTimeout(r,350));
  }
  storage.saveFeedMap(state.feedMap);rebuildWrestlerIndex();state.autoEpisodeLoadComplete=true;
  const complete=`Discovery complete: ${mapped} new exact-title feeds mapped.`;setOperationMessage('episodes',complete);showToast(complete);renderViewOnly();
}
async function loadProgrammeQuiet(p,id){try{const feed=await loadTvMazeFeed(p,{tvMazeId:id});state.showArtwork.set(p.id,feed.show?.image?.original||feed.show?.image?.medium||'');state.loadedEpisodes.set(p.id,(feed.episodes||[]).map(x=>normalizeEpisode(p,feed,x)).filter(Boolean));invalidateRecordCache();}catch(error){console.warn(error);}}

function saveReview(key){
  const rating=document.querySelector('#reviewRating')?.value||'',text=document.querySelector('#reviewText')?.value||'';
  state.reviews[key]={rating:rating?Number(rating):null,text,updatedAt:new Date().toISOString()};storage.saveReviews(state.reviews,key);scheduleCloudSync();showToast(accountConnected()?'Review saved and queued for account sync.':'Review saved locally.');
}

async function handleCloudAuth(action){
  const email=document.querySelector('#accountEmail')?.value?.trim()||'',password=document.querySelector('#accountPassword')?.value||'';
  try{
    if(action==='cloud-update-password'){
      const next=document.querySelector('#accountNewPassword')?.value||'',confirmPassword=document.querySelector('#accountConfirmPassword')?.value||'';
      if(next.length<8)throw new Error('Use a password of at least 8 characters.');
      if(next!==confirmPassword)throw new Error('The passwords do not match.');
      state.cloud.message='Updating password…';setOperationMessage('cloud',state.cloud.message);await updateCloudPassword(next);state.cloud.recovery=false;await finishAccountLogin();state.modal={type:'account'};showToast('Password updated successfully.');return;
    }
    if(action==='cloud-signin'){if(!email||!password)throw new Error('Enter your email and password.');state.cloud.message='Signing in…';setOperationMessage('cloud',state.cloud.message);await signInCloud(email,password);await finishAccountLogin();showToast('Ringside account connected.');}
    if(action==='cloud-signup'){if(!email||password.length<8)throw new Error('Enter an email and a password of at least 8 characters.');state.cloud.message='Creating account…';setOperationMessage('cloud',state.cloud.message);const result=await signUpCloud(email,password);if(result.session){await finishAccountLogin();showToast('Ringside account created.');}else{state.cloud.message='Account created. Confirm the email, then sign in.';setOperationMessage('cloud',state.cloud.message);}}
    if(action==='cloud-reset'){if(!email)throw new Error('Enter your email first.');await sendPasswordReset(email);state.cloud.message='Password-reset email sent.';setOperationMessage('cloud',state.cloud.message);}
  }catch(error){state.cloud.message=error.message;setOperationMessage('cloud',state.cloud.message);showToast(error.message);throw error;}
}

async function handleAction(action,event){
  event?.stopPropagation();
  if(action==='account'){state.modal={type:'account'};renderModalOnly();return;}
  if(action==='cloud-signin'||action==='cloud-signup'||action==='cloud-reset'||action==='cloud-update-password'){await handleCloudAuth(action);return;}
  if(action==='cloud-sync'){await syncCloudNow();return;}
  if(action==='cloud-signout'){await signOutCloud();state.cloud.user=null;state.cloud.message='Signed out. Local cached data remains on this device.';state.modal={type:'account'};renderViewOnly();renderModalOnly();return;}
  if(action==='toggle-filters'){state.filtersOpen=!state.filtersOpen;renderViewOnly();return;}
  if(action==='reset-filters'){state.filters=defaultFilters();state.visible=24;state.filtersOpen=true;renderViewOnly();return;}
  if(action==='load-more'){state.visible+=50;renderViewOnly();return;}
  if(action==='clear-wrestler'){state.filters.wrestler='';state.visible=24;renderViewOnly();return;}
  if(action==='connections'){state.modal={type:'connections'};renderModalOnly();return;}
  if(action==='close-modal'){closeModalOnly();return;}
  if(action==='dismiss-toast'){state.toast='';document.querySelector('.toast')?.remove();return;}
  if(action==='export'){downloadJson(`ringside-archive-backup-${new Date().toISOString().slice(0,10)}.json`,storage.exportAll());showToast('Backup exported.');return;}
  if(action==='import-backup'){pickFile('backup');return;}
  if(action==='plex-import'){pickFile('plex');return;}
  if(action==='clear-progress'&&confirm('Clear all local viewing progress?')){storage.clearProgress();state.statuses={};renderViewOnly();return;}
  if(action==='reload-all-episodes'){state.autoEpisodeLoadStarted=false;await loadAllEpisodes(true);return;}
  if(action==='discover-feeds'){await discoverMoreFeeds();return;}
  if(action==='refresh-integration-config'){state.cloud.config=await loadCloudConfig(true);showToast('Integration configuration refreshed.');renderModalOnly();return;}
  if(action==='trakt-connect'){await startTraktDevice();return;}
  if(action==='trakt-copy-code'){if(state.traktDevice?.userCode){await navigator.clipboard?.writeText(state.traktDevice.userCode).catch(()=>{});showToast('Trakt code copied.');}return;}
  if(action==='trakt-cancel'){state.traktDevice=null;state.traktPolling=false;state.traktMessage='Trakt connection cancelled.';renderModalOnly();return;}
  if(action==='trakt-sync'){await syncTraktHistory();return;}
  if(action==='trakt-disconnect'){if(accountConnected())await deleteCloudIntegration('trakt').catch(()=>{});storage.clearTrakt();state.trakt={};state.traktMessage='Disconnected.';renderModalOnly();return;}
  if(action==='plex-connect'){await startPlexConnection();return;}
  if(action==='plex-refresh-servers'){await refreshPlexServers();return;}
  if(action==='plex-disconnect'){if(accountConnected())await deleteCloudIntegration('plex').catch(()=>{});storage.clearPlex();state.plexData=storage.plexData();refreshPlexIndex();state.plexMessage='Disconnected.';renderModalOnly();renderViewOnly();return;}
  if(action==='plex-import-viewing'){await importPlexViewingProgress();return;}
  if(action==='scan-visible-artwork'){await scanVisibleArtwork();return;}
}

function pickFile(mode){filePicker.value='';filePicker.dataset.mode=mode;filePicker.dataset.taskKey=mode==='plex'?'plex-import':'import-backup';filePicker.accept='.json,application/json,text/plain';filePicker.click();}
filePicker.onchange=async()=>{
  const file=filePicker.files?.[0];if(!file)return;
  const mode=filePicker.dataset.mode||'file',taskKey=filePicker.dataset.taskKey||`import-${mode}`;
  state.tasks.set(taskKey,{key:taskKey,status:'running',label:mode==='plex'?'Importing Plex export':'Importing backup',buttonLabel:'Importing',detail:file.name,progress:null,startedAt:Date.now()});syncTaskButtons();
  try{
    const text=await file.text();
    if(mode==='plex'&&/[?&]X-Plex-Token=/i.test(text))throw new Error('Unsafe legacy Plex export detected. It contains a Plex token in image URLs. Rotate that token, then create a new version 3 export with the included script.');
    const data=JSON.parse(text);
    if(mode==='backup'){
      storage.importAll(data);state.statuses=storage.statuses();state.plexData=storage.plexData();state.trakt=storage.trakt();state.artworkCache=storage.artwork();state.reviews=storage.reviews();state.feedMap=storage.feedMap();refreshPlexIndex();
      if(accountConnected()){await loadAccountIntegrations({migrate:true});scheduleCloudSync();}showToast('Backup imported.');
    }else await importPlexPayload(data);
    renderViewOnly();if(state.modal)renderModalOnly();
  }catch(error){showToast(error.message||'Import failed.');}
  finally{state.tasks.delete(taskKey);syncTaskButtons();}
};

async function importPlexPayload(data){
  const rawItems=Array.isArray(data)?data:(data.titles||data.items||[]);
  const items=rawItems.filter(item=>item&&(item.title||item.grandparentTitle||item.ratingKey));
  const built=buildPlexMatches(state.data,items,Number(state.settings.plexWatchedThreshold||0.9));
  const linkedItems=matchedPlexItems(built);
  state.plexData={...state.plexData,items:linkedItems,matches:[...built.matches],scannedAt:data.exportedAt||new Date().toISOString(),selectedServer:data.serverInfo||state.plexData.selectedServer};
  state.plexData=storage.savePlexData(state.plexData);refreshPlexIndex();
  if(accountConnected()){try{await saveCloudIntegration('plex',state.plexData);state.plexData.cloudConnected=true;state.plexData=storage.savePlexData(state.plexData);}catch(error){state.plexMessage=`Local import saved, but cloud snapshot failed: ${error.message}`;}}
  if(state.settings.autoImportPlexViewing)await importPlexViewingProgress({quiet:true});
  const diagnostic=`Read ${rawItems.length.toLocaleString()} rows (${items.length.toLocaleString()} valid) and matched ${built.diagnostics?.matchedItems||0} Plex items to ${state.plexMatches.size.toLocaleString()} archive keys.`;
  state.plexMessage=state.plexMatches.size?diagnostic:`${diagnostic} The export contains no usable wrestling titles. Re-run the v5.3 exporter and select your Wrestling and Wrestling PPV libraries.`;
  showToast(state.plexMessage);
}


async function startTraktDevice(){
  if(state.traktPolling)return;
  const pollToken=`${Date.now()}-${Math.random()}`;state.traktPolling=pollToken;
  try{
    state.cloud.config=await loadCloudConfig(true);
    if(!state.cloud.config?.traktConfigured){
      const diag=state.cloud.config?.diagnostics||{},missing=[!diag.traktClientId&&'TRAKT_CLIENT_ID',!diag.traktClientSecret&&'TRAKT_CLIENT_SECRET'].filter(Boolean);
      throw new Error(`Trakt is not configured on this Vercel deployment${missing.length?`: add ${missing.join(' and ')}`:''}, then redeploy.`);
    }
    state.modal={type:'connections'};state.traktMessage='Requesting a Trakt device code…';setOperationMessage('trakt',state.traktMessage);renderModalOnly();
    const response=await fetch('./api/trakt/device',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'code'}),cache:'no-store'});
    const data=await apiJson(response,'Unable to create a Trakt device code.');
    const verificationUrl=data.verification_url||'https://trakt.tv/activate',expiresAt=Date.now()+Number(data.expires_in||600)*1000;
    state.traktDevice={userCode:data.user_code,deviceCode:data.device_code,verificationUrl,expiresAt,interval:Math.max(3,Number(data.interval||5)),status:'Waiting for authorization',pollToken};
    state.traktMessage='Enter the displayed code on Trakt.';renderModalOnly();updateTask('trakt-connect',{buttonLabel:'Waiting for Trakt',detail:`Code ${data.user_code}`});
    const countdown=setInterval(updateTraktCountdown,1000);
    try{
      while(state.traktDevice?.pollToken===pollToken&&Date.now()<expiresAt){
        await new Promise(r=>setTimeout(r,state.traktDevice.interval*1000));if(state.traktDevice?.pollToken!==pollToken)break;
        const headers=await accountHeaders({'Content-Type':'application/json'}),tokenResponse=await fetch('./api/trakt/device',{method:'POST',headers,body:JSON.stringify({action:'token',device_code:data.device_code}),cache:'no-store'});
        if(tokenResponse.status===202){updateTraktCountdown();continue;}
        const token=await apiJson(tokenResponse,'Trakt authorization failed.');
        if(token.cloud)state.trakt={cloudConnected:true,cloud:true,account:token.integration?.account||null,expiresAt:token.integration?.expiresAt||null};else state.trakt={...state.trakt,...token};
        storage.saveTrakt(state.trakt);state.traktDevice=null;state.traktMessage=token.warning||(accountConnected()?'Trakt connected to your Ringside account on every device.':'Trakt connected in this browser.');
        showToast(state.traktMessage);patchConnectionIndicators();renderModalOnly();renderViewOnly();return;
      }
      if(state.traktDevice?.pollToken===pollToken)throw new Error('The Trakt device code expired. Start the connection again.');
    }finally{clearInterval(countdown);}
  }catch(error){state.traktDevice=null;state.traktMessage=error.message;showToast(error.message);renderModalOnly();throw error;}
  finally{if(state.traktPolling===pollToken)state.traktPolling=false;}
}

async function ensureTraktAccessToken(){
  if(state.trakt.cloudConnected&&accountConnected())return '';
  if(!state.trakt.accessToken)throw new Error('Trakt is not connected on this device.');
  if(!state.trakt.expiresAt||Number(state.trakt.expiresAt)>Date.now()+60000)return state.trakt.accessToken;
  if(!state.trakt.refreshToken)throw new Error('The Trakt connection expired. Reconnect Trakt.');
  const response=await fetch('./api/trakt/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:state.trakt.refreshToken}),cache:'no-store'});
  const data=await apiJson(response,'Unable to refresh Trakt access.');
  state.trakt={...state.trakt,...data};storage.saveTrakt(state.trakt);return state.trakt.accessToken;
}
async function traktRequestHeaders(contentType=false){
  if(state.trakt.cloudConnected&&accountConnected())return accountHeaders(contentType?{'Content-Type':'application/json'}:{});
  const accessToken=await ensureTraktAccessToken();return {...(contentType?{'Content-Type':'application/json'}:{}),Authorization:`Bearer ${accessToken}`};
}
async function syncStatusToTrakt(item,status){
  const p=programme(item.programId),payload=recordTraktPayload(item,p);if(!payload)return;
  const headers=await traktRequestHeaders(true);
  const response=await fetch('./api/trakt/sync',{method:'POST',headers,body:JSON.stringify({action:status==='watched'?'add':'remove',item:payload}),cache:'no-store'});
  await apiJson(response,'Trakt update failed.');
}
async function syncTraktHistory(){
  try{
    if(!traktConnected())throw new Error('Connect Trakt before importing watched history.');
    state.traktMessage='Importing watched episodes and events from Trakt…';setOperationMessage('trakt',state.traktMessage);
    const headers=await traktRequestHeaders(false),response=await fetch('./api/trakt/history',{headers,cache:'no-store'}),data=await apiJson(response,'Trakt sync failed.');
    if(!state.autoEpisodeLoadComplete)await loadAllEpisodes(false);
    let matched=0;const changed=[];
    for(const show of data.shows||[]){const title=normalize(show.title);const p=state.data.programmes.find(program=>normalize(program.traktTitle||program.name)===title||program.aliases?.some(alias=>normalize(alias)===title));if(!p)continue;for(const season of show.seasons||[])for(const episode of season.episodes||[]){const key=`episode:${p.id}:${season.number}:${episode.number}`;if(state.statuses[key]!=='watched'){state.statuses[key]='watched';changed.push(key);}matched++;}}
    for(const movie of data.movies||[]){const title=normalize(movie.title),event=state.data.majorEvents.find(e=>normalize(e.traktTitle||e.title)===title&&(!movie.year||yearOf(e.date)===movie.year));if(event){const key=`event:${event.id}`;if(state.statuses[key]!=='watched'){state.statuses[key]='watched';changed.push(key);}matched++;}}
    storage.saveStatusesBulk(state.statuses,changed);scheduleCloudSync();state.traktMessage=`Imported ${matched.toLocaleString()} matching episodes/events from Trakt.`;setOperationMessage('trakt',state.traktMessage);showToast(state.traktMessage);renderViewOnly();renderModalOnly();
  }catch(error){state.traktMessage=error.message;setOperationMessage('trakt',state.traktMessage);showToast(error.message);throw error;}
}

async function startPlexConnection(){
  try{
    const clientId=state.plexData.clientId||makeClientId();state.plexData.clientId=clientId;storage.savePlexData(state.plexData);
    state.plexMessage='Starting Plex sign-in…';setOperationMessage('plex',state.plexMessage);
    const headers=await accountHeaders(),pin=await createPlexPin(clientId,headers);state.plexPin=pin;window.open(pin.authUrl,'_blank','noopener');
    state.plexMessage='Complete sign-in in the Plex window. Waiting for approval…';setOperationMessage('plex',state.plexMessage);updateTask('plex-connect',{buttonLabel:'Waiting for Plex',detail:'Approve the Plex browser window'});
    const started=Date.now();
    while(Date.now()-started<10*60*1000){
      await new Promise(r=>setTimeout(r,2000));const result=await pollPlexPin(clientId,pin.id,headers);if(!result.authToken&&!result.connected)continue;
      if(result.cloud)state.plexData={...state.plexData,cloudConnected:true,token:null};else state.plexData.token=result.authToken;
      storage.savePlexData(state.plexData);await refreshPlexServers();showToast(accountConnected()?'Plex connected to your Ringside account.':'Plex connected in this browser.');patchConnectionIndicators();renderViewOnly();return;
    }
    throw new Error('Plex sign-in expired.');
  }catch(error){state.plexMessage=error.message;setOperationMessage('plex',state.plexMessage);showToast(error.message);throw error;}
}
async function refreshPlexServers(){
  try{
    state.plexMessage='Loading Plex servers…';setOperationMessage('plex',state.plexMessage);const headers=await accountHeaders();
    const data=await loadPlexResources(state.plexData.clientId,state.plexData.token,headers);
    state.plexData.servers=data.servers||[];state.plexData.account=data.account||null;if(data.cloud)state.plexData.cloudConnected=true;
    storage.savePlexData(state.plexData);state.plexMessage=`Found ${state.plexData.servers.length} Plex server(s). Load libraries for the server you want to scan.`;renderModalOnly();patchConnectionIndicators();
  }catch(error){state.plexMessage=error.message;setOperationMessage('plex',state.plexMessage);showToast(error.message);throw error;}
}
async function loadPlexLibrariesForServer(machineIdentifier){
  const server=state.plexData.servers.find(x=>x.machineIdentifier===machineIdentifier);if(!server)return;
  const taskKey=`plex-libraries:${machineIdentifier}`;
  try{
    state.plexMessage=`Testing secure connections for ${server.name}…`;setOperationMessage('plex',state.plexMessage);updateTask(taskKey,{detail:server.name});const headers=await accountHeaders();
    const data=await listPlexLibraries(state.plexData.clientId,state.plexData.token,server,headers);
    state.plexData.sectionsByServer={...(state.plexData.sectionsByServer||{}),[machineIdentifier]:data.sections||[]};
    const existing=state.plexData.selectedSectionKeysByServer?.[machineIdentifier];if(!Array.isArray(existing)||!existing.length)state.plexData.selectedSectionKeysByServer={...(state.plexData.selectedSectionKeysByServer||{}),[machineIdentifier]:suggestedPlexSections(data.sections||[])};
    if(data.server)state.plexData.selectedServer=data.server;storage.savePlexData(state.plexData);
    state.plexMessage=`Connected to ${server.name}. Found ${(data.sections||[]).length} scannable libraries.`;updateTask(taskKey,{detail:state.plexMessage,progress:100});renderModalOnly();
  }catch(error){state.plexMessage=error.message;setOperationMessage('plex',state.plexMessage);showToast(error.message);throw error;}
}
async function scanSelectedPlexServer(machineIdentifier){
  const server=state.plexData.servers.find(x=>x.machineIdentifier===machineIdentifier);if(!server)return;
  const taskKey=`plex-scan:${machineIdentifier}`;
  try{
    if(!plexSectionsFor(server).length)await loadPlexLibrariesForServer(machineIdentifier);
    const selected=selectedPlexSectionsFor(server);if(!selected.length)throw new Error('Select at least one Plex library.');
    const sectionNames=plexSectionsFor(server).filter(section=>selected.includes(String(section.key))).map(section=>section.title);
    state.plexMessage=`Scanning ${server.name}: ${sectionNames.join(', ')||'selected libraries'}…`;setOperationMessage('plex',state.plexMessage);updateTask(taskKey,{detail:sectionNames.join(', ')||server.name,progress:15});
    const headers=await accountHeaders(),data=await scanPlexLibrary(state.plexData.clientId,state.plexData.token,server,selected,headers);updateTask(taskKey,{detail:'Matching Plex records to the archive',progress:75});
    const rawItems=data.items||[],built=buildPlexMatches(state.data,rawItems,Number(state.settings.plexWatchedThreshold||0.9));state.plexData.items=matchedPlexItems(built);state.plexData.matches=[...built.matches];state.plexData.selectedServer=data.server||server;state.plexData.scannedAt=data.scannedAt||new Date().toISOString();state.plexData.sections=data.sections||plexSectionsFor(server);state.plexData.selectedSectionKeys=selected;if(data.cloud)state.plexData.cloudConnected=true;
    state.plexData.sectionsByServer={...(state.plexData.sectionsByServer||{}),[machineIdentifier]:data.sections||plexSectionsFor(server)};state.plexData.selectedSectionKeysByServer={...(state.plexData.selectedSectionKeysByServer||{}),[machineIdentifier]:selected};
    state.plexData=storage.savePlexData(state.plexData);refreshPlexIndex();if(accountConnected())await saveCloudIntegration('plex',state.plexData).catch(error=>{state.plexMessage=`Plex scan matched locally, but the account snapshot failed: ${error.message}`;});
    state.plexMessage=`Scanned ${rawItems.length.toLocaleString()} Plex items from ${sectionNames.join(', ')||'selected libraries'}; retained ${state.plexData.items.length.toLocaleString()} matched items and ${state.plexMatches.size.toLocaleString()} archive keys.`;
    updateTask(taskKey,{detail:state.plexMessage,progress:100});if(state.settings.autoImportPlexViewing)await importPlexViewingProgress({quiet:true});showToast(state.plexMessage);renderViewOnly();renderModalOnly();
  }catch(error){state.plexMessage=error.message;setOperationMessage('plex',state.plexMessage);showToast(error.message);throw error;}
}
async function syncStatusToPlex(item,status){
  const plex=plexItemFor(item);if(!plex?.ratingKey)return;
  const server=state.plexData.servers.find(x=>x.machineIdentifier===plex.machineIdentifier)||state.plexData.selectedServer,headers=await accountHeaders();
  await updatePlexViewState({clientId:state.plexData.clientId,token:state.plexData.token,server,item:plex,action:status==='watched'?'watched':'unwatched',accountHeaders:headers});
}
async function importPlexViewingProgress({quiet=false}={}){
  try{
    state.plexMessage='Importing Plex watched and in-progress states…';if(!quiet)setOperationMessage('plex',state.plexMessage);
    if(!state.autoEpisodeLoadComplete)await loadAllEpisodes(false);refreshPlexIndex();
    const changed=[],traktQueue=[];let watched=0,watching=0;
    for(const [key,view] of state.plexViewing){const target=view.watched?'watched':view.progress>0?'watching':null;if(!target||state.statuses[key]===target)continue;state.statuses[key]=target;changed.push(key);if(target==='watched'){watched++;const item=recordByKey(key);if(item&&state.settings.syncPlexWatchedToTrakt&&traktConnected())traktQueue.push(item);}else watching++;}
    storage.saveStatusesBulk(state.statuses,changed);scheduleCloudSync();
    for(let index=0;index<Math.min(250,traktQueue.length);index++){const item=traktQueue[index];try{await syncStatusToTrakt(item,'watched');}catch{}updateTask('plex-import-viewing',{detail:`Forwarding ${index+1}/${Math.min(250,traktQueue.length)} to Trakt`,progress:traktQueue.length?(index+1)/Math.min(250,traktQueue.length)*100:100});await new Promise(r=>setTimeout(r,120));}
    state.plexMessage=`Imported ${watched} watched and ${watching} in-progress Plex matches${traktQueue.length?`; forwarded ${Math.min(250,traktQueue.length)} to Trakt`:''}.`;
    if(!quiet){setOperationMessage('plex',state.plexMessage);showToast(state.plexMessage);renderViewOnly();renderModalOnly();}
  }catch(error){state.plexMessage=error.message;if(!quiet){setOperationMessage('plex',state.plexMessage);showToast(error.message);}throw error;}
}

function artworkEntryForKey(key){
  if(key.startsWith('company:')){
    const p=promotion(key.slice(8));if(!p)return null;
    return {key,item:{id:p.id,name:p.name,title:p.name,aliases:[p.shortName,...(p.aliases||[])]},programme:null,extra:{kind:'company',aliases:[p.shortName,...(p.aliases||[])],promotionName:p.name,promotionShortName:p.shortName}};
  }
  if(key.startsWith('wrestler:')){
    const name=key.slice(9);if(!name)return null;
    return {key,item:{id:normalize(name).replace(/[^a-z0-9]+/g,'-'),name,title:name},programme:null,extra:{kind:'wrestler'}};
  }
  if(key.startsWith('program:')){
    const item=programme(key.slice(8)),p=item&&promotion(item.promotionId);
    return item?{key,item,programme:item,extra:{kind:item.kind,promotionName:p?.name||'',promotionShortName:p?.shortName||'',tvMazeId:item.tvMazeId||null,sourceUrl:item.sourceUrl||''}}:null;
  }
  const item=recordByKey(key),prog=item&&programme(item.programId),p=item&&promotion(item.promotionId);
  return item?{key,item,programme:prog,extra:{kind:item.kind,promotionName:p?.name||'',promotionShortName:p?.shortName||'',tvMazeId:prog?.tvMazeId||null,sourceUrl:item.sourceUrl||prog?.sourceUrl||''}}:null;
}
function currentArtworkEntries(){
  let entries=[];
  if(state.view==='companies'){
    entries=state.data.promotions.filter(p=>!state.filters.region||p.region===state.filters.region).slice(0,Math.max(24,state.visible)).map(p=>artworkEntryForKey(companyArtworkKey(p.id)));
  }else if(state.view==='wrestlers'&&!state.filters.wrestler){
    entries=sortedWrestlerProfiles().slice(0,state.visible).map(profile=>artworkEntryForKey(wrestlerArtworkKey(profile.name)));
  }else if(state.view==='chronology'){
    const programmes=state.data.programmes.filter(p=>matchFilters(p,'programme')).slice(0,Math.min(state.visible,24));
    const companies=[...new Set(programmes.map(p=>p.promotionId))].map(id=>artworkEntryForKey(companyArtworkKey(id)));
    entries=[...companies,...programmes.map(p=>artworkEntryForKey(`program:${p.id}`))];
  }else if(state.view==='exact'){
    const records=exactRecords().filter(item=>matchFilters(item)).slice(0,Math.min(state.visible,24));
    const companies=[...new Set(records.map(item=>item.promotionId).filter(Boolean))].map(id=>artworkEntryForKey(companyArtworkKey(id)));
    entries=[...companies,...records.map(item=>artworkEntryForKey(item.isProgrammeIndex?`program:${item.programId}`:statusKey(item)))];
  }
  const seen=new Set();
  return entries.filter(Boolean).filter(entry=>!seen.has(entry.key)&&seen.add(entry.key)).filter(entry=>!hasArtworkResult(state.artworkCache[entry.key])&&artworkLookupAllowed(entry.key));
}

async function storeArtworkBatch(entries,{showProgress=false}={}){
  if(!entries.length)return {found:0,keys:[]};
  const payload=await searchArtworkBatch(entries);let found=0;const keys=[];
  for(const row of payload.results||[]){
    const key=String(row.key||'');if(!key)continue;keys.push(key);
    if(row.result&&!row.result.error&&Number(row.result.confidence||100)>=80){state.artworkCache[key]={...row.result,scannerVersion:2,scannedAt:new Date().toISOString()};found++;}
    else state.artworkCache[key]={error:row.result?.error||'No artwork match',notFoundUntil:new Date(Date.now()+7*24*60*60*1000).toISOString(),scannedAt:new Date().toISOString()};
  }
  storage.saveArtwork(state.artworkCache);
  if(showProgress)state.artworkMessage=`Artwork scan: ${found} matches from ${entries.length} requests.`;
  return {found,keys};
}
function scheduleArtworkHydration(){
  clearTimeout(state.autoArtworkTimer);
  if(state.autoArtworkRunning||!('onLine' in navigator)||navigator.onLine===false||!['exact','chronology'].includes(state.view))return;
  state.autoArtworkTimer=setTimeout(async()=>{
    const entries=currentArtworkEntries().slice(0,4);if(!entries.length)return;
    state.autoArtworkRunning=true;
    try{const result=await storeArtworkBatch(entries);patchArtworkElements(result.keys);}catch(error){console.warn('Background artwork scan:',error.message);}finally{state.autoArtworkRunning=false;}
  },2400);
}
async function scanArtworkKey(key){
  const entry=artworkEntryForKey(key);if(!entry)return;
  const taskKey=`scan-art:${key}`,title=entry.item.title||entry.item.name;
  try{
    state.artworkMessage=`Scanning artwork for ${title}…`;setOperationMessage('artwork',state.artworkMessage);updateTask(taskKey,{detail:'Searching verified artwork sources',progress:15});
    const result=await searchArtwork(entry.item,entry.programme,entry.extra);updateTask(taskKey,{detail:'Applying artwork',progress:85});
    if(Number(result.confidence||100)<80)throw new Error('The artwork result was rejected because its match confidence was too low.');
    state.artworkCache[key]={...result,scannerVersion:2,scannedAt:new Date().toISOString()};storage.saveArtwork(state.artworkCache);patchArtworkElements([key]);
    state.artworkMessage=`Artwork found for ${title}.`;setOperationMessage('artwork',state.artworkMessage);showToast(state.artworkMessage);updateTask(taskKey,{detail:state.artworkMessage,progress:100});
    if(state.modal?.type==='record'||state.modal?.type==='programme')renderModalOnly();
  }catch(error){state.artworkCache[key]={error:error.message,notFoundUntil:new Date(Date.now()+24*60*60*1000).toISOString()};storage.saveArtwork(state.artworkCache);state.artworkMessage=error.message;setOperationMessage('artwork',state.artworkMessage);showToast(error.message);throw error;}
}
async function installServiceWorker(){
  if(!('serviceWorker' in navigator))return;
  const version='5.6.0',versionKey='ringside-app-version';
  try{
    const previous=localStorage.getItem(versionKey);
    if(previous!==version&&globalThis.caches){
      const keys=await caches.keys();
      await Promise.all(keys.filter(key=>key.startsWith('ringside-archive-')).map(key=>caches.delete(key)));
      localStorage.setItem(versionKey,version);
    }
    const registration=await navigator.serviceWorker.register('./service-worker.js?v=5.6.0',{updateViaCache:'none'});
    await registration.update().catch(()=>{});
    const activateWaiting=()=>registration.waiting?.postMessage({type:'SKIP_WAITING'});
    activateWaiting();
    registration.addEventListener?.('updatefound',()=>{
      const worker=registration.installing;
      worker?.addEventListener?.('statechange',()=>{if(worker.state==='installed')activateWaiting();});
    });
    let announced=false;
    navigator.serviceWorker.addEventListener?.('controllerchange',()=>{
      // Never force-reload an active reading session. The new worker controls the
      // current page immediately and the newest shell is used on the next navigation.
      if(announced)return;announced=true;showToast('Ringside Archive updated in the background. Your current position was preserved.');
    });
  }catch(error){console.warn('Service worker update:',error.message);}
}

async function scanVisibleArtwork(){
  if(state.scanningArtwork)return;state.scanningArtwork=true;
  const taskKey='scan-visible-artwork',list=currentArtworkEntries().slice(0,80);let done=0,found=0;
  try{
    if(!list.length){state.artworkMessage='Visible records already have artwork or are waiting for a retry window.';setOperationMessage('artwork',state.artworkMessage);showToast(state.artworkMessage);return;}
    setOperationMessage('artwork',`Artwork scan 0/${list.length}`);
    for(let index=0;index<list.length;index+=6){
      const batch=list.slice(index,index+6),result=await storeArtworkBatch(batch);found+=result.found;done+=batch.length;patchArtworkElements(result.keys);
      state.artworkMessage=`Artwork scan ${done}/${list.length} • ${found} matches`;setOperationMessage('artwork',state.artworkMessage);updateTask(taskKey,{detail:state.artworkMessage,progress:list.length?done/list.length*100:100});
      await new Promise(resolve=>setTimeout(resolve,180));
    }
    state.artworkMessage=`Artwork scan complete: ${found} new matches.`;setOperationMessage('artwork',state.artworkMessage);showToast(state.artworkMessage);
  }catch(error){state.artworkMessage=error.message;setOperationMessage('artwork',state.artworkMessage);showToast(error.message);throw error;}finally{state.scanningArtwork=false;}
}


const SCROLL_SESSION_KEY='ringside-scroll-v1';
const persistScroll=debounce(()=>{
  try{sessionStorage.setItem(SCROLL_SESSION_KEY,JSON.stringify({route:`${location.pathname}${location.hash}`,x:window.scrollX||0,y:window.scrollY||0,at:Date.now()}));}catch{}
},180);
window.addEventListener?.('scroll',persistScroll,{passive:true});
window.addEventListener?.('pagehide',persistScroll);
function restoreSessionScroll(){
  try{
    const saved=JSON.parse(sessionStorage.getItem(SCROLL_SESSION_KEY)||'null');
    if(!saved||saved.route!==`${location.pathname}${location.hash}`||Date.now()-saved.at>30*60*1000)return;
    const raf=globalThis.requestAnimationFrame||((callback)=>setTimeout(callback,0));raf(()=>raf(()=>window.scrollTo?.({left:saved.x||0,top:saved.y||0,behavior:'auto'})));
  }catch{}
}

(async function init(){
  try {
    state.data=await loadData();
    rebuildWrestlerIndex();
    refreshPlexIndex();
    const hash=location.hash.slice(1);if(navItems.some(x=>x[0]===hash))state.view=hash;
    render({preserveScroll:false});restoreSessionScroll();
    installServiceWorker();

    // Heavy metadata, account restoration and thousands of episode rows are deliberately
    // deferred until after the first usable paint.
    onIdle(()=>loadDeferredData(),300);
    onIdle(async()=>{
      try{
        state.cloud.config=await loadCloudConfig();
        const authRedirect=consumeCloudAuthRedirect();state.cloud.recovery=authRedirect?.type==='recovery';
        state.cloud.user=await getCloudUser();
        if(state.cloud.user){
          const switched=storage.prepareForAccount(state.cloud.user.id);
          if(switched){refreshStateFromStorage();state.plexData=storage.plexData();state.trakt=storage.trakt();refreshPlexIndex();}
          await syncCloudNow({quiet:true});await loadAccountIntegrations({migrate:true});
        }
        if(state.cloud.recovery){state.modal={type:'account'};state.cloud.message='Enter and confirm your new password.';}
        renderViewOnly();if(state.modal)renderModalOnly();
      }catch(error){state.cloud.message=error.message;console.warn('Account bootstrap:',error.message);renderViewOnly();if(state.modal)renderModalOnly();}
    },500);
    if(state.settings.autoLoadEpisodes&&['exact','chronology'].includes(state.view)&&!new URLSearchParams(location.search).has('noautoload'))onIdle(()=>loadAllEpisodes(false),1800);

    const cloudPoll=setInterval(()=>{if(accountConnected()&&state.settings.cloudAutoSync!==false)syncCloudNow({quiet:true}).catch(()=>{});},60000);cloudPoll?.unref?.();
    if(document.addEventListener)document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&accountConnected()&&state.settings.cloudAutoSync!==false){syncCloudNow({quiet:true}).then(()=>loadAccountIntegrations({migrate:false})).catch(()=>{});}});
  }catch(error){app.innerHTML=`<div class="bootScreen"><span class="brandMark">RA</span><h1>Archive failed to load</h1><p>${h(error.message)}</p><p>Use a local web server rather than opening index.html directly.</p></div>`;}
})();
