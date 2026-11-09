#!/usr/bin/env python3
"""Озвучка статей нейроголосом: assets/audio/<адрес>.mp3 и общий список assets/audio/index.json.

Текст для озвучки тот же, что у кнопки «Слушать» (assets/js/speech-text.js): заголовок и абзацы статьи без
подзаголовков, ссылки на Писание в скобках пропускаются, греческие, еврейские и латинские вставки тоже; у ссылки
внутри фразы голос читает подсказку data-say, если она есть. Между разделами пауза длиннее. Каждый абзац озвучивается
отдельно, поэтому в index.json записано, с какой секунды начинается каждый абзац: плеер подсвечивает
абзац, который сейчас звучит.

Служба озвучки выбирается по переменным окружения (в GitHub — секреты репозитория):
  AZURE_SPEECH_KEY и AZURE_SPEECH_REGION   Microsoft Azure, голос audio.azure_voice из tools/site-config.json;
  YANDEX_API_KEY (и при нужде YANDEX_FOLDER_ID)   Яндекс SpeechKit, голос audio.yandex_voice.
Без ключа — голос Microsoft из чтения вслух браузера Edge (пакет edge-tts, ключ и регистрация не нужны), если
в tools/site-config.json указано "audio": {"service": "edge"} или задана переменная AUDIO_SERVICE=edge.
Это неофициальный путь: Microsoft может его закрыть, тогда готовые записи останутся, а новые не появятся.
Если служба не выбрана, скрипт ничего не делает. Озвучиваются только новые и изменённые статьи.

  python3 tools/make_audio.py                 # озвучить то, что изменилось
  python3 tools/make_audio.py --dry-run       # показать, что будет озвучено, и сколько это знаков
  python3 tools/make_audio.py --only slug     # одну статью
  python3 tools/make_audio.py --batch-file tools/audio-batch.json  # текущий редакционный пакет
  python3 tools/make_audio.py --fake          # проверка без службы: вместо голоса тихий тон (не публиковать!)

Нужны Python 3.10+, Node.js 18+ и ffmpeg.
"""
import argparse
import asyncio
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'audio'
INDEX = OUT / 'index.json'
CONFIG = json.loads((ROOT / 'tools' / 'site-config.json').read_text(encoding='utf-8'))
AUDIO = CONFIG.get('audio', {})
FORMAT = 2                      # меняйте, если меняется способ сборки записи: всё переозвучится
PAUSE = {'title': 0.9, 'section': 1.2, 'p': 0.45, 'li': 0.35}   # section — последний абзац перед подзаголовком
CHUNK = 1500                    # знаков в одном запросе к службе


# --- Абзацы статьи: как в assets/js/listen.js — заголовок, затем p и li внутри .prose (подзаголовки не читаются) -
class Blocks(HTMLParser):
    TAGS = ('p', 'li')
    HEADINGS = ('h2', 'h3')

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.items = []     # [тег, [части текста], есть ли внутри <p>, последний абзац раздела]
        self.open = []
        self.figure = 0     # схемы (<figure>) и ссылки на видео (p.video-cue) не читаются, как и в listen.js
        self.skipping = []
        self.say = None     # [тег, глубина]: внутри элемента с data-say текст заменён подсказкой для голоса

    def handle_starttag(self, tag, attrs):
        if self.say:
            if tag == self.say[0]:
                self.say[1] += 1
            return
        a = dict(attrs)
        # схемы, ссылки на видео и абзацы с пустой подсказкой (data-say="") не читаются
        if tag == 'figure' or (tag == 'p' and 'video-cue' in (a.get('class') or '')) or (tag in self.TAGS and a.get('data-say') == ''):
            self.figure += 1
            self.skipping.append(tag)
            return
        if 'data-say' in a and not self.figure and tag not in self.TAGS:
            self.handle_data(a['data-say'] or '')
            self.say = [tag, 1]
            return
        if tag in self.HEADINGS and not self.figure and self.items:
            self.items[-1][3] = True
            return
        if tag not in self.TAGS or self.figure:
            return
        if tag == 'p':
            for it in self.open:
                if it[0] == 'li':
                    it[2] = True
        item = [tag, [], False, False]
        self.items.append(item)
        self.open.append(item)
        if 'data-say' in a:             # подсказка на весь абзац
            self.handle_data(a['data-say'])
            self.say = [tag, 1]

    def handle_endtag(self, tag):
        if self.say:
            if tag != self.say[0]:
                return
            self.say[1] -= 1
            if self.say[1]:
                return
            self.say = None
            if tag not in self.TAGS:
                return
        if self.skipping and tag == self.skipping[-1]:
            self.skipping.pop()
            self.figure = max(0, self.figure - 1)
            return
        if tag not in self.TAGS:
            return
        for i in range(len(self.open) - 1, -1, -1):
            if self.open[i][0] == tag:
                del self.open[i:]
                break

    def handle_data(self, data):
        if self.say:
            return
        for it in self.open:
            it[1].append(data)


