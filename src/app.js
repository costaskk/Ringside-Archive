import { storage } from './storage.js';
import { loadTvMazeFeed, normalizeEpisode, loadPromotionEpisodes } from './tvmaze.js';
import { escapeHtml as h, fmtDate, yearOf, downloadJson, normalize, debounce, icon } from './utils.js';

const app = document.querySelector('#app');
const filePicker = document.querySelector('#filePicker');

const state = {
  data: null,
  view: 'exact',
  statuses: storage.statuses(),
  settings: storage.settings(),
  plexMatches: storage.plex(),
  trakt: storage.trakt(),
  filters: { query:'', region:'', promotion:'', kind:'', era:'from-1970', wrestler:'', availability:'', hideWatched:false },
  selectedCompany: '',
  loadedEpisodes: new Map(),
  showArtwork: new Map(),
  visible: 40,
  filtersOpen: true,
  modal: null,
  toast: '',
  syncMessage: '',
  libraryTab: 'all'
};

const DATA_FILES = ['promotions','programmes','major-events','recommendations','wrestlers','format-labels','artwork-overrides','custom-records','meta'];
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

function currentStatus(key) { return state.statuses[key] || 'unwatched'; }
function setStatus(key, status) {
  if (status === 'unwatched') delete state.statuses[key]; else state.statuses[key] = status;
  storage.saveStatuses(state.statuses); render();
}
function showToast(message) { state.toast = message; render(); setTimeout(()=>{ if(state.toast===message){state.toast='';render();}},3500); }
function setView(view) { state.view=view; state.visible=40; state.modal=null; location.hash=`#${view}`; render(); }
function promotion(id){ return state.data.promotionMap.get(id); }
function programme(id){ return state.data.programmeMap.get(id); }
function statusKey(record){ return record.itemKey || `event:${record.id}`; }
function allLoadedEpisodes(){ return [...state.loadedEpisodes.values()].flat(); }
function exactRecords(){ return [...state.data.majorEvents,...state.data.customRecords,...allLoadedEpisodes()].sort((a,b)=>a.date.localeCompare(b.date)||a.title.localeCompare(b.title)); }

function matchFilters(item, type='record') {
  const f=state.filters, p=promotion(item.promotionId), prog=programme(item.programId);
  if (f.region && p?.region !== f.region) return false;
  if (f.promotion && item.promotionId !== f.promotion) return false;
  if (f.kind && item.kind !== f.kind) return false;
  if (f.era === 'from-1970' && yearOf(item.date || item.firstAirDate) < 1970) return false;
  if (/^\d{4}$/.test(f.era) && yearOf(item.date || item.firstAirDate) !== Number(f.era)) return false;
  if (f.hideWatched && currentStatus(type==='programme'?`program:${item.id}`:statusKey(item)) === 'watched') return false;
  if (f.availability === 'youtube' && !(item.watchUrl || item.youtubeUrl || prog?.youtubeUrl || p?.youtubeUrl)) return false;
  if (f.availability === 'tvmaze' && !(item.tvMazeId || prog?.tvMazeId || String(item.id).startsWith('tvmaze:'))) return false;
  if (f.availability === 'plex' && !(state.plexMatches.has(statusKey(item)) || state.plexMatches.has(`program:${item.programId || item.id}`))) return false;
  if (f.availability === 'recommended' && !(state.data.recommendationsByProgramme.has(item.programId || item.id))) return false;
  if (f.wrestler) {
    const hay=normalize([item.title,item.event,item.mainEvent,item.description,item.why,(item.wrestlers||[]).join(' ')].join(' '));
    if (!hay.includes(normalize(f.wrestler))) return false;
  }
  if (f.query) {
    const hay=normalize([item.title,item.name,item.event,item.mainEvent,item.description,item.location,item.venue,p?.name,p?.shortName,prog?.name,(item.wrestlers||[]).join(' ')].join(' '));
    if (!hay.includes(normalize(f.query))) return false;
  }
  return true;
}

function artwork(item, context='card') {
  const p=promotion(item.promotionId), override=state.data.artworkOverrides[item.id] || state.data.artworkOverrides[item.programId];
  const src=item.artwork || override?.url || state.showArtwork.get(item.programId || item.id) || '';
  if (src) return `<div class="artwork ${context}"><img loading="lazy" src="${h(src)}" alt="${h(item.title||item.name)} original artwork" /></div>`;
  return `<div class="artwork artworkFallback ${context}" style="--accent:${h(p?.color||'#d7a84f')}"><span>${h(p?.shortName||'Archive')}</span><strong>${h(item.title||item.name)}</strong></div>`;
}

