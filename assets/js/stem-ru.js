// Стеммер для русского языка по алгоритму Snowball (Russian stemmer).
// Отсекает окончания, чтобы «воскресения», «воскресение» и «воскресении»
// совпадали при поиске. Слово должно быть в нижнем регистре, «ё» → «е».

const VOWELS = 'аеиоуыэюя';
const isVowel = (ch) => VOWELS.includes(ch);

const byLength = (list) => [...list].sort((a, b) => b.length - a.length);

const PERFECTIVE_GERUND_1 = byLength(['в', 'вши', 'вшись']); // после а/я
const PERFECTIVE_GERUND_2 = byLength(['ив', 'ивши', 'ившись', 'ыв', 'ывши', 'ывшись']);
const ADJECTIVE = byLength(['ее', 'ие', 'ые', 'ое', 'ими', 'ыми', 'ей', 'ий', 'ый', 'ой', 'ем', 'им', 'ым', 'ом', 'его', 'ого', 'ему', 'ому', 'их', 'ых', 'ую', 'юю', 'ая', 'яя', 'ою', 'ею']);
const PARTICIPLE_1 = byLength(['ем', 'нн', 'вш', 'ющ', 'щ']); // после а/я
const PARTICIPLE_2 = byLength(['ивш', 'ывш', 'ующ']);
const REFLEXIVE = byLength(['ся', 'сь']);
const VERB_1 = byLength(['ла', 'на', 'ете', 'йте', 'ли', 'й', 'л', 'ем', 'н', 'ло', 'но', 'ет', 'ют', 'ны', 'ть', 'ешь', 'нно']); // после а/я
const VERB_2 = byLength(['ила', 'ыла', 'ена', 'ейте', 'уйте', 'ите', 'или', 'ыли', 'ей', 'уй', 'ил', 'ыл', 'им', 'ым', 'ен', 'ило', 'ыло', 'ено', 'ят', 'ует', 'уют', 'ит', 'ыт', 'ены', 'ить', 'ыть', 'ишь', 'ую', 'ю']);
const NOUN = byLength(['а', 'ев', 'ов', 'ие', 'ье', 'е', 'иями', 'ями', 'ами', 'еи', 'ии', 'и', 'ией', 'ей', 'ой', 'ий', 'й', 'иям', 'ям', 'ием', 'ем', 'ам', 'ом', 'о', 'у', 'ах', 'иях', 'ях', 'ы', 'ь', 'ию', 'ью', 'ю', 'ия', 'ья', 'я']);
const SUPERLATIVE = byLength(['ейш', 'ейше']);
const DERIVATIONAL = byLength(['ост', 'ость']);

function regions(word) {
  let rv = word.length;
  for (let i = 0; i < word.length; i += 1) {
    if (isVowel(word[i])) { rv = i + 1; break; }
  }
  // R1 — после первой согласной, следующей за гласной; R2 — то же внутри R1
  const after = (start) => {
    for (let i = start + 1; i < word.length; i += 1) {
      if (!isVowel(word[i]) && isVowel(word[i - 1])) return i + 1;
    }
    return word.length;
  };
  const r1 = after(0);
  const r2 = after(r1);
  return { rv, r2 };
}

// Удалить первое подходящее окончание, лежащее в области [limit..]
function removeEnding(word, limit, endings, needsAYa = false) {
  for (const e of endings) {
    if (!word.endsWith(e)) continue;
    const pos = word.length - e.length;
    if (pos < limit) continue;
    if (needsAYa) {
      const prev = word[pos - 1];
      if (pos - 1 < limit || (prev !== 'а' && prev !== 'я')) continue;
    }
    return word.slice(0, pos);
  }
  return null;
}

function removeAny(word, limit, groups) {
  for (const [endings, needsAYa] of groups) {
    const r = removeEnding(word, limit, endings, needsAYa);
    if (r !== null) return r;
  }
  return null;
}

export function stem(input) {
  let word = input;
  if (word.length < 3) return word;
  const { rv, r2 } = regions(word);
  if (rv >= word.length) return word;

  // Шаг 1
  let r = removeAny(word, rv, [[PERFECTIVE_GERUND_1, true], [PERFECTIVE_GERUND_2, false]]);
  if (r !== null) {
    word = r;
  } else {
    const noReflexive = removeEnding(word, rv, REFLEXIVE);
    if (noReflexive !== null) word = noReflexive;
    const adj = removeEnding(word, rv, ADJECTIVE);
    if (adj !== null) {
      word = adj;
      const part = removeAny(word, rv, [[PARTICIPLE_1, true], [PARTICIPLE_2, false]]);
      if (part !== null) word = part;
    } else {
      r = removeAny(word, rv, [[VERB_1, true], [VERB_2, false]]);
      if (r !== null) word = r;
      else {
        r = removeEnding(word, rv, NOUN);
        if (r !== null) word = r;
      }
    }
  }

  // Шаг 2
  if (word.endsWith('и') && word.length - 1 >= rv) word = word.slice(0, -1);

  // Шаг 3
  r = removeEnding(word, r2, DERIVATIONAL);
  if (r !== null) word = r;

  // Шаг 4
  if (word.endsWith('нн') && word.length - 2 >= rv) {
    word = word.slice(0, -1);
  } else {
    r = removeEnding(word, rv, SUPERLATIVE);
    if (r !== null) {
      word = r;
      if (word.endsWith('нн')) word = word.slice(0, -1);
    } else if (word.endsWith('ь') && word.length - 1 >= rv) {
      word = word.slice(0, -1);
    }
  }
  return word;
}
