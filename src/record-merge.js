const normalized = value => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

export function recordNaturalKey(item) {
  return `${String(item?.date || '').slice(0, 10)}|${item?.programId || ''}|${normalized(item?.title || item?.name || item?.id || '')}`;
}

export function episodeIdentity(item) {
  if (!item?.programId) return '';
  const code = String(item.code || '').match(/s\s*0*(\d+)\s*e\s*0*(\d+)/i);
  if (code) return `${item.programId}:s${Number(code[1])}:e${Number(code[2])}`;
  const season = Number(item.season);
  const number = Number(item.number);
  if (Number.isFinite(season) && Number.isFinite(number) && (season > 0 || number > 0)) {
    return `${item.programId}:s${season}:e${number}`;
  }
  if (item.kind === 'episode' && item.date) return `${item.programId}:date:${String(item.date).slice(0, 10)}`;
  return '';
}

export function exactIdentityKey(item) {
  const episode = episodeIdentity(item);
  return episode ? `episode|${episode}` : `record|${recordNaturalKey(item)}`;
}

function genericEpisodeTitle(value) {
  const title = normalized(value);
  return !title || /^episode(?: \d+)?$/.test(title) || /^s\d+ e\d+$/.test(title);
}

function genericEpisodeDescription(value) {
  const text = normalized(value);
  return !text
    || /record imported from the supplied plex library metadata/.test(text)
    || /episode aired \d{4} \d{2} \d{2}/.test(text);
}

export function mergeExactPair(left, right, priority = () => 0) {
  if (!left) return right;
  if (!right) return left;
  const leftPriority = Number(priority(left) || 0);
  const rightPriority = Number(priority(right) || 0);
  const primary = rightPriority > leftPriority ? right : left;
  const secondary = primary === left ? right : left;
  const merged = { ...secondary, ...primary };

  for (const key of ['artwork', 'showArtwork', 'sourceUrl', 'sourceLabel', 'tvMazeId', 'tvMazeShowId', 'rating', 'runtime', 'venue', 'location', 'mainEvent']) {
    if (merged[key] === null || merged[key] === undefined || merged[key] === '') merged[key] = secondary[key];
  }
  if (genericEpisodeTitle(merged.title) && !genericEpisodeTitle(secondary.title)) merged.title = secondary.title;
  if (genericEpisodeDescription(merged.description) && !genericEpisodeDescription(secondary.description)) merged.description = secondary.description;
  merged.itemKey = primary.itemKey || secondary.itemKey;
  merged._mergedIds = [...new Set([...(left._mergedIds || [left.id]), ...(right._mergedIds || [right.id])].filter(Boolean))];
  return merged;
}

export function mergeExactRows(rows = [], { priority = () => 0 } = {}) {
  const merged = new Map();
  for (const item of rows) {
    if (!item?.date) continue;
    const key = exactIdentityKey(item);
    merged.set(key, mergeExactPair(merged.get(key), item, priority));
  }
  return [...merged.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))
    || String(a.code || '').localeCompare(String(b.code || ''), undefined, { numeric: true })
    || String(a.title || '').localeCompare(String(b.title || '')));
}
