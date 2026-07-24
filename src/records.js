import { normalize, yearOf } from './utils.js';

const noise = /\b(?:singles?|tag team|trios?|six[- ]man|eight[- ]man|ten[- ]man|battle royal|steel cage|ladder|tables?|chairs?|death|no holds barred|submission|falls? count anywhere|two[- ]out[- ]of[- ]three falls?|handicap|gauntlet|tournament|final|match|championship|title|vacant|for the|with|special guest|referee|c\b|champion)\b/gi;

export function parseCompetitors(text = '') {
  const raw = String(text || '').replace(/[“”]/g, '"').replace(/[’]/g, "'").replace(/,\s+(Jr\.|Sr\.|II|III|IV)/g, ' $1');
  if (!raw) return [];
  const beforeStipulation = raw.split(/\s+(?:in an?|for the|with |to retain|to win|inside |at )\s+/i)[0];
  const candidates = [];
  const parenthetical = [...beforeStipulation.matchAll(/\(([^)]+)\)/g)].map(match => match[1]);
  const main = beforeStipulation.replace(/\([^)]*\)/g, ' ');
  for (const part of [main, ...parenthetical]) {
    for (const chunk of part.split(/\s+(?:vs\.?|versus|v\.?|defeated|&|and)\s+|\s*,\s*/i)) {
      const cleaned = chunk
        .replace(/\b(?:The|Team)\s+/i, match => match.trim() === 'The' ? 'The ' : '')
        .replace(/\b\(c\)\b/gi, '')
        .replace(noise, ' ')
        .replace(/\s+/g, ' ')
        .replace(/^[\-–—:;\s]+|[\-–—:;\s]+$/g, '')
        .trim();
      if (cleaned.length >= 2 && cleaned.length <= 80 && /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(cleaned)) candidates.push(cleaned);
    }
  }
  return [...new Set(candidates.filter(value => !/^(?:the|a|an|nwa|wwf|wwe|wcw|ecw|aew)$/i.test(value)))];
}

export function detailsFor(item, data) {
  const direct = data.eventDetails?.[item.id] || {};
  const recommendations = (data.recommendations || []).filter(rec =>
    rec.programId === item.programId && (rec.date === item.date || normalize(rec.title) === normalize(item.title))
  );
  const matches = Array.isArray(direct.matches) && direct.matches.length
    ? direct.matches
    : item.mainEvent ? [{ order: 'Main event', match: item.mainEvent, result: '' }] : [];
  const competitors = [...new Set([
    ...(direct.competitors || []),
    ...(item.wrestlers || []),
    ...recommendations.flatMap(rec => rec.wrestlers || []),
    ...parseCompetitors(item.mainEvent || ''),
    ...matches.flatMap(row => parseCompetitors(row.match || row.description || ''))
  ])].sort((a,b)=>a.localeCompare(b));
  return {
    ...direct,
    matches,
    competitors,
    editorial: direct.review || recommendations.map(rec => rec.why).filter(Boolean).join('\n\n'),
    completeCard: Boolean(direct.completeCard),
    sourceNote: direct.sourceNote || (direct.completeCard ? 'Complete card from the linked source.' : 'Only verified matches currently present in the archive are shown.'),
    year: yearOf(item.date)
  };
}

export function recordTraktPayload(item, programme) {
  if (!item || !programme) return null;
  if (String(item.itemKey || '').startsWith('episode:')) {
    const parts = item.itemKey.split(':');
    const season = Number(parts.at(-2));
    const episode = Number(parts.at(-1));
    if (!Number.isFinite(season) || !Number.isFinite(episode)) return null;
    return {
      kind: 'episode',
      show: {
        title: programme.traktTitle || programme.name,
        year: yearOf(programme.firstAirDate) || undefined,
        ids: programme.traktIds || undefined
      },
      season,
      episode
    };
  }
  if (['ppv','supercard','tournament','special'].includes(item.kind) || item.kind !== 'episode') {
    return {
      kind: 'movie',
      movie: {
        title: item.traktTitle || item.title,
        year: yearOf(item.date) || undefined,
        ids: item.traktIds || undefined
      }
    };
  }
  return null;
}