function topbar() {
  return `<header class="topbar">
    <button class="brand" data-view="exact"><span class="brandMark">RA</span><span><strong>Ringside Archive</strong><small>Professional Wrestling Watch Tracker</small></span></button>
    <nav aria-label="Primary navigation">${navItems.map(([id,ic,label])=>`<button data-view="${id}" class="${state.view===id?'active':''}"><span class="navIcon">${icon(ic)}</span>${label}</button>`).join('')}</nav>
    <div class="topActions"><button class="connectionButton" data-action="connections"><span class="connectionDot ${state.trakt.accessToken||state.plexMatches.size?'ready':''}"></span>Connections</button><button class="primaryButton small" data-action="export">${icon('download')} Backup</button></div>
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
    <article class="nextCard" style="--accent:${h(p?.color||'#d7a84f')}"><div class="nextContent"><div class="eyebrowRow"><span class="liveLabel"><i></i> Up next in chronology</span><span class="statusPill status-${currentStatus(statusKey(next))}">${statusLabels[currentStatus(statusKey(next))]}</span></div><span class="nextDate">${h(fmtDate(next.date))} • ${h(p?.shortName||'')}</span><h1>${h(next.title)}</h1><p>${h(next.description||next.mainEvent||'Open the verified record and continue through the chronology.')}</p><div class="heroMeta"><span>${h(next.kind)}</span>${next.venue?`<span>${h(next.venue)}</span>`:''}</div><div class="heroActions"><button class="primaryButton" data-open-record="${h(next.id)}">${icon('play')} Open guide</button><button data-status-key="${h(statusKey(next))}" data-status="watched">${icon('check')} Mark watched</button></div></div>${artwork(next,'heroArtwork')}</article>
    <aside class="progressCard"><div class="progressHeading"><div><span class="eyebrow">Your archive</span><h2>Viewing progress</h2></div><strong>${percent}%</strong></div><div class="progressTrack"><span style="width:${percent}%"></span></div><div class="metricGrid"><div><strong>${counts.promotions}</strong><span>Promotions</span></div><div><strong>${counts.programmes}</strong><span>Programme families</span></div><div><strong>${counts.majorEvents}</strong><span>Dated major events</span></div><div><strong>${allLoadedEpisodes().length}</strong><span>Loaded episodes</span></div></div><div class="connectionRail"><span class="${state.trakt.accessToken?'ready':''}"><b>T</b> Trakt</span><span class="${state.plexMatches.size?'ready':''}"><b>›</b> Plex import</span><span class="ready"><b>TV</b> ${counts.tvMazeFeeds} feeds</span><span class="ready"><b>▶</b> Free links</span></div></aside>
  </section>`;
}

function catalogueStatement(){
  const byRegion=Object.groupBy ? Object.groupBy(state.data.promotions,p=>p.region) : state.data.promotions.reduce((a,p)=>((a[p.region]??=[]).push(p),a),{});
  return `<section class="catalogueStatement"><div><span class="eyebrow">Recovered and audited foundation</span><h2>From territory television to global streaming</h2><p>The original 101-promotion catalogue and 1,144-event chronology are preserved. Exact TV episodes load from mapped TVMaze feeds and can be snapshotted automatically by GitHub Actions.</p></div><div class="statementStats"><span><strong>${byRegion['United States']?.length||0}</strong> U.S.</span><span><strong>${byRegion['Japan']?.length||0}</strong> Japan</span><span><strong>${byRegion['United Kingdom & Europe']?.length||0}</strong> UK / Europe</span><span><strong>${(byRegion['Mexico & Latin America']?.length||0)+(byRegion['Canada']?.length||0)+(byRegion['Australia']?.length||0)}</strong> Other</span></div></section>`;
}

function filterPanel(){
  const f=state.filters, regions=[...new Set(state.data.promotions.map(p=>p.region))].sort();
  const kinds=[...new Set([...state.data.programmes.map(p=>p.kind),...state.data.majorEvents.map(e=>e.kind),'episode'])].sort();
  return `<section class="filterPanel ${state.filtersOpen?'':'collapsed'}"><div class="filterTop"><label class="searchField"><span class="navIcon">${icon('search')}</span><input id="searchInput" placeholder="Search show, company, wrestler, match or event…" value="${h(f.query)}" /></label><button class="filterToggle" data-action="toggle-filters">${icon('filter')} Filters</button><div class="resultSummary"><strong id="resultCount">—</strong> results</div></div><div class="filterGrid">
    ${select('region','Region','All regions',regions.map(x=>[x,x]),f.region)}
    ${select('promotion','Promotion','All promotions',state.data.promotions.map(p=>[p.id,`${p.shortName} — ${p.name}`]),f.promotion)}
    ${select('kind','Programme type','All formats',kinds.map(x=>[x,state.data.formatLabels[x]||x]),f.kind)}
    ${select('era','Era','All eras',[['from-1970','1970 onward'],...Array.from({length:10},(_,i)=>[String(1930+i*10),`${1930+i*10}s only`])],f.era)}
    ${select('wrestler','Wrestler','All curated wrestlers',state.data.wrestlers.map(x=>[x,x]),f.wrestler)}
    ${select('availability','Availability','Any availability',[['plex','Available in Plex import'],['youtube','Official/free link'],['tvmaze','Exact episode feed'],['recommended','Curated recommendation']],f.availability)}
    <label class="checkField"><input data-filter="hideWatched" type="checkbox" ${f.hideWatched?'checked':''}/><span>Hide watched</span></label><button class="resetButton" data-action="reset-filters">Reset all</button>
  </div></section>`;
}
function select(key,label,empty,options,value){return `<label><span>${label}</span><select data-filter="${key}"><option value="">${empty}</option>${options.map(([v,l])=>`<option value="${h(v)}" ${String(value)===String(v)?'selected':''}>${h(l)}</option>`).join('')}</select></label>`;}