def read_article(path):
    s = path.read_text(encoding='utf-8')
    if 'http-equiv="refresh"' in s:
        return None
    title = re.search(r'<h1 class="article-title">(.*?)</h1>', s, re.S)
    prose = re.search(r'<div class="prose"([^>]*)>\n(.*?)\n\n  </div>', s, re.S)
    if not title or not prose:
        return None
    home = re.search(r'data-home="([^"]*)"', prose.group(1))
    p = Blocks()
    p.feed(prose.group(2))
    t = Blocks()
    t.feed(f'<p>{title.group(1)}</p>')
    blocks = [('title', ''.join(t.items[0][1]))]
    blocks += [('section' if end else tag, ''.join(parts)) for tag, parts, has_p, end in p.items
               if not (tag == 'li' and has_p)]
    return {'home': home.group(1) if home else '', 'blocks': blocks,
            'title': re.sub(r'\s+', ' ', ''.join(t.items[0][1])).strip()}


def speakable(articles):
    """Текст для голоса по фразам: {slug: [[фраза, ...] для каждого абзаца]} (через Node и speech-text.js)."""
    payload = [{'slug': slug, 'home': a['home'], 'blocks': [raw for _, raw in a['blocks']]} for slug, a in articles.items()]
    res = subprocess.run(['node', str(ROOT / 'tools' / 'audio-text.mjs')], input=json.dumps(payload, ensure_ascii=False),
                         capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


def chunks(phrases):
    out, cur = [], ''
    for s in phrases:
        if cur and len(cur) + 1 + len(s) > CHUNK:
            out.append(cur)
            cur = s
        else:
            cur = f'{cur} {s}' if cur else s
    if cur:
        out.append(cur)
    return out


# --- Службы озвучки: каждая возвращает PCM 16 бит, моно, с частотой self.rate ----------------------------
class VoiceError(Exception):
    """Служба не дала звук и после повторов: статья пропускается, запуск идёт дальше (её озвучит следующий)."""


def request(url, data, headers, attempts=6):
    for n in range(attempts):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers), timeout=120) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            body = e.read()[:300].decode('utf-8', 'replace')
            if e.code in (429, 500, 502, 503, 504) and n < attempts - 1:
                wait = float(e.headers.get('Retry-After') or 0) or min(60, 2 ** (n + 1))
                print(f'  служба ответила {e.code}, повтор через {wait:.0f} с', flush=True)
                time.sleep(wait)
                continue
            raise VoiceError(f'служба ответила {e.code}: {body}')
        except urllib.error.URLError as e:
            if n < attempts - 1:
                time.sleep(min(60, 2 ** (n + 1)))
                continue
            raise VoiceError(f'нет связи со службой: {e.reason}')


class Azure:
    rate = 24000

    def __init__(self, key, region):
        self.key, self.region = key, region
        self.voice = AUDIO.get('azure_voice', 'ru-RU-DmitryNeural')
        self.per_minute = int(AUDIO.get('azure_per_minute', 18))   # бесплатный тариф F0: 20 запросов в минуту
        self.calls = []

    @property
    def id(self):
        return f'azure:{self.voice}'

    def __call__(self, text):
        now = time.time()
        self.calls = [t for t in self.calls if now - t < 60]
        if len(self.calls) >= self.per_minute:
            time.sleep(60 - (now - self.calls[0]) + 0.5)
        self.calls.append(time.time())
        ssml = (f"<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='ru-RU'><voice name='{self.voice}'>"
                f'{escape(text)}</voice></speak>').encode('utf-8')
        return request(f'https://{self.region}.tts.speech.microsoft.com/cognitiveservices/v1', ssml, {
            'Ocp-Apim-Subscription-Key': self.key,
            'Content-Type': 'application/ssml+xml',
            'X-Microsoft-OutputFormat': 'raw-24khz-16bit-mono-pcm',
            'User-Agent': 'christian-monotheism-audio',
        })


