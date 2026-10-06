"""Библиотека вывода страниц сайта: каталоги, темы, указатель Писания, видео, страница статьи.

Используется из tools/rebuild.py. Сама ничего не записывает.
"""
import html
import json
import re
import subprocess
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parent

EXT = ('<span class="ext-mark" aria-hidden="true">↗</span>'
       '<span class="visually-hidden"> (внешний сайт, откроется в новой вкладке)</span>')

MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля',
          'августа', 'сентября', 'октября', 'ноября', 'декабря']


def plural(n, one, few, many):
    n10, n100 = n % 10, n % 100
    if n10 == 1 and n100 != 11:
        return one
    if 2 <= n10 <= 4 and not 12 <= n100 <= 14:
        return few
    return many


def n_articles(n):
    return f'{n} {plural(n, "статья", "статьи", "статей")}'


def n_questions(n):
    return f'{n} {plural(n, "вопрос", "вопроса", "вопросов")}'


def read(p):
    return (ROOT / p).read_text(encoding='utf-8')


def main_of(s):
    a = s.index('<main id="main" class="main" tabindex="-1">')
    b = s.index('</main>') + len('</main>')
    return a, b


def replace_main(s, new_main):
    a, b = main_of(s)
    return s[:a] + new_main + s[b:]


# --- Книги Библии (из bible.js) ------------------------------------------------
def load_books():
    js = read('assets/js/bible.js')
    books = []
    for m in re.finditer(r"^\s*\['([^']+)', '([^']+)', '([^']+)', '([^']+)', \[", js, re.M):
        books.append({'id': m.group(1), 'name': m.group(2), 'abbr': m.group(3), 'section': m.group(4)})
    for i, b in enumerate(books):
        b['order'] = i
    return books


BOOKS = load_books()
BOOK = {b['id']: b for b in BOOKS}
SECTIONS = [('ot', 'Ветхий Завет'), ('nt', 'Новый Завет'), ('other', 'Другие источники')]


def run_refs(docs):
    """[{type, passages, aliases, body}] -> [{refs, mentions, passageRefs, sortKeys}] через bible.js."""
    out = subprocess.run(['node', str(TOOLS / 'refs.mjs')], input=json.dumps(docs, ensure_ascii=False),
                         capture_output=True, text=True, check=True).stdout
    return json.loads(out)


# --- Общие фрагменты ----------------------------------------------------------------
def cards(items, prefix, kinds=None):
    """items: [(slug, title, summary)]; kinds: {slug: жанр} — метка над заголовком."""
    out = ['<ul class="cards">']
    for slug, title, summary in items:
        out.append('  <li class="card">')
        if kinds and kinds.get(slug):
            out.append(f'    <p class="eyebrow">{kinds[slug]}</p>')
        out.append(f'    <a class="card-link" href="{prefix}{slug}/index.html">{title}</a><p class="card-summary">{summary}</p>')
        out.append('  </li>')
    out.append('</ul>')
    return '\n'.join(out) + '\n'


def questions_list(items, prefix):
    out = ['<ul class="questions">']
    for label, slug in items:
        base, _, anchor = slug.partition('#')
        href = f'{prefix}{base}/index.html' + (f'#{anchor}' if anchor else '')
        out.append(f'  <li><a href="{href}"><span class="question-label">{label}</span>'
                   '<span class="question-arrow" aria-hidden="true">→</span></a></li>')
    out.append('</ul>')
    return '\n'.join(out) + '\n'


def chips(items):
    """items: [(href, title)]."""
    out = ['<ul class="chips">']
    for href, title in items:
        out.append(f'  <li><a class="chip" href="{href}">{title}</a></li>')
    out.append('</ul>')
    return '\n'.join(out) + '\n'


