import { storage } from './storage.js';
import { loadTvMazeFeed, normalizeEpisode, loadPromotionEpisodes, discoverTvMazeId } from './tvmaze.js';
import { escapeHtml as h, fmtDate, yearOf, downloadJson, normalize, debounce, icon } from './utils.js';
import { detailsFor, parseCompetitors, recordTraktPayload } from './records.js';
import { makeClientId, buildPlexMatches, plexWebUrl, createPlexPin, pollPlexPin, loadPlexResources, scanPlexLibrary, updatePlexViewState, searchArtwork } from './integrations.js';
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
  visible: 50,
  filtersOpen: false,
  modal: null,
  toast: '',
  syncMessage: '',
  libraryTab: 'all',
  autoEpisodeLoadStarted: false,
  autoEpisodeLoadComplete: false,
  plexMessage: '',
  traktMessage: '',
  artworkMessage: '',
  scanningArtwork: false,
  plexPin: null,
  cloud: { config:null, user:null, message:'', syncing:false, integrationsLoaded:false, recovery:false }
};

const DATA_FILES = ['promotions','programmes','major-events','recommendations','wrestlers','format-labels','artwork-overrides','artwork-catalog','event-details','custom-records','meta'];
const statusLabels = { unwatched:'Not started', watching:'Watching', watched:'Watched', skipped:'Skipped' };
const navItems = [
  ['exact','timeline','Complete Timeline'],['chronology','shows','Show Index'],['wrestlers','wrestlers','Wrestlers'],
  ['recommended','picks','Recommended'],['companies','companies','Companies'],['library','library','My Library']
];

async function loadData() {
  const results = await Promise.all(DATA_FILES.map(async name => {
    const response = await fetch(`./data/${name}.json`);
    if (!response.ok) throw new Error(`Unable to load data/${name}.json`);
    return response.json();
  }));
  const data = Object.fromEntries(DATA_FILES.map((name,index)=>[name.replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),results[index]]));
  data.promotionMap = new Map(data.promotions.map(x=>[x.id,x]));
  data.programmeMap = new Map(data.programmes.map(x=>[x.id,x]));
  data.recommendationsByProgramme = new Map();
  for (const item of data.recommendations) data.recommendationsByProgramme.set(item.programId,[...(data.recommendationsByProgramme.get(item.programId)||[]),item]);
  return data;
}

function promotion(id){ return state.data.promotionMap.get(id); }
function programme(id){ return state.data.programmeMap.get(id); }
function currentStatus(key) { return state.statuses[key] || 'unwatched'; }
function statusKey(record){ return record.itemKey || `event:${record.id}`; }
function allLoadedEpisodes(){ return [...state.loadedEpisodes.values()].flat(); }
function programmeTimelineRecords(){
  return state.data.programmes.map(p=>({
    ...p, title:p.name, date:p.firstAirDate, programId:p.id, itemKey:`program:${p.id}`,
    isProgrammeIndex:true, timelineLabel:'Programme begins / archive index'
  }));
}
function exactRecords(){ return [...programmeTimelineRecords(),...state.data.majorEvents,...state.data.customRecords,...allLoadedEpisodes()].sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.title).localeCompare(String(b.title))); }
function recordByKey(key){
  if(key.startsWith('episode:')) return allLoadedEpisodes().find(item=>statusKey(item)===key);
  if(key.startsWith('event:')) return [...state.data.majorEvents,...state.data.customRecords].find(item=>statusKey(item)===key);
  return null;
}
function showToast(message) { state.toast = message; render(); setTimeout(()=>{ if(state.toast===message){state.toast='';render();}},3800); }
function setView(view) { state.view=view; state.visible=50; state.modal=null; location.hash=`#${view}`; render(); }

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
  state.cloud.syncing=true;if(!quiet){state.cloud.message='Synchronizing account data…';render();}
  try{
    const remote=await pullCloudState();
    if(remote?.state)storage.mergeCloudState(remote.state);
    refreshStateFromStorage();refreshPlexIndex();
    const meta=storage.cloudMeta();
    const saved=await pushCloudState(storage.cloudState(),Math.max(Number(meta.revision||0),Number(remote?.revision||0)));
    storage.saveCloudMeta({revision:Number(saved?.revision||remote?.revision||0),lastSyncAt:new Date().toISOString(),dirty:false});
    state.cloud.message=`Synced ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
  }catch(error){state.cloud.message=error.message;if(!quiet)showToast(error.message);}
  finally{state.cloud.syncing=false;render();}
}

function applyPublicIntegrations(integrations=[]){
  const trakt=integrations.find(x=>x.provider==='trakt');
  if(trakt)state.trakt={...state.trakt,accessToken:null,refreshToken:null,cloudConnected:Boolean(trakt.connected),cloud:true,account:trakt.account||null,expiresAt:trakt.expiresAt||null};
  else if(!state.trakt.accessToken)state.trakt={...state.trakt,cloudConnected:false,cloud:false,account:null};
  storage.saveTrakt(state.trakt);
  const plex=integrations.find(x=>x.provider==='plex');
  if(plex)state.plexData={...state.plexData,...plex,cloudConnected:Boolean(plex.connected),token:null};
  else if(!state.plexData.token)state.plexData={...state.plexData,cloudConnected:false};
  storage.savePlexData(state.plexData);refreshPlexIndex();
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
  state.cloud.message='Account connected across devices.';render();
}
function youtubeUrlFor(item){ return item.watchUrl || item.youtubeUrl || programme(item.programId)?.youtubeUrl || promotion(item.promotionId)?.youtubeUrl || ''; }

function setStatus(key, status, options={}) {
  if (status === 'unwatched') delete state.statuses[key]; else state.statuses[key] = status;
  storage.saveStatuses(state.statuses,key);scheduleCloudSync();
  const item=recordByKey(key);
  if(item && options.syncExternal!==false && traktConnected() && (status==='watched'||status==='unwatched')) syncStatusToTrakt(item,status).catch(error=>console.warn(error));
  if(item && options.syncExternal!==false && state.settings.pushWatchedToPlex && plexAvailable(item) && (status==='watched'||status==='unwatched')) syncStatusToPlex(item,status).catch(error=>console.warn(error));
  render();
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
  if (f.availability === 'youtube' && !youtubeUrlFor(item)) return false;
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
    local.poster&&{url:local.poster,type:'poster',label:local.source||'Scanned poster',sourceUrl:local.sourceUrl},
    local.backdrop&&{url:local.backdrop,type:'backdrop',label:local.source||'Scanned backdrop',sourceUrl:local.sourceUrl},
    local.still&&{url:local.still,type:'episode',label:local.source||'Scanned still',sourceUrl:local.sourceUrl},
    plex?.thumbUrl&&{url:plex.thumbUrl,type:item.kind==='episode'?'episode':'poster',label:'Plex artwork'},
    plex?.artUrl&&{url:plex.artUrl,type:'backdrop',label:'Plex background'}
  ].filter(Boolean);
  const seen=new Set();return values.filter(value=>value.url&&!seen.has(value.url)&&(seen.add(value.url),true));
}
function artwork(item, context='card', isProgramme=false) {
  const p=promotion(item.promotionId), candidates=artworkCandidates(item,isProgramme);
  const src=candidates.find(x=>item.kind==='episode'&&x.type==='episode')?.url || candidates.find(x=>x.type==='poster')?.url || candidates[0]?.url || '';
  const title=item.title||item.name;
  return `<div class="artwork ${context} ${src?'hasImage':''}" style="--accent:${h(p?.color||'#d7a84f')}"><div class="artworkFallback artworkInner"><span>${h(p?.shortName||'Archive')}</span><strong>${h(title)}</strong></div>${src?`<img loading="lazy" src="${h(src)}" alt="${h(title)} artwork" referrerpolicy="no-referrer"/>`:''}</div>`;
}
function artworkGallery(item,isProgramme=false){
  const candidates=artworkCandidates(item,isProgramme);
  if(!candidates.length)return `<div class="sourceEmpty"><div><h4>No verified artwork found yet</h4><p>Use the no-key Wikipedia/Wikimedia scanner, add a TMDB key for richer season/episode art, import Plex, or add a verified override.</p></div><button data-scan-art="${h(isProgramme?`program:${item.id}`:statusKey(item))}">Scan artwork</button></div>`;
  return `<div class="artworkGallery">${candidates.map(image=>`<figure><img src="${h(image.url)}" alt="${h(image.label||'Artwork')}" loading="lazy" referrerpolicy="no-referrer"><figcaption>${image.sourceUrl?`<a href="${h(image.sourceUrl)}" target="_blank" rel="noreferrer">${h(image.label||image.type||'Artwork')} ↗</a>`:h(image.label||image.type||'Artwork')}</figcaption></figure>`).join('')}</div>`;
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
    <aside class="progressCard"><div class="progressHeading"><div><span class="eyebrow">Your archive</span><h2>Viewing progress</h2></div><strong>${percent}%</strong></div><div class="progressTrack"><span style="width:${percent}%"></span></div><div class="metricGrid"><div><strong>${counts.promotions}</strong><span>Promotions</span></div><div><strong>${counts.programmes}</strong><span>Programme families</span></div><div><strong>${counts.majorEvents}</strong><span>Dated major events</span></div><div><strong>${allLoadedEpisodes().length.toLocaleString()}</strong><span>Exact episodes</span></div></div><div class="connectionRail"><span class="${traktConnected()?'ready':''}"><b>T</b> Trakt</span><span class="${plexConnected()||state.plexMatches.size?'ready':''}"><b>›</b> Plex</span><span class="${state.autoEpisodeLoadComplete?'ready':''}"><b>TV</b> Episode feeds</span><span class="ready"><b>▶</b> Free links</span></div></aside>
  </section>`;
}

