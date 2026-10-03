"""Проверить внутренние ссылки и якоря во всех HTML-страницах сайта.

    python3 tools/check_links.py    # код 1, если есть битые ссылки
"""
import html
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKIP = {'.git', 'editorial', 'tools'}


def main():
    files = [p for p in ROOT.rglob('*.html') if not SKIP & set(p.relative_to(ROOT).parts)]
    ids = {f.resolve(): set(re.findall(r'\sid="([^"]+)"', f.read_text(encoding='utf-8'))) for f in files}
    checked, bad = 0, []
    for f in files:
        for mm in re.finditer(r'(?:href|src)="([^"]+)"', f.read_text(encoding='utf-8')):
            url = html.unescape(mm.group(1))
            if re.match(r'^(https?:|mailto:|tel:|data:|javascript:)', url):
                continue
            checked += 1
            path, _, frag = url.partition('#')
            target = f.resolve() if not path else (f.parent / path).resolve()
            if target.is_dir():
                target = target / 'index.html'
            if not target.exists():
                bad.append((f, url, 'нет файла'))
            elif frag and target.suffix == '.html' and frag not in ids.get(target, set()):
                bad.append((f, url, 'нет якоря'))
    print(f'Проверено ссылок: {checked}. Битых: {len(bad)}')
    for f, url, why in bad:
        print(f'  - {f.relative_to(ROOT)}: {url} ({why})')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
