// Поиск по странице: одна и та же строка на страницах «По местам Писания», «Вопросы и ответы», «Видео»
// и «Комменты на YouTube». Ищет только то, что есть на этой странице; без JavaScript форма ведёт
// в общий поиск по сайту.
//
// <form data-page-filter data-items="…" [data-groups="…"] [data-parts="…"] [data-idle-hidden="…"] [data-busy-hide="…"]>
//   data-items        — что показывать или прятать (вопрос, видео, место Писания, комментарий);
//   data-groups       — разделы, которые прячутся, если в них ничего не нашлось;
//   data-parts        — части записи (отметки времени в видео): если совпала только часть, видна только она;
//   data-idle-hidden  — части, скрытые без поиска (остальные комментарии папки) и видные при совпадении;
//   data-busy-hide    — что убрать на время поиска (переход по книгам, по темам).
import { tokenize, stem } from './search-core.js';
import { books, findRefs, stripRefs, segsOverlap } from './bible.js';

// Глагол и существительное должны приводить к одним вопросам. Проверяем
// «крестили» до стемминга: иначе оно получит ту же основу, что и «крест».
function filterStem(word) {
  const base = stem(word);
  if (base === 'мол' && word.startsWith('мол') && word.length > 3) return 'молитв';
  if ((base === 'крест' && /^крест[ия]/.test(word)) || /^крещу(?:сь)?$/.test(word)) return 'крещен';
  return base;
}

const form = document.querySelector('[data-page-filter]');
if (form) {
  const input = form.elements.q;
  const scope = form.closest('main') || document;
  const status = scope.querySelector('[data-page-filter-status]');
  const empty = scope.querySelector('[data-page-filter-empty]');
  const emptyLink = empty?.querySelector('a');
  const reset = form.querySelector('[data-page-filter-reset]');
  const all = (sel) => (sel ? [...scope.querySelectorAll(sel)] : []);
  const groups = all(form.dataset.groups);
  const busyHide = all(form.dataset.busyHide);
  const bookAlias = new Map(books.flatMap((b) => [b.name, ...b.aliases].map((a) => [a.toLowerCase().replace(/ё/g, 'е'), b.id])));

  const describe = (el) => {
    const text = el.textContent;
    return { stems: tokenize(text).map(filterStem), refs: findRefs(text) };
  };
  const items = all(form.dataset.items).map((el) => {
    const parts = form.dataset.parts ? [...el.querySelectorAll(form.dataset.parts)] : [];
    // текст записи без её частей: у видео это название и описание, а не отметки времени
    const own = el.cloneNode(true);
    if (form.dataset.parts) own.querySelectorAll(form.dataset.parts).forEach((p) => p.remove());
    const idle = form.dataset.idleHidden ? new Set(el.querySelectorAll(form.dataset.idleHidden)) : new Set();
    return { el, ...describe(own), parts: parts.map((p) => ({ el: p, idle: idle.has(p), ...describe(p) })) };
  });

  function parse(query) {
    const refs = findRefs(query, { query: true });
    const rest = stripRefs(query, refs);
    const whole = query.trim().toLowerCase().replace(/ё/g, 'е').replace(/\./g, '');
    const book = !refs.length && bookAlias.get(whole);
    return { refs, book, terms: book ? [] : tokenize(rest).map(filterStem) };
  }
  // слово совпадает, если оно начало словоформы: «воскрес» найдёт «воскресение» и «воскресил»
  const hasTerms = (d, terms) => terms.every((t) => d.stems.some((s) => s.startsWith(t)));
  const hasRefs = (d, q) => (q.book ? d.refs.some((r) => r.book === q.book)
    : q.refs.every((qr) => d.refs.some((r) => r.book === qr.book && segsOverlap(r.segs, qr.segs))));
  const matches = (d, q) => hasTerms(d, q.terms) && hasRefs(d, q);
  const active = (q) => q.terms.length || q.refs.length || q.book;

  function apply(save) {
    const raw = input.value;
    const q = parse(raw);
    const on = active(q);
    let count = 0;
    for (const it of items) {
      const own = !on || matches(it, q);
      const hit = on ? it.parts.filter((p) => matches(p, q)) : [];
      const show = own || hit.length > 0;
      it.el.hidden = !show;
      // часть видна: без поиска — если не скрыта заранее; при поиске — если совпала,
      // а если совпала вся запись — ещё и все её обычные части
      for (const p of it.parts) p.el.hidden = !(hit.includes(p) || (own && !p.idle));
      if (show) count++;
    }
    for (const g of groups) g.hidden = on && !g.querySelector(`${form.dataset.items}:not([hidden])`);
    for (const x of busyHide) x.hidden = Boolean(on);
    if (reset) reset.hidden = !raw.trim();
    if (status) status.textContent = on ? (count ? `Найдено: ${count}.` : '') : '';
    if (empty) {
      empty.hidden = !on || count > 0;
      if (emptyLink) emptyLink.href = `${emptyLink.dataset.base}?q=${encodeURIComponent(raw.trim())}`;
    }
    if (save) {
      const url = location.pathname + (raw.trim() ? `?q=${encodeURIComponent(raw.trim())}` : '') + location.hash;
      history.replaceState(null, '', url);
    }
  }

  let timer;
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => apply(true), 120); });
  form.addEventListener('submit', (e) => { e.preventDefault(); clearTimeout(timer); apply(true); });
  reset?.addEventListener('click', () => { input.value = ''; apply(true); input.focus(); });
  input.value = new URLSearchParams(location.search).get('q') || '';
  apply(false);
}