def video_block(v, heading, related=None, only=None):
    """only: секунды отметок, которые показать (в статье — только места по её теме), остальные — по ссылке."""
    inner = v['inner']
    if heading == 'h3':
        inner = inner.replace('<h2 class="video-title">', '<h3 class="video-title">', 1).replace('</h2><p class="video-desc">', '</h3><p class="video-desc">', 1)
    attr = ''
    if only:
        total = len(re.findall(r'<li><a class="ext timestamp"', inner))
        inner = re.sub(r'    <li><a class="ext timestamp" href="[^"]*\?t=(\d+)".*?</li>\n',
                       lambda mm: mm.group(0) if int(mm.group(1)) in only else '', inner)
        inner += (f'\n  <p class="video-more"><a href="../../videos/index.html#{v["id"]}">Все отметки ({total})'
                  ' на странице «Видео»</a></p>')
        attr = f' data-t="{",".join(str(t) for t in only)}"'
    out = f'<article class="video" id="{v["id"]}"{attr}>\n{inner}\n'
    if related:
        out += '  <div class="video-related">\n    <p class="video-related-label">Статьи по теме записи</p>\n    <ul>\n'
        for slug, title in related:
            out += f'      <li><a href="../answers/{slug}/index.html">{title}</a></li>\n'
        out += '    </ul>\n  </div>\n'
    return out + '</article>\n'


PLAY = ('<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">'
        '<path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>')


def video_cues(prose, vfields):
    """<p class="video-cue" data-video="v21" data-t="124"></p> в тексте статьи → ссылка на нужное место видео.
    Время и название главы берутся из videos/index.html."""
    def fill(mm):
        vid, sec = mm.group(1), int(mm.group(2))
        f = vfields[vid]
        label, desc = next((t, d) for s, t, d in f['timestamps'] if s == sec)
        return (f'<p class="video-cue" data-video="{vid}" data-t="{sec}"><a class="ext" href="{f["url"]}?t={sec}" target="_blank" rel="noopener">'
                f'<span class="video-cue-play">{PLAY}</span><span class="video-cue-body">'
                f'<span class="video-cue-head">Смотреть в видео с <time datetime="PT{sec}S">{label}</time></span> '
                f'<span class="video-cue-chapter">{desc}</span> <span class="video-cue-title">{f["title"]}</span></span>'
                '<span class="visually-hidden"> (YouTube, откроется в новой вкладке)</span></a></p>')
    return re.sub(r'<p class="video-cue" data-video="(v\d+)" data-t="(\d+)">.*?</p>', fill, prose, flags=re.S)


def topic_title(m, tid):
    return next(t['title'] for t in m['topics'] if t['id'] == tid)


def articles_in(m, tid):
    return [a for a in m['articles'] if tid in a['topics']]


def videos_by_id(m):
    return {v['id']: v for v in m['videos']}


def video_related(m, vid):
    return [(a['slug'], a['title']) for a in m['articles'] if vid in a['videos']]


# --- Каталоги -------------------------------------------------------------------------
def jump_nav(m):
    out = '  <nav class="jump" aria-label="Темы на этой странице">\n    <ul class="chips">\n'
    for t in m['topics']:
        out += f'      <li><a class="chip" href="#{t["id"]}">{t["title"]}</a></li>\n'
    return out + '    </ul>\n  </nav>\n'


def catalog_header(title, intro):
    return (f'  <header class="catalog-header">\n    <h1 class="page-title">{title}</h1>\n'
            f'    <div class="catalog-intro"><p>{intro}</p>\n</div>\n  </header>\n')


def render_articles_index(m):
    out = '<main id="main" class="main" tabindex="-1">\n\n\n<div class="catalog catalog-articles">\n'
    out += catalog_header('Все статьи', m.get('articles_intro', 'Материалы о Боге, Иисусе Христе, Писании, воскресении и жизни веры.'))
    out += jump_nav(m)
    for t in m['topics']:
        arts = articles_in(m, t['id'])
        out += (f'  <section class="catalog-group" id="{t["id"]}" aria-labelledby="{t["id"]}-h">\n'
                f'    <h2 class="group-title" id="{t["id"]}-h"><a href="../topics/{t["id"]}/index.html">{t["title"]}</a> '
                f'<span class="group-count">{len(arts)}</span></h2>\n    \n')
        out += cards([(a['slug'], a['title'], a['summary']) for a in arts], '../answers/',
                     {a['slug']: a.get('kind') for a in arts})
        out += '\n  </section>\n'
    return out + '</div>\n\n</main>'


