// Совместимость со ссылками на прежние разделы главной.
// Без JavaScript соответствующий :target показывает обычную ссылку.
function openMovedSection() {
  if (!location.hash) return;
  let id;
  try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
  const target = document.getElementById(id);
  const link = target?.closest('.home-legacy-links') && target.querySelector('a');
  if (link) location.replace(link.href);
}
openMovedSection();
window.addEventListener('hashchange', openMovedSection);