function catalogueStatement(){
  const byRegion=state.data.promotions.reduce((a,p)=>((a[p.region]??=[]).push(p),a),{});
  return `<section class="catalogueStatement"><div><span class="eyebrow">Programme-first complete index</span><h2>From territory television to global streaming</h2><p>All ${state.data.programmes.length} recovered weekly-show and event-series families are indexed. Every verified episode feed is loaded automatically into the Complete Timeline; unmapped historic series remain visible without invented dates and can be discovered or imported later.</p></div><div class="statementStats"><span><strong>${byRegion['United States']?.length||0}</strong> U.S.</span><span><strong>${byRegion['Japan']?.length||0}</strong> Japan</span><span><strong>${byRegion['United Kingdom & Europe']?.length||0}</strong> UK / Europe</span><span><strong>${(byRegion['Mexico & Latin America']?.length||0)+(byRegion['Canada']?.length||0)+(byRegion['Australia']?.length||0)}</strong> Other</span></div></section>`;
}

function select(key,label,empty,options,value){return `<label><span>${label}</span><select data-filter="${key}"><option value="">${empty}</option>${options.map(([v,l])=>`<option value="${h(v)}" ${String(value)===String(v)?'selected':''}>${h(l)}</option>`).join('')}</select></label>`;}
function filterPanel(){
  const f=state.filters, regions=[...new Set(state.data.promotions.map(p=>p.region))].sort();
  const kinds=[...new Set([...state.data.programmes.map(p=>p.kind),...state.data.majorEvents.map(e=>e.kind),'episode'])].sort();
  return `<section class="filterPanel ${state.filtersOpen?'':'collapsed'}"><div class="filterTop"><label class="searchField"><span class="navIcon">${icon('search')}</span><input id="searchInput" placeholder="Search show, company, wrestler, match or event…" value="${h(f.query)}" /></label><button class="filterToggle" data-action="toggle-filters" aria-expanded="${state.filtersOpen}">${icon('filter')} Filters ${state.filtersOpen?'▴':'▾'}</button><div class="resultSummary"><strong id="resultCount">—</strong> results</div></div><div class="filterGrid">
    ${select('region','Region','All regions',regions.map(x=>[x,x]),f.region)}
    ${select('promotion','Company','All companies',state.data.promotions.map(p=>[p.id,`${p.shortName} — ${p.name}`]),f.promotion)}
    ${select('kind','Format','All formats',kinds.map(x=>[x,state.data.formatLabels[x]||x]),f.kind)}
    <label><span>From year</span><input class="yearInput" data-filter="yearFrom" type="number" min="1930" max="2100" value="${h(f.yearFrom)}" placeholder="1970"></label>
    <label><span>To year</span><input class="yearInput" data-filter="yearTo" type="number" min="1930" max="2100" value="${h(f.yearTo)}" placeholder="Present"></label>
    ${select('wrestler','Wrestler','All wrestlers',state.data.wrestlers.map(x=>[x,x]),f.wrestler)}
    ${select('availability','Availability','Any availability',[['plex','Available in Plex'],['youtube','Official/free YouTube'],['artwork','Has artwork'],['missing-artwork','Missing artwork'],['tvmaze','Exact episode feed'],['recommended','Curated recommendation']],f.availability)}
    <label class="checkField"><input data-filter="hideWatched" type="checkbox" ${f.hideWatched?'checked':''}/><span>Hide watched</span></label><button class="resetButton" data-action="reset-filters">Reset all</button>
  </div></section>`;
}

function exactView(){
  const filtered=exactRecords().filter(x=>matchFilters(x));
  const visible=filtered.slice(0,state.visible);
  queueMicrotask(()=>{const el=document.querySelector('#resultCount');if(el)el.textContent=filtered.length.toLocaleString();});
  return `<div class="viewHeader"><div><span class="eyebrow">Individual dated records</span><h2>Exact episodes, PPVs & supercards</h2></div><div class="viewControls"><span>${allLoadedEpisodes().length.toLocaleString()} exact weekly episodes loaded</span></div></div>
  <section class="exactChronologyView"><div class="exactCoverageBar"><div><span class="eyebrow">Unified watch chronology</span><h3>Television, PPVs, PLEs, tournaments & supercards</h3><p>Mapped weekly feeds load automatically and merge with the recovered major-event catalogue. Use filters for company, wrestler, date range, YouTube, Plex or artwork.</p>${state.syncMessage?`<div class="syncProgress">${h(state.syncMessage)}</div>`:''}</div><div class="coverageActions"><button data-action="reload-all-episodes">Refresh all exact feeds</button><button data-action="discover-feeds">Discover more feeds</button><button data-action="scan-visible-artwork">Scan visible artwork</button></div></div>
  <div class="exactRecordsList">${visible.map(exactCard).join('')||empty('No records match the current filters.','Reset the filters or widen the year range.')}</div>${filtered.length>state.visible?`<div class="loadMoreRow"><button data-action="load-more">Show ${Math.min(50,filtered.length-state.visible)} more</button></div>`:''}</section>`;
}

function exactCard(e){
  const p=promotion(e.promotionId), prog=programme(e.programId), key=statusKey(e), status=currentStatus(key), plex=plexAvailable(e), plexState=plexProgressFor(e), youtube=youtubeUrlFor(e);
  if(e.isProgrammeIndex){
    const programmeArt=artworkCandidates(prog,true);
    return `<article class="exactRecordCard programmeTimelineCard ${status==='watched'?'isWatched':''}" style="--accent:${h(p?.color||'#d7a84f')}" data-open-programme="${h(prog.id)}" role="button" tabindex="0"><div class="exactRecordDate"><strong>${h(String(e.date).slice(0,4))}</strong><span>${h(fmtDate(e.date).replace(/, \d{4}$/,''))}</span><small>SHOW INDEX</small></div>${artwork(prog,'exactRecordArtwork',true)}<div class="exactRecordMain"><div class="programmeKicker"><span>${h(p?.shortName||'')}</span><span>•</span><span>${h(state.data.formatLabels[prog.kind]||prog.kind)}</span><b>Programme chronology</b></div><h3>${h(prog.name)}</h3><p>${h(prog.description)}</p><div class="exactRecordFacts"><span>Begins ${h(fmtDate(prog.firstAirDate))}</span>${prog.endDate?`<span>Ends ${h(fmtDate(prog.endDate))}</span>`:''}<span>${h(prog.cadence)}</span><span>${(state.loadedEpisodes.get(prog.id)||[]).length.toLocaleString()} exact episodes loaded</span></div><div class="availabilityLights"><span class="light ${plex?'pickLight':''}"><i></i> Plex${plex?(plexState?.watched?' watched':plexState?.progress?` ${Math.round(plexState.progress*100)}%`:' available'):''}</span><span class="light ${youtube?'pickLight':''}"><i></i> YouTube/free</span><span class="light ${programmeArt.length?'pickLight':''}"><i></i> Artwork</span></div></div><div class="exactRecordActions"><span class="statusPill status-${status}">${statusLabels[status]}</span><div class="recordStatus">${['watched','watching','skipped'].map(s=>`<button class="${status===s?'active':''}" data-status-key="${h(key)}" data-status="${s}">${s==='watched'?'✓ ':''}${statusLabels[s]}</button>`).join('')}</div><button data-open-programme="${h(prog.id)}">Open complete show</button></div></article>`;
  }
  const details=detailsFor(e,state.data);
  return `<article class="exactRecordCard ${status==='watched'?'isWatched':''}" style="--accent:${h(p?.color||'#d7a84f')}" data-open-record="${h(e.id)}" role="button" tabindex="0"><div class="exactRecordDate"><strong>${h(String(e.date).slice(0,4))}</strong><span>${h(fmtDate(e.date).replace(/, \d{4}$/,''))}</span><small>${h(e.kind)}</small></div>${artwork(e,'exactRecordArtwork')}<div class="exactRecordMain"><div class="programmeKicker"><span>${h(p?.shortName||'')}</span><span>•</span><span>${h(e.code||prog?.name||'Exact record')}</span><b>${String(e.id).startsWith('tvmaze:')?'Exact episode':'Verified date'}</b></div><h3>${h(e.title)}</h3>${prog?.name&&prog.name!==e.title?`<p class="eventName">${h(prog.name)}</p>`:''}<p>${h(e.description||e.mainEvent||'Open for the full available card, competitors and review notes.')}</p><div class="exactRecordFacts"><span>${h(fmtDate(e.date))}</span>${e.venue?`<span>${h(e.venue)}</span>`:''}${e.location?`<span>${h(e.location)}</span>`:''}${e.runtime?`<span>${e.runtime} min</span>`:''}${details.competitors.length?`<span>${details.competitors.length} competitors</span>`:''}</div><div class="availabilityLights"><span class="light ${plex?'pickLight':''}"><i></i> Plex${plex?(plexState?.watched?' watched':plexState?.progress?` ${Math.round(plexState.progress*100)}%`:' available'):''}</span><span class="light ${youtube?'pickLight':''}"><i></i> YouTube/free</span><span class="light ${artworkCandidates(e).length?'pickLight':''}"><i></i> Artwork</span></div></div><div class="exactRecordActions"><span class="statusPill status-${status}">${statusLabels[status]}</span><div class="recordStatus">${['watched','watching','skipped'].map(s=>`<button class="${status===s?'active':''}" data-status-key="${h(key)}" data-status="${s}">${s==='watched'?'✓ ':''}${statusLabels[s]}</button>`).join('')}</div>${plexLinkButton(e)}<button data-open-record="${h(e.id)}">Full card</button></div></article>`;
}
function plexLinkButton(item){const plex=plexItemFor(item),server=state.plexData.selectedServer||state.plexData.servers?.find(x=>x.machineIdentifier===plex?.machineIdentifier),url=plexWebUrl(plex,server);return url?`<a href="${h(url)}" target="_blank" rel="noreferrer">Open Plex ↗</a>`:'';}

