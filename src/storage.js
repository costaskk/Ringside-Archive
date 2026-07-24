const STATUS_KEY = 'ringside-status-v5';
const LEGACY_STATUS_KEYS = ['ringside-status-v4','ringside-status-v3'];
const STATUS_META_KEY = 'ringside-status-meta-v1';
const SETTINGS_KEY = 'ringside-settings-v5';
const LEGACY_SETTINGS_KEYS = ['ringside-settings-v4','ringside-settings-v3'];
const PLEX_KEY = 'ringside-plex-v3';
const LEGACY_PLEX_KEYS = ['ringside-plex-v2','ringside-plex-v1'];
const TRAKT_KEY = 'ringside-trakt-v2';
const LEGACY_TRAKT_KEY = 'ringside-trakt-v1';
const ARTWORK_KEY = 'ringside-artwork-v1';
const REVIEWS_KEY = 'ringside-reviews-v1';
const FEED_MAP_KEY = 'ringside-feed-map-v1';
const CLOUD_META_KEY = 'ringside-cloud-meta-v1';
const ACCOUNT_OWNER_KEY = 'ringside-account-owner-v1';

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || '') ?? fallback; } catch { return fallback; }
}
function write(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function migrateObject(primary, legacyKeys, fallback = {}) {
  const current = read(primary, null);
  if (current !== null) return current;
  for (const legacy of legacyKeys) {
    const old = read(legacy, null);
    if (old !== null) { write(primary, old); return old; }
  }
  return fallback;
}
function normalizePlexData(value) {
  if (Array.isArray(value)) return { matches: value, items: [], servers: [], selectedServer: null, account: null };
  return {
    matches: Array.isArray(value?.matches) ? value.matches : [],
    items: Array.isArray(value?.items) ? value.items : [],
    servers: Array.isArray(value?.servers) ? value.servers : [],
    selectedServer: value?.selectedServer || null,
    account: value?.account || null,
    clientId: value?.clientId || null,
    token: value?.token || null,
    scannedAt: value?.scannedAt || null
  };
}
function nowIso() { return new Date().toISOString(); }
function newerTimestamp(a, b) {
  const left = Date.parse(a || '') || 0, right = Date.parse(b || '') || 0;
  return left >= right ? 'local' : 'cloud';
}
function mergeRecordMaps(local = {}, cloud = {}, localMeta = {}, cloudMeta = {}) {
  const result = {}, meta = {};
  for (const key of new Set([...Object.keys(local), ...Object.keys(cloud)])) {
    const side = newerTimestamp(localMeta[key], cloudMeta[key]);
    if (side === 'cloud' && Object.prototype.hasOwnProperty.call(cloud, key)) {
      result[key] = cloud[key]; meta[key] = cloudMeta[key] || nowIso();
    } else if (Object.prototype.hasOwnProperty.call(local, key)) {
      result[key] = local[key]; meta[key] = localMeta[key] || nowIso();
    } else if (Object.prototype.hasOwnProperty.call(cloud, key)) {
      result[key] = cloud[key]; meta[key] = cloudMeta[key] || nowIso();
    }
  }
  return { result, meta };
}

export const storage = {

  accountOwner: () => localStorage.getItem(ACCOUNT_OWNER_KEY) || '',
  prepareForAccount(userId) {
    const next = String(userId || ''), current = this.accountOwner();
    if (!next) return false;
    if (current && current !== next) {
      for (const key of [
        STATUS_KEY, STATUS_META_KEY, SETTINGS_KEY, PLEX_KEY, TRAKT_KEY, ARTWORK_KEY, REVIEWS_KEY,
        `${REVIEWS_KEY}-meta`, FEED_MAP_KEY, CLOUD_META_KEY,
        ...LEGACY_STATUS_KEYS, ...LEGACY_SETTINGS_KEYS, ...LEGACY_PLEX_KEYS, LEGACY_TRAKT_KEY
      ]) localStorage.removeItem(key);
    }
    localStorage.setItem(ACCOUNT_OWNER_KEY, next);
    return Boolean(current && current !== next);
  },
  statuses: () => migrateObject(STATUS_KEY, LEGACY_STATUS_KEYS, {}),
  statusMeta: () => read(STATUS_META_KEY, {}),
  saveStatuses(value, changedKey = null) {
    write(STATUS_KEY, value);
    if (changedKey) {
      const meta = this.statusMeta(); meta[changedKey] = nowIso(); write(STATUS_META_KEY, meta);
    }
    this.markCloudDirty();
  },
  saveStatusesBulk(value, changedKeys = []) {
    write(STATUS_KEY, value);
    if (changedKeys.length) { const stamp=nowIso(),meta=this.statusMeta(); for(const key of changedKeys)meta[key]=stamp; write(STATUS_META_KEY,meta); }
    this.markCloudDirty();
  },
  settings: () => migrateObject(SETTINGS_KEY, LEGACY_SETTINGS_KEYS, {
    autoLoadEpisodes: true,
    autoImportPlexViewing: false,
    pushWatchedToPlex: false,
    syncPlexWatchedToTrakt: false,
    plexWatchedThreshold: 0.9,
    cloudAutoSync: true
  }),
  saveSettings(value) { write(SETTINGS_KEY, value); this.markCloudDirty(); },
  plexData() {
    const current = read(PLEX_KEY, null);
    if (current !== null) return normalizePlexData(current);
    for (const key of LEGACY_PLEX_KEYS) {
      const old = read(key, null);
      if (old !== null) { const migrated = normalizePlexData(old); write(PLEX_KEY, migrated); return migrated; }
    }
    return normalizePlexData({});
  },
  savePlexData: value => write(PLEX_KEY, normalizePlexData(value)),
  plex: () => new Set(storage.plexData().matches),
  savePlex(value) {
    const current = storage.plexData(); current.matches = [...value]; storage.savePlexData(current);
  },
  trakt: () => migrateObject(TRAKT_KEY, [LEGACY_TRAKT_KEY], {}),
  saveTrakt: value => write(TRAKT_KEY, value),
  artwork: () => read(ARTWORK_KEY, {}),
  saveArtwork(value) { write(ARTWORK_KEY, value); this.markCloudDirty(); },
  reviews: () => read(REVIEWS_KEY, {}),
  saveReviews(value, changedKey = null) {
    write(REVIEWS_KEY, value);
    if (changedKey) {
      const meta = read(`${REVIEWS_KEY}-meta`, {}); meta[changedKey] = nowIso(); write(`${REVIEWS_KEY}-meta`, meta);
    }
    this.markCloudDirty();
  },
  reviewMeta: () => read(`${REVIEWS_KEY}-meta`, {}),
  feedMap: () => read(FEED_MAP_KEY, {}),
  saveFeedMap(value) { write(FEED_MAP_KEY, value); this.markCloudDirty(); },
  cloudMeta: () => read(CLOUD_META_KEY, { revision: 0, lastSyncAt: null, dirty: false }),
  saveCloudMeta: value => write(CLOUD_META_KEY, value),
  markCloudDirty() {
    const meta = this.cloudMeta(); meta.dirty = true; meta.localUpdatedAt = nowIso(); this.saveCloudMeta(meta);
  },
  cloudState() {
    return {
      format: 'ringside-cloud-state', version: 1,
      statuses: this.statuses(), statusMeta: this.statusMeta(),
      settings: this.settings(), reviews: this.reviews(), reviewMeta: this.reviewMeta(),
      feedMap: this.feedMap(), artwork: this.artwork(), updatedAt: nowIso()
    };
  },
  mergeCloudState(cloud = {}) {
    const statusMerge = mergeRecordMaps(this.statuses(), cloud.statuses || {}, this.statusMeta(), cloud.statusMeta || {});
    write(STATUS_KEY, statusMerge.result); write(STATUS_META_KEY, statusMerge.meta);
    const reviewMerge = mergeRecordMaps(this.reviews(), cloud.reviews || {}, this.reviewMeta(), cloud.reviewMeta || {});
    write(REVIEWS_KEY, reviewMerge.result); write(`${REVIEWS_KEY}-meta`, reviewMerge.meta);
    if (cloud.settings) write(SETTINGS_KEY, { ...cloud.settings, ...this.settings() });
    if (cloud.feedMap) write(FEED_MAP_KEY, { ...cloud.feedMap, ...this.feedMap() });
    if (cloud.artwork) write(ARTWORK_KEY, { ...cloud.artwork, ...this.artwork() });
    return { statuses: statusMerge.result, reviews: reviewMerge.result, settings: this.settings(), feedMap: this.feedMap(), artwork: this.artwork() };
  },
  exportAll() {
    return {
      format: 'ringside-archive-backup', version: 5, exportedAt: nowIso(),
      statuses: this.statuses(), statusMeta: this.statusMeta(), settings: this.settings(), plex: this.plexData(), trakt: this.trakt(),
      artwork: this.artwork(), reviews: this.reviews(), reviewMeta: this.reviewMeta(), feedMap: this.feedMap()
    };
  },
  importAll(data) {
    if (!data || data.format !== 'ringside-archive-backup') throw new Error('This is not a Ringside Archive backup.');
    if (data.statuses) write(STATUS_KEY, data.statuses);
    if (data.statusMeta) write(STATUS_META_KEY, data.statusMeta);
    if (data.settings) write(SETTINGS_KEY, data.settings);
    if (data.plex) this.savePlexData(data.plex);
    else if (Array.isArray(data.plexMatches)) this.savePlexData({ matches: data.plexMatches, items: [] });
    if (data.trakt) this.saveTrakt(data.trakt);
    if (data.artwork) this.saveArtwork(data.artwork);
    if (data.reviews) write(REVIEWS_KEY, data.reviews);
    if (data.reviewMeta) write(`${REVIEWS_KEY}-meta`, data.reviewMeta);
    if (data.feedMap) this.saveFeedMap(data.feedMap);
    this.markCloudDirty();
  },
  clearProgress() {
    localStorage.removeItem(STATUS_KEY); localStorage.removeItem(STATUS_META_KEY);
    for (const key of LEGACY_STATUS_KEYS) localStorage.removeItem(key);
  },
  clearPlex() { localStorage.removeItem(PLEX_KEY); for (const key of LEGACY_PLEX_KEYS) localStorage.removeItem(key); },
  clearTrakt() { localStorage.removeItem(TRAKT_KEY); localStorage.removeItem(LEGACY_TRAKT_KEY); }
};
