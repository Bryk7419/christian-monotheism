"""Пересобрать производные страницы и поисковый индекс по текущим страницам сайта.

    python3 tools/rebuild.py           # записать обновлённые файлы
    python3 tools/rebuild.py --check   # только проверить; код 1, если что-то устарело

Источник правды — сами страницы:
  * статьи: answers/<адрес>/index.html (заголовок, описание, жанр, места, темы, текст, источники, «Читать дальше»);
  * темы: topics/<id>/index.html (исповедание, основные места, «Подробнее», видео, связанные темы);
  * вопросы «А как же…?»: questions/index.html;
  * видео: videos/index.html (карточки без блока «Статьи по теме записи»).
Из assets/search-index.json берутся только порядок статей и тем, синонимы поиска (aliases)
и заголовки служебных страниц. Новая статья добавляется в конец порядка.

Скрипт пересобирает: страницы статей (ссылки на указатель, время чтения, дата прописью),
страницы тем, каталог статей, страницу вопросов, список тем, страницу видео, указатель Писания,
плитки тем и «С чего начать» на главной, а также assets/search-index.json.
Страницы «Во что я верю» и «Об авторе» правятся вручную; в индекс попадает их текст.

Кроме того (tools/siteextras.py): служебный блок <head> всех страниц, оглавление и кнопки статей,
тексты стихов assets/verses/<адрес>.json (tools/verses.mjs), sitemap.xml, feed.xml, llms.txt и new/index.html.
"""
import argparse
import html
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sitegen as S  # noqa: E402
import siteextras as X  # noqa: E402
import subprocess  # noqa: E402

KINDS_TEXT = 'библейский разбор, обзор темы, краткий ответ, размышление или практическая заметка'


# --- Видео ------------------------------------------------------------------------------------------------
def parse_video(vid, inner):
    f = {'id': vid}
    f['eyebrow'] = re.search(r'<p class="eyebrow">(.*?)</p>', inner).group(1)
    f['title'] = re.search(r'<h2 class="video-title">(.*?)</h2>', inner).group(1)
    f['desc'] = re.search(r'<p class="video-desc">(.*?)</p>', inner).group(1)
    f['url'] = re.search(r'<p class="video-link"><a class="ext" href="([^"]+)"', inner).group(1)
    f['timestamps'] = [(int(sec), t, d) for sec, t, d in re.findall(
        r'\?t=(\d+)" target="_blank" rel="noopener"><time datetime="PT\d+S">([^<]+)</time>.*?<span class="timestamp-desc">(.*?)</span>', inner)]
    return f


def video_inner(f):
    out = (f'  <p class="eyebrow">{f["eyebrow"]}</p>\n'
           f'  <h2 class="video-title">{f["title"]}</h2><p class="video-desc">{f["desc"]}</p>\n'
           f'  <p class="video-link"><a class="ext" href="{f["url"]}" target="_blank" rel="noopener">Открыть на YouTube{S.EXT}</a></p>')
    if f['timestamps']:
        # ролики длиннее часа: колонка времени шире («1:01:38»)
        cls = 'timestamps timestamps-long' if any(sec >= 3600 for sec, _, _ in f['timestamps']) else 'timestamps'
        out += f'\n  <ol class="{cls}" aria-label="Отметки времени">\n'
        for sec, t, d in f['timestamps']:
            out += (f'    <li><a class="ext timestamp" href="{f["url"]}?t={sec}" target="_blank" rel="noopener">'
                    f'<time datetime="PT{sec}S">{t}</time><span class="visually-hidden"> (YouTube, откроется в новой вкладке)</span></a>'
                    f'<span class="timestamp-desc">{d}</span></li>\n')
        out += '  </ol>'
    return out


# --- Чтение сайта ---------------------------------------------------------------------------------------
def is_redirect(s):
    return 'http-equiv="refresh"' in s


def block(s, pattern):
    mm = re.search(pattern, s, re.S)
    return mm.group(1) if mm else ''