class Yandex:
    rate = 48000

    def __init__(self, key, folder):
        self.key, self.folder = key, folder
        self.voice = AUDIO.get('yandex_voice', 'filipp')

    @property
    def id(self):
        return f'yandex:{self.voice}'

    def __call__(self, text):
        form = {'text': text, 'lang': 'ru-RU', 'voice': self.voice, 'format': 'lpcm', 'sampleRateHertz': str(self.rate)}
        if self.folder:
            form['folderId'] = self.folder
        return request('https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize',
                       urllib.parse.urlencode(form).encode(), {'Authorization': f'Api-Key {self.key}'})


class Edge:
    """Голос Microsoft из чтения вслух браузера Edge (пакет edge-tts): без ключа и регистрации, но неофициально."""
    rate = 24000

    def __init__(self):
        try:
            import edge_tts
        except ImportError:
            sys.exit('Для озвучки голосом Edge нужен пакет edge-tts: pip install edge-tts')
        self.edge_tts = edge_tts
        self.voice = AUDIO.get('azure_voice', 'ru-RU-DmitryNeural')

    @property
    def id(self):
        return f'edge:{self.voice}'

    async def mp3(self, text):
        out = bytearray()
        async for part in self.edge_tts.Communicate(text, self.voice).stream():
            if part['type'] == 'audio':
                out += part['data']
        return bytes(out)

    def __call__(self, text):
        # служба Edge временами перестаёт отдавать звук («No audio was received»): ждать дольше, до 4 минут
        attempts = 7
        for n in range(attempts):
            try:
                mp3 = asyncio.run(self.mp3(text))
                if not mp3:
                    raise RuntimeError('служба не вернула звук')
                break
            except Exception as e:      # обрывы связи и отказы службы: подождать и повторить
                if n == attempts - 1:
                    raise VoiceError(f'служба Edge: {e}') from e
                wait = min(240, 4 * 2 ** n)
                print(f'  служба Edge: {e}; повтор через {wait} с', flush=True)
                time.sleep(wait)
        time.sleep(1)                   # не торопить службу
        return subprocess.run(['ffmpeg', '-loglevel', 'error', '-f', 'mp3', '-i', '-', '-f', 's16le',
                               '-ar', str(self.rate), '-ac', '1', '-'], input=mp3, capture_output=True, check=True).stdout


class Fake:
    """Для проверки плеера без службы: тихий тон, длина по числу знаков."""
    rate = 24000
    id = 'fake'

    def __call__(self, text):
        n = int(self.rate * max(0.4, len(text) * 0.055))
        return b''.join(int(1200 * math.sin(2 * math.pi * 220 * i / self.rate)).to_bytes(2, 'little', signed=True)
                        for i in range(n))


def provider(args):
    if args.fake:
        return Fake()
    if os.environ.get('AZURE_SPEECH_KEY'):
        region = os.environ.get('AZURE_SPEECH_REGION') or AUDIO.get('azure_region')
        if not region:
            sys.exit('Не задан регион Azure: секрет AZURE_SPEECH_REGION, например westeurope.')
        return Azure(os.environ['AZURE_SPEECH_KEY'].strip(), region.strip())
    if os.environ.get('YANDEX_API_KEY'):
        return Yandex(os.environ['YANDEX_API_KEY'].strip(), os.environ.get('YANDEX_FOLDER_ID', '').strip())
    if (os.environ.get('AUDIO_SERVICE') or AUDIO.get('service')) == 'edge':
        return Edge()
    return None


# --- Сборка записи ------------------------------------------------------------------------------------------
def build(voice, blocks, phrases):
    pcm, starts = bytearray(), []
    for (kind, _), sents in zip(blocks, phrases):
        starts.append(round(len(pcm) / 2 / voice.rate, 2))
        if not sents:
            continue
        for text in chunks(sents):
            audio = voice(text)
            pcm += audio[:len(audio) // 2 * 2]
        pcm += bytes(2 * int(voice.rate * PAUSE.get(kind, 0.4)))
    return bytes(pcm), starts


def encode(pcm, rate, out, title):
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix('.tmp.mp3')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 's16le', '-ar', str(rate), '-ac', '1', '-i', '-',
                    '-codec:a', 'libmp3lame', '-b:a', str(AUDIO.get('bitrate', '48k')), '-ar', '24000', '-ac', '1',
                    '-metadata', f'title={title}', '-metadata', f'artist={CONFIG.get("author", "")}',
                    '-metadata', f'album={CONFIG.get("site_name", "")}', str(tmp)], input=pcm, check=True)
    tmp.replace(out)


