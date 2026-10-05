"""Анонс новых статей в Telegram-канале. Запускается из .github/workflows/telegram-new-articles.yml.

Новая статья — это папка answers/<адрес>/, которой не было в предыдущей версии main (страницы перехода не считаются).
Нужны секреты репозитория TELEGRAM_BOT_TOKEN (токен бота от @BotFather) и TELEGRAM_CHAT_ID
(например, @SergBryk или числовой id канала); бот должен быть администратором канала.
Без секретов скрипт ничего не отправляет.

Проверка без отправки:  python3 tools/notify_telegram.py --dry-run <старый-коммит> <новый-коммит>
"""
import html
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = json.loads((ROOT / 'tools/site-config.json').read_text(encoding='utf-8'))


def new_articles(before, after):
    if not before or set(before) == {'0'}:
        return []
    out = subprocess.run(['git', 'diff', '--name-status', before, after, '--', 'answers'],
                         cwd=ROOT, capture_output=True, text=True, check=True).stdout
    slugs = []
    for line in out.splitlines():
        status, _, path = line.partition('\t')
        m = re.fullmatch(r'answers/([^/]+)/index\.html', path.strip())
        if status.startswith('A') and m:
            s = (ROOT / path.strip()).read_text(encoding='utf-8')
            if 'http-equiv="refresh"' not in s:
                slugs.append(m.group(1))
    return slugs


def message(slug):
    s = (ROOT / f'answers/{slug}/index.html').read_text(encoding='utf-8')
    title = html.unescape(re.sub(r'<[^>]+>', '', re.search(r'<h1 class="article-title">(.*?)</h1>', s, re.S).group(1)))
    summary = html.unescape(re.search(r'<meta name="description" content="([^"]*)">', s).group(1))
    url = CONFIG['base_url'] + f'answers/{slug}/'
    return (f'<b>Новая статья на сайте</b>\n\n<b>{html.escape(title)}</b>\n\n{html.escape(summary)}\n\n'
            f'<a href="{html.escape(url)}">Читать на сайте</a>'), url


def send(token, chat, text):
    data = urllib.parse.urlencode({'chat_id': chat, 'text': text, 'parse_mode': 'HTML'}).encode()
    with urllib.request.urlopen(f'https://api.telegram.org/bot{token}/sendMessage', data, timeout=30) as r:
        return json.loads(r.read())


def main():
    args = [a for a in sys.argv[1:] if a != '--dry-run']
    dry = '--dry-run' in sys.argv
    before = args[0] if args else os.environ.get('BEFORE', '')
    after = args[1] if len(args) > 1 else os.environ.get('AFTER', 'HEAD')
    slugs = new_articles(before, after)
    if not slugs:
        print('Новых статей нет.')
        return
    token, chat = os.environ.get('TELEGRAM_BOT_TOKEN'), os.environ.get('TELEGRAM_CHAT_ID')
    if not dry and not (token and chat):
        print('Секреты TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID не заданы: анонсы не отправлены.')
        return
    if not dry:
        time.sleep(120)  # дать GitHub Pages опубликовать страницу, чтобы Telegram показал превью
    for slug in slugs:
        text, url = message(slug)
        if dry:
            print(text, '\n---')
        else:
            send(token, chat, text)
            print('Отправлено:', url)


if __name__ == '__main__':
    main()
