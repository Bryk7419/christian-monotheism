// Каталог остаётся полным списком без JavaScript. Форма ведёт в обычный поиск.
import { prepareIndex, search, normalize } from './search-core.js';

const form = document.querySelector('[data-catalog-form]');
if (form) {
  const input = form.elements.q;
  const topic = form.elements.topic;
  const sort = document.getElementById('catalog-sort');
  const list = document.querySelector('[data-catalog-list]');
  const status = document.querySelector('[data-catalog-status]');
  const empty = document.querySelector('[data-catalog-empty]');
  const catalog = document.querySelector('.catalog-articles');
  const rows = [...list.children].map((el, order) => ({
    el, order, slug: el.dataset.slug, topics: el.dataset.topics.split(' '),
    date: el.dataset.date, text: normalize(el.querySelector('.card-link').textContent + ' ' + el.querySelector('.card-summary').textContent),
  }));
  const validTopics = new Set([...topic.options].map(o => o.value));
  let indexPromise, request = 0, timer;
  const loadIndex = () => indexPromise ??= fetch(new URL('../search-index.json', import.meta.url))
    .then(r => { if (!r.ok) throw new Error('Search index unavailable'); return r.json(); })
    .then(prepareIndex).catch(e => { indexPromise = null; throw e; });

  function restore() {
    const params = new URLSearchParams(location.search);
    input.value = params.get('q') || '';
    const selected = params.get('topic') || location.hash.slice(1);
    topic.value = validTopics.has(selected) ? selected : '';
    sort.value = params.get('sort') === 'updated' ? 'updated' : 'default';
  }
  function save(mode) {
    const params = new URLSearchParams();
    if (input.value.trim()) params.set('q', input.value.trim());
    if (topic.value) params.set('topic', topic.value);
    if (sort.value === 'updated') params.set('sort', 'updated');
    const url = location.pathname + (params.size ? `?${params}` : '');
    if (url !== location.pathname + location.search + location.hash) history[mode + 'State'](null, '', url);
  }
  async function render(mode) {
    const id = ++request;
    if (mode) save(mode);
    const q = input.value.trim(), selected = topic.value, order = sort.value;
    let matches = null, fallback = false;
    if (q) {
      status.textContent = 'Ищем статьи…';
      list.setAttribute('aria-busy', 'true');
      try {
        const index = await loadIndex();
        if (id !== request) return;
        matches = new Map(search(index, q, { topic: selected || null, limit: Infinity })
          .filter(r => r.doc.type === 'article').map((r, rank) => [r.doc.url.split('/')[2], rank]));
      } catch {
        if (id !== request) return;
        fallback = true;
        const terms = normalize(q).split(/\s+/).filter(Boolean);
        matches = new Map(rows.filter(r => terms.every(t => r.text.includes(t))).map(r => [r.slug, r.order]));
      }
    }
    if (id !== request) return;
    const sorted = [...rows].sort((a, b) => order === 'updated'
      ? b.date.localeCompare(a.date) || a.order - b.order
      : matches ? (matches.get(a.slug) ?? Infinity) - (matches.get(b.slug) ?? Infinity) || a.order - b.order : a.order - b.order);
    let count = 0;
    for (const r of sorted) {
      r.el.hidden = Boolean((selected && !r.topics.includes(selected)) || (matches && !matches.has(r.slug)));
      if (!r.el.hidden) count++;
    }
    list.replaceChildren(...sorted.map(r => r.el));
    list.removeAttribute('aria-busy');
    catalog.classList.toggle('is-date-order', order === 'updated');
    empty.hidden = count > 0;
    status.textContent = count ? `Показано статей: ${count} из ${rows.length}.` : 'Статьи не найдены.';
    if (fallback) status.textContent += ' Поиск по полному тексту временно недоступен; показаны совпадения в названиях и описаниях.';
  }
  input.addEventListener('input', () => { clearTimeout(timer); request++; timer = setTimeout(() => render('replace'), 160); });
  form.addEventListener('submit', e => { e.preventDefault(); clearTimeout(timer); render('push'); });
  topic.addEventListener('change', () => { clearTimeout(timer); render('push'); });
  sort.addEventListener('change', () => { clearTimeout(timer); render('push'); });
  form.addEventListener('reset', e => {
    e.preventDefault();
    clearTimeout(timer);
    input.value = '';
    topic.value = '';
    sort.value = 'default';
    render('push');
    input.focus();
  });
  window.addEventListener('popstate', () => { clearTimeout(timer); restore(); render(); });
  window.addEventListener('hashchange', () => { clearTimeout(timer); restore(); render(); });
  form.querySelectorAll('[data-catalog-enhanced]').forEach(el => { el.hidden = false; });
  restore();
  render();
}
