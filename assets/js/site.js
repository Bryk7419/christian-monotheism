// Небольшие улучшения страниц. Без JavaScript сайт полностью читается.

const isPreview = Boolean(document.querySelector('meta[name="site-preview"]'));

// --- Меню на узком экране ---------------------------------------------------
const toggle = document.querySelector('.menu-toggle');
const nav = document.getElementById('site-nav');
if (toggle && nav) {
  const setOpen = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    nav.classList.toggle('is-open', open);
  };
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      toggle.focus();
    }
  });
}

// --- Сообщение внизу экрана ---------------------------------------------------
const toast = document.querySelector('.toast');
let toastTimer;
function showToast(text) {
  if (!toast) return;
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
}

// --- Скопировать постоянную ссылку на статью ----------------------------------
for (const button of document.querySelectorAll('[data-copy-link]')) {
  button.addEventListener('click', async () => {
    const canonical = document.querySelector('link[rel="canonical"]');
    const url = canonical ? canonical.href : `${location.origin}${location.pathname}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast('Ссылка скопирована');
    } catch {
      // Буфер обмена недоступен: показать адрес для ручного копирования
      let field = button.parentElement.querySelector('.copy-field');
      if (!field) {
        field = document.createElement('input');
        field.className = 'copy-field';
        field.readOnly = true;
        field.setAttribute('aria-label', 'Постоянная ссылка');
        button.after(field);
      }
      field.value = url;
      field.focus();
      field.select();
    }
  });
}

// --- Видео: проигрыватель загружается только по нажатию ----------------------
if (!isPreview) {
  for (const box of document.querySelectorAll('.video-player[data-youtube-id]')) {
    box.hidden = false;
    const button = box.querySelector('button');
    button.addEventListener('click', () => {
      const id = box.dataset.youtubeId;
      const frame = document.createElement('iframe');
      frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0`;
      frame.title = box.dataset.title || 'Видео';
      frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      frame.allowFullscreen = true;
      frame.loading = 'lazy';
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      box.classList.add('is-playing');
      box.replaceChildren(frame);
      frame.focus();
    });
  }
}

// --- Поделиться: системное меню устройства, если браузер его поддерживает -------------------
if (navigator.share) {
  for (const b of document.querySelectorAll('[data-share]')) {
    b.hidden = false;
    b.addEventListener('click', async () => {
      const canonical = document.querySelector('link[rel="canonical"]');
      const title = document.querySelector('h1')?.textContent.trim() || document.title;
      try { await navigator.share({ title, url: canonical ? canonical.href : location.href }); } catch { /* отменено */ }
    });
  }
}

// --- Статья: полоска прочитанного, кнопка «Наверх», чтение вслух, всплывающие стихи ----------
const articleEl = document.querySelector('.article');
if (articleEl) {
  const bar = document.createElement('div');
  bar.className = 'read-progress';
  bar.setAttribute('aria-hidden', 'true');
  const up = document.createElement('a');
  up.className = 'to-top';
  up.href = '#main';
  up.hidden = true;
  up.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="visually-hidden">Наверх</span>';
  document.body.append(bar, up);
  let ticking = false;
  const update = () => {
    ticking = false;
    const r = articleEl.getBoundingClientRect();
    const total = r.height - window.innerHeight;
    const done = total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 0;
    bar.style.transform = `scaleX(${done})`;
    up.hidden = window.scrollY < window.innerHeight * 1.5;
  };
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  update();
  if (!isPreview) {
    import('./listen.js').catch(() => {});
    import('./verses.js').catch(() => {});
  }
}

// --- Приложение: работа без интернета для уже открытых страниц -------------------------------
const manifestLink = document.querySelector('link[rel="manifest"]');
if (!isPreview && manifestLink && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register(new URL('sw.js', manifestLink.href)).catch(() => {});
}
