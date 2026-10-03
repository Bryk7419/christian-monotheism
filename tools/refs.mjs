// Вызывается из tools/sitegen.py. stdin: [{passages:[], aliases:[], body:""}] -> stdout: [{refs, mentions, passageRefs}]
import { findRefs, parsePassage, sortKey } from '../assets/js/bible.js';
const input = JSON.parse(await new Promise((res) => { let s = ''; process.stdin.on('data', (d) => { s += d; }); process.stdin.on('end', () => res(s)); }));
const out = input.map((d) => {
  const passageRefs = (d.passages || []).map((p) => { const r = parsePassage(p); return r ? [r.book, r.segs] : null; });
  const refs = [...passageRefs.filter(Boolean)];
  for (const a of d.aliases || []) for (const r of findRefs(a)) refs.push([r.book, r.segs]);
  // Статьи: только ссылки с «:» (strict); видео: любые; темы и страницы: без упоминаний.
  const mentions = d.type === 'topic' || d.type === 'page' ? []
    : findRefs(d.body || '', { strict: d.type === 'article' }).map((r) => [r.book, r.segs]);
  const sortKeys = (d.passages || []).map((p) => { const r = parsePassage(p); return r ? sortKey(r) : null; });
  return { refs, mentions, passageRefs, sortKeys };
});
process.stdout.write(JSON.stringify(out));