function exactView(){
  const filtered=exactRecords().filter(x=>matchFilters(x));
  const visible=filtered.slice(0,state.visible);
  queueMicrotask(()=>{const el=document.querySelector('#resultCount');if(el)el.textContent=filtered.length.toLocaleString();});
  const companies=state.data.promotions.filter(p=>state.data.programmes.some(pr=>pr.promotionId===p.id&&pr.tvMazeId));
  return `<div class="viewHeader"><div><span class="eyebrow">Individual dated records</span><h2>Exact episodes, PPVs & supercards</h2></div><div class="viewControls"><span>Verified episode artwork appears where the source provides it</span></div></div>
  <section class="exactChronologyView"><div class="exactCoverageBar"><div><span class="eyebrow">Individual record chronology</span><h3>Exact PPVs, PLEs, supercards & television</h3><p>Select a company to load all mapped weekly episode feeds. Loaded records are merged chronologically with the recovered major-event catalogue.</p>${state.syncMessage?`<div class="syncProgress">${h(state.syncMessage)}</div>`:''}</div><label><span>Company chronology</span><select id="companyChronology"><option value="">All indexed major events</option>${companies.map(p=>`<option value="${p.id}" ${state.selectedCompany===p.id?'selected':''}>${h(p.shortName)} — ${h(p.name)}</option>`).join('')}</select></label></div>
  <div class="exactRecordsList">${visible.map(exactCard).join('')||empty('No records match the current filters.','Reset the filters or load a company episode feed.')}</div>${filtered.length>state.visible?`<div class="loadMoreRow"><button data-action="load-more">Show ${Math.min(40,filtered.length-state.visible)} more</button></div>`:''}</section>`;
}

function exactCard(e){
  const p=promotion(e.promotionId), prog=programme(e.programId), key=statusKey(e), status=currentStatus(key), plex=state.plexMatches.has(key)||state.plexMatches.has(`program:${e.programId}`);
  return `<article class="exactRecordCard ${status==='watched'?'isWatched':''}" style="--accent:${h(p?.color||'#d7a84f')}"><div class="exactRecordDate"><strong>${h(String(e.date).slice(0,4))}</strong><span>${h(fmtDate(e.date).replace(/, \d{4}$/,''))}</span><small>${h(e.kind)}</small></div><div class="exactRecordArtwork">${artwork(e,'exactRecordArtwork')}</div><div class="exactRecordMain"><div class="programmeKicker"><span>${h(p?.shortName||'')}</span><span>•</span><span>${h(e.code||prog?.name||'Exact record')}</span><b>${String(e.id).startsWith('tvmaze:')?'Exact feed':'Verified date'}</b></div><h3>${h(e.title)}</h3>${prog?.name&&prog.name!==e.title?`<p class="eventName">${h(prog.name)}</p>`:''}<p>${h(e.description||e.mainEvent||'Event card details are not yet included in the verified source record.')}</p><div class="exactRecordFacts"><span>${h(fmtDate(e.date))}</span>${e.venue?`<span>${h(e.venue)}</span>`:''}${e.location?`<span>${h(e.location)}</span>`:''}${e.runtime?`<span>${e.runtime} min</span>`:''}</div><div class="availabilityLights"><span class="light ${plex?'pickLight':''}"><i></i> Plex</span><span class="light pickLight"><i></i> ${h(e.sourceLabel||'Source')}</span></div></div><div class="exactRecordActions"><span class="statusPill status-${status}">${statusLabels[status]}</span><div class="recordStatus">${['watched','watching','skipped'].map(s=>`<button class="${status===s?'active':''}" data-status-key="${h(key)}" data-status="${s}">${s==='watched'?'✓ ':''}${statusLabels[s]}</button>`).join('')}</div>${e.sourceUrl?`<a href="${h(e.sourceUrl)}" target="_blank" rel="noreferrer">Open source ↗</a>`:''}<button data-open-record="${h(e.id)}">Details</button></div></article>`;
}

