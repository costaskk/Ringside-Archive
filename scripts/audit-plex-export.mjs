import fs from 'node:fs';

const file = process.argv[2] || 'plex-library-export.json';
const payload = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const rows = Array.isArray(payload) ? payload : (payload.titles || payload.items || []);
const valid = rows.filter(row => row && (row.title || row.grandparentTitle || row.ratingKey));
const wrestlingPattern = /wrestl|ppv|raw|smackdown|nitro|dynamite|collision|rampage|impact|nxt|ecw|wcw|wwf|wwe|aew|roh|njpw|tna/i;
const likelyWrestling = valid.filter(row => wrestlingPattern.test([
  row.library, row.title, row.grandparentTitle, row.parentTitle
].filter(Boolean).join(' ')));
const viewStateRows = valid.filter(row => Number(row.viewCount || 0) > 0 || Number(row.viewOffset || 0) > 0 || row.lastViewedAt);
const byLibrary = new Map();
for (const row of rows) {
  const name = row?.library || '(unknown)';
  const current = byLibrary.get(name) || { total: 0, valid: 0, episodes: 0, movies: 0, viewStateRows: 0 };
  current.total++;
  if (row && (row.title || row.grandparentTitle || row.ratingKey)) current.valid++;
  if (row?.type === 'episode') current.episodes++;
  if (row?.type === 'movie' || row?.type === 'video') current.movies++;
  if (Number(row?.viewCount || 0) > 0 || Number(row?.viewOffset || 0) > 0 || row?.lastViewedAt) current.viewStateRows++;
  byLibrary.set(name, current);
}
const serialized = JSON.stringify(payload);
const containsToken = /[?&]X-Plex-Token=/i.test(serialized);
const report = {
  file,
  format: payload.format || null,
  version: payload.version || null,
  totalRows: rows.length,
  validRows: valid.length,
  likelyWrestlingRows: likelyWrestling.length,
  viewStateRows: viewStateRows.length,
  containsEmbeddedPlexToken: containsToken,
  libraries: Object.fromEntries([...byLibrary.entries()].sort((a,b)=>a[0].localeCompare(b[0])))
};
console.log(JSON.stringify(report, null, 2));
if (containsToken) {
  console.error('SECURITY: This export contains a Plex token in image URLs. Rotate the token and create a version 3 export.');
  process.exitCode = 2;
}
if (!likelyWrestling.length) {
  console.error('MATCHING: No valid wrestling records were found. Re-run the exporter with -LibraryNames "Wrestling","Wrestling PPV" and confirm those libraries report valid items.');
  if (!process.exitCode) process.exitCode = 3;
}
if (Number(payload.version || 0) < 3) {
  console.error('FORMAT: This is a legacy export. Use the version 3 exporter included with Ringside Archive v5.5.0.');
  if (!process.exitCode) process.exitCode = 4;
}
