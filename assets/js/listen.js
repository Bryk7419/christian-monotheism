// Чтение статьи вслух.
// Если для статьи есть готовая запись нейроголосом (assets/audio/, tools/make_audio.py), показывается плеер.
// Иначе кнопка «Слушать» читает статью голосом устройства (Web Speech API): по абзацам, с подсветкой.
// Текст для голоса готовит assets/js/speech-text.js. Место, где читатель остановился, запоминается в этом браузере.

import { speakable, sentences } from './speech-text.js';

const synth = window.speechSynthesis;
const button = document.querySelector('[data-listen]');
const article = document.querySelector('.article');
const prose = document.querySelector('.prose');
const RATES = [1, 1.2, 1.4, 0.85];
const STORE = `listen:${location.pathname}`;
const VOICE_STORE = 'listen:voice';

// --- Чтение -------------------------------------------------------------------------------------------------
let blocks = [];
let queue = [];
let pos = 0;
let playing = false;
let generation = 0;
let rate = 1;
let voice = null;
let bar;
let wakeLock = null;
let userScrolledAt = 0;

// Что читается вслух: абзацы, заголовки и пункты списков; схемы (<figure>), ссылки на видео (.video-cue)
// и блок «Коротко» (.theses) пропускаются.
// То же правило в tools/make_audio.py (класс Blocks), иначе подсветка разойдётся с записью.
function speakableBlock(el) {
  return el && !(el.matches('li') && el.querySelector('p')) && !el.closest('figure, .video-cue, .theses');
}

function collect() {
  const home = prose?.dataset.home || null;
  const els = [article.querySelector('.article-title'), ...prose.querySelectorAll('p, h2, h3, li')];
  blocks = els.filter(speakableBlock);
  queue = [];
  blocks.forEach((el, bi) => {
    const text = speakable(el.textContent, home);
    for (const s of sentences(text)) queue.push({ el, bi, text: s });
  });
}

// Русские голоса устройства, лучшие первыми
function ruVoices() {
  const score = (v) => (/natural|neural|online|enhanced|premium|улучш/i.test(v.name) ? 4 : 0)
    + (/milena|yuri|katya|svetlana|dmitry|google/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1);
  return synth.getVoices().filter((v) => /^ru/i.test(v.lang)).sort((a, b) => score(b) - score(a));
}

// Голос, выбранный читателем кнопкой «Сменить голос», иначе лучший из найденных
function pickVoice() {
  const list = ruVoices();
  let saved = '';
  try { saved = localStorage.getItem(VOICE_STORE) || ''; } catch { /* */ }
  return list.find((v) => v.name === saved) || list[0] || null;
}

function nextVoice() {
  const list = ruVoices();
  if (list.length < 2) return;
  const i = list.findIndex((v) => v.name === voice?.name);
  voice = list[(i + 1) % list.length];
  try { localStorage.setItem(VOICE_STORE, voice.name); } catch { /* */ }
  notify(`Голос: ${voice.name}`);
  if (playing) speak();
}

function voiceButton() {
  const b = bar?.querySelector('[data-act="voice"]');
  if (b) b.hidden = ruVoices().length < 2;
}

function highlight(el) {
  for (const x of article.querySelectorAll('.is-speaking')) x.classList.remove('is-speaking');
  if (!el) return;
  el.classList.add('is-speaking');
  const r = el.getBoundingClientRect();
  const visible = r.top >= 0 && r.bottom <= window.innerHeight - 80;
  if (!visible && Date.now() - userScrolledAt > 4000) {
    el.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
}

function status() {
  if (!bar) return;
  const cur = queue[pos];
  bar.querySelector('.listen-status').textContent = cur ? `Абзац ${cur.bi + 1} из ${blocks.length}` : 'Готово';
  const t = bar.querySelector('[data-act="toggle"]');
  t.setAttribute('aria-label', playing ? 'Пауза' : 'Продолжить');
  t.innerHTML = playing ? ICON.pause : ICON.play;
  bar.querySelector('[data-act="rate"]').textContent = `${String(rate).replace('.', ',')}×`;
}

async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request('screen');
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; }
}

function speak() {
  const gen = ++generation;
  synth.cancel();
  const item = queue[pos];
  if (!item) { stop(true); return; }
  highlight(item.el);
  try { localStorage.setItem(STORE, String(item.bi)); } catch { /* хранилище недоступно */ }
  const u = new SpeechSynthesisUtterance(item.text);
  u.lang = 'ru-RU';
  if (voice) u.voice = voice;
  u.rate = rate;
  u.onend = () => { if (gen === generation && playing) { pos += 1; speak(); } };
  u.onerror = (e) => {
    if (gen !== generation || !playing || e.error === 'interrupted' || e.error === 'canceled') return;
    if (FATAL.has(e.error)) { pause(); notify('Не удалось включить чтение вслух на этом устройстве. Попробуйте другой браузер.'); return; }
    pos += 1;
    speak();
  };
  status();
  synth.speak(u);
}

