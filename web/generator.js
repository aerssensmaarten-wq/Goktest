// Generator van combinatievoorstellen.
//
// Eerlijk vooraf: bij een eerlijke trekking heeft ELKE combinatie exact dezelfde
// kans. Wat statistisch wél kan, is:
//  1. combinaties kiezen die passen bij de patronen die het vaakst voorkomen
//     (som, even/oneven, laag/hoog, spreiding) - zo speel je geen 'rare' combinatie;
//  2. populaire keuzes vermijden (enkel verjaardagen <= 31, rijen, eerdere
//     winnende combinaties) zodat je een jackpot bij winst met minder mensen deelt.
//     Dat verhoogt de verwachte uitbetaling, niet de kans.
import { currentEra } from './stats.js';

export const STRATEGIES = {
  balanced: {
    label: 'Gebalanceerd (aanbevolen)',
    help: 'Volgt de meest voorkomende patronen (som, even/oneven, laag/hoog, spreiding), licht gewogen naar vaak getrokken getallen, en vermijdt populaire combinaties zodat je een eventuele jackpot met minder mensen deelt.',
    detail: [
      'De app kijkt hoe winnende combinaties er doorgaans uitzien en houdt enkel voorstellen over die daarbij passen:',
      '• de som van de getallen ligt in het gebied waar de meeste trekkingen vallen (bv. bij Lotto ongeveer 105 tot 170);',
      '• de verhouding even/oneven en laag/hoog is een van de vaakst voorkomende (bv. 3 oneven + 3 even);',
      '• hoogstens één paar opeenvolgende getallen (zoals 12-13) en niet te veel getallen uit hetzelfde tiental;',
      '• geen combinatie met enkel getallen tot 31: die worden massaal gespeeld als verjaardagen, dus bij winst deel je met veel mensen.',
      'Binnen die regels krijgen vaak getrokken getallen een iets grotere kans. Waarom aanbevolen? Niet omdat je vaker wint, maar omdat je bij winst gemiddeld meer uitbetaald krijgt.',
    ],
  },
  hot: {
    label: 'Warme getallen',
    help: 'Getallen die in de gekozen periode het vaakst getrokken werden krijgen een veel grotere kans.',
    detail: [
      'Elk getal krijgt een gewicht volgens hoe vaak het in de gekozen analyseperiode getrokken werd: hoe vaker, hoe groter de kans dat het in een voorstel komt. De top-10 "Meest getrokken" komt dus vaak terug.',
      'Achterliggend idee: "wat vaak valt, blijft vallen". Bij een eerlijke trekking klopt dat niet, maar het is een populaire manier van spelen.',
    ],
  },
  cold: {
    label: 'Achterstallige getallen',
    help: 'Getallen die al het langst niet meer getrokken werden krijgen een grotere kans ("ze zijn aan de beurt" - let op: een trekking heeft geen geheugen).',
    detail: [
      'Elk getal krijgt een gewicht volgens hoe lang het al niet meer viel, vergeleken met zijn gemiddelde interval. Getallen uit de lijst "Langst niet getrokken" komen dus vaker in je voorstellen.',
      'Achterliggend idee: "dat getal moet nu eens vallen". Dat heet de gokkersdwaling: de ballen weten niet wanneer ze laatst getrokken werden.',
    ],
  },
  mixed: {
    label: 'Mix warm + achterstallig',
    help: 'Ongeveer de helft warme en de helft achterstallige getallen.',
    detail: [
      'De helft van de getallen wordt gekozen zoals bij "Warme getallen", de andere helft zoals bij "Achterstallige getallen". Voor wie beide ideeën wil combineren.',
    ],
  },
  random: {
    label: 'Puur toeval',
    help: 'Elk getal evenveel kans - wiskundig even goed als elke andere methode.',
    detail: [
      'Zoals een Quick Pick aan de kassa: elk getal heeft exact dezelfde kans. Wiskundig is dit even goed als elke andere methode.',
    ],
  },
};

// Cryptografisch sterke uniforme kans in [0, 1).
function rand() {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return a[0] / 2 ** 32;
}

function weightedSample(items, weights, k) {
  const pool = items.slice();
  const w = weights.slice();
  const out = [];
  for (let t = 0; t < k && pool.length; t++) {
    const total = w.reduce((s, x) => s + x, 0);
    let r = rand() * total;
    let i = 0;
    for (; i < pool.length - 1; i++) { r -= w[i]; if (r < 0) break; }
    out.push(pool[i]);
    pool.splice(i, 1); w.splice(i, 1);
  }
  return out;
}

