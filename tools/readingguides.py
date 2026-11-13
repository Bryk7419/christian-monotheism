"""Авторские маршруты по отдельным стихам; данные — reading-guides.json."""
import html
import json
import re

import sitegen as S
import siteextras as X


def load():
    return json.loads(S.read('tools/reading-guides.json'))


def items(guide):
    return [item for section in guide['sections'] for item in section['items']]


def for_article(guides, slug):
    # Собственный основной маршрут важнее упоминания в соседней подборке.
    return next((g for g in guides if g['primary'] == slug), None) or next(
        (g for g in guides if any(item['slug'] == slug for item in items(g))), None)


def validate(m):
    errors, seen = [], set()
    arts = {a['slug']: a for a in m['articles']}
    for g in m['reading_guides']:
        if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', g['id']) or g['id'] in seen:
            errors.append(f'Маршрут: недопустимый или повторный адрес {g["id"]}')
        seen.add(g['id'])
        if g['primary'] not in arts:
            errors.append(f'{g["id"]}: нет основной статьи {g["primary"]}')
        elif not m['pages'][g['primary']]['lead']:
            errors.append(f'{g["id"]}: основной статье нужен краткий авторский ответ')
        for item in items(g):
            if item['slug'] not in arts:
                errors.append(f'{g["id"]}: нет статьи {item["slug"]}')
            elif item.get('anchor') and f'id="{item["anchor"]}"' not in arts[item['slug']]['html']:
                errors.append(f'{g["id"]}: нет якоря {item["slug"]}#{item["anchor"]}')
        for source in g['sources']:
            if not source['url'].startswith('https://'):
                errors.append(f'{g["id"]}: источник должен иметь полный адрес HTTPS')
    return errors


def title(g):
    return f'{g["ref"]}: {g["title"]}'


def summary(g, m):
    return S.html_to_text(m['pages'][g['primary']]['lead'])


def choices(guides, prefix, current=None):
    out = ['<nav class="reading-choices" aria-label="Часто разбираемые места"><ul>']
    for g in guides:
        attr = ' aria-current="page"' if g['id'] == current else ''
        out.append(f'<li><a href="{prefix}{g["id"]}/index.html"{attr}>{html.escape(g["ref"])}</a></li>')
    return '\n'.join(out) + '\n</ul></nav>\n'


def catalog_intro(guides):
    return ('<section class="reading-start" aria-labelledby="reading-start-h">\n'
            '<h2 class="section-label" id="reading-start-h">Частые вопросы об Иисусе</h2>\n'
            '<p>Выберите стих: сначала моё понимание, затем подробные разборы и другие прочтения.</p>\n'
            + choices(guides, '') + '</section>\n')


def article_route(g, slug):
    label = g['label'] if g['primary'] == slug else 'По теме статьи'
    return (f'<nav class="article-reading-route" aria-label="Подборка по {html.escape(g["ref"])}">'
            f'<span>{html.escape(label)}</span>'
            f'<a href="../../scripture/{g["id"]}/index.html">{html.escape(g["ref"])}: все разборы и варианты →</a>'
            '</nav>\n')


def sources(g, heading_id='reading-english'):
    out = [f'<section class="reading-sources" aria-labelledby="{heading_id}">',
           f'<h2 class="section-label" id="{heading_id}">На английском: близкие разборы</h2>',
           '<ul class="reading-source-list">']
    for src in g['sources']:
        out += ['<li>',
                f'<p class="reading-source-meta">{html.escape(src["author"])} · {html.escape(src["format"])}</p>',
                f'<h3><a class="ext" href="{html.escape(src["url"], quote=True)}" target="_blank" rel="noopener">{html.escape(src["title"])}{S.EXT}</a></h3>',
                f'<p class="reading-source-relation">{html.escape(src["relation"])}</p>',
                f'<p>{html.escape(src["note"])}</p>', '</li>']
    return '\n'.join(out) + '\n</ul>\n</section>\n'


