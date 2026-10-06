# christian-monotheism

Сайт Сергея Брыка: статьи, темы и ответы по Писанию.

A static website (plain HTML, CSS and JavaScript, no build step), published with GitHub Pages:
https://bryk7419.github.io/christian-monotheism/

## Publishing with GitHub Pages

1. Open the repository's **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Choose the **main** branch and the **/ (root)** folder, then click **Save**.

GitHub publishes the site within a minute or two, and republishes it after every push to `main`.
The empty `.nojekyll` file tells GitHub Pages to serve the files exactly as they are.

## Structure

- `index.html` — home page; every section lives in its own folder with an `index.html`
  (`faith/`, `topics/`, `questions/`, `articles/`, `answers/`, `scripture/`, `videos/`, `about/`, `search/`).
- `assets/css/site.css` — styles; `assets/fonts/` — self-hosted fonts (SIL Open Font License).
- `assets/js/` — menu, link copying and site search; `assets/search-index.json` — search data.

All links are relative, so the site works both at the project address above and on a custom domain.

## Editing the site

Rules for editors and AI agents (Claude, Gemini and others) are in [AGENTS.md](AGENTS.md).
After editing pages, run `python3 tools/rebuild.py` to regenerate the catalog, scripture index,
topic pages and search index, then `python3 tools/check_links.py`.

## Проверки интерфейса

После `python3 tools/rebuild.py` выполните:

```sh
python3 tools/rebuild.py --check
python3 tools/check_links.py
```

Каталог выводит каждую статью один раз. `assets/js/catalog.js` добавляет поиск по
существующему индексу, фильтр темы, сортировку по дате и сохранение выбора в адресе.
Без JavaScript остаются полный список и ссылки на тематические подборки.
Нумерация вводных статей и время чтения собираются из подборки на главной.
Длинные заголовки могут иметь два визуальных уровня; полный текст названия сохраняется.

Для проверки каталога, оглавления, прогресса чтения, источников и мобильной вёрстки
нужны Playwright и Chromium. Запустите сервер из каталога над репозиторием:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

В другом терминале из репозитория:

```sh
node tools/check_reader_ui.mjs http://127.0.0.1:8000/christian-monotheism/
```

По умолчанию проверка использует установленный модуль `playwright` и его Chromium.
Если они установлены отдельно, `PLAYWRIGHT_MODULE` задаёт путь к `playwright` или
`playwright-core`, а `CHROMIUM_PATH` — путь к исполняемому файлу браузера.