function chronologyView(){
  const filtered=state.data.programmes.filter(p=>matchFilters(p,'programme'));
  const items=filtered.slice(0,state.visible);
  queueMicrotask(()=>{const el=document.querySelector('#resultCount');if(el)el.textContent=filtered.length.toLocaleString();});
  return `<div class="viewHeader"><div><span class="eyebrow">Programme-first catalogue</span><h2>Weekly shows, television, streaming & event series</h2></div><div class="viewControls"><span>${state.data.programmes.length} total programme families</span></div></div><section class="programmeGrid">${items.map(programmeCard).join('')||empty('No programmes found.','Try another company, year range or search term.')}</section>${filtered.length>state.visible?`<div class="loadMoreRow"><button data-action="load-more">Show more</button></div>`:''}`;
}
function programmeCard(p){
  const company=promotion(p.promotionId), status=currentStatus(`program:${p.id}`), loaded=state.loadedEpisodes.get(p.id)?.length||0, mapped=p.tvMazeId||state.feedMap[p.id];
  return `<article class="programmeCard" style="--accent:${h(company?.color||'#d7a84f')}" data-open-programme="${h(p.id)}" role="button" tabindex="0">${artwork(p,'programmeArtwork',true)}<div class="programmeCardBody"><div class="programmeKicker"><span>${h(company?.shortName||'')}</span><span>•</span><span>${h(state.data.formatLabels[p.kind]||p.kind)}</span></div><h3>${h(p.name)}</h3><p>${h(p.description)}</p><div class="heroMeta"><span>${h(p.firstAirDate)}${p.endDate?` – ${h(p.endDate)}`:''}</span><span>${h(p.cadence)}</span>${mapped?`<span class="statusPill status-watching">${loaded?`${loaded.toLocaleString()} episodes`:'Exact feed'}</span>`:'<span>Index only</span>'}</div><div class="programmeCardActions"><button data-open-programme="${h(p.id)}">Open show</button>${p.youtubeUrl?`<a href="${h(p.youtubeUrl)}" target="_blank" rel="noreferrer">YouTube ↗</a>`:''}<button data-status-key="program:${h(p.id)}" data-status="${status==='watched'?'unwatched':'watched'}">${status==='watched'?'Unwatch':'Watched'}</button></div></div></article>`;
}

function companiesView(){
  const items=state.data.promotions.filter(p=>{
    if(state.filters.region&&p.region!==state.filters.region)return false;
    if(state.filters.promotion&&p.id!==state.filters.promotion)return false;
    if(state.filters.query&&!normalize(`${p.name} ${p.shortName} ${p.description}`).includes(normalize(state.filters.query)))return false;
    return true;
  });
  queueMicrotask(()=>{const el=document.querySelector('#resultCount');if(el)el.textContent=items.length.toLocaleString();});
  return `<div class="viewHeader"><div><span class="eyebrow">Promotion directory</span><h2>Companies, territories & lineages</h2></div></div><section class="cardGrid">${items.map(p=>{const pc=state.data.programmes.filter(x=>x.promotionId===p.id).length,ec=state.data.majorEvents.filter(x=>x.promotionId===p.id).length,episodes=allLoadedEpisodes().filter(x=>x.promotionId===p.id).length;return `<article class="companyCard" style="--accent:${h(p.color)}"><div class="companySwatch"></div><span class="eyebrow">${h(p.region)}</span><h3>${h(p.shortName)}</h3><strong>${h(p.name)}</strong><p>${h(p.description)}</p><div class="heroMeta"><span>${pc} programmes</span><span>${ec} events</span><span>${episodes.toLocaleString()} episodes</span></div><div class="cardActions"><button data-company="${h(p.id)}">Open chronology</button>${p.officialUrl?`<a href="${h(p.officialUrl)}" target="_blank">Official ↗</a>`:''}${p.youtubeUrl?`<a href="${h(p.youtubeUrl)}" target="_blank">YouTube ↗</a>`:''}</div></article>`}).join('')}</section>`;
}

function recommendedView(){
  const filtered=state.data.recommendations.filter(x=>matchFilters(x)),items=filtered.slice(0,state.visible);
  queueMicrotask(()=>{const el=document.querySelector('#resultCount');if(el)el.textContent=filtered.length.toLocaleString();});
  return `<div class="viewHeader"><div><span class="eyebrow">Curated paths</span><h2>Recommended matches, events & episodes</h2></div></div><section class="cardGrid">${items.map(x=>{const p=promotion(x.promotionId),key=`recommendation:${x.id}`,st=currentStatus(key);return `<article class="recommendationCard" style="--accent:${h(p?.color||'#d7a84f')}"><span class="eyebrow">${h(fmtDate(x.date))} • ${h(p?.shortName||'')}</span><h3>${h(x.title)}</h3><strong>${h(x.event)}</strong><p>${h(x.why)}</p><div class="wrestlerTags">${(x.wrestlers||[]).map(w=>`<span>${h(w)}</span>`).join('')}</div><div class="cardActions">${x.watchUrl?`<a href="${h(x.watchUrl)}" target="_blank">Watch/search ↗</a>`:''}${x.sourceUrl?`<a href="${h(x.sourceUrl)}" target="_blank">Source ↗</a>`:''}<button data-status-key="${key}" data-status="${st==='watched'?'unwatched':'watched'}">${st==='watched'?'Watched ✓':'Mark watched'}</button></div></article>`}).join('')}</section>`;
}