function chronologyView(){
  const items=state.data.programmes.filter(p=>matchFilters(p,'programme')).slice(0,state.visible);
  const total=state.data.programmes.filter(p=>matchFilters(p,'programme')).length;
  queueMicrotask(()=>{const el=document.querySelector('#resultCount');if(el)el.textContent=total.toLocaleString();});
  return `<div class="viewHeader"><div><span class="eyebrow">Programme-first catalogue</span><h2>Weekly shows, television, streaming & event series</h2></div><div class="viewControls"><span>${total} programme families</span></div></div><section class="programmeGrid">${items.map(programmeCard).join('')||empty('No programmes found.','Try another company, era or search term.')}</section>${total>state.visible?`<div class="loadMoreRow"><button data-action="load-more">Show more</button></div>`:''}`;
}
function programmeCard(p){
  const company=promotion(p.promotionId), status=currentStatus(`program:${p.id}`), feed=p.tvMazeId?'<span class="statusPill status-watching">Exact feed</span>':'';
  return `<article class="programmeCard" style="--accent:${h(company?.color||'#d7a84f')}">${artwork(p,'programmeArtwork')}<div class="programmeCardBody"><div class="programmeKicker"><span>${h(company?.shortName||'')}</span><span>•</span><span>${h(state.data.formatLabels[p.kind]||p.kind)}</span></div><h3>${h(p.name)}</h3><p>${h(p.description)}</p><div class="heroMeta"><span>${h(p.firstAirDate)}${p.endDate?` – ${h(p.endDate)}`:''}</span><span>${h(p.cadence)}</span>${feed}</div><div class="programmeCardActions"><button data-open-programme="${h(p.id)}">Open guide</button>${p.youtubeUrl?`<a href="${h(p.youtubeUrl)}" target="_blank" rel="noreferrer">Free/official ↗</a>`:''}<button data-status-key="program:${h(p.id)}" data-status="${status==='watched'?'unwatched':'watched'}">${status==='watched'?'Unwatch':'Watched'}</button></div></div></article>`;
}

function companiesView(){
  const items=state.data.promotions.filter(p=>{
    if(state.filters.region&&p.region!==state.filters.region)return false;if(state.filters.query&&!normalize(`${p.name} ${p.shortName} ${p.description}`).includes(normalize(state.filters.query)))return false;return true;
  });
  queueMicrotask(()=>{const el=document.querySelector('#resultCount');if(el)el.textContent=items.length.toLocaleString();});
  return `<div class="viewHeader"><div><span class="eyebrow">Promotion directory</span><h2>Companies, territories & lineages</h2></div></div><section class="cardGrid">${items.map(p=>{const pc=state.data.programmes.filter(x=>x.promotionId===p.id).length,ec=state.data.majorEvents.filter(x=>x.promotionId===p.id).length;return `<article class="companyCard" style="--accent:${h(p.color)}"><div class="companySwatch"></div><span class="eyebrow">${h(p.region)}</span><h3>${h(p.shortName)}</h3><strong>${h(p.name)}</strong><p>${h(p.description)}</p><div class="heroMeta"><span>${pc} programmes</span><span>${ec} major events</span></div><div class="cardActions"><button data-company="${h(p.id)}">Open chronology</button>${p.officialUrl?`<a href="${h(p.officialUrl)}" target="_blank">Official ↗</a>`:''}${p.youtubeUrl?`<a href="${h(p.youtubeUrl)}" target="_blank">YouTube ↗</a>`:''}</div></article>`}).join('')}</section>`;
}

function recommendedView(){
  const items=state.data.recommendations.filter(x=>matchFilters(x)).slice(0,state.visible),total=state.data.recommendations.filter(x=>matchFilters(x)).length;
  queueMicrotask(()=>{const el=document.querySelector('#resultCount');if(el)el.textContent=total.toLocaleString();});
  return `<div class="viewHeader"><div><span class="eyebrow">Curated paths</span><h2>Recommended matches, events & episodes</h2></div></div><section class="cardGrid">${items.map(x=>{const p=promotion(x.promotionId),key=`recommendation:${x.id}`,st=currentStatus(key);return `<article class="recommendationCard" style="--accent:${h(p?.color||'#d7a84f')}"><span class="eyebrow">${h(fmtDate(x.date))} • ${h(p?.shortName||'')}</span><h3>${h(x.title)}</h3><strong>${h(x.event)}</strong><p>${h(x.why)}</p><div class="wrestlerTags">${(x.wrestlers||[]).map(w=>`<span>${h(w)}</span>`).join('')}</div><div class="cardActions">${x.watchUrl?`<a href="${h(x.watchUrl)}" target="_blank">Watch/search ↗</a>`:''}${x.sourceUrl?`<a href="${h(x.sourceUrl)}" target="_blank">Source ↗</a>`:''}<button data-status-key="${key}" data-status="${st==='watched'?'unwatched':'watched'}">${st==='watched'?'Watched ✓':'Mark watched'}</button></div></article>`}).join('')}</section>`;
}