const FATAL = new Set(['synthesis-failed', 'synthesis-unavailable', 'audio-hardware', 'audio-busy', 'network', 'not-allowed', 'language-unavailable', 'voice-unavailable']);

function notify(text) {
  const toast = document.querySelector('.toast');
  if (!toast) return;
  toast.textContent = text;
  toast.hidden = false;
  setTimeout(() => { toast.hidden = true; }, 4500);
}

function play() {
  playing = true;
  keepAwake(true);
  speak();
}

function pause() {
  playing = false;
  generation += 1;
  synth.cancel();
  keepAwake(false);
  status();
}

function stop(finished = false) {
  pause();
  highlight(null);
  if (finished) { try { localStorage.removeItem(STORE); } catch { /* */ } }
  bar?.remove();
  bar = null;
  button.setAttribute('aria-pressed', 'false');
}

function jumpBlock(delta) {
  const cur = queue[pos]?.bi ?? 0;
  const target = Math.max(0, Math.min(blocks.length - 1, cur + delta));
  pos = queue.findIndex((q) => q.bi === target);
  if (pos < 0) pos = 0;
  if (playing) speak(); else { highlight(queue[pos]?.el); status(); }
}

const ICON = {
  play: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>',
  prev: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M6 5h2v14H6zM20 5.5v13L9.5 12z" fill="currentColor"/></svg>',
  next: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M16 5h2v14h-2zM4 5.5v13L14.5 12z" fill="currentColor"/></svg>',
  voice: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

function makeBar() {
  bar = document.createElement('div');
  bar.className = 'listen-bar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Чтение вслух');
  bar.innerHTML = `<button type="button" data-act="prev" aria-label="Предыдущий абзац">${ICON.prev}</button>`
    + `<button type="button" data-act="toggle" class="listen-main" aria-label="Пауза">${ICON.pause}</button>`
    + `<button type="button" data-act="next" aria-label="Следующий абзац">${ICON.next}</button>`
    + '<button type="button" data-act="rate" class="listen-rate" aria-label="Скорость чтения">1×</button>'
    + `<button type="button" data-act="voice" aria-label="Сменить голос" title="Сменить голос" hidden>${ICON.voice}</button>`
    + '<span class="listen-status" aria-live="polite"></span>'
    + '<button type="button" data-act="restart" class="listen-restart">С начала</button>'
    + `<button type="button" data-act="stop" aria-label="Остановить чтение">${ICON.close}</button>`;
  bar.addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    if (act === 'toggle') { if (playing) pause(); else play(); }
    if (act === 'prev') jumpBlock(-1);
    if (act === 'next') jumpBlock(1);
    if (act === 'restart') { pos = 0; if (playing) speak(); else play(); }
    if (act === 'rate') {
      rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
      if (playing) speak(); else status();
    }
    if (act === 'voice') nextVoice();
    if (act === 'stop') stop();
  });
  document.body.append(bar);
  voiceButton();
}

function start() {
  if (bar) { if (playing) pause(); else play(); return; }
  collect();
  voice = pickVoice();
  let saved = 0;
  try { saved = Number(localStorage.getItem(STORE)) || 0; } catch { /* */ }
  pos = 0;
  if (saved > 1 && saved < blocks.length) {
    pos = Math.max(0, queue.findIndex((q) => q.bi === saved));
  }
  makeBar();
  bar.querySelector('.listen-restart').hidden = pos === 0;
  button.setAttribute('aria-pressed', 'true');
  if (!voice && synth.getVoices().length) notify('На этом устройстве не найден русский голос: чтение может звучать с акцентом.');
  play();
}

function setupSpeech() {
  if (!(synth && button && 'SpeechSynthesisUtterance' in window)) return;
  button.hidden = false;
  try { if (Number(localStorage.getItem(STORE)) > 1) button.querySelector('span').textContent = 'Продолжить слушать'; } catch { /* */ }
  button.addEventListener('click', start);
  synth.addEventListener?.('voiceschanged', () => { voice = pickVoice() || voice; voiceButton(); });
  window.addEventListener('pagehide', () => synth.cancel());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && playing && wakeLock === null) keepAwake(true); });
}

// --- Готовая запись нейроголосом (tools/make_audio.py) ----------------------------------------------------
// Если у статьи есть запись в assets/audio/, вместо кнопки «Слушать» показывается плеер:
// время, перемотка на 10 секунд, скорость; звучащий абзац подсвечивается; место остановки запоминается;
// на телефоне запись управляется с экрана блокировки.
const AICON = {
  back: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></g><text x="12.4" y="15.3" font-size="7.5" font-weight="700" text-anchor="middle" fill="currentColor" font-family="system-ui, sans-serif">10</text></svg>',
  fwd: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></g><text x="11.6" y="15.3" font-size="7.5" font-weight="700" text-anchor="middle" fill="currentColor" font-family="system-ui, sans-serif">10</text></svg>',
};