def parse_article_meta(s):
    a = {}
    a['title'] = re.search(r'<h1 class="article-title">(.*?)</h1>', s).group(1)
    a['summary'] = html.unescape(re.search(r'<meta name="description" content="([^"]*)">', s).group(1))
    kind = re.search(r'<p class="article-meta">\n      <span>([^<\d][^<]*)</span>', s)
    a['kind'] = kind.group(1) if kind else None
    a['passages'] = re.findall(r'<a class="ref" href="\.\./\.\./scripture/index.html#[^"]*">(.*?)</a>',
                               block(s, r'<p class="article-passages">(.*?)</p>'))
    a['topics'] = re.findall(r'class="chip" href="\.\./\.\./topics/([^/]+)/index.html"',
                             block(s, r'<section class="article-topics"(.*?)</section>'))
    vids = re.findall(r'<article class="video" id="(v\d+)"(?: data-t="([\d,]+)")?>', block(s, r'<section class="article-videos"(.*?)</section>'))
    a['videos'] = [v for v, _ in vids]
    a['video_t'] = {v: [int(x) for x in ts.split(',')] for v, ts in vids if ts}
    a['video_cues'] = [(v, int(sec)) for v, sec in re.findall(r'<p class="video-cue" data-video="(v\d+)" data-t="(\d+)">', s)]
    return a


def intro_of(path):
    return re.search(r'<div class="catalog-intro"><p>(.*?)</p>', S.read(path)).group(1)


def load():
    index = json.loads(S.read('assets/search-index.json'))
    old_docs = {d['url']: d for d in index['docs']}
    m = {'index': index, 'old_docs': old_docs, 'topics': [], 'articles': [], 'videos': [], 'questions': {}, 'pages': {}}

    for t in index['topics']:
        s = S.read(f'topics/{t["id"]}/index.html')
        main = s[slice(*S.main_of(s))]
        topic = {'id': t['id'], 'title': re.search(r'<h1 class="topic-title">(.*?)</h1>', main).group(1)}
        topic['confession'] = re.search(r'<p class="confession-text">(.*?)</p>', main).group(1)
        note = re.search(r'<p class="confession-note">(.*?)</p>', main)
        topic['note'] = note.group(1) if note else None
        topic['key_verses'] = re.findall(
            r'<dt><a class="ext ref" href="([^"]+)" target="_blank" rel="noopener">(.*?)' + re.escape(S.EXT) + r'</a></dt>\s*<dd>(.*?)</dd>', main)
        topic['more'] = re.findall(r'class="card-link" href="\.\./\.\./answers/([^/]+)/index.html"',
                                   block(main, r'id="more-h">Подробнее</h2>(.*?)</section>'))
        topic['videos'] = re.findall(r'<article class="video" id="(v\d+)">', block(main, r'id="videos-h">Видео</h2>(.*?)</section>'))
        topic['related'] = re.findall(r'class="chip" href="\.\./([^/]+)/index.html"',
                                      block(main, r'id="related-h">Связанные темы</h2>(.*?)</section>'))
        m['topics'].append(topic)

    qp = S.read('questions/index.html')
    for t in m['topics']:
        sec = re.search(r'<section class="catalog-group" id="' + t['id'] + r'".*?</section>', qp, re.S).group(0)
        m['questions'][t['id']] = [(lab, slug + anchor) for slug, anchor, lab in re.findall(
            r'<li><a href="\.\./answers/([^/]+)/index.html(#[^"]*)?"><span class="question-label">(.*?)</span>', sec)]

    m['vfields'] = {}
    for vm in re.finditer(r'<article class="video" id="(v\d+)">\n(.*?)\n</article>', S.read('videos/index.html'), re.S):
        inner = re.sub(r'\n  <div class="video-related">.*', '', vm.group(2), flags=re.S)
        m['vfields'][vm.group(1)] = parse_video(vm.group(1), inner)
    m['videos'] = [{'id': vid, 'inner': video_inner(f), 'title': f['title'], 'summary': f['desc']} for vid, f in m['vfields'].items()]

    known = [d['url'].split('/')[2] for d in index['docs'] if d['type'] == 'article']
    on_disk = sorted(p.parent.name for p in (S.ROOT / 'answers').glob('*/index.html'))
    order = [s for s in known if s in on_disk] + [s for s in on_disk if s not in known]
    for slug in order:
        s = S.read(f'answers/{slug}/index.html')
        if is_redirect(s):
            continue
        a = parse_article_meta(s)
        a['slug'] = slug
        a['aliases'] = old_docs.get(f'/answers/{slug}/', {}).get('aliases', [])
        a['html'] = s
        m['articles'].append(a)
        p = S.parse_article_page(s)
        p['minutes'] = S.reading_minutes(p['prose'])
        m['pages'][slug] = p

    n = len(m['articles'])
    m['articles_intro'] = ('Статьи собраны в подборки по темам: одна статья может входить в несколько подборок. '
                           f'Всего на сайте {n} {S.plural(n, "самостоятельный материал", "самостоятельных материала", "самостоятельных материалов")}. '
                           f'Над заголовком указан жанр: {KINDS_TEXT}.')
    m['scripture_intro'] = intro_of('scripture/index.html')
    m['videos_intro'] = intro_of('videos/index.html')
    return m


