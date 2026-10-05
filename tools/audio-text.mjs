// Текст абзацев для озвучки: тот же, что читает кнопка «Слушать» (assets/js/speech-text.js).
// Вход (stdin): [{slug, home, blocks: [сырой текст абзаца, ...]}]
// Выход (stdout): {slug: [[фраза, фраза, ...] для каждого абзаца]}
// Вызывается из tools/make_audio.py.
import { speakable, sentences } from '../assets/js/speech-text.js';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const out = {};
for (const { slug, home, blocks } of JSON.parse(input)) {
  out[slug] = blocks.map((raw) => sentences(speakable(raw, home || null)));
}
process.stdout.write(JSON.stringify(out));