def render_questions_index(m):
    out = '<main id="main" class="main" tabindex="-1">\n\n\n<div class="catalog catalog-questions">\n'
    out += catalog_header('А как же…?', 'Вопросы к библейскому унитарному пониманию веры и ответы по Писанию. '
                          'Каждый ответ можно прочитать полностью здесь, на сайте.')
    out += jump_nav(m)
    for t in m['topics']:
        out += (f'  <section class="catalog-group" id="{t["id"]}" aria-labelledby="{t["id"]}-h">\n'
                f'    <h2 class="group-title" id="{t["id"]}-h"><a href="../topics/{t["id"]}/index.html">{t["title"]}</a></h2>\n    \n')
        out += questions_list(m['questions'][t['id']], '../answers/')
        out += '\n  </section>\n'
    return out + '</div>\n\n</main>'


def topic_meta(m, t):
    return n_articles(len(articles_in(m, t['id']))), n_questions(len(m['questions'][t['id']])), f'{len(t["videos"])} видео'


def render_topics_index(m):
    out = '<main id="main" class="main" tabindex="-1">\n\n\n<div class="catalog catalog-topics">\n'
    out += catalog_header('Темы', 'Выберите тему. Начните с краткого исповедания и основных текстов Писания, '
                          'затем переходите к статьям и вопросам.')
    out += '  <ul class="topic-list">\n'
    for t in m['topics']:
        a, q, v = topic_meta(m, t)
        meta = f'{a} · {q}' + (f' · {v}' if t['videos'] else '')
        out += ('    <li class="topic-entry">\n'
                f'      <h2 class="topic-entry-title"><a href="{t["id"]}/index.html">{t["title"]}</a></h2>\n'
                f'      <p class="topic-entry-text">{t["confession"]}</p>\n'
                f'      <p class="topic-entry-meta">{meta}</p>\n'
                '    </li>\n')
    return out + '  </ul>\n</div>\n\n</main>'


def render_home_topics(m):
    out = ('<section class="home-block" aria-labelledby="home-topics-h">\n'
           '  <h2 class="section-label" id="home-topics-h">Темы</h2>\n  <ul class="topic-grid">\n')
    for t in m['topics']:
        a, q, _ = topic_meta(m, t)
        out += ('    <li>\n'
                f'      <a class="topic-tile" href="topics/{t["id"]}/index.html">\n'
                f'        <span class="topic-tile-title">{t["title"]}</span>\n'
                f'        <span class="topic-tile-meta">{a} · {q}</span>\n'
                '      </a>\n    </li>\n')
    return out + '  </ul>\n</section>'


def render_topic_main(m, t):
    vids = videos_by_id(m)
    arts = {a['slug']: a for a in m['articles']}
    out = ('<main id="main" class="main" tabindex="-1">\n\n<article class="topic">\n  <header class="topic-header">\n'
           '    <nav class="crumbs" aria-label="Вы здесь"><a href="../index.html">Темы</a></nav>\n'
           f'    <h1 class="topic-title">{t["title"]}</h1>\n  </header>\n\n'
           '  <section class="confession" aria-label="Краткое исповедание">\n'
           f'    <p class="confession-text">{t["confession"]}</p>\n')
    if t['note']:
        out += f'    <p class="confession-note">{t["note"]}</p>\n'
    out += ('  </section>\n  <section class="topic-block" aria-labelledby="scripture-h">\n'
            '    <h2 class="section-label" id="scripture-h">Основные места Писания</h2>\n    <dl class="key-verses">\n')
    for href, label, desc in t['key_verses']:
        out += ('      <div class="key-verse">\n'
                f'        <dt><a class="ext ref" href="{href}" target="_blank" rel="noopener">{label}{EXT}</a></dt>\n'
                f'        <dd>{desc}</dd>\n      </div>\n')
    out += ('    </dl>\n  </section>\n  <section class="topic-block" aria-labelledby="more-h">\n'
            '    <h2 class="section-label" id="more-h">Подробнее</h2>\n    \n')
    out += cards([(s, arts[s]['title'], arts[s]['summary']) for s in t['more']], '../../answers/')
    out += ('\n  </section>\n  <section class="topic-block" aria-labelledby="questions-h">\n'
            '    <h2 class="section-label" id="questions-h">А как же…?</h2>\n    \n')
    out += questions_list(m['questions'][t['id']], '../../answers/')
    out += '\n  </section>\n'
    if t['videos']:
        out += ('  <section class="topic-block" aria-labelledby="videos-h">\n'
                '    <h2 class="section-label" id="videos-h">Видео</h2>\n    <div class="video-list">\n')
        for vid in t['videos']:
            out += video_block(vids[vid], 'h3') + '\n'
        out += '    </div>\n  </section>\n'
    out += ('  <section class="topic-block" aria-labelledby="related-h">\n'
            '    <h2 class="section-label" id="related-h">Связанные темы</h2>\n    \n')
    out += chips([(f'../{r}/index.html', topic_title(m, r)) for r in t['related']])
    out += ('\n  </section>\n\n'
            f'  <p class="topic-all"><a href="../../articles/index.html#{t["id"]}">Все статьи темы «{t["title"]}» '
            f'({len(articles_in(m, t["id"]))})</a></p>\n</article>\n\n</main>')
    return out