# --- Проверки -----------------------------------------------------------------------------------------
def validate(m):
    errors = []
    arts = {a['slug']: a for a in m['articles']}
    topic_ids = {t['id'] for t in m['topics']}
    for a in m['articles']:
        p = m['pages'][a['slug']]
        where = f'answers/{a["slug"]}'
        if not a['topics']:
            errors.append(f'{where}: нет ни одной темы')
        for t in a['topics']:
            if t not in topic_ids:
                errors.append(f'{where}: неизвестная тема {t}')
        if p['crumb'] not in a['topics']:
            errors.append(f'{where}: тема в «хлебных крошках» ({p["crumb"]}) не входит в темы статьи')
        for s in p['next']:
            if s not in arts:
                errors.append(f'{where}: «Читать дальше» ссылается на несуществующую статью {s}')
        for v in a['videos']:
            if v not in m['vfields']:
                errors.append(f'{where}: неизвестное видео {v}')
        stamps = {v: {sec for sec, _, _ in f['timestamps']} for v, f in m['vfields'].items()}
        for v, secs in list(a['video_t'].items()) + [(v, [sec]) for v, sec in a['video_cues']]:
            for sec in secs:
                if v not in stamps or sec not in stamps[v]:
                    errors.append(f'{where}: у видео {v} нет отметки {sec} с (см. videos/index.html)')
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', p['date']):
            errors.append(f'{where}: дата должна быть в виде ГГГГ-ММ-ДД')
    # «Разбираемые места» — то, что статья действительно разбирает; из них собирается указатель Писания.
    # Дополнительное место, которого нет в тексте статьи, — явная ошибка (параллели сюда не ставятся, см. AGENTS.md).
    m['verses'] = verses_data(m)
    prefs = S.run_refs([{'type': 'article', 'passages': a['passages'], 'aliases': [], 'body': ''} for a in m['articles']])
    for a, r in zip(m['articles'], prefs):
        seen = {}
        for key in m['verses'][a['slug']]['verses']:
            book, cv = key.split(' ')
            c, v = cv.split(':')
            seen.setdefault(book, set()).add(int(c) * 1000 + int(v))
        for label, pref in list(zip(a['passages'], r['passageRefs']))[1:]:
            if not pref:
                continue
            book, segs = pref
            if not any(lo <= k <= hi for k in seen.get(book, ()) for lo, hi in segs):
                errors.append(f'answers/{a["slug"]}: в «Разбираемых местах» указано {label}, но в тексте статьи это место не разбирается')
    for t in m['topics']:
        for s in t['more']:
            if s not in arts:
                errors.append(f'topics/{t["id"]}: «Подробнее» — несуществующая статья {s}')
            elif t['id'] not in arts[s]['topics']:
                errors.append(f'topics/{t["id"]}: статья {s} в «Подробнее», но не отнесена к этой теме')
        for v in t['videos']:
            if v not in m['vfields']:
                errors.append(f'topics/{t["id"]}: неизвестное видео {v}')
        for _, target in m['questions'][t['id']]:
            slug, _, anchor = target.partition('#')
            if slug not in arts:
                errors.append(f'questions ({t["id"]}): несуществующая статья {slug}')
                continue
            if t['id'] not in arts[slug]['topics']:
                errors.append(f'questions ({t["id"]}): статья {slug} не отнесена к этой теме')
            if anchor and f'id="{anchor}"' not in m['pages'][slug]['prose']:
                errors.append(f'questions ({t["id"]}): в статье {slug} нет якоря #{anchor}')
    return errors


