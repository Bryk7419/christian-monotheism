// Всплывающие стихи: ссылка «Ин. 8:58» в тексте статьи становится кнопкой; по нажатию
// рядом появляется текст стиха по Синодальному переводу и ссылка на главу на bible.by.
// Тексты стихов статьи лежат в assets/verses/<адрес>.json (собирает tools/rebuild.py).
// Без JavaScript ссылки остаются обычным текстом.

import { books } from './bible.js';
import { scanRefs, versesOf, BIBLE_BY } from './refscan.js';

const prose = document.querySelector('.prose[data-verses]');
const ABBR = Object.fromEntries(books.map((b) => [b.id, b.abbr]));

function textNodes(el) {
  const out = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement.closest('a, button, .vref, .vpop') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let pos = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    out.push({ node: n, start: pos, end: pos + n.data.length });
    pos += n.data.length;
  }
  return out;
}

function keysOf(ref) {
  return versesOf(ref.segs).map(([c, v]) => `${ref.book} ${c}:${v}`);
}

function wrap(block, verses, home) {
  // Текст абзаца без ссылок и кнопок: позиции совпадают с textNodes
  const nodes = textNodes(block);
  const text = nodes.map((n) => n.node.data).join('');
  const refs = scanRefs(text, home).filter((r) => {
    const keys = keysOf(r);
    return keys.length && keys.every((k) => verses[k]);
  });
  for (const ref of refs.reverse()) {
    const n = nodes.find((x) => x.start <= ref.start && ref.end <= x.end);
    if (!n) continue;
    const range = document.createRange();
    range.setStart(n.node, ref.start - n.start);
    range.setEnd(n.node, ref.end - n.start);
    // span, а не button: кнопка дала бы перенос строки сразу после открывающей скобки
    const button = document.createElement('span');
    button.className = 'vref';
    button.setAttribute('role', 'button');
    button.tabIndex = 0;
    button.dataset.keys = keysOf(ref).join('|');
    button.dataset.label = ref.explicit ? text.slice(ref.start, ref.end) : `${ABBR[ref.book]} ${text.slice(ref.start, ref.end)}`;
    button.dataset.book = ref.book;
    button.dataset.chapter = String(ref.segs[0][0]);
    button.setAttribute('aria-haspopup', 'dialog');
    try { range.surroundContents(button); } catch { /* ссылка пересекает разметку: оставить текстом */ }
  }
}

let pop;
let opener;

function closePop(returnFocus = true) {
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  if (returnFocus && opener) opener.focus();
  opener?.setAttribute('aria-expanded', 'false');
  opener = null;
}

function ensurePop() {
  if (pop) return pop;
  pop = document.createElement('div');
  pop.className = 'vpop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-labelledby', 'vpop-title');
  pop.hidden = true;
  pop.innerHTML = '<div class="vpop-head"><p class="vpop-title" id="vpop-title"></p>'
    + '<button class="vpop-close" type="button" aria-label="Закрыть">'
    + '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></div>'
    + '<div class="vpop-text"></div><p class="vpop-foot"><span>Синодальный перевод</span> <a class="ext" target="_blank" rel="noopener"></a></p>';
  document.body.append(pop);
  pop.querySelector('.vpop-close').addEventListener('click', () => closePop());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });
  document.addEventListener('click', (e) => {
    if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('.vref')) closePop(false);
  });
  window.addEventListener('resize', () => closePop(false));
  return pop;
}

function place(button) {
  const narrow = window.matchMedia('(max-width: 40rem)').matches;
  pop.classList.toggle('vpop-sheet', narrow);
  if (narrow) { pop.style.left = ''; pop.style.top = ''; return; }
  const r = button.getBoundingClientRect();
  const width = Math.min(448, document.documentElement.clientWidth - 32);
  const left = Math.max(16, Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - width - 16));
  pop.style.width = `${width}px`;
  pop.style.left = `${left}px`;
  pop.style.top = `${r.bottom + window.scrollY + 8}px`;
}

function show(button, verses) {
  ensurePop();
  if (opener === button && !pop.hidden) { closePop(); return; }
  opener?.setAttribute('aria-expanded', 'false');
  opener = button;
  button.setAttribute('aria-expanded', 'true');
  const keys = button.dataset.keys.split('|');
  pop.querySelector('.vpop-title').textContent = button.dataset.label;
  const box = pop.querySelector('.vpop-text');
  box.replaceChildren();
  for (const k of keys) {
    const p = document.createElement('p');
    if (keys.length > 1) {
      const num = document.createElement('sup');
      num.textContent = k.split(':').pop();
      p.append(num, ' ');
    }
    p.append(verses[k]);
    box.append(p);
  }
  const link = pop.querySelector('.vpop-foot a');
  const n = BIBLE_BY[button.dataset.book];
  link.hidden = !n;
  if (n) {
    link.href = `https://bible.by/syn/${n}/${button.dataset.chapter}/`;
    link.innerHTML = 'Читать главу на bible.by<span class="ext-mark" aria-hidden="true">↗</span><span class="visually-hidden"> (внешний сайт, откроется в новой вкладке)</span>';
  }
  pop.hidden = false;
  place(button);
  pop.querySelector('.vpop-close').focus({ preventScroll: true });
}

async function init() {
  let verses;
  try {
    const res = await fetch(prose.dataset.verses);
    if (!res.ok) return;
    verses = await res.json();
  } catch { return; }
  const home = prose.dataset.home || null;
  for (const block of prose.querySelectorAll('p, li, blockquote, td')) {
    if (block.querySelector('p, li')) continue; // вложенные абзацы обработаются сами
    wrap(block, verses, home);
  }
  prose.addEventListener('click', (e) => {
    const button = e.target.closest('.vref');
    if (button) show(button, verses);
  });
  prose.addEventListener('keydown', (e) => {
    const button = e.target.closest('.vref');
    if (button && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); show(button, verses); }
  });
}

if (prose) {
  if ('requestIdleCallback' in window) requestIdleCallback(init, { timeout: 2000 });
  else setTimeout(init, 300);
}
