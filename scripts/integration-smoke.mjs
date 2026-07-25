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
    if(value.includes('en.wikipedia.org/api/rest_v1/page/summary/'))return new Response('',{status:404});
    if(value.includes('en.wikipedia.org/w/api.php')){
      const query=new URL(value).searchParams.get('gsrsearch')||'';
      const wrestler=/Hulk Hogan/i.test(query);
      const payload={query:{pages:[{
        pageid:wrestler?1:2,
        title:wrestler?'Hulk Hogan':'World Wrestling Entertainment',
        description:wrestler?'American professional wrestler':'American professional wrestling promotion',
        fullurl:wrestler?'https://en.wikipedia.org/wiki/Hulk_Hogan':'https://en.wikipedia.org/wiki/WWE',
        original:{source:wrestler?'https://upload.wikimedia.org/hulk.jpg':'https://upload.wikimedia.org/wwe-logo.svg'}
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
  if(Number(results[0]?.result?.confidence||0)<80||Number(results[1]?.result?.confidence||0)<80)throw new Error('Artwork confidence threshold test failed.');

  globalThis.fetch=async url=>{
    if(String(url)==='https://api.tvmaze.com/shows/80637')return new Response(JSON.stringify({
      id:80637,name:'NWA: Total Nonstop Action',url:'https://www.tvmaze.com/shows/80637/nwa-total-nonstop-action',
      image:{original:'https://static.tvmaze.com/uploads/images/original_untouched/tna.jpg'}
    }),{status:200,headers:{'content-type':'application/json'}});
    throw new Error(`Unexpected TVMaze artwork fetch: ${url}`);
  };
  res=responseRecorder();
  await artworkSearch({method:'POST',body:{title:'NWA-TNA / TNA Weekly Pay-Per-Views',programmeTitle:'NWA-TNA / TNA Weekly Pay-Per-Views',aliases:['NWA: Total Nonstop Action'],kind:'ppv',tvMazeId:80637}},res);
  if(res.record.statusCode!==200||res.record.body?.source!=='TVMaze'||Number(res.record.body?.confidence||0)<90)throw new Error('Mapped TVMaze artwork priority test failed.');

  globalThis.fetch=async (url,options={})=>{
    const value=String(url);
    if(value.includes('en.wikipedia.org/api/rest_v1/page/summary/Hulk_Hogan'))return new Response(JSON.stringify({
      title:'Hulk Hogan',description:'American professional wrestler',extract:'Professional wrestler',
      originalimage:{source:'https://upload.wikimedia.org/hulk-render.jpg'},content_urls:{desktop:{page:'https://en.wikipedia.org/wiki/Hulk_Hogan'}}
    }),{status:200,headers:{'content-type':'application/json'}});
    if(value==='https://upload.wikimedia.org/hulk-render.jpg')return new Response(Buffer.from([1,2,3]),{status:200,headers:{'content-type':'image/jpeg'}});
    throw new Error(`Unexpected rendered headshot fetch: ${url}`);
  };
  res=responseRecorder();
  await artworkSearch({method:'GET',query:{render:'1',kind:'wrestler',title:'Hulk Hogan'}},res);
  if(res.record.statusCode!==200||res.record.headers['content-type']!=='image/jpeg')throw new Error('Direct wrestler headshot rendering test failed.');

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

  process.env.SUPABASE_URL='https://supabase.example';
  process.env.SUPABASE_PUBLISHABLE_KEY='publishable';
  process.env.CLOUDFLARE_ACCOUNT_ID='abc123';
  process.env.R2_ACCESS_KEY_ID='r2-access';
  process.env.R2_SECRET_ACCESS_KEY='r2-secret';
  process.env.R2_BUCKET_NAME='ringside-artwork';
  process.env.R2_ARTWORK_PUBLIC_BASE_URL='https://artwork.example';
  let r2Put=null;
  globalThis.fetch=async (url,options={})=>{
    const value=String(url);
    if(value==='https://supabase.example/auth/v1/user')return new Response(JSON.stringify({id:'user-1'}),{status:200,headers:{'content-type':'application/json'}});
    if(value.includes('en.wikipedia.org/api/rest_v1/page/summary/Hulk_Hogan'))return new Response(JSON.stringify({title:'Hulk Hogan',description:'American professional wrestler',extract:'Professional wrestler',originalimage:{source:'https://upload.wikimedia.org/hulk-r2.jpg'},content_urls:{desktop:{page:'https://en.wikipedia.org/wiki/Hulk_Hogan'}}}),{status:200,headers:{'content-type':'application/json'}});
    if(value==='https://upload.wikimedia.org/hulk-r2.jpg')return new Response(Buffer.from([9,8,7,6]),{status:200,headers:{'content-type':'image/jpeg'}});
    if(value.startsWith('https://abc123.r2.cloudflarestorage.com/ringside-artwork/')){r2Put={url:value,options};return new Response('',{status:200});}
    throw new Error(`Unexpected R2 artwork fetch: ${url}`);
  };
  res=responseRecorder();
  await artworkSearch({method:'POST',headers:{'x-ringside-account-token':'token'},body:{key:'wrestler:Hulk Hogan',title:'Hulk Hogan',kind:'wrestler'}},res);
  if(res.record.statusCode!==200||!res.record.body?.r2Cached||!String(res.record.body?.headshot).startsWith('https://artwork.example/runtime/'))throw new Error('Authenticated R2 artwork persistence test failed.');
  if(!r2Put?.options?.headers?.Authorization||r2Put.options.headers['Cache-Control']!=='public,max-age=31536000,immutable')throw new Error('R2 SigV4/cache headers are missing.');

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
