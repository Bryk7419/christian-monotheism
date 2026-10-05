// Поиск ссылок на Писание в обычном тексте статьи: «Ин. 8:58», «1 Кор. 3:6, 8», «(8:24)».
// Модуль без зависимостей от страницы: его используют сборка (Node), всплывающие стихи и озвучка.
//
// Ссылка без названия книги («(8:24)») относится к книге последней явной ссылки в том же
// предложении, а если её нет, к «домашней» книге статьи (первое из «Разбираемых мест»).

import { books } from './bible.js';

const byAbbr = new Map();
for (const b of books) byAbbr.set(b.abbr.replace(/\s+/g, ' '), b.id);
// Сокращения длиннее проверяются раньше («1 Ин.» раньше «Ин.»).
const abbrs = [...byAbbr.keys()].sort((a, b) => b.length - a.length)
  .map((a) => a.replace(/\./g, '\\.').replace(/ /g, '[\\s\\u00a0]'));

const NUM = '\\d{1,3}';
const DASH = '\\s?[-‐-―−]\\s?';
// глава:стих[-стих|-глава:стих] и продолжения «, стих[-стих]» или «, глава:стих[-стих]»
const PART = `${NUM}:${NUM}(?:${DASH}${NUM}(?::${NUM})?)?`;
const CONT = `(?:,\\s?(?:${NUM}:)?${NUM}(?:${DASH}${NUM})?(?!\\d|:\\d))*`;
const REF = new RegExp(`(?:(?<![\\p{L}\\d])(${abbrs.join('|')})[\\s\\u00a0]?)?(?<![\\d:])(${PART}${CONT})`, 'gu');
const SENTENCE_END = /[.!?…»]\s+[«(А-ЯЁA-Z]/u;

/** Разобрать числовую часть «8:24, 28» или «1:15, 30» в отрезки [глава, стих1, глава2, стих2]. */
export function parseNums(text) {
  const segs = [];
  let chapter = null;
  for (const raw of text.split(',')) {
    const part = raw.trim();
    const m = /^(?:(\d+):)?(\d+)(?:\s?[-‐-―−]\s?(\d+)(?::(\d+))?)?$/u.exec(part);
    if (!m) continue;
    if (m[1]) chapter = Number(m[1]);
    if (chapter === null) continue;
    const v1 = Number(m[2]);
    let c2 = chapter;
    let v2 = v1;
    if (m[3] && m[4]) { c2 = Number(m[3]); v2 = Number(m[4]); } else if (m[3]) { v2 = Number(m[3]); }
    segs.push([chapter, v1, c2, v2]);
    chapter = c2;
  }
  return segs;
}

/**
 * Найти ссылки в тексте одного абзаца.
 * Возвращает [{ start, end, book, segs, explicit }] с позициями в исходной строке.
 */
export function scanRefs(text, homeBook) {
  const out = [];
  let lastBook = null;
  let lastEnd = 0;
  REF.lastIndex = 0;
  let m;
  while ((m = REF.exec(text))) {
    const start = m.index;
    const end = start + m[0].length;
    const before = text.slice(Math.max(0, start - 3), start);
    // «(с 1:17)» в тексте о видео: это отметка времени, а не стих
    if (!m[1] && /(?:^|[\s(])с\s$/u.test(before)) continue;
    // «Hebrews 1:10», «1 Ен. 48:3»: книга, которой нет в списке, — ссылку не трогаем
    if (!m[1] && /(?:[A-Za-z]{2,}|\p{L}{1,6}\.)[\s\u00a0]?$/u.test(text.slice(Math.max(0, start - 12), start))) continue;
    // Новое предложение сбрасывает книгу последней явной ссылки
    if (lastBook && SENTENCE_END.test(text.slice(lastEnd, start))) lastBook = null;
    let book;
    if (m[1]) {
      book = byAbbr.get(m[1].replace(/[\s\u00a0]+/g, ' '));
      if (!book) continue;
      lastBook = book;
    } else {
      book = lastBook || homeBook;
    }
    lastEnd = end;
    if (!book) continue;
    const segs = parseNums(m[2]);
    if (!segs.length) continue;
    out.push({ start, end, book, segs, explicit: Boolean(m[1]) });
  }
  return out;
}

/** Все стихи, на которые указывают отрезки: [[глава, стих], …] (не больше 40 подряд). */
export function versesOf(segs, chapterLengths) {
  const out = [];
  for (const [c1, v1, c2, v2] of segs) {
    for (let c = c1; c <= c2; c += 1) {
      const from = c === c1 ? v1 : 1;
      const to = c === c2 ? v2 : (chapterLengths?.[c - 1] ?? v1);
      for (let v = from; v <= to && out.length < 40; v += 1) out.push([c, v]);
    }
  }
  return out;
}

/** Номер книги на bible.by (Синодальный перевод) для ссылки «читать главу». */
export const BIBLE_BY = {
  gen: 1, exo: 2, lev: 3, num: 4, deu: 5, jos: 6, jdg: 7, rut: 8, '1sa': 9, '2sa': 10, '1ki': 11, '2ki': 12,
  '1ch': 13, '2ch': 14, ezr: 15, neh: 16, est: 17, job: 18, psa: 19, pro: 20, ecc: 21, sng: 22, isa: 23, jer: 24,
  lam: 25, ezk: 26, dan: 27, hos: 28, jol: 29, amo: 30, oba: 31, jon: 32, mic: 33, nam: 34, hab: 35, zep: 36,
  hag: 37, zec: 38, mal: 39, mat: 40, mrk: 41, luk: 42, jhn: 43, act: 44, jas: 45, '1pe': 46, '2pe': 47,
  '1jn': 48, '2jn': 49, '3jn': 50, jud: 51, rom: 52, '1co': 53, '2co': 54, gal: 55, eph: 56, php: 57, col: 58,
  '1th': 59, '2th': 60, '1ti': 61, '2ti': 62, tit: 63, phm: 64, heb: 65, rev: 66,
};
