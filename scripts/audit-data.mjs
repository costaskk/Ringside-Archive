import fs from 'node:fs/promises';
const read=name=>fs.readFile(new URL(`../data/${name}.json`,import.meta.url),'utf8').then(JSON.parse);
const [promotions,programmes,events,recommendations,customRecords]=await Promise.all(['promotions','programmes','major-events','recommendations','custom-records'].map(read));
const allEvents=[...events,...customRecords];
const errors=[];const warnings=[];
const unique=(items,key,label)=>{const seen=new Set();for(const item of items){const value=item[key];if(seen.has(value))errors.push(`Duplicate ${label}: ${value}`);seen.add(value);}};
unique(promotions,'id','promotion id');unique(programmes,'id','programme id');unique(allEvents,'id','event id');unique(recommendations,'id','recommendation id');
const pids=new Set(promotions.map(x=>x.id)),programIds=new Set(programmes.map(x=>x.id));
for(const item of programmes)if(!pids.has(item.promotionId))errors.push(`Programme ${item.id} has unknown promotion ${item.promotionId}`);
for(const item of allEvents){if(!pids.has(item.promotionId))errors.push(`Event ${item.id} has unknown promotion ${item.promotionId}`);if(!programIds.has(item.programId))errors.push(`Event ${item.id} has unknown programme ${item.programId}`);if(!/^\d{4}-\d{2}-\d{2}$/.test(item.date))errors.push(`Event ${item.id} has invalid date ${item.date}`);if(item.mainEvent==='TBA')warnings.push(`Future/TBA event: ${item.id}`);}
for(const item of recommendations){if(!pids.has(item.promotionId))errors.push(`Recommendation ${item.id} has unknown promotion`);if(!programIds.has(item.programId))errors.push(`Recommendation ${item.id} has unknown programme`);}
console.log(JSON.stringify({ok:errors.length===0,counts:{promotions:promotions.length,programmes:programmes.length,events:events.length,customRecords:customRecords.length,recommendations:recommendations.length},errors,warnings: warnings.slice(0,25),warningCount:warnings.length},null,2));
if(errors.length)process.exit(1);
