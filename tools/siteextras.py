"""Служебные части страниц, которые собирает tools/rebuild.py.

* служебный блок в <head> каждой страницы: постоянный адрес, картинка для превью ссылок,
  разметка schema.org для поисковиков, манифест приложения, RSS, счётчик посещений;
* якоря и оглавление разделов статьи, кнопки «Слушать» и «Поделиться», блок «Остался вопрос?»;
* sitemap.xml, feed.xml (RSS), llms.txt и страница «Что нового» (new/index.html).

Настройки — tools/site-config.json (адрес сайта, ссылка «Задать вопрос», код счётчика GoatCounter).
"""
import html
import json
import re
from pathlib import Path

import sitegen as S

CONFIG = json.loads((S.TOOLS / 'site-config.json').read_text(encoding='utf-8'))
BASE = CONFIG['base_url']
HEAD_START, HEAD_END = '<!-- site:head -->', '<!-- /site:head -->'
DEFAULT_IMAGE = ('assets/img/og-image.jpg', 1200, 603)


def esc(s):
    return html.escape(s, quote=True)


def plain(h):
    return html.unescape(re.sub(r'<[^>]+>', '', h)).strip()


# --- Якоря и оглавление статьи -----------------------------------------------------------------------
TRANSLIT = dict(zip('абвгдеёжзийклмнопрстуфхцчшщъыьэюя',
                    ['a', 'b', 'v', 'g', 'd', 'e', 'e', 'zh', 'z', 'i', 'y', 'k', 'l', 'm', 'n', 'o', 'p', 'r', 's', 't',
                     'u', 'f', 'h', 'ts', 'ch', 'sh', 'shch', '', 'y', '', 'e', 'yu', 'ya']))


def slugify(text):
    s = ''.join(TRANSLIT.get(c, c) for c in plain(text).lower())
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    return s[:48].rstrip('-') or 'razdel'


def add_heading_ids(prose):
    """Дать якорь каждому <h2> без id (по тексту заголовка латиницей). Существующие якоря не меняются."""
    used = set(re.findall(r'\bid="([^"]+)"', prose))

    def fix(mm):
        attrs, inner = mm.group(1), mm.group(2)
        if 'id=' in attrs:
            return mm.group(0)
        base = slugify(inner)
        new, n = base, 2
        while new in used:
            new, n = f'{base}-{n}', n + 1
        used.add(new)
        return f'<h2{attrs} id="{new}">{inner}</h2>'
    return re.sub(r'<h2([^>]*)>(.*?)</h2>', fix, prose)


def toc(prose):
    if 'class="theses"' in prose:   # блок «Коротко» сам ведёт к разделам статьи
        return ''
    heads = re.findall(r'<h2[^>]*\bid="([^"]+)"[^>]*>(.*?)</h2>', prose)
    if len(heads) < 3:
        return ''
    items = '\n'.join(f'        <li><a href="#{i}">{esc(plain(t))}</a></li>' for i, t in heads)
    return ('  <nav class="toc" aria-label="Содержание статьи">\n    <details>\n'
            f'      <summary>Содержание <span class="toc-count">{len(heads)} {S.plural(len(heads), "раздел", "раздела", "разделов")}</span></summary>\n'
            f'      <ol>\n{items}\n      </ol>\n    </details>\n  </nav>\n')


# --- Кнопки статьи -----------------------------------------------------------------------------------------
ICON_PLAY = ('<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">'
             '<path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>')
ICON_LINK = ('<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" '
             'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>')
ICON_SHARE = ('<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" '
              'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>')


def share_buttons(indent='      '):
    # «Поделиться» открывает системное меню устройства (там Telegram, почта и т. д.) и показывается,
    # только если браузер его поддерживает; «Скопировать ссылку» есть всегда.
    return (f'{indent}<button class="button button-quiet" type="button" data-share hidden>{ICON_SHARE} Поделиться</button>\n'
            f'{indent}<button class="button button-quiet copy-link" type="button" data-copy-link>{ICON_LINK} Скопировать ссылку</button>\n')


def article_tools():
    return ('    <div class="article-tools">\n'
            f'      <button class="button listen-button" type="button" data-listen hidden>{ICON_PLAY} <span>Слушать</span></button>\n'
            + share_buttons() + '    </div>\n')


def article_end():
    return ('    <section class="article-end" aria-labelledby="ask-h">\n'
            '      <h2 class="section-label" id="ask-h">Остался вопрос?</h2>\n'
            '      <p>Если после статьи остался вопрос или возражение, напишите мне. Отвечаю по Писанию.</p>\n'
            f'      <p><a class="button" href="{esc(CONFIG["ask_url"])}" target="_blank" rel="noopener">Задать вопрос автору{S.EXT}</a></p>\n'
            '      <div class="article-tools" aria-label="Поделиться статьёй">\n'
            + share_buttons('        ') + '      </div>\n    </section>\n')