function careerItems(wrestler){
  const n=normalize(wrestler), events=exactRecords().filter(e=>normalize(`${e.title} ${e.mainEvent||''} ${competitorsFor(e).join(' ')}`).includes(n)).map(e=>({...e,_type:'event'}));
  const picks=state.data.recommendations.filter(r=>(r.wrestlers||[]).some(w=>normalize(w)===n)).map(e=>({...e,_type:'pick'}));
  return [...events,...picks].sort((a,b)=>a.date.localeCompare(b.date));
}
function wrestlersView(){
  if(state.filters.wrestler) return wrestlerCareer(state.filters.wrestler);
  const query=normalize(state.filters.query), items=state.data.wrestlers.filter(w=>!query||normalize(w).includes(query));
  queueMicrotask(()=>{const el=document.querySelector('#resultCount');if(el)el.textContent=items.length.toLocaleString();});
  return `<div class="viewHeader"><div><span class="eyebrow">Career viewing routes</span><h2>Follow a wrestler chronologically</h2></div></div><section class="wrestlerDirectory">${items.map(w=>{const count=careerItems(w).length;return `<button class="wrestlerButton" data-wrestler="${h(w)}"><strong>${h(w)}</strong><span>${count.toLocaleString()} matched records and curated picks</span></button>`}).join('')}</section>`;
}
function wrestlerCareer(w){const items=careerItems(w);return `<div class="viewHeader"><div><span class="eyebrow">Career chronology</span><h2>${h(w)}</h2></div><div class="viewControls"><button data-action="clear-wrestler">Back to directory</button></div></div><section class="careerTimeline">${items.map(x=>x._type==='event'?exactCard(x):`<article class="careerCard"><span class="eyebrow">${h(fmtDate(x.date))} • Curated pick</span><h3>${h(x.title)}</h3><strong>${h(x.event)}</strong><p>${h(x.why)}</p>${x.watchUrl?`<div class="cardActions"><a href="${h(x.watchUrl)}" target="_blank">Watch/search ↗</a></div>`:''}</article>`).join('')||empty('No exact matches yet.','The wrestler remains in the curated directory, but no searchable appearance is present in the current sources.')}</section>`;}

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
function empty(title,body){return `<div class="emptyState"><h3>${h(title)}</h3><p>${h(body)}</p></div>`;}

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
  const p=promotion(item.promotionId),prog=programme(item.programId),details=detailsFor(item,state.data),key=statusKey(item),review=state.reviews[key]||{},plex=plexItemFor(item),plexState=plexProgressFor(item),youtube=youtubeUrlFor(item);
  const matches=details.matches.length?`<ol class="matchCardList">${details.matches.map((match,index)=>`<li><span>${h(match.order||`Match ${index+1}`)}</span><strong>${h(match.match||match.description||'')}</strong>${match.result?`<p>${h(match.result)}</p>`:''}</li>`).join('')}</ol>`:`<div class="sourceEmpty"><div><h4>Complete card not yet present</h4><p>The source confirms the event and date, but does not provide a full match card in the recovered dataset.</p></div></div>`;
  const status=currentStatus(key);
  return modalShell(item.title,`<div class="detailHero">${artwork(item,'detailArtwork')}<div class="detailHeroText"><div class="programmeKicker"><span>${h(p?.name||'')}</span><span>•</span><span>${h(prog?.name||item.kind)}</span></div><h2>${h(item.title)}</h2><p class="detailLead">${h(item.description||item.mainEvent||'Exact dated archive record.')}</p><div class="detailFacts"><span><small>Date</small><strong>${h(fmtDate(item.date))}</strong></span>${item.code?`<span><small>Episode</small><strong>${h(item.code)}</strong></span>`:''}${item.venue?`<span><small>Venue</small><strong>${h(item.venue)}</strong></span>`:''}${item.location?`<span><small>Location</small><strong>${h(item.location)}</strong></span>`:''}${item.runtime?`<span><small>Runtime</small><strong>${item.runtime} min</strong></span>`:''}${item.rating?`<span><small>Source rating</small><strong>${item.rating}/10</strong></span>`:''}${plexState?`<span><small>Plex state</small><strong>${plexState.watched?'Watched':`${Math.round(plexState.progress*100)}% viewed`}</strong></span>`:''}</div><div class="modalActions"><button data-status-key="${h(key)}" data-status="${status==='watched'?'unwatched':'watched'}">${status==='watched'?'Remove watched':'Mark watched'}</button>${item.sourceUrl?`<a href="${h(item.sourceUrl)}" target="_blank">Source ↗</a>`:''}${youtube?`<a href="${h(youtube)}" target="_blank">YouTube/free ↗</a>`:''}${plex?plexLinkButton(item):''}</div></div></div>
    <section class="detailSection"><div class="sectionHeading"><div><span class="eyebrow">${details.completeCard?'Complete card':'Verified card information'}</span><h3>Matches</h3></div><small>${h(details.sourceNote)}</small></div>${matches}</section>
    <section class="detailSection"><div class="sectionHeading"><div><span class="eyebrow">Participants</span><h3>Wrestlers competing</h3></div><strong>${details.competitors.length}</strong></div><div class="wrestlerTags expanded">${details.competitors.map(w=>`<button data-wrestler="${h(w)}">${h(w)}</button>`).join('')||'<span>No competitors parsed from the available record.</span>'}</div></section>
    <section class="detailSection"><div class="sectionHeading"><div><span class="eyebrow">Review & notes</span><h3>Archive review</h3></div></div>${details.editorial?`<div class="editorialReview">${h(details.editorial).replace(/\n/g,'<br>')}</div>`:'<p class="sourceNote">No published or curated review is attached to this record yet.</p>'}<div class="personalReview"><label><span>Your rating</span><select id="reviewRating"><option value="">No rating</option>${Array.from({length:10},(_,i)=>i+1).map(n=>`<option value="${n}" ${Number(review.rating)===n?'selected':''}>${n}/10</option>`).join('')}</select></label><label><span>Your review</span><textarea id="reviewText" placeholder="Write private notes about the card or episode…">${h(review.text||'')}</textarea></label><button data-save-review="${h(key)}">Save review</button></div></section>
    <section class="detailSection"><div class="sectionHeading"><div><span class="eyebrow">Original visual assets</span><h3>Artwork</h3></div><button data-scan-art="${h(key)}">Scan again</button></div>${artworkGallery(item)}</section>`,true);
}
function programmeModal(p){
  if(!p)return '';
  const company=promotion(p.promotionId),loaded=state.loadedEpisodes.get(p.id)||[],status=currentStatus(`program:${p.id}`),mapped=p.tvMazeId||state.feedMap[p.id],catalog={...(state.data.artworkCatalog?.programmes?.[p.id]||{}),...(state.artworkCache[`program:${p.id}`]||{})};
  const seasons=Object.entries(catalog.seasons||{});
  return modalShell(p.name,`<div class="detailHero">${artwork(p,'detailArtwork',true)}<div class="detailHeroText"><div class="programmeKicker"><span>${h(company?.name||'')}</span><span>•</span><span>${h(state.data.formatLabels[p.kind]||p.kind)}</span></div><h2>${h(p.name)}</h2><p class="detailLead">${h(p.description)}</p><div class="detailFacts"><span><small>First aired</small><strong>${h(p.firstAirDate)}</strong></span>${p.endDate?`<span><small>Final date</small><strong>${h(p.endDate)}</strong></span>`:''}<span><small>Cadence</small><strong>${h(p.cadence)}</strong></span><span><small>Exact episodes</small><strong>${loaded.length.toLocaleString()}</strong></span></div><div class="modalActions">${mapped?`<button data-load-programme="${h(p.id)}">${icon('refresh')} Refresh episodes</button>`:`<button data-discover-programme="${h(p.id)}">Discover exact feed</button>`}${p.officialUrl?`<a href="${h(p.officialUrl)}" target="_blank">Official ↗</a>`:''}${p.youtubeUrl?`<a href="${h(p.youtubeUrl)}" target="_blank">YouTube/free ↗</a>`:''}<button data-status-key="program:${h(p.id)}" data-status="${status==='watched'?'unwatched':'watched'}">${status==='watched'?'Remove watched':'Mark programme watched'}</button></div>${p.feedNote?`<p class="sourceNote">${h(p.feedNote)}</p>`:''}</div></div>
    <section class="detailSection"><div class="sectionHeading"><div><span class="eyebrow">Show and season visuals</span><h3>Artwork</h3></div><button data-scan-art="program:${h(p.id)}">Scan artwork</button></div>${artworkGallery(p,true)}${seasons.length?`<h4 class="subheading">Season artwork</h4><div class="seasonArtworkGrid">${seasons.map(([season,art])=>`<figure><img src="${h(art.poster||art.backdrop||'')}" alt="Season ${h(season)} artwork" loading="lazy"><figcaption>Season ${h(season)}</figcaption></figure>`).join('')}</div>`:''}</section>
    <section class="detailSection"><div class="sectionHeading"><div><span class="eyebrow">Complete episode index</span><h3>${loaded.length.toLocaleString()} exact episodes</h3></div></div>${loaded.length?`<div class="episodeRows">${loaded.map(episodeRow).join('')}</div>`:`<div class="emptyState"><h3>${mapped?'Episode feed loading or unavailable':'No exact feed mapped'}</h3><p>${mapped?'Refresh the feed to load dates, titles and episode artwork.':'The show remains fully indexed as a programme family. Use discovery to find an exact TVMaze match without inventing dates.'}</p></div>`}</section>`,true);
}
function episodeRow(e){const st=currentStatus(statusKey(e));return `<article class="episodeRow" data-open-record="${h(e.id)}" role="button" tabindex="0">${artwork(e,'episodeThumb')}<div class="episodeIdentity"><span>${h(e.code)}</span><h4>${h(e.title)}</h4><p>${h(fmtDate(e.date))}${e.runtime?` • ${e.runtime} min`:''}${plexAvailable(e)?` • Plex${plexProgressFor(e)?.watched?' watched':plexProgressFor(e)?.progress?` ${Math.round(plexProgressFor(e).progress*100)}%`:''}`:''}</p></div><p class="episodeSummary">${h(e.description)}</p><button class="${st==='watched'?'active':''}" data-status-key="${h(statusKey(e))}" data-status="${st==='watched'?'unwatched':'watched'}">${st==='watched'?'Watched ✓':'Mark watched'}</button></article>`;}