def render(g, m, verse):
    arts = {a['slug']: a for a in m['articles']}
    a = arts[g['primary']]
    out = ('<main id="main" class="main" tabindex="-1">\n'
           '<div class="reading-guide">\n'
           '<nav class="crumbs" aria-label="Вы здесь"><a href="../index.html">По местам Писания</a>'
           f'<span aria-hidden="true">/</span><span>{html.escape(g["ref"])}</span></nav>\n'
           '<header class="reading-guide-header">\n'
           '<p class="eyebrow">Разборы Сергея Брыка</p>\n'
           f'<h1 class="page-title">{html.escape(title(g))}</h1>\n'
           '</header>\n'
           + choices(m['reading_guides'], '../', g['id'])
           + '<figure class="reading-verse">\n'
           f'<blockquote><p>«{html.escape(verse)}»</p></blockquote>\n'
           f'<figcaption>{html.escape(g["ref"])} · Синодальный перевод</figcaption></figure>\n'
           '<section class="reading-primary" aria-labelledby="reading-answer-h">\n'
           f'<h2 class="section-label" id="reading-answer-h">{html.escape(g["label"])}</h2>\n'
           f'<p class="reading-answer">{m["pages"][g["primary"]]["lead"]}</p>\n'
           f'<p class="reading-primary-title">{html.escape(a["title"])}</p>\n'
           f'<a class="button" href="../../answers/{a["slug"]}/index.html">Читать мой разбор →</a>\n'
           '</section>\n')
    for i, section in enumerate(g['sections']):
        out += (f'<section class="reading-section" aria-labelledby="reading-section-{i}">\n'
                f'<h2 class="section-label" id="reading-section-{i}">{html.escape(section["title"])}</h2>\n'
                '<ul class="reading-article-list">\n')
        for item in section['items']:
            a = arts[item['slug']]
            anchor = '#' + item['anchor'] if item.get('anchor') else ''
            out += (f'<li><h3><a href="../../answers/{item["slug"]}/index.html{anchor}">{html.escape(a["title"])}</a></h3>'
                    f'<p>{html.escape(item["note"])}</p></li>\n')
        out += '</ul>\n</section>\n'
    return out + sources(g) + '<p class="reading-back"><a href="../index.html">← Все места Писания</a></p>\n</div>\n</main>'


def pages(m):
    # Цитата берётся из того же проверенного корпуса, что и всплывающие стихи.
    refs = S.run_refs([{'type': 'page', 'passages': [g['ref']], 'aliases': [], 'body': ''}
                       for g in m['reading_guides']])
    bible = json.loads(S.read('tools/data/synodal.json'))['books']
    arts = {a['slug']: a for a in m['articles']}
    out = {}
    for g, ref in zip(m['reading_guides'], refs):
        book, segments = ref['passageRefs'][0]
        start, end = segments[0]
        if len(segments) != 1 or start != end or start % 1000 == 0:
            raise ValueError(f'{g["id"]}: нужен один точный стих')
        chapter, verse = divmod(start, 1000)
        text = bible[book][chapter - 1][verse - 1]
        path = f'scripture/{g["id"]}/index.html'
        # Страница имеет ту же глубину адреса, что и статья; ресурсы остаются относительными.
        template = arts[g['primary']]['html'].replace('property="og:type" content="article"',
                                                     'property="og:type" content="website"')
        template = S.set_head(template, title(g), summary(g, m), title(g))
        info = X.simple_info(path, title(g))
        info['jsonld'][0].update({'@type': 'CollectionPage', 'description': summary(g, m), 'author': X.person()})
        info['jsonld'].append(X.breadcrumbs([('По местам Писания', X.BASE + 'scripture/'),
                                             (g['ref'], X.page_url(path))]))
        out[path] = S.replace_main(X.apply_head(template, path, info), render(g, m, text))
    return out


def search_docs(m):
    arts = {a['slug']: a for a in m['articles']}
    for g in m['reading_guides']:
        related = '\n'.join(arts[item['slug']]['title'] + ' ' + item['note'] for item in items(g))
        english = '\n'.join(src['author'] + ' ' + src['title'] + ' ' + src['note'] for src in g['sources'])
        yield {'type': 'guide', 'url': f'/scripture/{g["id"]}/', 'title': title(g),
               'summary': summary(g, m), 'topics': arts[g['primary']]['topics'], 'passages': [g['ref']],
               'aliases': ['основной разбор', 'варианты толкования'],
               'body': summary(g, m) + '\n' + related + '\n' + english}
