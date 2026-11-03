// Текст статьи для чтения вслух: общий для кнопки «Слушать» (assets/js/listen.js)
// и для записи озвучки нейроголосом (tools/make_audio.py через tools/audio-text.mjs).
// Голос читает ровный текст: ссылки на Писание в скобках пропускаются, ссылки внутри фразы читаются словами
// (если у ссылки нет подсказки data-say, см. AGENTS.md); греческие, еврейские и латинские вставки пропускаются,
// кроме имени יהוה («Яхве»); пустые после этого скобки и лишние знаки убираются.

import { books } from './bible.js';
import { scanRefs } from './refscan.js';

const BOOK = Object.fromEntries(books.map((b) => [b.id, b]));

// --- Греческий: традиционное чтение ---------------------------------------------------------------------
const VOWELS = 'αεηιουω';
const DIGRAPHS = [['αι', 'ай'], ['ει', 'эй'], ['οι', 'ой'], ['υι', 'юй'], ['ου', 'у'], ['αυ', 'ау'], ['ευ', 'эу'], ['ηυ', 'эу'],
  ['γγ', 'нг'], ['γκ', 'нк'], ['γξ', 'нкс'], ['γχ', 'нх']];
const LETTERS = { α: 'а', β: 'б', γ: 'г', δ: 'д', ε: 'э', ζ: 'дз', η: 'э', θ: 'т', ι: 'и', κ: 'к', λ: 'л', μ: 'м', ν: 'н',
  ξ: 'кс', ο: 'о', π: 'п', ρ: 'р', σ: 'с', ς: 'с', τ: 'т', υ: 'ю', φ: 'ф', χ: 'х', ψ: 'пс', ω: 'о' };