function accountModal(){
  const configured=Boolean(state.cloud.config?.supabaseConfigured),user=state.cloud.user;
  if(!configured)return modalShell('Ringside account',`<div class="accountSetup"><h3>Supabase setup required</h3><p>Accounts are optional for local use, but required for automatic cross-device progress plus roaming Plex and Trakt connections. Follow <code>supabase/schema.sql</code> and the README, then add the Supabase environment variables in Vercel.</p></div>`,true);
  if(state.cloud.recovery)return modalShell('Choose a new password',`<div class="authLayout recoveryLayout"><section><span class="eyebrow">Password recovery</span><h3>Secure your Ringside account</h3><p>The recovery link was accepted. Enter a new password to complete the reset.</p></section><section class="authForm"><label><span>New password</span><input id="accountNewPassword" type="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters"></label><label><span>Confirm password</span><input id="accountConfirmPassword" type="password" autocomplete="new-password" minlength="8" placeholder="Repeat the new password"></label><div class="modalActions"><button class="primaryButton" data-action="cloud-update-password">Update password</button></div><p class="sourceNote">${h(state.cloud.message||'After updating, this device remains signed in and your archive will synchronize.')}</p></section></div>`,true);
  if(user)return modalShell('Ringside account',`<div class="accountDashboard"><div class="accountIdentity"><span class="accountAvatar large">${h((user.email||'A').slice(0,1).toUpperCase())}</span><div><span class="eyebrow">Signed in</span><h3>${h(user.email||'Ringside account')}</h3><p>Viewing states, reviews, settings and artwork cache synchronize through Row Level Security. Plex and Trakt credentials plus the latest Plex library snapshot are encrypted server-side.</p></div></div><div class="cloudStatusGrid"><span><small>Cloud state</small><strong>${h(state.cloud.message||'Ready')}</strong></span><span><small>Trakt</small><strong>${traktConnected()?'Connected':'Not connected'}</strong></span><span><small>Plex</small><strong>${plexConnected()?'Connected':'Not connected'}</strong></span><span><small>Auto sync</small><strong>${state.settings.cloudAutoSync===false?'Off':'On'}</strong></span></div><label class="settingToggle"><input type="checkbox" data-setting="cloudAutoSync" ${state.settings.cloudAutoSync===false?'':'checked'}><span><strong>Automatic account sync</strong><small>Pull on login/focus and synchronize changes after edits.</small></span></label><div class="modalActions"><button data-action="cloud-sync" ${state.cloud.syncing?'disabled':''}>Sync now</button><button data-action="connections">Manage Plex & Trakt</button><button class="dangerButton" data-action="cloud-signout">Sign out</button></div></div>`,true);
  return modalShell('Create or sign in to Ringside',`<div class="authLayout"><section><span class="eyebrow">One account on every device</span><h3>Sync the complete archive</h3><p>Your viewing progress, ratings, reviews, preferences, feed mappings and artwork cache follow the account. Encrypted server storage also keeps your Plex and Trakt connections available without exporting credentials.</p><ul><li>Supabase Auth for email/password accounts</li><li>RLS-protected personal archive state</li><li>AES-256-GCM encrypted Plex and Trakt integrations</li><li>Automatic merge using per-record timestamps</li></ul></section><section class="authForm"><label><span>Email</span><input id="accountEmail" type="email" autocomplete="email" placeholder="you@example.com"></label><label><span>Password</span><input id="accountPassword" type="password" autocomplete="current-password" minlength="8" placeholder="At least 8 characters"></label><div class="modalActions"><button class="primaryButton" data-action="cloud-signin">Sign in</button><button data-action="cloud-signup">Create account</button><button data-action="cloud-reset">Reset password</button></div><p class="sourceNote">${h(state.cloud.message||'Email confirmation may be required depending on your Supabase Auth settings.')}</p></section></div>`,true);
}

function connectionsModal(){
  const servers=state.plexData.servers||[],traktOn=traktConnected(),plexOn=plexConnected();
  const accountNote=accountConnected()?`<div class="accountSyncNotice ready"><strong>Cross-device integration storage enabled</strong><span>Connected Plex/Trakt accounts and the latest Plex scan are attached to ${h(state.cloud.user.email||'this account')}.</span></div>`:`<div class="accountSyncNotice"><strong>Connections are device-local</strong><span>Sign in to a Ringside account before connecting Plex or Trakt to make them available on your other devices.</span><button data-action="account">Sign in</button></div>`;
  return modalShell('Connections, sync & artwork',`${accountNote}<div class="connectionGrid"><section class="connectionPanel"><h3>Trakt viewing sync</h3><p>Exact episodes and supported event records synchronize both ways. With a Ringside account, the Trakt refresh token is encrypted on the server and works from every signed-in device.</p><div class="modalActions">${traktOn?`<button data-action="trakt-sync">Import watched history</button><button data-action="trakt-disconnect">Disconnect</button>`:`<button data-action="trakt-connect">Connect Trakt</button>`}</div><p>${h(state.traktMessage||(traktOn?(state.trakt.account?.username?`Connected as ${state.trakt.account.username}.`:'Connected.'):'Add the Trakt environment variables to Vercel first.'))}</p><div id="traktDevice"></div></section>
  <section class="connectionPanel"><h3>Plex library & viewing sync</h3><p>Match exact shows, seasons, episodes and event files. Import real Plex viewCount/viewOffset progress; optionally push Ringside watched changes back to Plex and forward Plex-watched matches to Trakt.</p><div class="modalActions">${plexOn?`<button data-action="plex-refresh-servers">Refresh servers</button><button data-action="plex-import-viewing">Import Plex viewing</button><button data-action="plex-disconnect">Disconnect</button>`:`<button data-action="plex-connect">Sign in to Plex</button>`}<button data-action="plex-import">Import local export</button></div><p>${h(state.plexMessage||`${state.plexMatches.size.toLocaleString()} archive keys matched from ${(state.plexData.items||[]).length.toLocaleString()} Plex items.`)}</p><div class="settingStack"><label class="settingToggle"><input type="checkbox" data-setting="autoImportPlexViewing" ${state.settings.autoImportPlexViewing?'checked':''}><span><strong>Import after each Plex scan</strong><small>Watched items become Watched; partial progress becomes Watching.</small></span></label><label class="settingToggle"><input type="checkbox" data-setting="pushWatchedToPlex" ${state.settings.pushWatchedToPlex?'checked':''}><span><strong>Push Ringside watched state to Plex</strong><small>Uses Plex scrobble/unscrobble only for exact matched items.</small></span></label><label class="settingToggle"><input type="checkbox" data-setting="syncPlexWatchedToTrakt" ${state.settings.syncPlexWatchedToTrakt?'checked':''}><span><strong>Forward Plex-watched matches to Trakt</strong><small>Only records that map exactly in both integrations are submitted.</small></span></label><label><span>Plex watched threshold</span><input id="plexThreshold" data-setting="plexWatchedThreshold" type="number" min="0.5" max="1" step="0.05" value="${h(state.settings.plexWatchedThreshold||0.9)}"></label></div>${servers.length?`<div class="serverList">${servers.map(server=>`<article><div><strong>${h(server.name)}</strong><small>${server.owned?'Owned server':'Shared server'} • ${server.connections?.length||0} connections</small></div><button data-plex-server="${h(server.machineIdentifier)}">Scan library</button></article>`).join('')}</div>`:''}</section>
  <section class="connectionPanel"><h3>Artwork scanner</h3><p>TVMaze, TMDB, Wikipedia/Wikimedia and imported Plex metadata are layered with source attribution. Missing art remains labelled rather than fabricated.</p><div class="modalActions"><button data-action="scan-visible-artwork" ${state.scanningArtwork?'disabled':''}>Scan visible records</button></div><p>${h(state.artworkMessage||`${Object.keys(state.artworkCache).length} cached artwork results.`)}</p></section>
  <section class="connectionPanel"><h3>Backup & recovery</h3><p>Account sync is automatic when configured, but a private JSON backup remains useful for offline recovery. Legacy backups can also migrate local Plex/Trakt connections into your signed-in account.</p><div class="modalActions"><button data-action="export">Export JSON</button><button data-action="import-backup">Import JSON</button><button data-action="cloud-sync" ${accountConnected()?'':'disabled'}>Sync account</button></div></section></div>`,true);
}

function footer(){return `<footer><div class="footerBrand"><span class="brandMark">RA</span><div><strong>Ringside Archive</strong><small>Account-synced, local-first project</small></div></div><p>Episode metadata uses verified feeds. Artwork retains source attribution and fallbacks are never presented as original. Complete match cards are displayed only when the source data actually includes them. This product uses the TMDB API but is not endorsed or certified by TMDB. Wikipedia/Wikimedia results link back to their source page so image licensing can be checked.</p><span>Catalogue v5.1.1 • ${state.data.meta.counts.majorEvents.toLocaleString()} major events • ${state.data.programmes.length} programme families • ${allLoadedEpisodes().length.toLocaleString()} loaded episodes</span></footer>`;}
function mobileNav(){return `<nav class="mobileNav">${navItems.map(([id,ic,label])=>`<button data-view="${id}" class="${state.view===id?'active':''}"><span>${icon(ic)}</span>${label.replace('Complete ','')}</button>`).join('')}</nav>`;}