# --- Служебный блок <head> -----------------------------------------------------------------------------
def page_url(path):
    """Путь файла → постоянный адрес страницы (папка со слешем)."""
    p = path[:-len('index.html')] if path.endswith('index.html') else path
    return BASE + p


def card_image(kind, slug):
    rel = f'assets/img/cards/{kind}-{slug}.jpg'
    if (S.ROOT / rel).exists():
        return rel, 1200, 630
    return DEFAULT_IMAGE


def person():
    return {'@type': 'Person', 'name': CONFIG['author'], 'url': BASE + 'about/'}


def jsonld(obj):
    s = json.dumps(obj, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
    return f'<script type="application/ld+json">{s}</script>'


def head_block(path, info):
    depth = path.count('/')
    root = '../' * depth
    img, w, h = info.get('image') or DEFAULT_IMAGE
    lines = [HEAD_START,
             f'<link rel="canonical" href="{esc(info["url"])}">',
             f'<meta property="og:url" content="{esc(info["url"])}">',
             f'<meta property="og:image" content="{esc(BASE + img)}">',
             f'<meta property="og:image:width" content="{w}">',
             f'<meta property="og:image:height" content="{h}">',
             f'<meta property="og:image:alt" content="{esc(info.get("image_alt") or CONFIG["site_name"])}">',
             '<meta name="twitter:card" content="summary_large_image">',
             f'<meta name="theme-color" content="{CONFIG["theme_light"]}" media="(prefers-color-scheme: light)">',
             f'<meta name="theme-color" content="{CONFIG["theme_dark"]}" media="(prefers-color-scheme: dark)">',
             f'<link rel="manifest" href="{root}manifest.webmanifest">',
             f'<link rel="alternate" type="application/rss+xml" title="{esc(CONFIG["site_name"])}: новые и обновлённые статьи" href="{root}feed.xml">']
    for obj in info.get('jsonld', []):
        lines.append(jsonld(obj))
    if CONFIG.get('goatcounter'):
        code = CONFIG['goatcounter']
        lines.append(f'<script data-goatcounter="https://{esc(code)}.goatcounter.com/count" async src="https://gc.zgo.at/count.js"></script>')
    lines.append(HEAD_END)
    return '\n'.join(lines) + '\n'


def apply_head(s, path, info):
    s = re.sub(re.escape(HEAD_START) + r'.*?' + re.escape(HEAD_END) + r'\n', '', s, flags=re.S)
    s = re.sub(r'<meta property="og:image" content="[^"]*">\n', '', s)
    return s.replace('</head>', head_block(path, info) + '</head>', 1)


def breadcrumbs(items):
    return {'@context': 'https://schema.org', '@type': 'BreadcrumbList',
            'itemListElement': [{'@type': 'ListItem', 'position': i + 1, 'name': n, 'item': u} for i, (n, u) in enumerate(items)]}


def article_info(m, a, p):
    url = page_url(f'answers/{a["slug"]}/index.html')
    img = card_image('article', a['slug'])
    topic = S.topic_title(m, p['crumb'])
    art = {'@context': 'https://schema.org', '@type': 'Article', 'headline': plain(a['title']), 'description': a['summary'],
           'inLanguage': 'ru', 'dateModified': p['date'], 'author': person(), 'publisher': person(),
           'image': BASE + img[0], 'mainEntityOfPage': url, 'articleSection': topic,
           'isPartOf': {'@type': 'WebSite', 'name': CONFIG['site_name'], 'url': BASE}}
    crumbs = breadcrumbs([('Все статьи', BASE + 'articles/'), (topic, BASE + f'topics/{p["crumb"]}/'), (plain(a['title']), url)])
    return {'url': url, 'image': img, 'image_alt': plain(a['title']), 'jsonld': [art, crumbs]}


def topic_info(t):
    url = page_url(f'topics/{t["id"]}/index.html')
    page = {'@context': 'https://schema.org', '@type': 'CollectionPage', 'name': plain(t['title']), 'description': plain(t['confession']),
            'inLanguage': 'ru', 'url': url, 'author': person()}
    return {'url': url, 'image': card_image('topic', t['id']), 'image_alt': plain(t['title']),
            'jsonld': [page, breadcrumbs([('Темы', BASE + 'topics/'), (plain(t['title']), url)])]}


def simple_info(path, title=None):
    url = page_url(path)
    info = {'url': url, 'jsonld': []}
    if path == 'index.html':
        info['jsonld'] = [{'@context': 'https://schema.org', '@type': 'WebSite', 'name': CONFIG['site_name'], 'url': BASE,
                           'inLanguage': 'ru', 'description': CONFIG['site_description'], 'author': person(),
                           'potentialAction': {'@type': 'SearchAction', 'target': BASE + 'search/index.html?q={search_term_string}',
                                               'query-input': 'required name=search_term_string'}}]
    elif path == 'about/index.html':
        info['jsonld'] = [{'@context': 'https://schema.org', '@type': 'ProfilePage', 'url': url, 'inLanguage': 'ru',
                           'mainEntity': dict(person(), image=BASE + 'assets/img/sergey-bryk.jpg',
                                              sameAs=[CONFIG['telegram_url'], CONFIG['youtube_url']])}]
    elif title:
        info['jsonld'] = [{'@context': 'https://schema.org', '@type': 'WebPage', 'name': title, 'url': url, 'inLanguage': 'ru'}]
    return info


# --- Новое на сайте: sitemap, RSS, llms.txt, «Что нового» ---------------------------------------------------
def by_date(m):
    return sorted(m['articles'], key=lambda a: (m['pages'][a['slug']]['date'], a['slug']), reverse=True)


def sitemap(m, paths):
    rows = []
    dates = {f'answers/{a["slug"]}/index.html': m['pages'][a['slug']]['date'] for a in m['articles']}
    for path in sorted(paths):
        last = f'<lastmod>{dates[path]}</lastmod>' if path in dates else ''
        rows.append(f'  <url><loc>{esc(page_url(path))}</loc>{last}</url>')
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            + '\n'.join(rows) + '\n</urlset>\n')