function wrestlersView(){
  if(state.filters.wrestler) return wrestlerCareer(state.filters.wrestler);
  const query=normalize(state.filters.query), items=state.data.wrestlers.filter(w=>!query||normalize(w).includes(query));
  queueMicrotask(()=>{const el=document.querySelector('#resultCount');if(el)el.textContent=items.length.toLocaleString();});
  return `<div class="viewHeader"><div><span class="eyebrow">Career viewing routes</span><h2>Follow a wrestler chronologically</h2></div></div><section class="wrestlerDirectory">${items.map(w=>{const count=careerItems(w).length;return `<button class="wrestlerButton" data-wrestler="${h(w)}"><strong>${h(w)}</strong><span>${count} matched records and curated picks</span></button>`}).join('')}</section>`;
}
function careerItems(wrestler){
  const n=normalize(wrestler), events=state.data.majorEvents.filter(e=>normalize(`${e.title} ${e.mainEvent||''}`).includes(n)).map(e=>({...e,_type:'event'}));
  const picks=state.data.recommendations.filter(r=>(r.wrestlers||[]).some(w=>normalize(w)===n)).map(e=>({...e,_type:'pick'}));
  return [...events,...picks].sort((a,b)=>a.date.localeCompare(b.date));
}
function wrestlerCareer(w){const items=careerItems(w);return `<div class="viewHeader"><div><span class="eyebrow">Career chronology</span><h2>${h(w)}</h2></div><div class="viewControls"><button data-action="clear-wrestler">Back to directory</button></div></div><section class="careerTimeline">${items.map(x=>x._type==='event'?exactCard(x):`<article class="careerCard"><span class="eyebrow">${h(fmtDate(x.date))} • Curated pick</span><h3>${h(x.title)}</h3><strong>${h(x.event)}</strong><p>${h(x.why)}</p>${x.watchUrl?`<div class="cardActions"><a href="${h(x.watchUrl)}" target="_blank">Watch/search ↗</a></div>`:''}</article>`).join('')||empty('No exact matches yet.','The wrestler remains in the curated directory, but the recovered event facts do not include a searchable appearance.')}</section>`;}

function libraryView(){
  const entries=[];
  for(const [key,status] of Object.entries(state.statuses)){
    if(state.libraryTab!=='all'&&status!==state.libraryTab)continue;
    if(key.startsWith('event:')){const item=state.data.majorEvents.find(x=>`event:${x.id}`===key);if(item)entries.push({key,status,item});}
    else if(key.startsWith('episode:')){const item=allLoadedEpisodes().find(x=>x.itemKey===key);if(item)entries.push({key,status,item});}
    else if(key.startsWith('program:')){const item=state.data.programmes.find(x=>`program:${x.id}`===key);if(item)entries.push({key,status,item,programme:true});}
    else if(key.startsWith('recommendation:')){const item=state.data.recommendations.find(x=>`recommendation:${x.id}`===key);if(item)entries.push({key,status,item,recommendation:true});}
  }
  return `<div class="viewHeader"><div><span class="eyebrow">Local-first owner library</span><h2>Your progress and availability</h2></div></div><section class="libraryView"><article class="librarySummaryCard"><div class="libraryPulse"><span class="online"></span></div><div><span class="eyebrow">Stored in this browser</span><h3>${Object.keys(state.statuses).length} tracked items</h3><p>Export a backup before clearing browser data or moving devices.</p></div><div class="libraryTools"><button data-action="export">Export backup</button><button data-action="import-backup">Import backup</button><button data-action="plex-import">Import Plex titles</button><button class="dangerButton" data-action="clear-progress">Clear progress</button></div></article><div class="statusTabs">${['all','watching','watched','skipped'].map(x=>`<button data-library-tab="${x}" class="${state.libraryTab===x?'active':''}">${x==='all'?'All':statusLabels[x]}</button>`).join('')}</div><div class="exactRecordsList">${entries.map(e=>e.programme?programmeCard(e.item):e.recommendation?`<article class="careerCard"><h3>${h(e.item.title)}</h3><p>${h(e.item.why)}</p><button data-status-key="${h(e.key)}" data-status="unwatched">Remove</button></article>`:exactCard(e.item)).join('')||empty('Your library is empty.','Mark a programme, episode or event as watching, watched or skipped.')}</div></section>`;
}

function empty(title,body){return `<div class="emptyState"><h3>${h(title)}</h3><p>${h(body)}</p></div>`;}

