const DB_NAME = 'ringside-archive-media';
const DB_VERSION = 1;
const STORE = 'plex-items';

function openDb() {
  if (!('indexedDB' in globalThis)) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open the Plex item database.'));
  });
}

function itemKey(item) {
  return String(item?.ratingKey || `${item?.machineIdentifier || ''}:${item?.libraryKey || item?.library || ''}:${item?.grandparentTitle || ''}:${item?.parentIndex ?? ''}:${item?.index ?? ''}:${item?.title || ''}`);
}

function compact(item) {
  const keys = ['title','grandparentTitle','parentTitle','year','type','ratingKey','index','parentIndex','originallyAvailableAt','duration','lastViewedAt','viewCount','viewOffset','userRating','guid','guids','thumb','art','thumbUrl','artUrl','library','libraryKey','machineIdentifier','serverName'];
  const out = { key: itemKey(item) };
  for (const key of keys) if (item?.[key] !== undefined && item?.[key] !== null && item?.[key] !== '') out[key] = item[key];
  return out;
}

export async function savePlexItems(items = []) {
  const db = await openDb();
  if (!db) return false;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.clear();
    for (const item of items) store.put(compact(item));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('Unable to save the full Plex index.'));
    tx.onabort = () => reject(tx.error || new Error('The Plex index transaction was aborted.'));
  });
  db.close();
  return true;
}

export async function loadPlexItems() {
  const db = await openDb();
  if (!db) return [];
  const rows = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error('Unable to load the full Plex index.'));
  });
  db.close();
  return rows.map(({ key, ...item }) => item);
}

export async function clearPlexItems() {
  const db = await openDb();
  if (!db) return;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('Unable to clear the Plex item database.'));
  });
  db.close();
}
