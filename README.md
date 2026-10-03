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
