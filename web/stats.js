// Statistische analyse van trekkingen. Pure functies, zonder DOM, zodat ze
// zowel in de browser als in Node (tests) gebruikt kunnen worden.

// ---------------------------------------------------------------- helpers

export function binom(n, k) {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
function sd(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
export function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// Overschrijdingskans van een chi-kwadraatverdeling (Wilson-Hilferty benadering).
export function chiSquarePValue(x, df) {
  if (df <= 0) return 1;
  const z = (Math.cbrt(x / df) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df));
  return 1 - normalCdf(z);
}
function normalCdf(z) {
  // Abramowitz & Stegun 26.2.17
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

// ---------------------------------------------------------------- data

// Zet het compacte JSON-formaat om naar objecten.
export function parseDraws(raw) {
  return raw.draws.map(([date, main, extra, sign]) => ({ date, main, extra, sign }));
}

// Het tijdperk (spelformule) dat geldt op een bepaalde datum.
export function eraFor(meta, date) {
  let era = { from: null, mainMax: meta.mainMax, extraMax: meta.extraMax };
  for (const e of meta.eras || []) if (date >= e.from) era = e;
  return era;
}

export function currentEra(meta) {
  const eras = meta.eras || [];
  return eras.length ? eras[eras.length - 1] : { from: null, mainMax: meta.mainMax, extraMax: meta.extraMax };
}

// Periodes waarover geanalyseerd kan worden.
export function periodOptions(meta, draws) {
  const opts = [];
  const era = currentEra(meta);
  if ((meta.eras || []).length > 1) opts.push({ id: 'era', label: `Huidige spelformule (sinds ${fmtDate(era.from)})` });
  opts.push({ id: 'all', label: `Alle trekkingen ooit (sinds ${fmtDate(draws[0]?.date)})` });
  const n = draws.length;
  for (const k of [1000, 500, 100, 50]) if (n > k * 1.5) opts.push({ id: `last${k}`, label: `Laatste ${k} trekkingen` });
  for (const y of [10, 5, 1]) opts.push({ id: `years${y}`, label: y === 1 ? 'Afgelopen jaar' : `Afgelopen ${y} jaar` });
  return opts;
}

export function filterPeriod(meta, draws, periodId) {
  if (periodId === 'era') {
    const era = currentEra(meta);
    return era.from ? draws.filter((d) => d.date >= era.from) : draws;
  }
  let m = /^last(\d+)$/.exec(periodId);
  if (m) return draws.slice(-Number(m[1]));
  m = /^years(\d+)$/.exec(periodId);
  if (m && draws.length) {
    const last = new Date(draws[draws.length - 1].date + 'T00:00:00Z');
    last.setUTCFullYear(last.getUTCFullYear() - Number(m[1]));
    const from = last.toISOString().slice(0, 10);
    return draws.filter((d) => d.date > from);
  }
  return draws;
}

export function fmtDate(iso) {
  if (!iso) return '?';
  const [y, mo, d] = iso.split('-');
  return `${d}/${mo}/${y}`;
}

// ---------------------------------------------------------------- frequenties

// Tel hoe vaak elk getal voorkomt. `field` = 'main' of 'extra'.
// Houdt rekening met wisselende spelformules: per getal wordt ook bijgehouden in
// hoeveel trekkingen het getal überhaupt getrokken *kon* worden.
export function frequencies(meta, draws, field, lo, hi) {
  const count = new Array(hi + 1).fill(0);
  const eligible = new Array(hi + 1).fill(0);
  const lastSeen = new Array(hi + 1).fill(-1);
  const gapsSum = new Array(hi + 1).fill(0);
  const gapsN = new Array(hi + 1).fill(0);
  const maxGap = new Array(hi + 1).fill(0);
  const perDraw = field === 'main' ? meta.mainCount : meta.extraCount;
  let expected = new Array(hi + 1).fill(0);
  draws.forEach((d, idx) => {
    const era = meta.kind === 'pool' ? eraFor(meta, d.date) : { mainMax: hi, extraMax: hi };
    const poolMax = Math.min(hi, field === 'main' ? era.mainMax : era.extraMax || hi);
    const poolSize = poolMax - lo + 1;
    for (let n = lo; n <= poolMax; n++) {
      eligible[n]++;
      expected[n] += perDraw / poolSize;
    }
    for (const n of d[field]) {
      if (n < lo || n > hi) continue;
      count[n]++;
      if (lastSeen[n] >= 0) {
        const g = idx - lastSeen[n];
        gapsSum[n] += g; gapsN[n]++;
        if (g > maxGap[n]) maxGap[n] = g;
      }
      lastSeen[n] = idx;
    }
  });
  const total = draws.length;
  const rows = [];
  for (let n = lo; n <= hi; n++) {
    if (!eligible[n]) continue;
    const since = lastSeen[n] >= 0 ? total - 1 - lastSeen[n] : total;
    rows.push({
      n,
      count: count[n],
      expected: expected[n],
      deviation: expected[n] ? (count[n] - expected[n]) / expected[n] : 0,
      pct: total ? count[n] / total : 0,
      since,
      avgGap: gapsN[n] ? gapsSum[n] / gapsN[n] : null,
      maxGap: Math.max(maxGap[n], since),
      lastDate: lastSeen[n] >= 0 ? draws[lastSeen[n]].date : null,
    });
  }
  // Chi-kwadraattoets: wijken de tellingen meer af dan toeval verklaart?
  let chi = 0;
  for (const r of rows) if (r.expected > 0) chi += (r.count - r.expected) ** 2 / r.expected;
  const df = rows.length - 1;
  return { rows, chi, df, p: chiSquarePValue(chi, df), total };
}

// ---------------------------------------------------------------- patronen (pool-spellen)

export function poolPatterns(meta, draws) {
  const k = meta.mainCount;
  const sums = [];
  const odd = new Array(k + 1).fill(0);
  const low = new Array(k + 1).fill(0);
  const consec = new Array(k).fill(0);     // aantal opeenvolgende paren per trekking
  const repeats = new Array(k + 1).fill(0); // getallen herhaald uit vorige trekking
  const spread = [];                        // grootste - kleinste
  const endDigits = new Array(10).fill(0);
  const decadeMax = new Array(k + 1).fill(0); // max aantal getallen in hetzelfde tiental
  let birthdayOnly = 0;
  let prev = null;
  for (const d of draws) {
    const era = eraFor(meta, d.date);
    const m = d.main;
    const half = era.mainMax / 2;
    sums.push(m.reduce((s, x) => s + x, 0));
    odd[m.filter((x) => x % 2).length]++;
    low[m.filter((x) => x <= half).length]++;
    let c = 0;
    for (let i = 1; i < m.length; i++) if (m[i] === m[i - 1] + 1) c++;
    consec[Math.min(c, k - 1)]++;
    if (prev) repeats[m.filter((x) => prev.has(x)).length]++;
    prev = new Set(m);
    spread.push(m[m.length - 1] - m[0]);
    for (const x of m) endDigits[x % 10]++;
    const dec = {};
    for (const x of m) dec[Math.floor((x - 1) / 10)] = (dec[Math.floor((x - 1) / 10)] || 0) + 1;
    decadeMax[Math.max(...Object.values(dec))]++;
    if (m.every((x) => x <= 31)) birthdayOnly++;
  }
  const sorted = [...sums].sort((a, b) => a - b);
  return {
    n: draws.length,
    sum: {
      mean: mean(sums), sd: sd(sums), min: sorted[0], max: sorted[sorted.length - 1],
      p10: quantile(sorted, 0.1), p25: quantile(sorted, 0.25), median: quantile(sorted, 0.5),
      p75: quantile(sorted, 0.75), p90: quantile(sorted, 0.9), values: sums,
    },
    odd, low, consec, repeats, endDigits, decadeMax, birthdayOnly,
    spread: { mean: mean(spread), median: quantile([...spread].sort((a, b) => a - b), 0.5) },
  };
}

// Meest voorkomende paren en drietallen.
export function topCombos(draws, maxN, size, limit = 10) {
  const N = maxN + 1;
  if (size === 2) {
    const c = new Uint32Array(N * N);
    for (const d of draws) {
      const m = d.main;
      for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) c[m[i] * N + m[j]]++;
    }
    return topFromArray(c, limit, (idx) => [Math.floor(idx / N), idx % N]);
  }
  const c = new Uint32Array(N * N * N);
  for (const d of draws) {
    const m = d.main;
    for (let i = 0; i < m.length; i++)
      for (let j = i + 1; j < m.length; j++)
        for (let l = j + 1; l < m.length; l++) c[(m[i] * N + m[j]) * N + m[l]]++;
  }
  return topFromArray(c, limit, (idx) => [Math.floor(idx / (N * N)), Math.floor(idx / N) % N, idx % N]);
}

function topFromArray(arr, limit, decode) {
  const best = []; // [count, idx], klein gehouden
  let floor = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v === 0 || (best.length >= limit && v <= floor)) continue;
    best.push([v, i]);
    best.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    if (best.length > limit) best.pop();
    floor = best[best.length - 1][0];
  }
  return best.map(([count, idx]) => ({ nums: decode(idx), count }));
}

