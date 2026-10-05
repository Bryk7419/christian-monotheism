// «Слушать»: чтение статьи вслух голосом устройства (Web Speech API).
// Читается заголовок и текст статьи по абзацам; текущий абзац подсвечивается.
// Ссылки на Писание в скобках пропускаются, ссылки внутри фразы читаются словами;
// греческие слова читаются в традиционном (эразмовом) произношении: θεός → «тэос».
// Место, где читатель остановился, запоминается в этом браузере.

import { books } from './bible.js';
import { scanRefs } from './refscan.js';

const synth = window.speechSynthesis;
const button = document.querySelector('[data-listen]');
const article = document.querySelector('.article');
const prose = document.querySelector('.prose');
const BOOK = Object.fromEntries(books.map((b) => [b.id, b]));
const RATES = [1, 1.2, 1.4, 0.85];
const STORE = `listen:${location.pathname}`;
const VOICE_STORE = 'listen:voice';

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

const GREEK_RUN = /[Ͱ-Ͽἀ-῿][Ͱ-Ͽἀ-῿̀-ͯʼ’]*/gu;

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
  let t = text.replace(/[↗]/g, '').replace(/ /g, ' ');
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
  // 4. греческий
  t = t.replace(GREEK_RUN, (w) => greekToCyrillic(w));
  // 5. сокращения и римские цифры
  t = t.replace(/Р\.\s?Х\./g, 'Рождества Христова').replace(/\bт\.\s?е\./g, 'то есть').replace(/и т\.\s?д\./g, 'и так далее')
    .replace(/\b([IVXLC]+)(?=(?:-[IVXLC]+)?\s+век)/g, (r) => String(roman(r)))
    .replace(/-([IVXLC]+)(?=\s+век)/g, (_, r) => `-${roman(r)}`);
  return t.replace(/\s+([,.;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

function sentences(text) {
  const out = [];
  for (const s of text.split(/(?<=[.!?…»])\s+(?=[«(А-ЯЁA-Z0-9])/u)) {
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

// --- Чтение -------------------------------------------------------------------------------------------------
let blocks = [];
let queue = [];
let pos = 0;
let playing = false;
let generation = 0;
let rate = 1;
let voice = null;
let bar;
let wakeLock = null;
let userScrolledAt = 0;

function collect() {
  const home = prose?.dataset.home || null;
  const els = [article.querySelector('.article-title'), ...prose.querySelectorAll('p, h2, h3, li')];
  blocks = els.filter((el) => el && !(el.matches('li') && el.querySelector('p')));
  queue = [];
  blocks.forEach((el, bi) => {
    const text = speakable(el.textContent, home);
    for (const s of sentences(text)) queue.push({ el, bi, text: s });
  });
}

// Русские голоса устройства, лучшие первыми
function ruVoices() {
  const score = (v) => (/natural|neural|online|enhanced|premium|улучш/i.test(v.name) ? 4 : 0)
    + (/milena|yuri|katya|svetlana|dmitry|google/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1);
  return synth.getVoices().filter((v) => /^ru/i.test(v.lang)).sort((a, b) => score(b) - score(a));
}

// Голос, выбранный читателем кнопкой «Сменить голос», иначе лучший из найденных
function pickVoice() {
  const list = ruVoices();
  let saved = '';
  try { saved = localStorage.getItem(VOICE_STORE) || ''; } catch { /* */ }
  return list.find((v) => v.name === saved) || list[0] || null;
}

function nextVoice() {
  const list = ruVoices();
  if (list.length < 2) return;
  const i = list.findIndex((v) => v.name === voice?.name);
  voice = list[(i + 1) % list.length];
  try { localStorage.setItem(VOICE_STORE, voice.name); } catch { /* */ }
  notify(`Голос: ${voice.name}`);
  if (playing) speak();
}

function voiceButton() {
  const b = bar?.querySelector('[data-act="voice"]');
  if (b) b.hidden = ruVoices().length < 2;
}

function highlight(el) {
  for (const x of article.querySelectorAll('.is-speaking')) x.classList.remove('is-speaking');
  if (!el) return;
  el.classList.add('is-speaking');
  const r = el.getBoundingClientRect();
  const visible = r.top >= 0 && r.bottom <= window.innerHeight - 80;
  if (!visible && Date.now() - userScrolledAt > 4000) {
    el.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
}

function status() {
  if (!bar) return;
  const cur = queue[pos];
  bar.querySelector('.listen-status').textContent = cur ? `Абзац ${cur.bi + 1} из ${blocks.length}` : 'Готово';
  const t = bar.querySelector('[data-act="toggle"]');
  t.setAttribute('aria-label', playing ? 'Пауза' : 'Продолжить');
  t.innerHTML = playing ? ICON.pause : ICON.play;
  bar.querySelector('[data-act="rate"]').textContent = `${String(rate).replace('.', ',')}×`;
}

async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request('screen');
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; }
}

function speak() {
  const gen = ++generation;
  synth.cancel();
  const item = queue[pos];
  if (!item) { stop(true); return; }
  highlight(item.el);
  try { localStorage.setItem(STORE, String(item.bi)); } catch { /* хранилище недоступно */ }
  const u = new SpeechSynthesisUtterance(item.text);
  u.lang = 'ru-RU';
  if (voice) u.voice = voice;
  u.rate = rate;
  u.onend = () => { if (gen === generation && playing) { pos += 1; speak(); } };
  u.onerror = (e) => {
    if (gen !== generation || !playing || e.error === 'interrupted' || e.error === 'canceled') return;
    if (FATAL.has(e.error)) { pause(); notify('Не удалось включить чтение вслух на этом устройстве. Попробуйте другой браузер.'); return; }
    pos += 1;
    speak();
  };
  status();
  synth.speak(u);
}

const FATAL = new Set(['synthesis-failed', 'synthesis-unavailable', 'audio-hardware', 'audio-busy', 'network', 'not-allowed', 'language-unavailable', 'voice-unavailable']);

function notify(text) {
  const toast = document.querySelector('.toast');
  if (!toast) return;
  toast.textContent = text;
  toast.hidden = false;
  setTimeout(() => { toast.hidden = true; }, 4500);
}

function play() {
  playing = true;
  keepAwake(true);
  speak();
}

function pause() {
  playing = false;
  generation += 1;
  synth.cancel();
  keepAwake(false);
  status();
}

function stop(finished = false) {
  pause();
  highlight(null);
  if (finished) { try { localStorage.removeItem(STORE); } catch { /* */ } }
  bar?.remove();
  bar = null;
  button.setAttribute('aria-pressed', 'false');
}

function jumpBlock(delta) {
  const cur = queue[pos]?.bi ?? 0;
  const target = Math.max(0, Math.min(blocks.length - 1, cur + delta));
  pos = queue.findIndex((q) => q.bi === target);
  if (pos < 0) pos = 0;
  if (playing) speak(); else { highlight(queue[pos]?.el); status(); }
}

const ICON = {
  play: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>',
  prev: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M6 5h2v14H6zM20 5.5v13L9.5 12z" fill="currentColor"/></svg>',
  next: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M16 5h2v14h-2zM4 5.5v13L14.5 12z" fill="currentColor"/></svg>',
  voice: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

function makeBar() {
  bar = document.createElement('div');
  bar.className = 'listen-bar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Чтение вслух');
  bar.innerHTML = `<button type="button" data-act="prev" aria-label="Предыдущий абзац">${ICON.prev}</button>`
    + `<button type="button" data-act="toggle" class="listen-main" aria-label="Пауза">${ICON.pause}</button>`
    + `<button type="button" data-act="next" aria-label="Следующий абзац">${ICON.next}</button>`
    + '<button type="button" data-act="rate" class="listen-rate" aria-label="Скорость чтения">1×</button>'
    + `<button type="button" data-act="voice" aria-label="Сменить голос" title="Сменить голос" hidden>${ICON.voice}</button>`
    + '<span class="listen-status" aria-live="polite"></span>'
    + '<button type="button" data-act="restart" class="listen-restart">С начала</button>'
    + `<button type="button" data-act="stop" aria-label="Остановить чтение">${ICON.close}</button>`;
  bar.addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    if (act === 'toggle') { if (playing) pause(); else play(); }
    if (act === 'prev') jumpBlock(-1);
    if (act === 'next') jumpBlock(1);
    if (act === 'restart') { pos = 0; if (playing) speak(); else play(); }
    if (act === 'rate') {
      rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
      if (playing) speak(); else status();
    }
    if (act === 'voice') nextVoice();
    if (act === 'stop') stop();
  });
  document.body.append(bar);
  voiceButton();
}

function start() {
  if (bar) { if (playing) pause(); else play(); return; }
  collect();
  voice = pickVoice();
  let saved = 0;
  try { saved = Number(localStorage.getItem(STORE)) || 0; } catch { /* */ }
  pos = 0;
  if (saved > 1 && saved < blocks.length) {
    pos = Math.max(0, queue.findIndex((q) => q.bi === saved));
  }
  makeBar();
  bar.querySelector('.listen-restart').hidden = pos === 0;
  button.setAttribute('aria-pressed', 'true');
  if (!voice && synth.getVoices().length) notify('На этом устройстве не найден русский голос: чтение может звучать с акцентом.');
  play();
}

if (synth && button && article && prose && 'SpeechSynthesisUtterance' in window) {
  button.hidden = false;
  try { if (Number(localStorage.getItem(STORE)) > 1) button.querySelector('span').textContent = 'Продолжить слушать'; } catch { /* */ }
  button.addEventListener('click', start);
  synth.addEventListener?.('voiceschanged', () => { voice = pickVoice() || voice; voiceButton(); });
  for (const ev of ['wheel', 'touchmove', 'keydown']) window.addEventListener(ev, () => { userScrolledAt = Date.now(); }, { passive: true });
  window.addEventListener('pagehide', () => synth.cancel());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && playing && wakeLock === null) keepAwake(true); });
}