function render(){
  if(!state.data)return;
  let content='';
  if(state.view==='exact')content=exactView();
  if(state.view==='chronology')content=chronologyView();
  if(state.view==='wrestlers')content=wrestlersView();
  if(state.view==='recommended')content=recommendedView();
  if(state.view==='companies')content=companiesView();
  if(state.view==='library')content=libraryView();
  app.innerHTML=`${topbar()}<main class="appShell">${dashboard()}${catalogueStatement()}${filterPanel()}${content}${footer()}</main>${mobileNav()}${modal()}${state.toast?`<div class="toast"><span>${icon('check')}</span><span>${h(state.toast)}</span><button data-action="dismiss-toast">×</button></div>`:''}`;
  document.body.classList.toggle('modalOpen',Boolean(state.modal));
  bind();
}

function bind(){
  document.querySelectorAll('[data-view]').forEach(el=>el.onclick=()=>setView(el.dataset.view));
  document.querySelectorAll('[data-status-key]').forEach(el=>el.onclick=e=>{e.stopPropagation();setStatus(el.dataset.statusKey,el.dataset.status);});
  document.querySelectorAll('[data-open-programme]').forEach(el=>{el.onclick=e=>{if(el.tagName!=='BUTTON'&&e.target.closest('button,a'))return;state.modal={type:'programme',id:el.dataset.openProgramme};render();};el.onkeydown=e=>{if(e.key==='Enter'){state.modal={type:'programme',id:el.dataset.openProgramme};render();}};});
  document.querySelectorAll('[data-open-record]').forEach(el=>{el.onclick=e=>{if(el.tagName!=='BUTTON'&&e.target.closest('button,a,select,textarea,input'))return;state.modal={type:'record',id:el.dataset.openRecord};render();};el.onkeydown=e=>{if(e.key==='Enter'){state.modal={type:'record',id:el.dataset.openRecord};render();}};});
  document.querySelectorAll('[data-company]').forEach(el=>el.onclick=()=>{state.filters.promotion=el.dataset.company;setView('exact');});
  document.querySelectorAll('[data-wrestler]').forEach(el=>el.onclick=e=>{e.stopPropagation();state.filters.wrestler=el.dataset.wrestler;state.modal=null;setView('wrestlers');});
  document.querySelectorAll('[data-library-tab]').forEach(el=>el.onclick=()=>{state.libraryTab=el.dataset.libraryTab;render();});
  document.querySelectorAll('[data-filter]').forEach(el=>{const eventName=el.tagName==='INPUT'&&el.type==='number'?'input':'change';el[`on${eventName}`]=debounce(()=>{state.filters[el.dataset.filter]=el.type==='checkbox'?el.checked:el.value;state.visible=50;render();},eventName==='input'?250:0);});
  const search=document.querySelector('#searchInput'); if(search) search.oninput=debounce(()=>{state.filters.query=search.value;state.visible=50;render();},150);
  document.querySelectorAll('[data-load-programme]').forEach(el=>el.onclick=e=>{e.stopPropagation();loadProgramme(el.dataset.loadProgramme,true);});
  document.querySelectorAll('[data-discover-programme]').forEach(el=>el.onclick=e=>{e.stopPropagation();discoverProgramme(el.dataset.discoverProgramme);});
  document.querySelectorAll('[data-save-review]').forEach(el=>el.onclick=()=>saveReview(el.dataset.saveReview));
  document.querySelectorAll('[data-scan-art]').forEach(el=>el.onclick=()=>scanArtworkKey(el.dataset.scanArt));
  document.querySelectorAll('[data-plex-server]').forEach(el=>el.onclick=()=>scanSelectedPlexServer(el.dataset.plexServer));
  document.querySelectorAll('[data-setting]').forEach(el=>el.onchange=()=>{let value=el.type==='checkbox'?el.checked:el.value;if(el.type==='number')value=Number(value);state.settings[el.dataset.setting]=value;storage.saveSettings(state.settings);refreshPlexIndex();scheduleCloudSync();render();});
  document.querySelectorAll('[data-action]').forEach(el=>el.onclick=e=>handleAction(el.dataset.action,e));
  document.querySelectorAll('img').forEach(img=>img.onerror=()=>img.style.display='none');
  const backdrop=document.querySelector('.modalBackdrop');if(backdrop)backdrop.onclick=e=>{if(e.target===backdrop){state.modal=null;render();}};
}

async function loadProgramme(id,forceLive=false){
  const p=programme(id),mapped=state.feedMap[id]||p.tvMazeId; if(!mapped){showToast('No exact feed is mapped for this programme yet.');return;}
  state.syncMessage=`Loading ${p.name}…`; render();
  try { const feed=await loadTvMazeFeed(p,{forceLive,tvMazeId:mapped}); state.showArtwork.set(p.id,feed.show?.image?.original||feed.show?.image?.medium||''); state.loadedEpisodes.set(p.id,(feed.episodes||[]).map(x=>normalizeEpisode(p,feed,x)).filter(Boolean)); state.syncMessage=''; state.modal={type:'programme',id}; showToast(`${state.loadedEpisodes.get(id).length.toLocaleString()} exact episodes loaded for ${p.name}.`); }
  catch(error){state.syncMessage='';showToast(error.message);} render();
}
async function loadAllEpisodes(forceLive=false){
  if(state.autoEpisodeLoadStarted&&!forceLive)return;
  state.autoEpisodeLoadStarted=true;state.autoEpisodeLoadComplete=false;
  const feeds=state.data.programmes.filter(p=>p.tvMazeId||state.feedMap[p.id]);
  const queue=[...feeds];let done=0,totalEpisodes=0;
  const worker=async()=>{while(queue.length){const p=queue.shift();try{const feed=await loadTvMazeFeed(p,{forceLive,tvMazeId:state.feedMap[p.id]||p.tvMazeId});state.showArtwork.set(p.id,feed.show?.image?.original||feed.show?.image?.medium||'');const episodes=(feed.episodes||[]).map(x=>normalizeEpisode(p,feed,x)).filter(Boolean);state.loadedEpisodes.set(p.id,episodes);totalEpisodes+=episodes.length;}catch(error){console.warn(error);}finally{done++;state.syncMessage=`Loading exact weekly episodes: ${done}/${feeds.length} feeds • ${totalEpisodes.toLocaleString()} episodes`;if(done%4===0||done===feeds.length)render();}}};
  await Promise.all(Array.from({length:Math.min(4,feeds.length)},worker));
  state.autoEpisodeLoadComplete=true;state.syncMessage=`Loaded ${totalEpisodes.toLocaleString()} exact episodes from ${feeds.length} verified feeds.`;render();setTimeout(()=>{if(state.autoEpisodeLoadComplete){state.syncMessage='';render();}},4000);
}
async function discoverProgramme(id){
  const p=programme(id);state.syncMessage=`Searching for an exact episode feed for ${p.name}…`;render();
  try{const match=await discoverTvMazeId(p);if(!match)throw new Error('No exact-title TVMaze feed was found.');state.feedMap[p.id]=match.tvMazeId;storage.saveFeedMap(state.feedMap);showToast(`Mapped ${p.name} to TVMaze show ${match.tvMazeId}.`);await loadProgramme(id);}catch(error){state.syncMessage='';showToast(error.message);render();}
}
async function discoverMoreFeeds(){
  const candidates=state.data.programmes.filter(p=>!p.tvMazeId&&!state.feedMap[p.id]&&['weekly','territory-tv','studio','streaming'].includes(p.kind));
  let mapped=0,checked=0;state.syncMessage=`Discovering additional exact feeds: 0/${candidates.length}`;render();
  for(const p of candidates){try{const match=await discoverTvMazeId(p);if(match){state.feedMap[p.id]=match.tvMazeId;mapped++;await loadProgrammeQuiet(p,match.tvMazeId);}}catch{}checked++;state.syncMessage=`Discovering additional exact feeds: ${checked}/${candidates.length} • ${mapped} exact matches`;if(checked%5===0)render();await new Promise(r=>setTimeout(r,550));}
  storage.saveFeedMap(state.feedMap);state.syncMessage=`Discovery complete: ${mapped} new exact-title feeds mapped.`;state.autoEpisodeLoadComplete=true;render();showToast(state.syncMessage);
}
async function loadProgrammeQuiet(p,id){try{const feed=await loadTvMazeFeed(p,{tvMazeId:id});state.showArtwork.set(p.id,feed.show?.image?.original||feed.show?.image?.medium||'');state.loadedEpisodes.set(p.id,(feed.episodes||[]).map(x=>normalizeEpisode(p,feed,x)).filter(Boolean));}catch(error){console.warn(error);}}

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
      state.cloud.message='Updating password…';render();await updateCloudPassword(next);state.cloud.recovery=false;await finishAccountLogin();state.modal={type:'account'};showToast('Password updated successfully.');return;
    }
    if(action==='cloud-signin'){if(!email||!password)throw new Error('Enter your email and password.');state.cloud.message='Signing in…';render();await signInCloud(email,password);await finishAccountLogin();showToast('Ringside account connected.');}
    if(action==='cloud-signup'){if(!email||password.length<8)throw new Error('Enter an email and a password of at least 8 characters.');state.cloud.message='Creating account…';render();const result=await signUpCloud(email,password);if(result.session){await finishAccountLogin();showToast('Ringside account created.');}else{state.cloud.message='Account created. Confirm the email, then sign in.';render();}}
    if(action==='cloud-reset'){if(!email)throw new Error('Enter your email first.');await sendPasswordReset(email);state.cloud.message='Password-reset email sent.';render();}
  }catch(error){state.cloud.message=error.message;showToast(error.message);render();}
}

