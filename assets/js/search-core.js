// Ядро поиска: нормализация, словоформы, ссылки на Писание, ранжирование.
// Работает и в браузере (search.js), и в Node (проверки после сборки).

import { findRefs, stripRefs, segsOverlap } from './bible.js';
import { stem as snowball } from './stem-ru.js';

// Частые формы, которые стеммер разводит по разным основам.
const STEM_FIXES = new Map([
  ['отец', 'отц'],
  ['христос', 'христ'],
  ['церков', 'церкв'],
  ['любов', 'любв'],
]);

const STOPWORDS = new Set([
  'и', 'в', 'во', 'не', 'на', 'с', 'со', 'к', 'ко', 'у', 'о', 'об', 'обо', 'от', 'до', 'по',
  'за', 'из', 'а', 'но', 'же', 'ли', 'бы', 'то', 'как', 'что', 'это', 'для', 'при', 'или',
  'ни', 'да', 'так', 'там', 'тут', 'ещё', 'еще',
]);

export function normalize(text) {
  return String(text ?? '').toLowerCase().replace(/ё/g, 'е');
}

export function tokenize(text) {
  return normalize(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

export function stem(token) {
  if (/\d/.test(token)) return token;
  const s = snowball(token);
  return STEM_FIXES.get(s) ?? s;
}

const stemsOf = (text) => tokenize(text).map(stem);

/** Подготовить документы индекса: разобрать ссылки и словоформы. */
export function prepareIndex(raw) {
  const docs = raw.docs.map((d) => {
    const fields = {
      title: new Set(stemsOf(d.title)),
      aliases: new Set(stemsOf((d.aliases || []).join(' '))),
      summary: new Set(stemsOf(d.summary)),
      passages: new Set(stemsOf((d.passages || []).join(' '))),
    };
    const bodyStems = stemsOf(d.body);
    const bodyCounts = new Map();
    for (const s of bodyStems) bodyCounts.set(s, (bodyCounts.get(s) || 0) + 1);
    return {
      ...d,
      fields,
      bodyCounts,
      bodyStemList: [...bodyCounts.keys()],
      normTitle: normalize(d.title),
      normBody: normalize(d.body),
    };
  });
  return { ...raw, docs };
}

// Совпадение основы запроса с основой в документе: 1 — точное, меньше — частичное
function stemScore(q, s, isLast) {
  if (q === s) return 1;
  if (q.length >= 5 && s.length >= 5 && (s.startsWith(q) || q.startsWith(s))) return 0.7;
  if (isLast && q.length >= 4 && s.startsWith(q)) return 0.5;
  return 0;
}

function bestInSet(q, set, isLast) {
  if (set.has(q)) return 1;
  let best = 0;
  for (const s of set) {
    const v = stemScore(q, s, isLast);
    if (v > best) best = v;
    if (best === 1) break;
  }
  return best;
}

const WEIGHTS = { title: 12, aliases: 8, passages: 6, summary: 5 };

/** Разобрать запрос: ссылки на Писание + слова. */
export function parseQuery(query) {
  const refs = findRefs(query, { query: true });
  const rest = refs.length ? stripRefs(query, refs) : query;
  const words = tokenize(rest).filter((t) => !STOPWORDS.has(t));
  const lastRaw = /[\s.,:;!?]$/.test(query) ? null : words[words.length - 1];
  const terms = words.map((w) => ({ raw: w, stem: stem(w), isLast: w === lastRaw }));
  return { refs, terms, phrase: normalize(rest).replace(/\s+/g, ' ').trim() };
}

const refIn = (q, docRefs) => docRefs.some(([book, segs]) => book === q.book && segsOverlap(segs, q.segs));

// Чем уже совпавший отрывок, тем выше документ: «Ин. 17:3» точнее, чем «Ин. 17:1–24».
function precisionBonus(queryRefs, docRefs) {
  let best = 0;
  for (const q of queryRefs) {
    for (const [book, segs] of docRefs) {
      if (book !== q.book) continue;
      for (const [from, to] of segs) {
        if (!segsOverlap([[from, to]], q.segs)) continue;
        const span = to - from;
        best = Math.max(best, 10 / (1 + span / 3));
      }
    }
  }
  return best;
}

/**
 * Поиск. Возвращает [{ doc, score, matchedStems, refHit }], лучшие первыми.
 * Документ подходит, если совпадают все ссылки из запроса и все слова.
 */
export function search(index, query, { topic = null, limit = 50 } = {}) {
  const q = parseQuery(query);
  if (!q.refs.length && !q.terms.length) return [];
  const results = [];
  for (const doc of index.docs) {
    if (topic && !(doc.topics || []).includes(topic)) continue;
    let score = 0;
    let refHit = null;

    if (q.refs.length) {
      // «passage» — место разбирается в статье; «mention» — только упоминается в тексте
      const inPassages = q.refs.every((r) => refIn(r, doc.refs || []));
      const inText = q.refs.every((r) => refIn(r, doc.refs || []) || refIn(r, doc.mentions || []));
      if (inPassages) { score += 100 + precisionBonus(q.refs, doc.refs || []); refHit = 'passage'; }
      else if (inText) { score += 35; refHit = 'mention'; }
      else continue;
    }

    const matchedStems = [];
    let allTerms = true;
    for (const t of q.terms) {
      let termScore = 0;
      for (const [field, weight] of Object.entries(WEIGHTS)) {
        const m = bestInSet(t.stem, doc.fields[field], t.isLast);
        if (m) termScore += weight * m;
      }
      let bodyBest = 0;
      let bodyCount = 0;
      if (doc.bodyCounts.has(t.stem)) { bodyBest = 1; bodyCount = doc.bodyCounts.get(t.stem); }
      else {
        for (const s of doc.bodyStemList) {
          const v = stemScore(t.stem, s, t.isLast);
          if (v > bodyBest) { bodyBest = v; bodyCount = doc.bodyCounts.get(s); }
        }
      }
      if (bodyBest) termScore += bodyBest * (2 + Math.min(bodyCount, 8) * 0.5);
      if (!termScore) { allTerms = false; break; }
      score += termScore;
      matchedStems.push(t.stem);
    }
    if (!allTerms) continue;

    if (q.phrase.length > 3 && q.terms.length > 1) {
      if (doc.normTitle.includes(q.phrase)) score += 25;
      else if (doc.normBody.includes(q.phrase)) score += 12;
    }
    if (doc.type === 'article') score += 1;
    results.push({ doc, score, matchedStems, refHit });
  }
  results.sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title, 'ru'));
  return results.slice(0, limit);
}