def save(index):
    INDEX.parent.mkdir(parents=True, exist_ok=True)
    INDEX.write_text(json.dumps(dict(sorted(index.items())), ensure_ascii=False, separators=(',', ':')) + '\n',
                     encoding='utf-8')


def read_batch(path):
    slugs = json.loads(Path(path).read_text(encoding='utf-8'))
    if not isinstance(slugs, list) or not slugs:
        raise ValueError('Пакет озвучки должен быть непустым списком адресов статей.')
    if any(not isinstance(s, str) or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', s) for s in slugs):
        raise ValueError('В пакете озвучки допустимы только адреса статей: латиница, цифры и дефисы.')
    return list(dict.fromkeys(slugs))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    selection = ap.add_mutually_exclusive_group()
    selection.add_argument('--only', action='append', help='адрес статьи (можно несколько раз)')
    selection.add_argument('--batch-file', help='JSON-файл с непустым списком статей текущего пакета')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--fake', action='store_true')
    ap.add_argument('--force', action='store_true', help='переозвучить, даже если текст не менялся')
    ap.add_argument('--max-minutes', type=float, default=0, help='остановиться после стольких минут работы')
    args = ap.parse_args()
    if args.batch_file:
        try:
            args.only = read_batch(args.batch_file)
        except (OSError, ValueError) as e:
            ap.error(str(e))
    started = time.time()

    voice = None if args.dry_run else provider(args)
    if voice is None and not args.dry_run:
        print('Служба озвучки не выбрана (ключ AZURE_SPEECH_KEY или YANDEX_API_KEY, либо audio.service "edge"): озвучка пропущена.')
        return
    articles = {}
    for f in sorted((ROOT / 'answers').glob('*/index.html')):
        a = read_article(f)
        if a:
            articles[f.parent.name] = a
    unknown = [slug for slug in args.only or [] if slug not in articles]
    if unknown:
        sys.exit(f'Нет такой статьи: {", ".join(unknown)}. Адрес — имя папки в answers/, например slovo-bylo-bog.')
    phrases = speakable(articles)
    index = json.loads(INDEX.read_text(encoding='utf-8')) if INDEX.exists() else {}
    vid = voice.id if voice else 'dry-run'

    # записи удалённых и объединённых статей
    gone = [s for s in index if s not in articles and (not args.only or s in args.only)]
    if gone and not args.dry_run:
        for slug in gone:
            index.pop(slug)
            (OUT / f'{slug}.mp3').unlink(missing_ok=True)
            print(f'удалена запись: {slug}')
        save(index)

    todo = []
    for slug in articles:
        if args.only and slug not in args.only:
            continue
        h = hashlib.sha256(json.dumps([FORMAT, vid, phrases[slug]], ensure_ascii=False).encode()).hexdigest()[:12]
        if args.force or index.get(slug, {}).get('h') != h or not (OUT / f'{slug}.mp3').exists():
            todo.append((slug, h))
    chars = sum(len(' '.join(' '.join(b) for b in phrases[s])) for s, _ in todo)
    print(f'Статей: {len(articles)}. Озвучить: {len(todo)}, это {chars} знаков.', flush=True)
    if args.dry_run:
        for slug, _ in todo:
            print(' ', slug)
        return

    done, failed, streak = 0, [], 0
    for slug, h in todo:
        if args.max_minutes and time.time() - started > args.max_minutes * 60:
            print('Время вышло: остальное озвучится при следующем запуске.')
            break
        a = articles[slug]
        print(f'озвучиваю: {slug}', flush=True)
        try:
            pcm, starts = build(voice, a['blocks'], phrases[slug])
        except VoiceError as e:         # статью озвучит следующий запуск; три отказа подряд — служба не отвечает
            failed.append(slug)
            streak += 1
            print(f'  пропущена ({e})', flush=True)
            if streak >= 3:
                print('Служба трижды подряд не дала звук: остальное озвучится при следующем запуске.')
                break
            time.sleep(120)
            continue
        streak = 0
        encode(pcm, voice.rate, OUT / f'{slug}.mp3', a['title'])
        index[slug] = {'h': h, 'd': round(len(pcm) / 2 / voice.rate, 1), 'v': vid, 's': starts}
        save(index)
        done += 1
    print(f'Готово: {done} из {len(todo)}.' + (f' Пропущены: {", ".join(failed)}.' if failed else ''))
    if failed and not done:
        sys.exit(1)


if __name__ == '__main__':
    main()