// ---------------------------------------------------------------- patronen (cijferspellen)

export function digitPatterns(meta, draws) {
  const k = meta.mainCount;
  const pos = Array.from({ length: k }, () => new Array(10).fill(0));
  const sums = [];
  const distinct = new Array(k + 1).fill(0);
  const combos = new Map();
  const signs = new Map();
  for (const d of draws) {
    d.main.forEach((x, i) => pos[i][x]++);
    sums.push(d.main.reduce((s, x) => s + x, 0));
    distinct[new Set(d.main).size]++;
    const key = d.main.join('');
    combos.set(key, (combos.get(key) || 0) + 1);
    if (d.sign) signs.set(d.sign, (signs.get(d.sign) || 0) + 1);
  }
  const sorted = [...sums].sort((a, b) => a - b);
  const topCombosList = [...combos.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10)
    .map(([c, n]) => ({ combo: c, count: n }));
  // Kans op aantal verschillende cijfers bij puur toeval (ter vergelijking)
  const expectedDistinct = distinctProbabilities(k).map((p) => p * draws.length);
  return {
    n: draws.length, pos, distinct, expectedDistinct,
    sum: { mean: mean(sums), sd: sd(sums), p25: quantile(sorted, 0.25), median: quantile(sorted, 0.5), p75: quantile(sorted, 0.75), values: sums },
    topCombos: topCombosList,
    uniqueCombos: combos.size,
    signs: [...signs.entries()].sort((a, b) => b[1] - a[1]).map(([sign, count]) => ({ sign, count })),
  };
}

