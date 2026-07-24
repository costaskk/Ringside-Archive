import traktDevice from '../api/trakt/device.js';
import artworkSearch from '../api/artwork/search.js';
import plexLibrary from '../api/plex/library.js';
import configHandler from '../api/config.js';

function responseRecorder(){
  const record={statusCode:200,headers:{},body:null};
  return {
    record,
    status(code){record.statusCode=code;return this;},
    setHeader(name,value){record.headers[name.toLowerCase()]=value;return this;},
    json(value){record.body=value;return this;},
    send(value){record.body=value;return this;}
  };
}

const originalFetch=globalThis.fetch;
const originalEnv={...process.env};
try{
  process.env.TRAKT_CLIENT_ID='  fake-client-id  ';
  process.env.TRAKT_CLIENT_SECRET=' fake-secret ';
  let traktRequestHeaders=null;
  globalThis.fetch=async (url,options={})=>{
    if(String(url).includes('/oauth/device/code')){traktRequestHeaders=options.headers;return new Response(JSON.stringify({error:'forbidden'}),{status:403,headers:{'content-type':'application/json'}});}
    throw new Error(`Unexpected fetch: ${url}`);
  };
  let res=responseRecorder();
  await traktDevice({method:'POST',body:{action:'code'},headers:{}},res);
  if(res.record.statusCode!==403||!/client ID/i.test(`${res.record.body?.error} ${res.record.body?.details}`))throw new Error('Trakt 403 diagnostic test failed.');
  if(!traktRequestHeaders?.['User-Agent']||!traktRequestHeaders?.['trakt-api-key']||!traktRequestHeaders?.['trakt-api-version'])throw new Error('Trakt required-header test failed.');

  res=responseRecorder();
  configHandler({method:'GET'},res);
  if(!res.record.body?.traktConfigured||!res.record.body?.diagnostics?.traktClientId)throw new Error('Config diagnostics test failed.');

  delete process.env.TMDB_READ_ACCESS_TOKEN;
  globalThis.fetch=async url=>{
    const value=String(url);
    if(value.includes('en.wikipedia.org/w/api.php')){
      const query=new URL(value).searchParams.get('gsrsearch')||'';
      const wrestler=/Hulk Hogan/i.test(query);
      const payload={query:{pages:[{
        pageid:wrestler?1:2,
        title:wrestler?'Hulk Hogan':'World Wrestling Entertainment',
        description:wrestler?'American professional wrestler':'American professional wrestling promotion',
        fullurl:wrestler?'https://en.wikipedia.org/wiki/Hulk_Hogan':'https://en.wikipedia.org/wiki/WWE',
        original:{source:wrestler?'https://upload.wikimedia.org/hulk.jpg':'https://upload.wikimedia.org/wwe.svg'}
      }]}};
      return new Response(JSON.stringify(payload),{status:200,headers:{'content-type':'application/json'}});
    }
    throw new Error(`Unexpected artwork fetch: ${url}`);
  };
  res=responseRecorder();
  await artworkSearch({method:'POST',body:{items:[
    {key:'company:wwe',title:'World Wrestling Entertainment',kind:'company',aliases:['WWE']},
    {key:'wrestler:Hulk Hogan',title:'Hulk Hogan',kind:'wrestler'}
  ]}},res);
  const results=res.record.body?.results||[];
  if(res.record.statusCode!==200||!results[0]?.result?.logo||!results[1]?.result?.headshot)throw new Error('Artwork logo/headshot batch test failed.');

  globalThis.fetch=async (url,options={})=>{
    if(String(url)==='https://upload.wikimedia.org/test.svg'){
      if(!options.headers?.['User-Agent'])throw new Error('Artwork proxy omitted User-Agent.');
      return new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>',{status:200,headers:{'content-type':'image/svg+xml'}});
    }
    throw new Error(`Unexpected artwork proxy fetch: ${url}`);
  };
  res=responseRecorder();
  await artworkSearch({method:'GET',query:{asset:'https://upload.wikimedia.org/test.svg'}},res);
  if(res.record.statusCode!==200||res.record.headers['content-type']!=='image/svg+xml')throw new Error('Artwork proxy test failed.');

  let videoRequestUrl='';
  globalThis.fetch=async url=>{
    const value=String(url);
    if(value.startsWith('https://bad.plex.direct'))throw new TypeError('fetch failed');
    if(value==='https://relay.plex.services/library/sections')return new Response(JSON.stringify({MediaContainer:{Directory:[
      {key:'7',title:'Wrestling',type:'show'},
      {key:'8',title:'Wrestling PPV',type:'video'}
    ]}}),{status:200,headers:{'content-type':'application/json'}});
    if(value.startsWith('https://relay.plex.services/library/sections/7/all')){
      if(!new URL(value).searchParams.has('type')||new URL(value).searchParams.get('type')!=='4')throw new Error('Show scan did not request Plex episode type 4.');
      return new Response(JSON.stringify({MediaContainer:{totalSize:1,size:1,Metadata:[{title:'Episode One',grandparentTitle:'WWE Raw',type:'episode',ratingKey:'99',parentIndex:1,index:1,duration:3600000,viewOffset:1800000,thumb:'/library/metadata/99/thumb'}]}}),{status:200,headers:{'content-type':'application/json'}});
    }
    if(value.startsWith('https://relay.plex.services/library/sections/8/all')){
      videoRequestUrl=value;
      return new Response(JSON.stringify({MediaContainer:{totalSize:1,size:1,Metadata:[{title:'WrestleMania 40',year:2024,type:'movie',ratingKey:'100',duration:14400000,viewCount:1}]}}),{status:200,headers:{'content-type':'application/json'}});
    }
    throw new Error(`Unexpected Plex fetch: ${url}`);
  };
  const server={name:'Test Plex',machineIdentifier:'machine-1',connections:[
    {uri:'https://bad.plex.direct:32400',local:false,relay:false},
    {uri:'https://relay.plex.services',local:false,relay:true}
  ]};
  res=responseRecorder();
  await plexLibrary({method:'POST',headers:{},body:{action:'scan',clientId:'client',token:'token',server,sectionKeys:['7','8']}},res);
  if(res.record.statusCode!==200||res.record.body?.items?.length!==2||res.record.body?.server?.uri!=='https://relay.plex.services')throw new Error('Plex connection fallback/section scan test failed.');
  if(!videoRequestUrl||new URL(videoRequestUrl).searchParams.has('type'))throw new Error('Other Videos scan must omit the Plex metadata type filter.');

  console.log('Integration smoke passed: Trakt headers/diagnostics, artwork discovery/proxy and Plex connection fallback validated.');
} finally {
  globalThis.fetch=originalFetch;
  for(const key of Object.keys(process.env))if(!(key in originalEnv))delete process.env[key];
  Object.assign(process.env,originalEnv);
}