export function greekToCyrillic(word) {
  const decomposed = word.normalize('NFD');
  const rough = decomposed.includes('̔');
  let w = decomposed.replace(/[̀-ͯͅʼ’']/g, '').toLowerCase();
  let out = '';
  for (let i = 0; i < w.length;) {
    const pair = w.slice(i, i + 2);
    const d = DIGRAPHS.find(([g]) => g === pair);
    if (d) { out += d[1]; i += 2; continue; }
    const c = w[i];
    if (c === 'υ' && i > 0 && VOWELS.includes(w[i - 1])) out += 'у';
    else out += LETTERS[c] ?? c;
    i += 1;
  }
  // густое придыхание в начале слова: ὁ → «хо», ἕν → «хэн»
  if (rough && VOWELS.includes(w[0])) out = `х${out}`;
  if (rough && w[0] === 'ρ') out = `р${out.slice(1)}`;
  return out;
}

const GREEK_WORD = /[Ͱ-Ͽἀ-῿][Ͱ-Ͽἀ-῿̀-ͯʼ’]*/u;

// --- Иврит: русский голос его не прочтёт. Вслух звучит только имя Бога, остальное пропускается ------------
const HEBREW_WORDS = { יהוה: 'Яхве' };
const HEBREW_WORD = /[\u05D0-\u05EA][\u0591-\u05C7\u05D0-\u05EA]*/u;
function hebrewWord(word) {
  return HEBREW_WORDS[word.replace(/[\u0591-\u05C7]/g, '')] ?? '';
}

// --- Ссылки на Писание словами ------------------------------------------------------------------------------
function spokenRef(ref) {
  const b = BOOK[ref.book];
  // отрезки по главам: «8:24, 28» → глава 8, стихи 24 и 28
  const groups = [];
  for (const [c1, v1, c2, v2] of ref.segs) {
    const text = c1 !== c2 ? `с ${v1} стиха главы ${c1} по ${v2} стих главы ${c2}` : (v1 === v2 ? `${v1}` : `с ${v1} по ${v2}`);
    const last = groups[groups.length - 1];
    if (last && last.c === c1 && c1 === c2) last.items.push(text);
    else groups.push({ c: c1, items: [text], range: c1 !== c2 || v1 !== v2 });
  }
  const parts = groups.map((g) => {
    const many = g.items.length > 1 || g.range;
    const head = ref.book === 'psa' ? `псалом ${g.c}` : `глава ${g.c}`;
    return `${head}, ${many ? 'стихи' : 'стих'} ${g.items.join(' и ')}`;
  });
  const name = ref.explicit && b && ref.book !== 'psa' ? `${b.name}, ` : '';
  const text = `${name}${parts.join('; ')}`;
  return text.charAt(0).toUpperCase() === text.charAt(0) ? text : text;
}

const ROMAN = { I: 1, V: 5, X: 10, L: 50, C: 100 };
function roman(s) {
  let n = 0;
  for (let i = 0; i < s.length; i += 1) {
    const v = ROMAN[s[i]];
    n += v < (ROMAN[s[i + 1]] ?? 0) ? -v : v;
  }
  return n;
}

export function speakable(text, home) {
  let t = text.replace(/[↗\u0301]/g, '').replace(/ /g, ' ');
  // 1. ссылки → метки
  const refs = scanRefs(t, home);
  const spoken = [];
  for (const r of [...refs].reverse()) {
    spoken.unshift(spokenRef(r));
    t = `${t.slice(0, r.start)}\u0001${refs.indexOf(r)}\u0002${t.slice(r.end)}`;
  }
  // 2. скобки, где только ссылки, убираются; в остальных ссылки выбрасываются
  t = t.replace(/\s?\(([^()]*)\)/g, (all, inner) => {
    if (!inner.includes('\u0001')) return all;
    const rest = inner.replace(/\u0001\d+\u0002/g, '').replace(/(^|[;,]\s*)(ср\.|см\.)\s*/g, '$1').replace(/^[\s;,.]+|[\s;,.]+$/g, '');
    return rest ? ` (${rest})` : '';
  });
  // 3. ссылки внутри фразы → словами
  t = t.replace(/\u0001(\d+)\u0002/g, (_, i) => spoken[Number(i)] ?? '');
  // 4. сокращения и римские цифры (до латиницы: римские цифры — тоже латинские буквы)
  t = t.replace(/Р\.\s?Х\./g, 'Рождества Христова').replace(/\bт\.\s?е\./g, 'то есть').replace(/и т\.\s?д\./g, 'и так далее')
    .replace(/\b([IVXLC]+)(?=(?:[-–][IVXLC0-9]+)?\s+век)/g, (r) => String(roman(r)))
    .replace(/[-–]([IVXLC]+)(?=\s+век)/g, (_, r) => `-${roman(r)}`);
  // 5. греческие, еврейские и латинские вставки пропускаются: голос читает ровный русский текст.
  // Запятая сразу после вставки уходит вместе с ней: «стоит אֵלַי, «на Меня»» → «стоит «на Меня»»
  t = t.replace(/§+\s*\d*[a-z–-]*/g, '').replace(/\[\d+\]/g, '')
    .replace(GREEK_RUN, '').replace(HEBREW_RUN, (_, w, comma) => (hebrewWord(w) ? hebrewWord(w) + (comma || '') : ''))
    .replace(LATIN_RUN, '');
  return tidy(t);
}

// (кроме запятой перед союзом: «сочетание אֵת אֲשֶׁר, и его» → «сочетание, и его»)
const COMMA = '(\\s*,(?=\\s)(?!\\s+(?:и|а|но|или|что|чтобы|как|когда|где|если|хотя|потому|котор[а-яё]+)\\s))?';
const GREEK_RUN = new RegExp(`${GREEK_WORD.source}${COMMA}`, 'gu');
const HEBREW_RUN = new RegExp(`(${HEBREW_WORD.source})${COMMA}`, 'gu');
// латинские слова подряд вместе с числами между ними; число перед русским словом остаётся: «JPS 1917 года» → «1917 года»
const LATIN_RUN = new RegExp(`[A-Za-z][A-Za-z0-9'’]*(?:[\\s.,:;?!&/–-]+(?:[A-Za-z][A-Za-z0-9'’]*|[0-9]+(?:[:.,–-][0-9]+)*(?![0-9])(?!\\s+[а-яё])))*${COMMA}`, 'g');
const LABEL = '(?:греч|евр|лат|англ|букв|ср|см)\\.|по-(?:гречески|еврейски|латыни|английски)|в оригинале';

// Убрать следы пропущенных вставок: пустые скобки и кавычки, повторные знаки, пробелы перед знаками
function tidy(text) {
  let t = text;
  for (let i = 0; i < 3; i += 1) {
    t = t.replace(new RegExp(`\\(\\s*(?:(?:${LABEL})[\\s,;:]*)*[\\s,;:.\\-–—]*\\)`, 'g'), '')
      .replace(/«\s*[,;:.…?!\-–—]*\s*»/g, '')
      .replace(/\s+([,.;:!?…»)])/g, '$1')
      .replace(/([«(])\s+/g, '$1')
      .replace(/([,;:])\s*(?=[,;:.!?])/g, '')
      .replace(/(^|[.!?]\s+)[,;:—–-]\s*/g, '$1')
      .replace(/\s+[—–-]\s*(?=[,.;:!?])/g, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/^\s*[.,;:!?—–-]+\s*/, '');
  }
  return t.trim();
}

export function sentences(text) {
  const out = [];
  // конец фразы — точка, ? ! или … (можно с закрывающей кавычкой); инициалы «У. Р.» фразу не кончают
  for (const s of text.split(/(?<=[.!?…]»?)(?<!(?:^|[\s(«])[А-ЯЁA-Z]\.)\s+(?=[«(А-ЯЁA-Z0-9])/u)) {
    if (s.length <= 260) { if (s.trim()) out.push(s.trim()); continue; }
    // длинную фразу делим по точке с запятой или двоеточию, чтобы голос не обрывался
    let rest = s;
    while (rest.length > 260) {
      const cut = Math.max(rest.lastIndexOf('; ', 240), rest.lastIndexOf(': ', 240), rest.lastIndexOf(', ', 240));
      if (cut < 80) break;
      out.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 2);
    }
    if (rest.trim()) out.push(rest.trim());
  }
  return out;
}
