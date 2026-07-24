const STATUS_KEY = 'ringside-status-v3';
const SETTINGS_KEY = 'ringside-settings-v3';
const PLEX_KEY = 'ringside-plex-v1';
const TRAKT_KEY = 'ringside-trakt-v1';

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || '') ?? fallback; } catch { return fallback; }
}
function write(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

export const storage = {
  statuses: () => read(STATUS_KEY, {}),
  saveStatuses: value => write(STATUS_KEY, value),
  settings: () => read(SETTINGS_KEY, {}),
  saveSettings: value => write(SETTINGS_KEY, value),
  plex: () => new Set(read(PLEX_KEY, [])),
  savePlex: value => write(PLEX_KEY, [...value]),
  trakt: () => read(TRAKT_KEY, {}),
  saveTrakt: value => write(TRAKT_KEY, value),
  exportAll() {
    return {
      format: 'ringside-archive-backup', version: 3, exportedAt: new Date().toISOString(),
      statuses: this.statuses(), settings: this.settings(), plexMatches: [...this.plex()], trakt: this.trakt()
    };
  },
  importAll(data) {
    if (!data || data.format !== 'ringside-archive-backup') throw new Error('This is not a Ringside Archive backup.');
    if (data.statuses) this.saveStatuses(data.statuses);
    if (data.settings) this.saveSettings(data.settings);
    if (Array.isArray(data.plexMatches)) this.savePlex(new Set(data.plexMatches));
    if (data.trakt) this.saveTrakt(data.trakt);
  },
  clearProgress() { localStorage.removeItem(STATUS_KEY); }
};
