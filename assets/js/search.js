// Страница поиска: загружает индекс опубликованных материалов и ищет
// по заголовкам, кратким описаниям, полным текстам, местам Писания и синонимам.

import { prepareIndex, search, snippet, parseQuery } from './search-core.js';
import { getBook } from './bible.js';

const form = document.querySelector('[data-search-form]');
const input = document.getElementById('search-q');
const statusEl = document.querySelector('[data-search-status]');
const list = document.querySelector('[data-search-results]');
const hint = document.querySelector('[data-search-hint]');
const topicSelect = document.getElementById('search-topic');

// Корень сайта вычисляется от адреса этого файла (assets/js/search.js),
// поэтому поиск работает и в подпапке GitHub Pages.
const siteRoot = new URL('../../', import.meta.url);
const linkSuffix = document.querySelector('meta[name="link-suffix"]')?.content || '';
const TYPE_LABELS = { article: 'Статья', topic: 'Тема', page: 'Страница', video: 'Видео' };

function hrefFor(route) {
  const [path, hash] = route.split('#');
  const url = new URL(path.replace(/^\//, '') + (path.endsWith('/') ? linkSuffix : ''), siteRoot);
  return url.href + (hash ? `#${hash}` : '');
}

let indexPromise;
function loadIndex() {
  indexPromise ??= fetch(new URL('../search-index.json', import.meta.url))
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(prepareIndex);
  return indexPromise;
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children) if (c != null) node.append(c);
  return node;
}

function plural(n, one, few, many) {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}

function describeRefs(refs) {
  return refs.map((r) => {
    const b = getBook(r.book);
    const [from, to] = r.segs[0];
    const c = Math.floor(from / 1000);
    const v = from % 1000;
    const c2 = Math.floor(to / 1000);
    const v2 = to % 1000;
    let text = `${b?.abbr ?? r.book} ${c}`;
    if (v) text += `:${v}${to !== from ? `–${c2 !== c ? `${c2}:` : ''}${v2}` : ''}`;
    else if (c2 !== c) text += `–${c2}`;
    return text;
  }).join(', ');
}

function render(index, query, topic) {
  list.replaceChildren();
  const q = query.trim();
  if (hint) hint.hidden = Boolean(q);
  if (!q) {
    statusEl.textContent = '';
    return;
  }
  const parsed = parseQuery(q);
  const results = search(index, q, { topic });
  const topicTitle = topic ? index.topics.find((t) => t.id === topic)?.title : null;
  const refNote = parsed.refs.length ? ` Место Писания: ${describeRefs(parsed.refs)}.` : '';
  if (!results.length) {
    statusEl.textContent = `Ничего не найдено${topicTitle ? ` в теме «${topicTitle}»` : ''}.${refNote} Попробуйте другое слово или уберите фильтр по теме.`;
    return;
  }
  statusEl.textContent = `${results.length} ${plural(results.length, 'результат', 'результата', 'результатов')}${topicTitle ? ` в теме «${topicTitle}»` : ''}.${refNote}`;

  for (const r of results) {
    const d = r.doc;
    const title = el('a', { href: hrefFor(d.url), className: 'result-title', textContent: d.title });
    const meta = el('p', { className: 'result-meta' }, el('span', { className: 'result-type', textContent: TYPE_LABELS[d.type] || '' }));
    if (r.refHit && d.passages?.length) {
      meta.append(el('span', { className: 'ref', textContent: d.passages.join(' · ') }));
    } else if (r.refHit === 'mention') {
      meta.append(el('span', { textContent: 'место упоминается в тексте' }));
    }
    const snip = el('p', { className: 'result-snippet' });
    const parts = r.matchedStems.length ? snippet(d, r.matchedStems) : [{ text: d.summary || '', mark: false }];
    for (const p of parts) snip.append(p.mark ? el('mark', { textContent: p.text }) : p.text);
    list.append(el('li', { className: 'result' }, meta, el('h2', { className: 'result-heading' }, title), snip));
  }
}

async function run() {
  const data = new FormData(form);
  const query = String(data.get('q') || '');
  const topic = String(data.get('topic') || '') || null;
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (topic) params.set('topic', topic);
  const next = `${location.pathname}${params.toString() ? `?${params}` : ''}`;
  try { history.replaceState(null, '', next); } catch { /* в предпросмотре адрес может быть закрыт */ }
  try {
    const index = await loadIndex();
    render(index, query, topic);
  } catch (err) {
    statusEl.textContent = 'Не удалось загрузить поисковый индекс. Обновите страницу.';
    console.error(err);
  }
}

if (form && input) {
  const params = new URLSearchParams(location.search);
  input.value = params.get('q') || '';
  const topic = params.get('topic');
  if (topic && topicSelect && [...topicSelect.options].some((o) => o.value === topic)) topicSelect.value = topic;
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(run, 160);
  });
  form.addEventListener('change', (e) => { if (e.target.name === 'topic') run(); });
  form.addEventListener('submit', (e) => { e.preventDefault(); run(); });
  loadIndex().catch(() => {});
  if (input.value) run();
  input.focus();
}