def render_videos_main(m):
    out = '<main id="main" class="main" tabindex="-1">\n\n\n<div class="catalog catalog-videos">\n'
    out += catalog_header('Видео', m.get('videos_intro', 'Беседы и разборы по темам сайта. Рядом со статьями можно найти подходящую запись, '
                          'а здесь — всю подборку. Отметки времени перенесены из авторских анонсов.'))
    out += '  <div class="video-list video-list-full">\n'
    for v in m['videos']:
        out += video_block(v, 'h2', video_related(m, v['id'])) + '\n'
    return out + '  </div>\n</div>\n\n</main>'


# --- Указатель Писания ---------------------------------------------------------------
def scripture_entries(m):
    """Места из всех статей: одинаковая подпись — одна запись; id по первому стиху, дубли с -2, -3."""
    docs = [{'type': 'article', 'passages': a['passages'], 'aliases': [], 'body': ''} for a in m['articles']]
    res = run_refs(docs)
    entries, by_label, used = [], {}, set()
    for a, r in zip(m['articles'], res):
        for label, pref, key in zip(a['passages'], r['passageRefs'], r['sortKeys']):
            if label in by_label:
                e = by_label[label]
                if a['slug'] not in e['articles']:
                    e['articles'].append(a['slug'])
                continue
            book, segs = pref
            c, v = divmod(segs[0][0], 1000)
            base = f'{book}-{c}-{v}'
            anchor, n = base, 1
            while anchor in used:
                n += 1
                anchor = f'{base}-{n}'
            used.add(anchor)
            e = {'label': label, 'book': book, 'key': key, 'anchor': anchor, 'articles': [a['slug']], 'seq': len(entries)}
            by_label[label] = e
            entries.append(e)
    entries.sort(key=lambda e: (e['key'], e['seq']))
    return entries