function modal(){
  const m=state.modal;if(!m)return '';
  if(m.type==='programme')return programmeModal(programme(m.id));
  if(m.type==='record')return recordModal(exactRecords().find(x=>x.id===m.id));
  if(m.type==='connections')return connectionsModal();
  return '';
}
function modalShell(title,body,wide=false){return `<div class="modalBackdrop" data-action="close-modal"><section class="modalPanel ${wide?'wide':''}" role="dialog" aria-modal="true"><button class="modalClose" data-action="close-modal">×</button><header class="modalHeader"><span class="eyebrow">Ringside Archive</span><h2>${h(title)}</h2></header><div class="modalBody">${body}</div></section></div>`;}
function recordModal(item){if(!item)return '';const p=promotion(item.promotionId),prog=programme(item.programId);return modalShell(item.title,`<div class="programmeKicker"><span>${h(p?.name||'')}</span><span>•</span><span>${h(prog?.name||item.kind)}</span></div><div class="modalActions">${item.sourceUrl?`<a href="${h(item.sourceUrl)}" target="_blank">Open source ↗</a>`:''}<button data-status-key="${h(statusKey(item))}" data-status="watched">Mark watched</button></div>${artwork(item,'detailArtwork')}<p><strong>${h(fmtDate(item.date))}</strong></p><p>${h(item.description||item.mainEvent||'No extended description is available in the recovered source record.')}</p>${item.venue?`<p>${h(item.venue)}${item.location?`, ${h(item.location)}`:''}</p>`:''}`);}
function programmeModal(p){if(!p)return '';const company=promotion(p.promotionId),loaded=state.loadedEpisodes.get(p.id)||[],status=currentStatus(`program:${p.id}`);return modalShell(p.name,`<div class="programmeKicker"><span>${h(company?.name||'')}</span><span>•</span><span>${h(state.data.formatLabels[p.kind]||p.kind)}</span></div><p>${h(p.description)}</p><div class="heroMeta"><span>${h(p.firstAirDate)}${p.endDate?` – ${h(p.endDate)}`:''}</span><span>${h(p.cadence)}</span><span>${h(p.priority)}</span></div><div class="modalActions">${p.tvMazeId?`<button data-load-programme="${h(p.id)}">${icon('refresh')} ${loaded.length?'Refresh':'Load'} exact episodes</button>`:''}${p.officialUrl?`<a href="${h(p.officialUrl)}" target="_blank">Official ↗</a>`:''}${p.youtubeUrl?`<a href="${h(p.youtubeUrl)}" target="_blank">Free/official video ↗</a>`:''}<button data-status-key="program:${h(p.id)}" data-status="${status==='watched'?'unwatched':'watched'}">${status==='watched'?'Remove watched':'Mark programme watched'}</button></div>${p.feedNote?`<p class="sourceNote">${h(p.feedNote)}</p>`:''}${loaded.length?`<h3>${loaded.length.toLocaleString()} exact episodes loaded</h3><div class="episodeRows">${loaded.slice(0,250).map(episodeRow).join('')}</div>${loaded.length>250?`<p class="sourceNote">Showing the first 250 in this modal; all loaded episodes are available in Complete Timeline.</p>`:''}`:`<div class="emptyState"><h3>${p.tvMazeId?'Episode feed ready':'No exact feed mapped'}</h3><p>${p.tvMazeId?'Load the verified TVMaze feed to add individual dates, titles and available original artwork.':'The programme remains indexed without inventing unverified episode dates.'}</p></div>`}`,true);}
function episodeRow(e){const st=currentStatus(statusKey(e));return `<article class="episodeRow">${e.artwork?`<img src="${h(e.artwork)}" alt="" loading="lazy">`:`<div class="episodeImageFallback">${icon('play')}</div>`}<div class="episodeIdentity"><span>${h(e.code)}</span><h4>${h(e.title)}</h4><p>${h(fmtDate(e.date))}${e.runtime?` • ${e.runtime} min`:''}</p></div><button class="${st==='watched'?'active':''}" data-status-key="${h(statusKey(e))}" data-status="${st==='watched'?'unwatched':'watched'}">${st==='watched'?'Watched ✓':'Mark watched'}</button></article>`;}
function connectionsModal(){return modalShell('Connections & portability',`<div class="connectionGrid"><section class="connectionPanel"><h3>Trakt device connection</h3><p>Optional. Add <code>TRAKT_CLIENT_ID</code> and <code>TRAKT_CLIENT_SECRET</code> in Vercel, then start device authorization here.</p><div class="modalActions"><button data-action="trakt-connect">Connect Trakt</button><button data-action="trakt-sync" ${state.trakt.accessToken?'':'disabled'}>Import watched history</button></div><p>${state.trakt.accessToken?'A Trakt token is stored locally in this browser.':'Not connected.'}</p><div id="traktDevice"></div></section><section class="connectionPanel"><h3>Plex availability import</h3><p>Vercel cannot directly scan a private LAN Plex server. Run the included PowerShell export tool, then import the resulting JSON here.</p><div class="modalActions"><button data-action="plex-import">Import Plex export</button></div><p>${state.plexMatches.size.toLocaleString()} matched title keys stored locally.</p></section><section class="connectionPanel"><h3>Progress backup</h3><p>Supabase is not required. Export/import keeps the site private and portable without accounts.</p><div class="modalActions"><button data-action="export">Export JSON</button><button data-action="import-backup">Import JSON</button></div></section><section class="connectionPanel"><h3>Original artwork</h3><p>TVMaze supplies programme and episode artwork. Major-event art is only displayed when a verified URL exists in <code>data/artwork-overrides.json</code>.</p></section></div>`,true);}