// P(precies j verschillende cijfers in k onafhankelijke cijfers 0-9)
export function distinctProbabilities(k) {
  // Stirling-getallen van de tweede soort
  const S = Array.from({ length: k + 1 }, () => new Array(k + 1).fill(0));
  S[0][0] = 1;
  for (let n = 1; n <= k; n++) for (let j = 1; j <= n; j++) S[n][j] = j * S[n - 1][j] + S[n - 1][j - 1];
  const out = new Array(k + 1).fill(0);
  for (let j = 1; j <= k; j++) {
    let falling = 1;
    for (let i = 0; i < j; i++) falling *= 10 - i;
    out[j] = (S[k][j] * falling) / 10 ** k;
  }
  return out;
}

// ---------------------------------------------------------------- winkansen

export function jackpotOdds(meta, pick) {
  const era = currentEra(meta);
  if (meta.key === 'keno') {
    const k = pick || meta.pickCount;
    return binom(meta.mainCount, k) / binom(era.mainMax, k); // alle k gekozen getallen juist
  }
  if (meta.kind === 'digits') return 1 / (10 ** meta.mainCount * (meta.hasSign ? 12 : 1));
  let combos = binom(era.mainMax, meta.mainCount);
  if (meta.extraCount && !meta.extraFromMainPool) combos *= binom(era.extraMax, meta.extraCount);
  return 1 / combos;
}

export function fmtOdds(p) {
  if (!p) return '-';
  const inv = Math.round(1 / p);
  return `1 op ${inv.toLocaleString('nl-BE')}`;
}
