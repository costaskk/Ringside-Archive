import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=') || '';
const publicBase = String(arg('public-base-url') || process.env.R2_ARTWORK_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const outputDir = path.resolve(root, arg('output-dir') || 'public-artwork');
const inputPath = path.resolve(root, arg('catalog') || 'data/artwork-catalog.json');
const stagedPath = path.resolve(root, arg('catalog-out') || 'data/artwork-catalog.r2-staged.json');
const manifestPath = path.resolve(root, arg('manifest-out') || 'data/artwork-r2-manifest.json');
const limit = Number(arg('limit') || Infinity);
const concurrency = Math.max(1, Math.min(12, Number(arg('concurrency') || 4)));
const dryRun = process.argv.includes('--dry-run');

if (!publicBase) throw new Error('Provide --public-base-url=https://artwork.example.com or R2_ARTWORK_PUBLIC_BASE_URL.');

const catalog = JSON.parse(await fs.readFile(inputPath, 'utf8'));
const staged = structuredClone(catalog);
const jobs = [];
const mediaFields = ['poster', 'backdrop', 'still', 'logo', 'headshot'];
const safe = value => String(value).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 140) || 'item';

function extensionFrom(url, contentType = '') {
  const type = contentType.split(';')[0].trim().toLowerCase();
  const map = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/svg+xml': '.svg', 'image/avif': '.avif' };
  if (map[type]) return map[type];
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    if (/^\.(?:jpe?g|png|webp|gif|svg|avif)$/.test(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  } catch {}
  return '.jpg';
}

function enqueue(section, key, target, field, url, suffix = '') {
  if (!/^https?:\/\//i.test(String(url || ''))) return;
  if (String(url).startsWith(`${publicBase}/`)) return;
  jobs.push({ section, key, target, field, url, suffix });
}

for (const section of ['programmes', 'records', 'episodes']) {
  for (const [key, entry] of Object.entries(staged[section] || {})) {
    for (const field of mediaFields) enqueue(section, key, entry, field, entry[field]);
    for (const [season, seasonEntry] of Object.entries(entry.seasons || {})) {
      for (const field of mediaFields) enqueue(section, key, seasonEntry, field, seasonEntry[field], `season-${safe(season)}-`);
    }
  }
}

const selected = jobs.slice(0, Number.isFinite(limit) ? limit : jobs.length);
const manifest = { version: 1, generatedAt: new Date().toISOString(), publicBaseUrl: publicBase, totalCandidates: jobs.length, processed: 0, uploadedFiles: [], failures: [] };
let cursor = 0;

async function worker() {
  while (cursor < selected.length) {
    const job = selected[cursor++];
    try {
      const response = await fetch(job.url, { headers: { Accept: 'image/avif,image/webp,image/*,*/*;q=0.8', 'User-Agent': 'RingsideArchiveArtworkCache/5.7 (+https://ringside-archive.vercel.app)' }, signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length) throw new Error('empty response');
      const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
      const ext = extensionFrom(job.url, response.headers.get('content-type') || '');
      const relative = path.posix.join(job.section, safe(job.key), `${job.suffix}${job.field}-${hash}${ext}`);
      const destination = path.join(outputDir, ...relative.split('/'));
      if (!dryRun) { await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, buffer); }
      const original = job.url;
      job.target[job.field] = `${publicBase}/${relative}`;
      job.target.cachedFrom ||= {};
      job.target.cachedFrom[job.field] = original;
      manifest.uploadedFiles.push({ key: job.key, section: job.section, field: job.field, sourceUrl: original, objectKey: relative, bytes: buffer.length });
    } catch (error) {
      manifest.failures.push({ key: job.key, section: job.section, field: job.field, sourceUrl: job.url, error: error.message });
    } finally {
      manifest.processed++;
      if (manifest.processed % 25 === 0 || manifest.processed === selected.length) console.log(`Prepared ${manifest.processed}/${selected.length} artwork assets.`);
    }
  }
}

await fs.mkdir(outputDir, { recursive: true });
await Promise.all(Array.from({ length: Math.min(concurrency, selected.length || 1) }, worker));
staged.r2 = { publicBaseUrl: publicBase, generatedAt: manifest.generatedAt, objectCount: manifest.uploadedFiles.length };
if (!dryRun) {
  await fs.writeFile(stagedPath, `${JSON.stringify(staged, null, 2)}\n`);
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
console.log(JSON.stringify({ ok: true, candidates: jobs.length, processed: manifest.processed, cached: manifest.uploadedFiles.length, failures: manifest.failures.length, outputDir, stagedCatalog: stagedPath, dryRun }, null, 2));