async function handleAction(action,event){
  event?.stopPropagation();
  if(action==='account'){state.modal={type:'account'};render();return;}
  if(action==='cloud-signin'||action==='cloud-signup'||action==='cloud-reset'||action==='cloud-update-password'){await handleCloudAuth(action);return;}
  if(action==='cloud-sync'){await syncCloudNow();return;}
  if(action==='cloud-signout'){await signOutCloud();state.cloud.user=null;state.cloud.message='Signed out. Local cached data remains on this device.';state.modal={type:'account'};render();return;}
  if(action==='toggle-filters'){state.filtersOpen=!state.filtersOpen;render();return;}
  if(action==='reset-filters'){state.filters={query:'',region:'',promotion:'',kind:'',yearFrom:'1970',yearTo:'',wrestler:'',availability:'',hideWatched:false};state.visible=50;render();return;}
  if(action==='load-more'){state.visible+=50;render();return;}
  if(action==='clear-wrestler'){state.filters.wrestler='';render();return;}
  if(action==='connections'){state.modal={type:'connections'};render();return;}
  if(action==='close-modal'){state.modal=null;render();return;}
  if(action==='dismiss-toast'){state.toast='';render();return;}
  if(action==='export'){downloadJson(`ringside-archive-backup-${new Date().toISOString().slice(0,10)}.json`,storage.exportAll());showToast('Backup exported.');return;}
  if(action==='import-backup'){pickFile('backup');return;}
  if(action==='plex-import'){pickFile('plex');return;}
  if(action==='clear-progress'&&confirm('Clear all local viewing progress?')){storage.clearProgress();state.statuses={};render();return;}
  if(action==='reload-all-episodes'){state.autoEpisodeLoadStarted=false;await loadAllEpisodes(true);return;}
  if(action==='discover-feeds'){await discoverMoreFeeds();return;}
  if(action==='trakt-connect'){await startTraktDevice();return;}
  if(action==='trakt-sync'){await syncTraktHistory();return;}
  if(action==='trakt-disconnect'){if(accountConnected())await deleteCloudIntegration('trakt').catch(()=>{});storage.clearTrakt();state.trakt={};state.traktMessage='Disconnected.';render();return;}
  if(action==='plex-connect'){await startPlexConnection();return;}
  if(action==='plex-refresh-servers'){await refreshPlexServers();return;}
  if(action==='plex-disconnect'){if(accountConnected())await deleteCloudIntegration('plex').catch(()=>{});storage.clearPlex();state.plexData=storage.plexData();refreshPlexIndex();state.plexMessage='Disconnected.';render();return;}
  if(action==='plex-import-viewing'){await importPlexViewingProgress();return;}
  if(action==='scan-visible-artwork'){await scanVisibleArtwork();return;}
}
function pickFile(mode){filePicker.value='';filePicker.dataset.mode=mode;filePicker.accept='.json,application/json,text/plain';filePicker.click();}
filePicker.onchange=async()=>{const file=filePicker.files?.[0];if(!file)return;try{const text=await file.text(),data=JSON.parse(text);if(filePicker.dataset.mode==='backup'){storage.importAll(data);state.statuses=storage.statuses();state.plexData=storage.plexData();state.trakt=storage.trakt();state.artworkCache=storage.artwork();state.reviews=storage.reviews();state.feedMap=storage.feedMap();refreshPlexIndex();if(accountConnected()){await loadAccountIntegrations({migrate:true});scheduleCloudSync();}showToast('Backup imported.');}
else {await importPlexPayload(data);}render();}catch(error){showToast(error.message||'Import failed.');}};
async function importPlexPayload(data){
  const items=Array.isArray(data)?data:(data.titles||data.items||[]);state.plexData={...state.plexData,items,scannedAt:data.exportedAt||new Date().toISOString(),selectedServer:data.serverInfo||state.plexData.selectedServer};const built=buildPlexMatches(state.data,items,Number(state.settings.plexWatchedThreshold||0.9));state.plexData.matches=[...built.matches];storage.savePlexData(state.plexData);refreshPlexIndex();
  if(accountConnected()){try{await saveCloudIntegration('plex',state.plexData);state.plexData.cloudConnected=Boolean(state.plexData.token);storage.savePlexData(state.plexData);}catch(error){state.plexMessage=`Local import saved, but cloud snapshot failed: ${error.message}`;}}
  if(state.settings.autoImportPlexViewing)await importPlexViewingProgress({quiet:true});showToast(`${state.plexMatches.size.toLocaleString()} exact/programme Plex matches stored.`);
}

async function startTraktDevice(){
  try {
    state.traktMessage='Requesting a Trakt device code…';render();
    const response=await fetch('./api/trakt/device',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'code'})}),data=await response.json();
    if(!response.ok)throw new Error(data.error||'Trakt device authorization is not configured.');
    const holder=document.querySelector('#traktDevice');if(holder)holder.innerHTML=`<p>Open <a href="${h(data.verification_url)}" target="_blank">${h(data.verification_url)}</a> and enter:</p><h2><code>${h(data.user_code)}</code></h2><p>Waiting for authorization…</p>`;
    window.open(data.verification_url,'_blank','noopener');const started=Date.now();
    while(Date.now()-started<(data.expires_in||600)*1000){
      await new Promise(r=>setTimeout(r,(data.interval||5)*1000));
      const headers=await accountHeaders({'Content-Type':'application/json'});
      const tokenResponse=await fetch('./api/trakt/device',{method:'POST',headers,body:JSON.stringify({action:'token',device_code:data.device_code})});
      if(tokenResponse.status===202)continue;
      const token=await tokenResponse.json();if(!tokenResponse.ok)throw new Error(token.error||'Trakt authorization failed.');
      if(token.cloud){state.trakt={cloudConnected:true,cloud:true,account:token.integration?.account||null,expiresAt:token.integration?.expiresAt||null};}
      else state.trakt={...state.trakt,...token};
      storage.saveTrakt(state.trakt);state.traktMessage=accountConnected()?'Trakt connected to your Ringside account on every device.':'Trakt connected in this browser.';
      showToast(state.traktMessage);render();return;
    }
    throw new Error('Trakt device code expired.');
  }catch(error){state.traktMessage=error.message;showToast(error.message);render();}
}
async function ensureTraktAccessToken(){
  if(state.trakt.cloudConnected&&accountConnected())return '';
  if(!state.trakt.accessToken)throw new Error('Trakt is not connected.');
  if(!state.trakt.expiresAt||Number(state.trakt.expiresAt)>Date.now()+60000)return state.trakt.accessToken;
  if(!state.trakt.refreshToken)throw new Error('The Trakt connection expired. Reconnect Trakt.');
  const response=await fetch('./api/trakt/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:state.trakt.refreshToken})});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to refresh Trakt access.');
  state.trakt={...state.trakt,...data};storage.saveTrakt(state.trakt);return state.trakt.accessToken;
}
async function traktRequestHeaders(contentType=false){
  if(state.trakt.cloudConnected&&accountConnected())return accountHeaders(contentType?{'Content-Type':'application/json'}:{});
  const accessToken=await ensureTraktAccessToken();return {...(contentType?{'Content-Type':'application/json'}:{}),Authorization:`Bearer ${accessToken}`};
}
async function syncStatusToTrakt(item,status){
  const p=programme(item.programId),payload=recordTraktPayload(item,p);if(!payload)return;
  const headers=await traktRequestHeaders(true);
  const response=await fetch('./api/trakt/sync',{method:'POST',headers,body:JSON.stringify({action:status==='watched'?'add':'remove',item:payload})});
  if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||'Trakt update failed.');}
}
async function syncTraktHistory(){
  try {
    state.traktMessage='Importing watched episodes and events from Trakt…';render();
    const headers=await traktRequestHeaders(false),response=await fetch('./api/trakt/history',{headers}),data=await response.json();
    if(!response.ok)throw new Error(data.error||'Trakt sync failed.');if(!state.autoEpisodeLoadComplete)await loadAllEpisodes(false);
    let matched=0;const changed=[];
    for(const show of data.shows||[]){const title=normalize(show.title);const p=state.data.programmes.find(program=>normalize(program.traktTitle||program.name)===title||program.aliases?.some(alias=>normalize(alias)===title));if(!p)continue;for(const season of show.seasons||[])for(const episode of season.episodes||[]){const key=`episode:${p.id}:${season.number}:${episode.number}`;if(state.statuses[key]!=='watched'){state.statuses[key]='watched';changed.push(key);}matched++;}}
    for(const movie of data.movies||[]){const title=normalize(movie.title),event=state.data.majorEvents.find(e=>normalize(e.traktTitle||e.title)===title&&(!movie.year||yearOf(e.date)===movie.year));if(event){const key=`event:${event.id}`;if(state.statuses[key]!=='watched'){state.statuses[key]='watched';changed.push(key);}matched++;}}
    storage.saveStatusesBulk(state.statuses,changed);scheduleCloudSync();state.traktMessage=`Imported ${matched.toLocaleString()} matching episodes/events from Trakt.`;showToast(state.traktMessage);render();
  }catch(error){state.traktMessage=error.message;showToast(error.message);render();}
}

