"""Читатель находит основной ответ, уточнение и сохранённый вариант."""
import subprocess
import unittest

import sitegen as S


class ReadingGuideSearchTests(unittest.TestCase):
    def test_reader_queries(self):
        result = subprocess.run(['node', '--input-type=module', '-'], cwd=S.ROOT,
                                input=r'''
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {prepareIndex, search} from './assets/js/search-core.js';
const index = prepareIndex(JSON.parse(fs.readFileSync('assets/search-index.json', 'utf8')));
const guides = JSON.parse(fs.readFileSync('tools/reading-guides.json', 'utf8'));
for (const g of guides) {
  for (const query of [g.ref, g.ref.replace('.', ''), g.ref.replace('Ин.', 'Иоанна')]) {
    const hits = search(index, query);
    assert.equal(hits[0].doc.url, `/scripture/${g.id}/`, query);
    assert(hits.some(h => h.doc.url === `/answers/${g.primary}/`), `main answer: ${query}`);
  }
  const doc = index.docs.find(d => d.url === `/scripture/${g.id}/`);
  assert.deepEqual(doc.mentions, [], 'related verses must not masquerade as guide subjects');
}
for (const [query, slug] of [
  ['Ин 3:13 Даниил', 'in-3-13-prorochestvo-daniila'],
  ['Ин 6:62 воскресение', 'ioanna-6-62-unitarnye-tolkovaniya'],
  ['Мф 28:19 рукописи', 'vo-imya-ottsa-syna-duha'],
  ['Иоанна 2:11', 'svadba-v-kane'],
  ['Рим. 1:4', 'syn-bozhiy-v-sile'],
  ['Втор. 18:15', 'prorok-kak-moisey'],
  ['Деян. 3:22', 'prorok-kak-moisey'],
  ['Еф. 3:17', 'hristos-v-serdtsah'],
  ['Быт. 15:6', 'chemu-poveril-avram'],
  ['Рим. 4:3', 'chemu-poveril-avram'],
  ['Иуд. 5', 'iuda-5-kto-vyvel-iz-egipta'],
  ['Иуды 1:5', 'iuda-5-kto-vyvel-iz-egipta'],
]) assert.equal(search(index, query)[0].doc.url, `/answers/${slug}/`, query);
assert(search(index, 'Дастин Смит').some(h => h.doc.url === '/scripture/john-1-1/'));
// The verse shortcut must not change ranking for a whole chapter or range.
const withoutBoost = {...index, docs: index.docs.map(d => d.type === 'guide' ? {...d, type:'page'} : d)};
for (const query of ['Ин 6', 'Ин 6:38–62']) {
  const scores = new Map(search(withoutBoost, query).map(h => [h.doc.url, h.score]));
  for (const hit of search(index, query).filter(h => h.doc.type === 'guide'))
    assert.equal(hit.score, scores.get(hit.doc.url), query);
}
''', text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