def render_scripture_main(m, entries):
    titles = {a['slug']: a['title'] for a in m['articles']}
    present = []
    for e in entries:
        if e['book'] not in present:
            present.append(e['book'])
    out = ('<main id="main" class="main" tabindex="-1">\n\n\n<div class="catalog catalog-scripture">\n'
           + catalog_header('По местам Писания', m.get('scripture_intro', 'Указатель стихов и отрывков, которые разбираются в статьях.'))
           + '  \n<form class="search-form" action="../search/index.html" method="get" role="search">\n'
           '  <label class="search-label" for="scripture-q">Поиск по статьям, темам и местам Писания</label>\n'
           '  <div class="search-row">\n'
           '    <input class="search-input" id="scripture-q" name="q" type="search" autocomplete="off" '
           'placeholder="Например: 1 Кор 8:6" enterkeyhint="search">\n'
           '    <button class="button" type="submit">Найти</button>\n  </div>\n</form>\n\n'
           '  <nav class="jump jump-books" aria-label="Книги">\n')
    for sid, sname in SECTIONS:
        bs = [BOOK[b] for b in present if BOOK[b]['section'] == sid]
        if not bs:
            continue
        out += f'    <p class="jump-label">{sname}</p>\n    <ul class="chips chips-books">\n'
        for b in bs:
            out += f'      <li><a class="chip" href="#book-{b["id"]}" title="{b["name"]}">{b["abbr"]}</a></li>\n'
        out += '    </ul>\n'
    out += '  </nav>\n'
    for sid, sname in SECTIONS:
        bs = [BOOK[b] for b in present if BOOK[b]['section'] == sid]
        if not bs:
            continue
        out += (f'  <section class="scripture-section" aria-labelledby="sec-{sid}">\n'
                f'    <h2 class="testament" id="sec-{sid}">{sname}</h2>\n')
        for b in bs:
            out += (f'    <section class="book" id="book-{b["id"]}" aria-labelledby="book-{b["id"]}-h">\n'
                    f'      <h3 class="book-title" id="book-{b["id"]}-h">{b["name"]}</h3>\n'
                    '      <ul class="passage-list">\n')
            for e in entries:
                if e['book'] != b['id']:
                    continue
                out += (f'        <li class="passage" id="{e["anchor"]}">\n'
                        f'          <span class="ref passage-ref">{e["label"]}</span>\n'
                        '          <ul class="passage-articles">\n')
                for s in e['articles']:
                    out += f'            <li><a href="../answers/{s}/index.html">{titles[s]}</a></li>\n'
                out += '          </ul>\n        </li>\n'
            out += '      </ul>\n    </section>\n'
        out += '  </section>\n'
    return out + '</div>\n\n</main>'


# --- Поисковый индекс -------------------------------------------------------------
def html_to_text(h):
    """Текст для индекса: блоки на отдельных строках, как в действующем индексе. Ссылки на видео (.video-cue) не входят."""
    h = re.sub(r'<p class="video-cue".*?</p>', '', h, flags=re.S)
    h = re.sub(r'</(p|h2|h3|li|dd|dt)>', '\n', h)
    h = re.sub(r'<[^>]+>', '', h)
    lines = [html.unescape(x).strip() for x in h.split('\n')]
    return '\n'.join(x for x in lines if x)


# --- Страница статьи ----------------------------------------------------------------
def reading_minutes(prose_html):
    words = len(html_to_text(prose_html).split())
    return max(1, round(words / 180))


def human_date(iso):
    y, mo, d = iso.split('-')
    return f'{int(d)} {MONTHS[int(mo) - 1]} {y}'


def parse_article_page(s):
    """Части готовой страницы статьи — для проверки шаблона."""
    p = {}
    p['crumb'] = re.search(r'<a href="\.\./\.\./topics/([^/]+)/index.html">[^<]+</a>\n    </nav>', s).group(1)
    p['minutes'] = int(re.search(r'<span>(\d+) минут', s).group(1))
    p['date'] = re.search(r'<time datetime="([^"]+)">', s).group(1)
    lead = re.search(r'<p class="article-lead">(?:<span class="lead-label">[^<]*</span>\s*)?(.*?)</p>', s, re.S)
    p['lead'] = lead.group(1).strip() if lead else ''
    p['prose'] = re.search(r'<div class="prose"[^>]*>\n(.*?)\n\n  </div>', s, re.S).group(1)
    p['sources'] = re.findall(r'<li><a class="ext" href="([^"]+)" target="_blank" rel="noopener">(.*?)' + re.escape(EXT) + r'</a></li>',
                              re.search(r'<ul class="source-list">(.*?)</ul>', s, re.S).group(1))
    nxt = re.search(r'id="next-h">Читать дальше</h2>(.*?)</section>', s, re.S).group(1)
    p['next'] = re.findall(r'class="card-link" href="\.\./([^/]+)/index.html"', nxt)
    return p