def rfc822(iso):
    import datetime
    d = datetime.date.fromisoformat(iso)
    days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return f'{days[d.weekday()]}, {d.day:02d} {months[d.month - 1]} {d.year} 06:00:00 +0000'


def feed(m):
    arts = by_date(m)[:CONFIG['feed_items']]
    items = []
    for a in arts:
        url = page_url(f'answers/{a["slug"]}/index.html')
        date = m['pages'][a['slug']]['date']
        items.append('  <item>\n'
                     f'    <title>{esc(plain(a["title"]))}</title>\n    <link>{esc(url)}</link>\n'
                     f'    <guid isPermaLink="false">{esc(url)}#{date}</guid>\n'
                     f'    <pubDate>{rfc822(date)}</pubDate>\n    <description>{esc(a["summary"])}</description>\n  </item>')
    newest = m['pages'][arts[0]['slug']]['date'] if arts else '2026-01-01'
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n<channel>\n'
            f'  <title>{esc(CONFIG["site_name"])}: новые и обновлённые статьи</title>\n'
            f'  <link>{esc(BASE)}</link>\n  <description>{esc(CONFIG["site_description"])}</description>\n'
            f'  <language>ru</language>\n  <lastBuildDate>{rfc822(newest)}</lastBuildDate>\n'
            + '\n'.join(items) + '\n</channel>\n</rss>\n')


def llms(m):
    lines = [f'# {CONFIG["site_name"]}: христианский монотеизм', '',
             f'> {CONFIG["site_description"]}', '',
             'Сайт Сергея Брыка: статьи и разборы Писания с позиции библейского унитаризма. '
             'Цитаты по Синодальному переводу. Библейские разборы называют главные возражения и отвечают на них.', '']
    for t in m['topics']:
        arts = S.articles_in(m, t['id'])
        if not arts:
            continue
        lines += [f'## {plain(t["title"])}', '']
        for a in arts:
            lines.append(f'- [{plain(a["title"])}]({page_url("answers/" + a["slug"] + "/index.html")}): {a["summary"]}')
        lines.append('')
    return '\n'.join(lines)


def render_new_main(m):
    arts = by_date(m)[:CONFIG['new_items']]
    out = '<main id="main" class="main" tabindex="-1">\n\n\n<div class="catalog catalog-new">\n'
    out += S.catalog_header('Что нового', 'Новые и обновлённые статьи, от последних к более ранним. '
                            'Подписаться можно в Telegram-канале или через RSS.')
    out += ('  <p class="subscribe">\n'
            f'    <a class="button" href="{esc(CONFIG["telegram_url"])}" target="_blank" rel="noopener">Telegram-канал{S.EXT}</a>\n'
            '    <a class="button button-quiet" href="../feed.xml">RSS-лента</a>\n  </p>\n')
    current = None
    for a in arts:
        date = m['pages'][a['slug']]['date']
        if date != current:
            if current is not None:
                out += '</ul>\n  </section>\n'
            current = date
            out += (f'  <section class="catalog-group" aria-label="{S.human_date(date)}">\n'
                    f'    <h2 class="group-title"><time datetime="{date}">{S.human_date(date)}</time></h2>\n<ul class="cards">\n')
        out += ('  <li class="card">\n'
                + (f'    <p class="eyebrow">{a["kind"]}</p>\n' if a.get('kind') else '')
                + f'    <a class="card-link" href="../answers/{a["slug"]}/index.html">{a["title"]}</a><p class="card-summary">{a["summary"]}</p>\n  </li>\n')
    if current is not None:
        out += '</ul>\n  </section>\n'
    return out + '</div>\n\n</main>'
