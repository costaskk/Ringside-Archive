import fs from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const [events,recommendations]=await Promise.all([
  fs.readFile(new URL('data/major-events.json',root),'utf8').then(JSON.parse),
  fs.readFile(new URL('data/recommendations.json',root),'utf8').then(JSON.parse)
]);
const noise=/\b(?:singles?|tag team|trios?|six[- ]man|eight[- ]man|ten[- ]man|battle royal|steel cage|ladder|tables?|chairs?|death|no holds barred|submission|falls? count anywhere|two[- ]out[- ]of[- ]three falls?|handicap|gauntlet|tournament|final|match|championship|title|vacant|for the|with|special guest|referee|champion)\b/gi;
function competitors(text=''){
  const raw=String(text).replace(/[“”]/g,'"').replace(/[’]/g,"'").replace(/,\s+(Jr\.|Sr\.|II|III|IV)/g,' $1');if(!raw)return[];
  const before=raw.split(/\s+(?:in an?|for the|with |to retain|to win|inside |at )\s+/i)[0];
  const par=[...before.matchAll(/\(([^)]+)\)/g)].map(x=>x[1]);const main=before.replace(/\([^)]*\)/g,' ');const out=[];
  for(const part of [main,...par])for(const chunk of part.split(/\s+(?:vs\.?|versus|v\.?|defeated|&|and)\s+|\s*,\s*/i)){
    const cleaned=chunk.replace(/\b\(c\)\b/gi,'').replace(noise,' ').replace(/\s+/g,' ').replace(/^[\-–—:;\s]+|[\-–—:;\s]+$/g,'').trim();
    if(cleaned.length>=2&&cleaned.length<=80&&/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(cleaned)&&!/^(?:the|a|an|nwa|wwf|wwe|wcw|ecw|aew|\d+[- ]man|one[- ]ring|two[- ]ring)$/i.test(cleaned))out.push(cleaned);
  }
  return [...new Set(out)];
}
const details={};
for(const event of events){
  const recs=recommendations.filter(rec=>rec.programId===event.programId&&(rec.date===event.date||String(rec.title).toLowerCase()===String(event.title).toLowerCase()));
  details[event.id]={
    completeCard:false,
    matches:event.mainEvent?[{order:'Main event',match:event.mainEvent,result:''}]:[],
    competitors:competitors(event.mainEvent),
    review:recs.map(rec=>rec.why).filter(Boolean).join('\n\n'),
    sourceNote:'Known main event from the recovered Wikipedia chronology. Add further sourced matches to mark this card complete.'
  };
}
await fs.writeFile(new URL('data/event-details.json',root),JSON.stringify(details,null,2)+'\n');
console.log(`Generated details for ${Object.keys(details).length} events.`);
