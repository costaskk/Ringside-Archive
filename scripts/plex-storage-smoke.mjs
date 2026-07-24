class MemoryStorage {
  constructor(limit = 5 * 1024 * 1024) { this.map = new Map(); this.limit = limit; }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) {
    const text = String(value);
    let total = 0;
    for (const [currentKey, currentValue] of this.map) if (currentKey !== key) total += (currentKey.length + currentValue.length) * 2;
    total += (String(key).length + text.length) * 2;
    if (total > this.limit) { const error = new Error('Quota exceeded'); error.name = 'QuotaExceededError'; throw error; }
    this.map.set(String(key), text);
  }
  removeItem(key) { this.map.delete(String(key)); }
}

globalThis.localStorage = new MemoryStorage(900 * 1024);
const { storage } = await import('../src/storage.js');
const items = Array.from({ length: 1800 }, (_, index) => ({
  title: `WWE Raw episode ${index + 1}`,
  grandparentTitle: 'WWE Raw',
  type: 'episode', ratingKey: String(index + 1), parentIndex: Math.floor(index / 52) + 1, index: index % 52 + 1,
  duration: 3600000, viewCount: index % 300 === 0 ? 1 : 0,
  viewOffset: index % 200 === 0 ? 1200000 : 0,
  thumb: `/library/metadata/${index + 1}/thumb/1`,
  art: `/library/metadata/${index + 1}/art/1`,
  thumbUrl: `http://127.0.0.1:32400/library/metadata/${index + 1}/thumb/1?X-Plex-Token=secret`,
  artUrl: `https://example.invalid/image/${index + 1}.jpg`,
  library: 'Wrestling', machineIdentifier: 'server', unusedLargeField: 'x'.repeat(300)
}));
const matches = items.map((_, index) => `episode:wwe-raw:${Math.floor(index / 52) + 1}:${index % 52 + 1}`);
const saved = storage.savePlexData({ items, matches, servers: [], selectedServer: null });
const serialized = localStorage.getItem('ringside-plex-v3') || '';
if (/X-Plex-Token=/i.test(serialized)) throw new Error('Plex storage retained a raw token URL.');
if (/unusedLargeField/.test(serialized)) throw new Error('Plex storage retained unapproved fields.');
if (!Array.isArray(saved.matches) || saved.matches.length !== matches.length) throw new Error('Plex storage lost ownership match keys.');
if (!Array.isArray(saved.items) || saved.items.length > items.length) throw new Error('Plex compact storage returned invalid items.');
console.log(`Plex storage smoke passed: ${matches.length} match keys, ${saved.items.length} compact item links, no raw token URLs.`);