// Gewichten per getal op basis van frequentie-tabel (uit stats.frequencies).
function weightsFor(rows, strategy, numbers) {
  const byN = new Map(rows.map((r) => [r.n, r]));
  return numbers.map((n) => {
    const r = byN.get(n);
    if (!r) return 1;
    const ratio = r.expected > 0 ? r.count / r.expected : 1; // ~1 bij gemiddelde
    const gapRatio = r.avgGap ? r.since / r.avgGap : 1;
    switch (strategy) {
      case 'hot': return Math.max(0.01, ratio) ** 8;
      case 'cold': return Math.max(0.05, gapRatio) ** 2;
      case 'balanced': return Math.max(0.01, ratio) ** 2;
      default: return 1;
    }
  });
}

function range(lo, hi) { const a = []; for (let i = lo; i <= hi; i++) a.push(i); return a; }

// Bouw de patroonvoorwaarden op uit de historische patronen.
export function buildFilters(meta, patterns) {
  const k = meta.mainCount;
  const common = (dist) => {
    // kleinste set waarden die samen >= 70% van de trekkingen dekken
    const total = dist.reduce((s, x) => s + x, 0);
    const order = dist.map((c, i) => [c, i]).sort((a, b) => b[0] - a[0]);
    const keep = new Set();
    let acc = 0;
    for (const [c, i] of order) { keep.add(i); acc += c; if (acc / total >= 0.7) break; }
    return keep;
  };
  return {
    k,
    sumLo: patterns.sum.p25 - (patterns.sum.p25 - patterns.sum.p10) / 2,
    sumHi: patterns.sum.p75 + (patterns.sum.p90 - patterns.sum.p75) / 2,
    odd: common(patterns.odd),
    low: common(patterns.low),
    maxConsec: 1,
    maxDecade: Math.max(2, ...[...common(patterns.decadeMax)]),
  };
}

export function describeCombo(meta, nums) {
  const era = currentEra(meta);
  const half = era.mainMax / 2;
  let consec = 0;
  for (let i = 1; i < nums.length; i++) if (nums[i] === nums[i - 1] + 1) consec++;
  return {
    sum: nums.reduce((s, x) => s + x, 0),
    odd: nums.filter((x) => x % 2).length,
    low: nums.filter((x) => x <= half).length,
    consec,
  };
}

function passes(meta, nums, f) {
  const d = describeCombo(meta, nums);
  if (d.sum < f.sumLo || d.sum > f.sumHi) return false;
  if (!f.odd.has(d.odd) || !f.low.has(d.low)) return false;
  if (d.consec > f.maxConsec) return false;
  const dec = {};
  for (const x of nums) { const b = Math.floor((x - 1) / 10); dec[b] = (dec[b] || 0) + 1; if (dec[b] > f.maxDecade) return false; }
  if (nums.every((x) => x <= 31)) return false;            // verjaardagen: populair
  if (nums.every((x) => x % 10 === nums[0] % 10)) return false; // zelfde eindcijfer
  return true;
}

// ---------------------------------------------------------------- historiek

// Index van alle trekkingen ooit, om snel te zien of (en hoe vaak) een
// voorgestelde combinatie al gevallen is.
export function buildHistory(meta, allDraws) {
  if (meta.key === 'keno') {
    // per trekking een bitmasker (3 x 32 bits) van de getrokken getallen
    const masks = new Uint32Array(allDraws.length * 3);
    allDraws.forEach((d, i) => { for (const n of d.main) masks[i * 3 + (n >> 5)] |= 1 << (n & 31); });
    return { kind: 'subset', masks, dates: allDraws.map((d) => d.date) };
  }
  const map = new Map();
  const withSign = new Map();
  const sep = meta.kind === 'digits' ? '' : '-';
  const add = (m, key, date) => { const h = m.get(key); if (h) { h.count++; h.last = date; } else m.set(key, { count: 1, last: date }); };
  for (const d of allDraws) {
    const key = d.main.join(sep);
    add(map, key, d.date);
    if (d.sign) add(withSign, key + '|' + d.sign, d.date);
  }
  return { kind: 'exact', map, withSign, sep };
}

// Hoe vaak viel deze combinatie al? -> { count, last, countWithSign?, lastWithSign? }
export function lookupHistory(history, s) {
  if (!history) return null;
  if (history.kind === 'subset') {
    const m = [0, 0, 0];
    for (const n of s.main) m[n >> 5] |= 1 << (n & 31);
    m[0] >>>= 0; m[1] >>>= 0; m[2] >>>= 0;
    const { masks, dates } = history;
    let count = 0, last = null;
    for (let i = 0; i < dates.length; i++) {
      if (((masks[i * 3] & m[0]) >>> 0) === m[0] && ((masks[i * 3 + 1] & m[1]) >>> 0) === m[1] && ((masks[i * 3 + 2] & m[2]) >>> 0) === m[2]) {
        count++; last = dates[i];
      }
    }
    return { count, last };
  }
  const key = s.main.join(history.sep);
  const h = history.map.get(key) || { count: 0, last: null };
  const out = { count: h.count, last: h.last };
  if (s.sign) {
    const hs = history.withSign.get(key + '|' + s.sign) || { count: 0, last: null };
    out.countWithSign = hs.count; out.lastWithSign = hs.last;
  }
  return out;
}