/** Фрагмент текста вокруг первого совпадения: [{ text, mark }] для безопасной вставки. */
export function snippet(doc, matchedStems, length = 220) {
  const text = doc.body || doc.summary || '';
  if (!matchedStems.length) {
    return [{ text: (doc.summary || text).slice(0, length) + ((doc.summary || text).length > length ? '…' : ''), mark: false }];
  }
  const wordRe = /[\p{L}\p{N}]+/gu;
  const hits = [];
  let m;
  while ((m = wordRe.exec(text))) {
    const s = stem(normalize(m[0]));
    if (matchedStems.some((q) => stemScore(q, s, true) > 0)) hits.push([m.index, m.index + m[0].length]);
  }
  if (!hits.length) return [{ text: doc.summary || text.slice(0, length), mark: false }];
  let start = Math.max(0, hits[0][0] - 70);
  if (start > 0) {
    const sp = text.indexOf(' ', start);
    if (sp !== -1 && sp < hits[0][0]) start = sp + 1;
  }
  let end = Math.min(text.length, start + length);
  if (end < text.length) {
    const sp = text.lastIndexOf(' ', end);
    if (sp > hits[0][1]) end = sp;
  }
  const parts = [];
  if (start > 0) parts.push({ text: '…', mark: false });
  let pos = start;
  for (const [a, b] of hits) {
    if (a < start || b > end) continue;
    if (a > pos) parts.push({ text: text.slice(pos, a), mark: false });
    parts.push({ text: text.slice(a, b), mark: true });
    pos = b;
  }
  if (pos < end) parts.push({ text: text.slice(pos, end), mark: false });
  if (end < text.length) parts.push({ text: '…', mark: false });
  return parts;
}