function clock(sec) {
  const t = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

function minutesText(sec) {
  const m = Math.max(1, Math.round(sec / 60));
  const f = m % 10 === 1 && m % 100 !== 11 ? 'минута' : (m % 10 >= 2 && m % 10 <= 4 && (m % 100 < 12 || m % 100 > 14) ? 'минуты' : 'минут');
  return `${m} ${f}`;
}

async function audioEntry() {
  const { audio: base, slug } = prose.dataset;
  if (!base || !slug) return null;
  try {
    const res = await fetch(`${base}index.json`);
    if (!res.ok) return null;
    const e = (await res.json())[slug];
    return e && e.d ? { ...e, src: `${base}${slug}.mp3?v=${e.h}` } : null;
  } catch { return null; }
}

function setupAudio(info) {
  const KEY = `audio:${location.pathname}`;
  const audio = new Audio();
  audio.preload = 'none';
  const els = [article.querySelector('.article-title'), ...prose.querySelectorAll('p, h2, h3, li')]
    .filter(speakableBlock);
  const starts = info.s || [];
  const sync = els.length === starts.length;
  let saved = 0;
  try { saved = Number(localStorage.getItem(KEY)) || 0; } catch { /* */ }
  if (saved < 15 || saved > info.d - 15) saved = 0;
  let loaded = false;
  let pending = saved;
  let started = false;
  let dragging = false;
  let lastSave = 0;
  let current = -1;
  let rateIx = 0;
  let mini = null;
  let miniClosed = false;
  let playerVisible = true;

  const player = document.createElement('div');
  player.className = 'audio-player';
  player.setAttribute('role', 'region');
  player.setAttribute('aria-label', 'Аудиоверсия статьи');
  player.innerHTML = `<button class="ap-play" type="button" aria-label="Слушать статью">${ICON.play}</button>`
    + '<p class="ap-title">Слушать статью <span class="ap-sub"></span></p>'
    + '<div class="ap-tools">'
    + `<button type="button" data-a="back" aria-label="Назад на 10 секунд" title="Назад на 10 секунд">${AICON.back}</button>`
    + `<button type="button" data-a="fwd" aria-label="Вперёд на 10 секунд" title="Вперёд на 10 секунд">${AICON.fwd}</button>`
    + '<button type="button" data-a="rate" class="ap-rate" aria-label="Скорость чтения" title="Скорость чтения">1×</button></div>'
    + `<div class="ap-track"><span class="ap-time">${clock(saved)}</span>`
    + `<input class="ap-seek" type="range" min="0" max="${Math.ceil(info.d)}" step="1" value="${Math.floor(saved)}" aria-label="Перемотка записи">`
    + `<span class="ap-dur">${clock(info.d)}</span></div>`;
  const sub = player.querySelector('.ap-sub');
  sub.textContent = saved ? `продолжить с ${clock(saved)}` : `${minutesText(info.d)} · синтезированный голос`;
  const seek = player.querySelector('.ap-seek');
  (article.querySelector('.article-tools') || prose).before(player);

  const now = () => (loaded && audio.readyState > 0 ? audio.currentTime : pending);

  function load() {
    if (loaded) return;
    loaded = true;
    audio.src = info.src;
    audio.playbackRate = RATES[rateIx];
  }

  function setTime(t) {
    const v = Math.max(0, Math.min(info.d, t));
    load();
    if (audio.readyState > 0) audio.currentTime = v; else pending = v;
    render(v);
  }

  function toggle() {
    load();
    if (audio.paused) {
      audio.play().catch(() => notify('Не удалось включить запись. Попробуйте ещё раз.'));
    } else audio.pause();
  }

  function cycleRate() {
    rateIx = (rateIx + 1) % RATES.length;
    audio.playbackRate = RATES[rateIx];
    const label = `${String(RATES[rateIx]).replace('.', ',')}×`;
    for (const b of document.querySelectorAll('.ap-rate, .listen-bar [data-a="rate"]')) b.textContent = label;
  }

  function render(t) {
    const label = clock(t);
    player.querySelector('.ap-time').textContent = label;
    if (!dragging) seek.value = String(Math.floor(t));
    if (mini) mini.querySelector('.listen-time').textContent = `${label} / ${clock(info.d)}`;
    if (sync && started) {
      let i = starts.length - 1;
      while (i > 0 && starts[i] > t + 0.05) i -= 1;
      if (i !== current) { current = i; highlight(els[i]); }
    }
  }

  function icons() {
    const on = !audio.paused;
    const b = player.querySelector('.ap-play');
    b.innerHTML = on ? ICON.pause : ICON.play;
    b.setAttribute('aria-label', on ? 'Пауза' : 'Слушать статью');
    const m = mini?.querySelector('[data-a="toggle"]');
    if (m) { m.innerHTML = on ? ICON.pause : ICON.play; m.setAttribute('aria-label', on ? 'Пауза' : 'Продолжить'); }
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = on ? 'playing' : 'paused';
  }

  function save(force) {
    const t = now();
    if (!force && Math.abs(t - lastSave) < 5) return;
    lastSave = t;
    try {
      if (t > 15 && t < info.d - 15) localStorage.setItem(KEY, String(Math.floor(t)));
      else localStorage.removeItem(KEY);
    } catch { /* */ }
  }

  function updateMini() {
    const want = started && !playerVisible && !miniClosed;
    if (want && !mini) {
      mini = document.createElement('div');
      mini.className = 'listen-bar';
      mini.setAttribute('role', 'region');
      mini.setAttribute('aria-label', 'Аудиоверсия статьи');
      mini.innerHTML = `<button type="button" data-a="back" aria-label="Назад на 10 секунд">${AICON.back}</button>`
        + `<button type="button" data-a="toggle" class="listen-main" aria-label="Пауза">${ICON.pause}</button>`
        + `<button type="button" data-a="fwd" aria-label="Вперёд на 10 секунд">${AICON.fwd}</button>`
        + '<span class="listen-time" aria-hidden="true"></span>'
        + `<button type="button" data-a="rate" class="listen-rate" aria-label="Скорость чтения">${player.querySelector('.ap-rate').textContent}</button>`
        + `<button type="button" data-a="close" aria-label="Скрыть панель">${ICON.close}</button>`;
      mini.addEventListener('click', act);
      document.body.append(mini);
      icons();
      render(now());
    } else if (!want && mini) {
      mini.remove();
      mini = null;
    }
  }

  function act(e) {
    const a = e.target.closest('button')?.dataset.a;
    if (a === 'back') setTime(now() - 10);
    if (a === 'fwd') setTime(now() + 10);
    if (a === 'rate') cycleRate();
    if (a === 'toggle') toggle();
    if (a === 'close') { miniClosed = true; updateMini(); }
  }

  player.querySelector('.ap-play').addEventListener('click', toggle);
  player.querySelector('.ap-tools').addEventListener('click', act);
  seek.addEventListener('input', () => { dragging = true; player.querySelector('.ap-time').textContent = clock(Number(seek.value)); });
  seek.addEventListener('change', () => { dragging = false; setTime(Number(seek.value)); });

  audio.addEventListener('loadedmetadata', () => { if (pending) audio.currentTime = pending; });
  audio.addEventListener('timeupdate', () => { render(audio.currentTime); save(false); });
  audio.addEventListener('play', () => {
    started = true;
    miniClosed = false;
    sub.textContent = `${minutesText(info.d)} · синтезированный голос`;
    icons();
    updateMini();
    if ('mediaSession' in navigator && !navigator.mediaSession.metadata && 'MediaMetadata' in window) {
      const img = document.querySelector('meta[property="og:image"]')?.content;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: article.querySelector('.article-title')?.textContent.trim() || document.title,
        artist: 'Сергей Брык',
        album: 'Христианский монотеизм',
        artwork: img ? [{ src: img, sizes: '1200x630', type: 'image/jpeg' }] : [],
      });
      const handlers = {
        play: () => audio.play(), pause: () => audio.pause(),
        seekbackward: () => setTime(now() - 10), seekforward: () => setTime(now() + 10),
        seekto: (d) => setTime(d.seekTime),
      };
      for (const [k, f] of Object.entries(handlers)) { try { navigator.mediaSession.setActionHandler(k, f); } catch { /* */ } }
    }
  });
  audio.addEventListener('pause', () => { icons(); save(true); });
  audio.addEventListener('ended', () => {
    started = false;
    current = -1;
    highlight(null);
    pending = 0;
    try { localStorage.removeItem(KEY); } catch { /* */ }
    icons();
    updateMini();
  });
  audio.addEventListener('error', () => { if (loaded) notify('Запись сейчас недоступна. Попробуйте позже.'); });
  window.addEventListener('pagehide', () => save(true));

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => { playerVisible = e.isIntersecting; updateMini(); }).observe(player);
  }
}

if (article && prose) {
  for (const ev of ['wheel', 'touchmove', 'keydown']) window.addEventListener(ev, () => { userScrolledAt = Date.now(); }, { passive: true });
  audioEntry().then((info) => { if (info) setupAudio(info); else setupSpeech(); });
}
