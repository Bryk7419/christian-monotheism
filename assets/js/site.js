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