def render_article_main(m, a, p, anchors):
    """a: данные статьи (title, topics, passages, videos); p: crumb, minutes, date, prose, sources, next.

    По каким записям автора подготовлена статья, на странице не показывается: это записывается в editorial/source-ledger.md.
    """
    import siteextras as X
    arts = {x['slug']: x for x in m['articles']}
    vids = videos_by_id(m)
    prose = video_cues(X.add_heading_ids(p['prose']), m['vfields'])
    home = m.get('verses', {}).get(a['slug'], {}).get('home') or ''
    out = ('<main id="main" class="main" tabindex="-1">\n\n<article class="article">\n  <header class="article-header">\n'
           '    <nav class="crumbs" aria-label="Вы здесь">\n'
           f'      <a href="../../articles/index.html">Все статьи</a><span aria-hidden="true">/</span>'
           f'<a href="../../topics/{p["crumb"]}/index.html">{topic_title(m, p["crumb"])}</a>\n    </nav>\n'
           f'    <h1 class="article-title">{a["title"]}</h1>\n'
           + (f'    <p class="article-lead"><span class="lead-label">Мой ответ:</span> {p["lead"]}</p>\n' if p.get('lead') else '')
           + '    <p class="article-meta">\n'
           + (f'      <span>{a["kind"]}</span>\n      <span class="sep" aria-hidden="true">·</span>\n' if a.get('kind') else '')
           + f'      <span>{p["minutes"]} {plural(p["minutes"], "минута", "минуты", "минут")} чтения</span>\n'
           '      <span class="sep" aria-hidden="true">·</span>\n'
           f'      <span>обновлено <time datetime="{p["date"]}">{human_date(p["date"])}</time></span>\n    </p>\n')
    if a['passages']:
        out += '    <p class="article-passages">\n      <span class="passages-label">Разбираемые места:</span>\n'
        links = [f'      <a class="ref" href="../../scripture/index.html#{anchors[lab]}">{lab}</a>' for lab in a['passages']]
        out += '<span class="sep" aria-hidden="true"> · </span>\n'.join(links) + '\n    </p>\n'
    out += (X.article_tools() + '  </header>\n\n' + X.toc(prose)
            + f'  <div class="prose" data-home="{home}" data-verses="../../assets/verses/{a["slug"]}.json" data-slug="{a["slug"]}" data-audio="../../assets/audio/">\n' + prose + '\n\n  </div>\n\n')
    out += ('  <footer class="article-footer">\n' + X.article_end()
            + '    <section class="apparatus" aria-labelledby="sources-h">\n'
            '      <h2 class="section-label" id="sources-h">Места Писания и источники</h2>\n      <ul class="source-list">\n')
    for href, label in p['sources']:
        out += f'        <li><a class="ext" href="{href}" target="_blank" rel="noopener">{label}{EXT}</a></li>\n'
    out += '      </ul>\n'
    out += '    </section>\n'
    if a['videos']:
        out += ('    <section class="article-videos" aria-labelledby="video-h">\n'
                '      <h2 class="section-label" id="video-h">Видео</h2>\n      <div class="video-list">\n')
        for vid in a['videos']:
            out += video_block(vids[vid], 'h3', only=a.get('video_t', {}).get(vid)) + '\n'
        out += '      </div>\n    </section>\n'
    out += ('    <section aria-labelledby="next-h">\n      <h2 class="section-label" id="next-h">Читать дальше</h2>\n      \n'
            + cards([(s, arts[s]['title'], arts[s]['summary']) for s in p['next']], '../')
            + '\n    </section>\n    <section class="article-topics" aria-labelledby="topics-h">\n'
            '      <h2 class="section-label" id="topics-h">Темы</h2>\n      \n'
            + chips([(f'../../topics/{t}/index.html', topic_title(m, t)) for t in a['topics']])
            + '\n    </section>\n  </footer>\n</article>\n\n</main>')
    return out


def set_head(s, title, description, og_title):
    """Заголовок и описание в <head> страницы-образца."""
    d = html.escape(description, quote=True)
    s = re.sub(r'<title>.*?</title>', lambda _: f'<title>{title} — Сергей Брык</title>', s, count=1)
    s = re.sub(r'<meta name="description" content="[^"]*">', lambda _: f'<meta name="description" content="{d}">', s, count=1)
    s = re.sub(r'<meta property="og:title" content="[^"]*">', lambda _: f'<meta property="og:title" content="{html.escape(og_title, quote=True)}">', s, count=1)
    s = re.sub(r'<meta property="og:description" content="[^"]*">', lambda _: f'<meta property="og:description" content="{d}">', s, count=1)
    return s