# --- Вывод ----------------------------------------------------------------------------------------------
def verses_data(m):
    """Тексты стихов, на которые ссылается каждая статья (для всплывающих подсказок)."""
    docs = [{'slug': a['slug'], 'passage': a['passages'][0] if a['passages'] else '',
             'blocks': S.html_to_text(m['pages'][a['slug']]['prose']).split('\n')} for a in m['articles']]
    res = subprocess.run(['node', str(S.TOOLS / 'verses.mjs')], input=json.dumps(docs, ensure_ascii=False),
                         capture_output=True, text=True, check=True).stdout
    return json.loads(res)


STATIC_PAGES = [('faith/index.html', 'Во что я верю'), ('about/index.html', 'Об авторе'), ('search/index.html', 'Поиск')]


def render_all(m):
    out = {}
    entries = S.scripture_entries(m)
    anchors = {e['label']: e['anchor'] for e in entries}
    arts = {a['slug']: a for a in m['articles']}
    m['verses'] = m.get('verses') or verses_data(m)
    for a in m['articles']:
        path = f'answers/{a["slug"]}/index.html'
        p = m['pages'][a['slug']]
        s = S.set_head(a['html'], a['title'], a['summary'], a['title'])
        s = X.apply_head(s, path, X.article_info(m, a, p))
        out[path] = S.replace_main(s, S.render_article_main(m, a, p, anchors))
        out[f'assets/verses/{a["slug"]}.json'] = json.dumps(m['verses'][a['slug']]['verses'], ensure_ascii=False, separators=(',', ':')) + '\n'
    for t in m['topics']:
        path = f'topics/{t["id"]}/index.html'
        s = S.set_head(S.read(path), t['title'], t['confession'], t['title'])
        s = X.apply_head(s, path, X.topic_info(t))
        out[path] = S.replace_main(s, S.render_topic_main(m, t))
    for path, title, intro, main in [
            ('articles/index.html', 'Все статьи', m['articles_intro'], S.render_articles_index(m)),
            ('questions/index.html', None, None, S.render_questions_index(m)),
            ('topics/index.html', None, None, S.render_topics_index(m)),
            ('videos/index.html', 'Видео', m['videos_intro'], S.render_videos_main(m)),
            ('scripture/index.html', 'По местам Писания', m['scripture_intro'], S.render_scripture_main(m, entries))]:
        s = S.read(path)
        if title:
            s = S.set_head(s, title, intro, title)
        s = X.apply_head(s, path, X.simple_info(path, title or X.plain(re.search(r'<title>(.*?) — ', s).group(1))))
        out[path] = S.replace_main(s, main)
    # «Что нового»: страница по образцу каталога статей
    new = S.set_head(S.read('articles/index.html'), 'Что нового', 'Новые и обновлённые статьи сайта, от последних к более ранним.', 'Что нового')
    new = X.apply_head(new, 'new/index.html', X.simple_info('new/index.html', 'Что нового'))
    out['new/index.html'] = S.replace_main(new, X.render_new_main(m))
    for path, title in STATIC_PAGES:
        out[path] = X.apply_head(S.read(path), path, X.simple_info(path, title))
    home = S.read('index.html')
    home = re.sub(r'<section class="home-block" aria-labelledby="home-topics-h">.*?</section>',
                  lambda _: S.render_home_topics(m), home, count=1, flags=re.S)
    start = re.search(r'(<h2 class="section-label">С чего начать</h2>\n)(<ul class="cards">.*?</ul>\n)', home, re.S)
    if start:
        slugs = re.findall(r'class="card-link" href="answers/([^/]+)/index.html"', start.group(2))
        cards = S.cards([(s, arts[s]['title'], arts[s]['summary']) for s in slugs if s in arts], 'answers/')
        home = home[:start.start(2)] + cards + home[start.end(2):]
    out['index.html'] = X.apply_head(home, 'index.html', X.simple_info('index.html'))
    out['assets/search-index.json'] = search_index(m)
    pages = [p for p in out if p.endswith('.html')]
    out['sitemap.xml'] = X.sitemap(m, pages)
    out['feed.xml'] = X.feed(m)
    out['llms.txt'] = X.llms(m)
    return out


