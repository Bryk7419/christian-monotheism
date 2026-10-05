// Картинки для превью ссылок (Telegram, WhatsApp, соцсети): assets/img/cards/article-<адрес>.jpg и topic-<id>.jpg.
// Нужен Playwright с Chromium (в окружениях Claude он уже установлен):
//   node tools/make_cards.mjs            # только недостающие карточки
//   node tools/make_cards.mjs --all      # пересоздать все (после смены заголовков)
// После создания карточек запустите python3 tools/rebuild.py: адреса картинок попадут в <head> страниц.
// Если карточки нет, в превью показывается общая картинка assets/img/og-image.jpg.
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets/img/cards');
const all = process.argv.includes('--all');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch {
  ({ chromium } = createRequire('/opt/node22/lib/node_modules/')('playwright'));
}

const plain = (h) => h.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const jobs = [];
for (const slug of readdirSync(path.join(ROOT, 'answers'))) {
  const f = path.join(ROOT, 'answers', slug, 'index.html');
  if (!existsSync(f)) continue;
  const s = readFileSync(f, 'utf8');
  if (s.includes('http-equiv="refresh"')) continue;
  const title = plain(/<h1 class="article-title">([\s\S]*?)<\/h1>/.exec(s)[1]);
  const kind = (/<p class="article-meta">\s*<span>([^<\d][^<]*)<\/span>/.exec(s) || [])[1] || '';
  const passage = plain((/<a class="ref" href="[^"]*">([^<]*)<\/a>/.exec((/<p class="article-passages">([\s\S]*?)<\/p>/.exec(s) || [])[1] || '') || [])[1] || '');
  jobs.push({ file: `article-${slug}.jpg`, eyebrow: kind, title, foot: passage });
}
for (const id of readdirSync(path.join(ROOT, 'topics'))) {
  const f = path.join(ROOT, 'topics', id, 'index.html');
  if (!existsSync(f)) continue;
  const s = readFileSync(f, 'utf8');
  const t = /<h1 class="topic-title">([\s\S]*?)<\/h1>/.exec(s);
  if (!t) continue;
  jobs.push({ file: `topic-${id}.jpg`, eyebrow: 'Тема', title: plain(t[1]), foot: '' });
}

// Шрифты и картинки встраиваются в страницу: страница без адреса не может читать локальные файлы.
const MIME = { woff2: 'font/woff2', png: 'image/png', jpg: 'image/jpeg' };
const asset = (p) => `data:${MIME[p.split('.').pop()]};base64,${readFileSync(path.join(ROOT, p)).toString('base64')}`;
const page = (j) => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
@font-face { font-family: "OST"; font-weight: 700; src: url("${asset('assets/fonts/old-standard-tt-cyrillic-700-normal.woff2')}"); }
@font-face { font-family: "OST"; font-weight: 700; src: url("${asset('assets/fonts/old-standard-tt-latin-700-normal.woff2')}"); unicode-range: U+0000-00FF, U+2000-206F; }
@font-face { font-family: "Lit"; font-weight: 600; src: url("${asset('assets/fonts/literata-cyrillic-600-normal.woff2')}"); }
* { box-sizing: border-box; margin: 0; }
body { width: 1200px; height: 630px; background: #f4f5f2; color: #1c2127; font-family: "Lit", Georgia, serif; position: relative; overflow: hidden; }
.rule { position: absolute; left: 0; top: 0; bottom: 0; width: 18px; background: #9c2f1f; }
.brand { position: absolute; left: 80px; top: 56px; display: flex; align-items: center; gap: 20px; font: 600 30px "Lit"; }
.brand img { width: 72px; height: 72px; border-radius: 50%; }
.brand small { display: block; font-size: 22px; color: #59616b; font-weight: 600; }
.eyebrow { position: absolute; left: 80px; top: 190px; font: 700 22px system-ui, sans-serif; letter-spacing: 0.12em; text-transform: uppercase; color: #9c2f1f; }
.title { position: absolute; left: 80px; right: 320px; top: 232px; bottom: 120px; display: flex; align-items: flex-start; }
.title h1 { font: 700 64px/1.12 "OST", Georgia, serif; text-wrap: balance; }
.foot { position: absolute; left: 80px; bottom: 56px; font: 700 30px system-ui, sans-serif; color: #9c2f1f; }
.photo { position: absolute; right: 70px; bottom: 60px; width: 210px; height: 210px; border-radius: 50%; object-fit: cover; border: 6px solid #fff; box-shadow: 0 6px 24px rgba(0,0,0,.18); }
.verse { position: absolute; right: 50px; top: 64px; width: 250px; text-align: center; font: 600 19px/1.35 "Lit"; color: #59616b; text-wrap: balance; }
</style></head><body>
<div class="rule"></div>
<div class="brand"><img src="${asset('assets/img/icon-512.png')}" alt=""><div>Сергей Брык<small>Христианский монотеизм</small></div></div>
<p class="eyebrow">${esc(j.eyebrow)}</p>
<div class="title"><h1 id="t">${esc(j.title)}</h1></div>
${j.foot ? `<p class="foot">${esc(j.foot)}</p>` : ''}
<p class="verse">«Ибо един Бог, един и посредник между Богом и человеками, человек Христос Иисус»<br>1 Тим. 2:5</p>
<img class="photo" src="${asset('assets/img/sergey-bryk.jpg')}" alt="">
</body></html>`;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1200, height: 630 } });
let made = 0;
for (const j of jobs) {
  const out = path.join(OUT, j.file);
  if (!all && existsSync(out)) continue;
  await tab.setContent(page(j), { waitUntil: 'load' });
  await tab.evaluate(async () => {
    await document.fonts.ready;
    const h = document.getElementById('t');
    const box = h.parentElement;
    let size = 64;
    while ((h.scrollHeight > box.clientHeight || h.scrollWidth > box.clientWidth) && size > 34) {
      size -= 2;
      h.style.fontSize = `${size}px`;
    }
  });
  await tab.screenshot({ path: out, type: 'jpeg', quality: 84 });
  made += 1;
}
await browser.close();
console.log(`Карточек создано: ${made} из ${jobs.length}`);