async function startPlexConnection(){
  try{
    const clientId=state.plexData.clientId||makeClientId();state.plexData.clientId=clientId;storage.savePlexData(state.plexData);state.plexMessage='Starting Plex sign-in…';render();
    const headers=await accountHeaders(),pin=await createPlexPin(clientId,headers);state.plexPin=pin;window.open(pin.authUrl,'_blank','noopener');state.plexMessage='Complete sign-in in the Plex window. Waiting for approval…';render();const started=Date.now();
    while(Date.now()-started<10*60*1000){await new Promise(r=>setTimeout(r,2000));const result=await pollPlexPin(clientId,pin.id,headers);if(!result.authToken&&!result.connected)continue;if(result.cloud){state.plexData={...state.plexData,cloudConnected:true,token:null};}else state.plexData.token=result.authToken;storage.savePlexData(state.plexData);await refreshPlexServers();showToast(accountConnected()?'Plex connected to your Ringside account.':'Plex connected in this browser.');return;}
    throw new Error('Plex sign-in expired.');
  }catch(error){state.plexMessage=error.message;showToast(error.message);render();}
}
async function refreshPlexServers(){
  try{
    state.plexMessage='Loading Plex servers…';render();const headers=await accountHeaders();
    const data=await loadPlexResources(state.plexData.clientId,state.plexData.token,headers);state.plexData.servers=data.servers||[];state.plexData.account=data.account||null;if(data.cloud)state.plexData.cloudConnected=true;
    storage.savePlexData(state.plexData);state.plexMessage=`Found ${state.plexData.servers.length} Plex server(s).`;render();
  }catch(error){state.plexMessage=error.message;showToast(error.message);render();}
}
async function scanSelectedPlexServer(machineIdentifier){
  const server=state.plexData.servers.find(x=>x.machineIdentifier===machineIdentifier);if(!server)return;
  try{
    state.plexMessage=`Scanning ${server.name}…`;render();const headers=await accountHeaders();
    const data=await scanPlexLibrary(state.plexData.clientId,state.plexData.token,server,headers);state.plexData.items=data.items||[];state.plexData.selectedServer=data.server||server;state.plexData.scannedAt=data.scannedAt||new Date().toISOString();if(data.cloud)state.plexData.cloudConnected=true;
    const built=buildPlexMatches(state.data,state.plexData.items,Number(state.settings.plexWatchedThreshold||0.9));state.plexData.matches=[...built.matches];storage.savePlexData(state.plexData);refreshPlexIndex();
    state.plexMessage=`Scanned ${(data.items||[]).length.toLocaleString()} Plex items and matched ${state.plexMatches.size.toLocaleString()} archive keys.`;
    if(state.settings.autoImportPlexViewing)await importPlexViewingProgress({quiet:true});showToast(state.plexMessage);render();
  }catch(error){state.plexMessage=error.message;showToast(error.message);render();}
}
async function syncStatusToPlex(item,status){
  const plex=plexItemFor(item);if(!plex?.ratingKey)return;
  const server=state.plexData.servers.find(x=>x.machineIdentifier===plex.machineIdentifier)||state.plexData.selectedServer,headers=await accountHeaders();
  await updatePlexViewState({clientId:state.plexData.clientId,token:state.plexData.token,server,item:plex,action:status==='watched'?'watched':'unwatched',accountHeaders:headers});
}
async function importPlexViewingProgress({quiet=false}={}){
  try{
    if(!state.autoEpisodeLoadComplete)await loadAllEpisodes(false);refreshPlexIndex();
    const changed=[],traktQueue=[];let watched=0,watching=0;
    for(const [key,view] of state.plexViewing){
      const target=view.watched?'watched':view.progress>0?'watching':null;if(!target||state.statuses[key]===target)continue;
      state.statuses[key]=target;changed.push(key);if(target==='watched'){watched++;const item=recordByKey(key);if(item&&state.settings.syncPlexWatchedToTrakt&&traktConnected())traktQueue.push(item);}else watching++;
    }
    storage.saveStatusesBulk(state.statuses,changed);scheduleCloudSync();
    for(const item of traktQueue.slice(0,250)){try{await syncStatusToTrakt(item,'watched');}catch{}await new Promise(r=>setTimeout(r,120));}
    state.plexMessage=`Imported ${watched} watched and ${watching} in-progress Plex matches${traktQueue.length?`; forwarded ${Math.min(250,traktQueue.length)} to Trakt`:''}.`;
    if(!quiet)showToast(state.plexMessage);render();
  }catch(error){state.plexMessage=error.message;if(!quiet)showToast(error.message);render();}
}

async function scanArtworkKey(key){
  let item=null,isProgramme=false;
  if(key.startsWith('program:')){item=programme(key.slice(8));isProgramme=true;}else item=recordByKey(key);
  if(!item)return;
  try{state.artworkMessage=`Scanning artwork for ${item.title||item.name}…`;render();const result=await searchArtwork(item,isProgramme?item:programme(item.programId));state.artworkCache[key]={...result,scannedAt:new Date().toISOString()};storage.saveArtwork(state.artworkCache);state.artworkMessage=`Artwork found for ${item.title||item.name}.`;showToast(state.artworkMessage);render();}catch(error){state.artworkMessage=error.message;showToast(error.message);render();}
}
async function scanVisibleArtwork(){
  if(state.scanningArtwork)return;state.scanningArtwork=true;
  const list=(state.view==='chronology'?state.data.programmes.filter(x=>matchFilters(x,'programme')).map(item=>({item,key:`program:${item.id}`,isProgramme:true})):exactRecords().filter(x=>matchFilters(x)).map(item=>({item:item.isProgrammeIndex?programme(item.programId):item,key:statusKey(item),isProgramme:Boolean(item.isProgrammeIndex)}))).filter(x=>!artworkCandidates(x.item,x.isProgramme).length).slice(0,80);
  let done=0,found=0;for(const entry of list){try{const result=await searchArtwork(entry.item,entry.isProgramme?entry.item:programme(entry.item.programId));state.artworkCache[entry.key]={...result,scannedAt:new Date().toISOString()};if(result.poster||result.backdrop||result.still)found++;}catch{}done++;state.artworkMessage=`Artwork scan ${done}/${list.length} • ${found} matches`;if(done%4===0)render();await new Promise(r=>setTimeout(r,280));}storage.saveArtwork(state.artworkCache);state.scanningArtwork=false;state.artworkMessage=`Artwork scan complete: ${found} new matches.`;showToast(state.artworkMessage);render();
}

(async function init(){
  try {
    state.data=await loadData();state.cloud.config=await loadCloudConfig();const authRedirect=consumeCloudAuthRedirect();state.cloud.recovery=authRedirect?.type==='recovery';state.cloud.user=await getCloudUser();
    refreshPlexIndex();const hash=location.hash.slice(1);if(navItems.some(x=>x[0]===hash))state.view=hash;
    if(state.cloud.user){const switched=storage.prepareForAccount(state.cloud.user.id);if(switched){refreshStateFromStorage();state.plexData=storage.plexData();state.trakt=storage.trakt();refreshPlexIndex();}await syncCloudNow({quiet:true});await loadAccountIntegrations({migrate:true});}
    if(state.cloud.recovery){state.modal={type:'account'};state.cloud.message='Enter and confirm your new password.';}
    render();
    if(state.settings.autoLoadEpisodes&&!new URLSearchParams(location.search).has('noautoload'))loadAllEpisodes(false);
    if('serviceWorker'in navigator)navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
    const cloudPoll=setInterval(()=>{if(accountConnected()&&state.settings.cloudAutoSync!==false)syncCloudNow({quiet:true}).catch(()=>{});},60000);cloudPoll?.unref?.();
    if(document.addEventListener)document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&accountConnected()&&state.settings.cloudAutoSync!==false){syncCloudNow({quiet:true}).then(()=>loadAccountIntegrations({migrate:false})).catch(()=>{});}});
  }catch(error){app.innerHTML=`<div class="bootScreen"><span class="brandMark">RA</span><h1>Archive failed to load</h1><p>${h(error.message)}</p><p>Use a local web server rather than opening index.html directly.</p></div>`;}
})();