// Genereer `count` voorstellen.
// ctx = { meta, draws, mainFreq, extraFreq, patterns, digitPatterns, pick, history }
// opts.avoidPast: enkel combinaties die nog nooit gevallen zijn (indien mogelijk).
export function generate(ctx, strategy, count, opts = {}) {
  const { meta } = ctx;
  const avoidPast = Boolean(opts.avoidPast && ctx.history);
  const out = [];
  const seen = new Set();
  let guard = 0;
  while (out.length < count && guard++ < count * 50) {
    let s, hist;
    for (let attempt = 0; attempt < (avoidPast ? 300 : 1); attempt++) {
      s = meta.kind === 'digits' ? genDigits(ctx, strategy) : genPool(ctx, strategy);
      hist = lookupHistory(ctx.history, s);
      if (!avoidPast || !hist || hist.count === 0) break;
    }
    const key = s.main.join('-') + '|' + (s.extra || []).join('-') + '|' + (s.sign || '');
    if (seen.has(key)) continue;
    seen.add(key);
    s.history = hist;
    s.notFresh = avoidPast && hist && hist.count > 0; // geen nieuwe combinatie gevonden
    out.push(s);
  }
  return out;
}

function genPool(ctx, strategy) {
  const { meta, mainFreq, extraFreq, patterns } = ctx;
  const era = currentEra(meta);
  const k = meta.key === 'keno' ? ctx.pick : meta.mainCount;
  const numbers = range(1, era.mainMax);
  let main;
  if (strategy === 'mixed') {
    const hot = weightedSample(numbers, weightsFor(mainFreq.rows, 'hot', numbers), Math.ceil(k / 2));
    const rest = numbers.filter((n) => !hot.includes(n));
    main = hot.concat(weightedSample(rest, weightsFor(mainFreq.rows, 'cold', rest), k - hot.length));
  } else {
    const w = weightsFor(mainFreq.rows, strategy, numbers);
    if (strategy === 'balanced' && meta.key !== 'keno') {
      const filters = buildFilters(meta, patterns);
      for (let tries = 0; tries < 20000; tries++) {
        const cand = weightedSample(numbers, w, k).sort((a, b) => a - b);
        if (passes(meta, cand, filters)) { main = cand; break; }
      }
    }
    if (!main) main = weightedSample(numbers, w, k);
  }
  main.sort((a, b) => a - b);
  let extra = [];
  if (meta.extraCount && !meta.extraFromMainPool) {
    const ex = range(1, era.extraMax);
    const exStrategy = strategy === 'mixed' ? 'balanced' : strategy;
    extra = weightedSample(ex, weightsFor(extraFreq.rows, exStrategy, ex), meta.extraCount).sort((a, b) => a - b);
  }
  return { main, extra, info: meta.key === 'keno' ? null : describeCombo(meta, main) };
}

function genDigits(ctx, strategy) {
  const { meta, digitPatterns: dp } = ctx;
  const digits = range(0, 9);
  const main = [];
  for (let i = 0; i < meta.mainCount; i++) {
    const counts = dp.pos[i];
    const exp = dp.n / 10;
    let w;
    if (strategy === 'hot') w = counts.map((c) => Math.max(0.01, c / exp) ** 8);
    else if (strategy === 'balanced') w = counts.map((c) => Math.max(0.01, c / exp) ** 2);
    else if (strategy === 'cold') w = counts.map((c) => Math.max(0.01, exp / Math.max(1, c)) ** 4);
    else if (strategy === 'mixed') w = counts.map((c) => (i % 2 ? Math.max(0.01, exp / Math.max(1, c)) ** 4 : Math.max(0.01, c / exp) ** 8));
    else w = digits.map(() => 1);
    main.push(weightedSample(digits, w, 1)[0]);
  }
  if (strategy === 'balanced') {
    // Vermijd populaire cijferreeksen (allemaal gelijk, oplopend/aflopend)
    const allSame = main.every((x) => x === main[0]);
    const run = main.every((x, i) => i === 0 || x === main[i - 1] + 1) || main.every((x, i) => i === 0 || x === main[i - 1] - 1);
    if ((allSame || run) && main.length > 1) return genDigits(ctx, strategy);
  }
  let sign;
  if (meta.hasSign) {
    const names = dp.signs.map((s) => s.sign);
    const exp = dp.n / 12;
    const w = dp.signs.map((s) => strategy === 'random' ? 1 : strategy === 'cold' ? exp / Math.max(1, s.count) : (s.count / exp) ** (strategy === 'hot' ? 8 : 2));
    sign = names.length ? weightedSample(names, w, 1)[0] : undefined;
  }
  return { main, extra: [], sign, info: { sum: main.reduce((s, x) => s + x, 0) } };
}

