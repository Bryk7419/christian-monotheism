// Вызывается из tools/rebuild.py. Тексты стихов для всплывающих подсказок в статьях.
// stdin: [{slug, passage, blocks: [текст абзаца, …]}] -> stdout: {slug: {home, verses: {"jhn 8:58": "текст"}}}
// «Домашняя» книга статьи — книга первого из «Разбираемых мест»; ссылки без книги относятся к ней.
import { readFileSync } from 'node:fs';
import { parsePassage } from '../assets/js/bible.js';
import { scanRefs, versesOf } from '../assets/js/refscan.js';

const bible = JSON.parse(readFileSync(new URL('./data/synodal.json', import.meta.url), 'utf8')).books;
const input = JSON.parse(await new Promise((res) => {
  let s = '';
  process.stdin.setEncoding('utf8'); // иначе русская буква на границе кусков портится
  process.stdin.on('data', (d) => { s += d; });
  process.stdin.on('end', () => res(s));
}));

const out = {};
for (const doc of input) {
  const home = doc.passage ? parsePassage(doc.passage)?.book ?? null : null;
  const verses = {};
  for (const text of doc.blocks) {
    for (const ref of scanRefs(text, home)) {
      const book = bible[ref.book];
      if (!book) continue;
      for (const [c, v] of versesOf(ref.segs, book.map((ch) => ch.length))) {
        const t = book[c - 1]?.[v - 1];
        if (t) verses[`${ref.book} ${c}:${v}`] = t;
      }
    }
  }
  const sorted = Object.fromEntries(Object.entries(verses).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })));
  out[doc.slug] = { home, verses: sorted };
}
process.stdout.write(JSON.stringify(out));