def current(p):
    f = S.ROOT / p
    return f.read_text(encoding='utf-8') if f.exists() else None


def search_index(m):
    old_docs = m['old_docs']

    def page_doc(path, url):
        prose = re.search(r'<div class="prose prose-page">\n(.*?)\n  </div>', S.read(path), re.S).group(1)
        d = old_docs[url]
        return {'type': 'page', 'url': url, 'title': d['title'], 'summary': d['summary'], 'topics': [], 'passages': [],
                'aliases': [], 'body': S.html_to_text(prose)}

    def video_topics(vid):
        out = [t['id'] for t in m['topics'] if vid in t['videos']]
        for a in m['articles']:
            if vid in a['videos']:
                out += [t for t in a['topics'] if t not in out]
        return out

    docs = []
    for a in m['articles']:
        docs.append({'type': 'article', 'url': f'/answers/{a["slug"]}/', 'title': a['title'], 'summary': a['summary'],
                     'topics': a['topics'], 'passages': a['passages'], 'aliases': a['aliases'],
                     'body': S.html_to_text(m['pages'][a['slug']]['prose'])})
    for t in m['topics']:
        docs.append({'type': 'topic', 'url': f'/topics/{t["id"]}/', 'title': t['title'], 'summary': t['confession'],
                     'topics': [t['id']], 'passages': [label for _, label, _ in t['key_verses']], 'aliases': [],
                     'body': t['confession'] + '\n' + '\n'.join(f'{label} — {desc}' for _, label, desc in t['key_verses'])})
    docs.append(page_doc('faith/index.html', '/faith/'))
    docs.append(page_doc('about/index.html', '/about/'))
    for vid, f in m['vfields'].items():
        docs.append({'type': 'video', 'url': f'/videos/#{vid}', 'title': f['title'], 'summary': f['desc'],
                     'topics': video_topics(vid), 'passages': [], 'aliases': [],
                     'body': f['desc'] + ''.join(f'\n{t} — {d}' for _, t, d in f['timestamps'])})
    res = S.run_refs([{'type': d['type'], 'passages': d['passages'], 'aliases': d['aliases'], 'body': d['body']} for d in docs])
    keys = ['type', 'url', 'title', 'summary', 'topics', 'passages', 'aliases', 'refs', 'mentions', 'body']
    index = {'topics': [{'id': t['id'], 'title': t['title']} for t in m['topics']],
             'docs': [{k: dict(d, refs=r['refs'], mentions=r['mentions'])[k] for k in keys} for d, r in zip(docs, res)]}
    return json.dumps(index, ensure_ascii=False, separators=(',', ':'))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--check', action='store_true', help='ничего не записывать; код 1, если файлы устарели')
    args = ap.parse_args()
    m = load()
    errors = validate(m)
    if errors:
        print('Ошибки в данных сайта:')
        for e in errors:
            print('  -', e)
        sys.exit(2)
    rendered = render_all(m)
    stale = [p for p, s in rendered.items() if s != current(p)]
    if args.check:
        print('Устаревшие файлы:' if stale else 'Все производные файлы актуальны.')
        for p in stale:
            print('  -', p)
        sys.exit(1 if stale else 0)
    for p, s in rendered.items():
        if p in stale:
            (S.ROOT / p).parent.mkdir(parents=True, exist_ok=True)
            (S.ROOT / p).write_text(s, encoding='utf-8')
    print(f'Статей: {len(m["articles"])}. Обновлено файлов: {len(stale)}')
    for p in stale:
        print('  -', p)


if __name__ == '__main__':
    main()