function footer(){return `<footer><div class="footerBrand"><span class="brandMark">RA</span><div><strong>Ringside Archive</strong><small>Reconstructed complete project</small></div></div><p>Episode metadata and television artwork use TVMaze feeds under CC BY-SA. Major-event facts retain their individual source links. No AI artwork is presented as original.</p><span>Catalogue v3.0 • ${state.data.meta.counts.majorEvents.toLocaleString()} recovered major events • ${state.data.meta.counts.tvMazeFeeds} mapped exact feeds</span></footer>`;}
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
  bind();
}

function bind(){
  document.querySelectorAll('[data-view]').forEach(el=>el.onclick=()=>setView(el.dataset.view));
  document.querySelectorAll('[data-status-key]').forEach(el=>el.onclick=e=>{e.stopPropagation();setStatus(el.dataset.statusKey,el.dataset.status);});
  document.querySelectorAll('[data-open-programme]').forEach(el=>el.onclick=()=>{state.modal={type:'programme',id:el.dataset.openProgramme};render();});
  document.querySelectorAll('[data-open-record]').forEach(el=>el.onclick=()=>{state.modal={type:'record',id:el.dataset.openRecord};render();});
  document.querySelectorAll('[data-company]').forEach(el=>el.onclick=()=>{state.selectedCompany=el.dataset.company;state.filters.promotion=el.dataset.company;setView('exact');loadCompany(el.dataset.company);});
  document.querySelectorAll('[data-wrestler]').forEach(el=>el.onclick=()=>{state.filters.wrestler=el.dataset.wrestler;render();});
  document.querySelectorAll('[data-library-tab]').forEach(el=>el.onclick=()=>{state.libraryTab=el.dataset.libraryTab;render();});
  document.querySelectorAll('[data-filter]').forEach(el=>el.onchange=()=>{state.filters[el.dataset.filter]=el.type==='checkbox'?el.checked:el.value;state.visible=40;render();});
  const search=document.querySelector('#searchInput'); if(search) search.oninput=debounce(()=>{state.filters.query=search.value;state.visible=40;render();},120);
  const company=document.querySelector('#companyChronology'); if(company) company.onchange=()=>{state.selectedCompany=company.value;state.filters.promotion=company.value;state.visible=40;if(company.value)loadCompany(company.value);else render();};
  document.querySelectorAll('[data-load-programme]').forEach(el=>el.onclick=()=>loadProgramme(el.dataset.loadProgramme));
  document.querySelectorAll('[data-action]').forEach(el=>el.onclick=e=>handleAction(el.dataset.action,e));
  const backdrop=document.querySelector('.modalBackdrop');if(backdrop)backdrop.onclick=e=>{if(e.target===backdrop){state.modal=null;render();}};
}

async function loadProgramme(id){
  const p=programme(id); state.syncMessage=`Loading ${p.name}…`; render();
  try { const feed=await loadTvMazeFeed(p,{forceLive:false}); state.showArtwork.set(p.id,feed.show?.image?.original||feed.show?.image?.medium||''); state.loadedEpisodes.set(p.id,(feed.episodes||[]).map(x=>normalizeEpisode(p,feed,x)).filter(Boolean)); state.syncMessage=''; state.modal={type:'programme',id}; showToast(`${state.loadedEpisodes.get(id).length.toLocaleString()} exact episodes loaded for ${p.name}.`); }
  catch(error){state.syncMessage='';showToast(error.message);} render();
}
async function loadCompany(id){
  const company=promotion(id);state.syncMessage=`Loading mapped episode feeds for ${company.shortName}…`;render();
  try {const records=await loadPromotionEpisodes(state.data.programmes,id,(done,total,program)=>{state.syncMessage=`Loading ${company.shortName}: ${done}/${total} feeds (${program.name})`;const el=document.querySelector('.syncProgress');if(el)el.textContent=state.syncMessage;});
    const grouped=new Map();for(const record of records)grouped.set(record.programId,[...(grouped.get(record.programId)||[]),record]);for(const [pid,list] of grouped)state.loadedEpisodes.set(pid,list);state.syncMessage=`Loaded ${records.length.toLocaleString()} exact episodes from ${grouped.size} feeds.`;showToast(state.syncMessage);setTimeout(()=>{state.syncMessage='';render();},3000);
  }catch(error){state.syncMessage='';showToast(error.message);}render();
}

async function handleAction(action,event){
  event?.stopPropagation();
  if(action==='toggle-filters'){state.filtersOpen=!state.filtersOpen;render();}
  if(action==='reset-filters'){state.filters={query:'',region:'',promotion:'',kind:'',era:'from-1970',wrestler:'',availability:'',hideWatched:false};state.selectedCompany='';state.visible=40;render();}
  if(action==='load-more'){state.visible+=40;render();}
  if(action==='clear-wrestler'){state.filters.wrestler='';render();}
  if(action==='connections'){state.modal={type:'connections'};render();}
  if(action==='close-modal'){state.modal=null;render();}
  if(action==='dismiss-toast'){state.toast='';render();}
  if(action==='export'){downloadJson(`ringside-archive-backup-${new Date().toISOString().slice(0,10)}.json`,storage.exportAll());showToast('Backup exported.');}
  if(action==='import-backup')pickFile('backup');
  if(action==='plex-import')pickFile('plex');
  if(action==='clear-progress'&&confirm('Clear all local viewing progress?')){storage.clearProgress();state.statuses={};render();}
  if(action==='trakt-connect')await startTraktDevice();
  if(action==='trakt-sync')await syncTraktHistory();
}
function pickFile(mode){filePicker.value='';filePicker.dataset.mode=mode;filePicker.accept='.json,application/json,text/plain';filePicker.click();}
filePicker.onchange=async()=>{const file=filePicker.files?.[0];if(!file)return;try{const text=await file.text(),data=JSON.parse(text);if(filePicker.dataset.mode==='backup'){storage.importAll(data);state.statuses=storage.statuses();state.plexMatches=storage.plex();state.trakt=storage.trakt();showToast('Backup imported.');}
else {const titles=Array.isArray(data)?data:(data.titles||data.items||[]);const matches=new Set(state.plexMatches);for(const item of titles){const title=typeof item==='string'?item:[item.title,item.name,item.grandparentTitle,item.parentTitle].filter(Boolean).join(' ');if(!title)continue;const n=normalize(title);for(const p of state.data.programmes)if(n.includes(normalize(p.name))||p.aliases?.some(a=>n.includes(normalize(a))))matches.add(`program:${p.id}`);for(const e of state.data.majorEvents)if(n.includes(normalize(e.title)))matches.add(`event:${e.id}`);}state.plexMatches=matches;storage.savePlex(matches);showToast(`${matches.size.toLocaleString()} Plex matches stored.`);}render();}catch(error){showToast(error.message||'Import failed.');}};

async function startTraktDevice(){
  try {const response=await fetch('./api/trakt/device-code',{method:'POST'});const data=await response.json();if(!response.ok)throw new Error(data.error||'Trakt device authorization is not configured.');const holder=document.querySelector('#traktDevice');if(holder)holder.innerHTML=`<p>Open <a href="${h(data.verification_url)}" target="_blank">${h(data.verification_url)}</a> and enter:</p><h2><code>${h(data.user_code)}</code></h2><p>Waiting for authorization…</p>`;const started=Date.now();while(Date.now()-started<(data.expires_in||600)*1000){await new Promise(r=>setTimeout(r,(data.interval||5)*1000));const tokenResponse=await fetch('./api/trakt/device-token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_code:data.device_code})});if(tokenResponse.status===202)continue;const token=await tokenResponse.json();if(!tokenResponse.ok)throw new Error(token.error||'Trakt authorization failed.');state.trakt={...state.trakt,...token};storage.saveTrakt(state.trakt);showToast('Trakt connected.');render();return;}throw new Error('Trakt device code expired.');}catch(error){showToast(error.message);}
}
async function syncTraktHistory(){
  try {const response=await fetch('./api/trakt/history',{headers:{Authorization:`Bearer ${state.trakt.accessToken}`}});const data=await response.json();if(!response.ok)throw new Error(data.error||'Trakt sync failed.');let matched=0;for(const item of data.items||[]){const title=normalize(item.title),year=item.year;const program=state.data.programmes.find(p=>normalize(p.name)===title||p.aliases?.some(a=>normalize(a)===title));if(program){state.statuses[`program:${program.id}`]='watched';matched++;continue;}const event=state.data.majorEvents.find(e=>normalize(e.title)===title&&(!year||yearOf(e.date)===year));if(event){state.statuses[`event:${event.id}`]='watched';matched++;}}storage.saveStatuses(state.statuses);showToast(`Trakt sync matched ${matched.toLocaleString()} archive items.`);render();}catch(error){showToast(error.message);}
}

(async function init(){
  try {state.data=await loadData();const hash=location.hash.slice(1);if(navItems.some(x=>x[0]===hash))state.view=hash;render();if('serviceWorker'in navigator)navigator.serviceWorker.register('./service-worker.js').catch(()=>{});}catch(error){app.innerHTML=`<div class="bootScreen"><span class="brandMark">RA</span><h1>Archive failed to load</h1><p>${h(error.message)}</p><p>Use a local web server rather than opening index.html directly.</p></div>`;}
})();
