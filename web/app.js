import { el, clear, nf, pf, df1 } from './dom.js';
import { barChart, heatGrid, hideTip } from './charts.js';
import * as S from './stats.js';
import { STRATEGIES, generate, buildHistory } from './generator.js';

const DATA = '../data';
const state = { index: null, cache: new Map(), history: new Map(), game: null, period: null, strategy: 'balanced', count: 5, pick: 10, avoidPast: loadPref('avoidPast', true) };

// Voorkeuren onthouden op dit toestel (werkt ook zonder, bv. in privévenster).
function loadPref(key, fallback) {
  try { const v = localStorage.getItem(`pref.${key}`); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
}
function savePref(key, value) {
  try { localStorage.setItem(`pref.${key}`, JSON.stringify(value)); } catch { /* geen opslag beschikbaar */ }
}
const $app = document.getElementById('app');
const $tabs = document.getElementById('tabs');
const $updated = document.getElementById('updated');

// ------------------------------------------------------------ laden

async function getJSON(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

async function loadGame(key) {
  if (!state.cache.has(key)) {
    const raw = await getJSON(`${DATA}/json/${encodeURIComponent(key)}.json`);
    state.cache.set(key, S.parseDraws(raw));
  }
  return state.cache.get(key);
}

async function init() {
  try {
    state.index = await getJSON(`${DATA}/json/index.json`);
    try { state.jackpots = (await getJSON(`${DATA}/json/jackpots.json`)).games || {}; } catch { state.jackpots = {}; }
  } catch (e) {
    $app.replaceChildren(el('div', { class: 'card error' },
      el('h2', { text: 'Gegevens niet gevonden' }),
      el('p', { text: 'Start de app via "python -m lottery serve" in de projectmap, en haal eerst de resultaten op met "python -m lottery full".' }),
      el('p', { class: 'muted', text: String(e.message) })));
    return;
  }
  $updated.textContent = `Bijgewerkt t.e.m. de trekking van ${S.fmtDate(state.index.lastDraw)}`;
  const games = state.index.games.filter((g) => g.count > 0);
  for (const g of games) {
    $tabs.appendChild(el('a', { href: `#${g.key}`, class: 'tab', 'data-key': g.key, text: g.name }));
  }
  $tabs.appendChild(el('a', { href: '#data', class: 'tab', 'data-key': 'data', text: 'Databestanden' }));
  window.addEventListener('hashchange', route);
  route();
  prefetchForOffline(games);
}

function route() {
  hideTip();
  const key = decodeURIComponent(location.hash.slice(1)) || state.index.games.find((g) => g.count)?.key;
  for (const t of $tabs.children) t.setAttribute('aria-current', t.dataset.key === key ? 'page' : 'false');
  if (key === 'data') return renderData();
  const meta = state.index.games.find((g) => g.key === key);
  if (!meta) { location.hash = state.index.games[0].key; return; }
  if (state.game !== key) { state.game = key; state.period = null; state.pick = meta.pickCount || 10; }
  renderGame(meta);
}

// ------------------------------------------------------------ bouwstenen

function balls(nums, cls = '') { return el('span', { class: 'balls' }, nums.map((n) => el('span', { class: `ball ${cls}`, text: String(n) }))); }

function drawBalls(meta, d) {
  const parts = [balls(d.main, meta.kind === 'digits' ? 'digit' : '')];
  if (d.extra && d.extra.length) parts.push(el('span', { class: 'plus', 'aria-hidden': 'true', text: '+' }), balls(d.extra, 'extra'));
  if (d.sign) parts.push(el('span', { class: 'sign', text: d.sign }));
  return el('span', { class: 'draw' }, parts);
}

function card(title, ...body) { return el('section', { class: 'card' }, title ? el('h3', { text: title }) : null, ...body); }
function stat(label, value, sub) {
  return el('div', { class: 'stat' }, el('div', { class: 'stat-label', text: label }), el('div', { class: 'stat-value', text: value }), sub ? el('div', { class: 'stat-sub', text: sub }) : null);
}
function table(headers, rows, opts = {}) {
  return el('div', { class: 'table-wrap' }, el('table', { class: opts.class || '' },
    el('thead', {}, el('tr', {}, headers.map((h) => el('th', { scope: 'col', text: h })))),
    el('tbody', {}, rows.map((r) => el('tr', {}, r.map((c) => el('td', {}, c)))))));
}
function details(summary, ...body) { return el('details', { class: 'more' }, el('summary', { text: summary }), ...body); }

function distChart(dist, labelFn, n, title, expected) {
  const data = dist.map((c, i) => ({ label: labelFn(i), value: c, tip: [`${title}: ${labelFn(i)}`, `${nf.format(c)} trekkingen (${pf.format(n ? c / n : 0)})`, ...(expected ? [`verwacht bij toeval: ${pf.format(expected[i] / n)}`] : [])] }))
    .filter((d, i) => d.value > 0 || (expected && expected[i] > 0.5));
  return barChart(data, { title, height: 180 });
}

// ------------------------------------------------------------ spelpagina

async function renderGame(meta) {
  $app.replaceChildren(el('p', { class: 'muted', text: `${meta.name} laden…` }));
  const all = await loadGame(meta.key);
  if (state.game !== meta.key) return;
  const periods = S.periodOptions(meta, all);
  if (!state.period || !periods.some((p) => p.id === state.period)) state.period = periods[0].id;
  const draws = S.filterPeriod(meta, all, state.period);
  const era = S.currentEra(meta);
  const last = all[all.length - 1];

  // berekeningen
  const ctx = { meta, draws, pick: state.pick };
  const isPool = meta.kind === 'pool';
  if (!state.history.has(meta.key)) state.history.set(meta.key, buildHistory(meta, all));
  ctx.history = state.history.get(meta.key);
  if (isPool) {
    ctx.mainFreq = S.frequencies(meta, draws, 'main', 1, era.mainMax);
    if (meta.extraCount) ctx.extraFreq = S.frequencies(meta, draws, 'extra', 1, meta.extraFromMainPool ? era.mainMax : era.extraMax);
    ctx.patterns = S.poolPatterns(meta, draws);
  } else {
    ctx.digitPatterns = S.digitPatterns(meta, draws);
  }

  const periodSelect = el('select', { id: 'period', onchange: (e) => { state.period = e.target.value; renderGame(meta); } },
    periods.map((p) => el('option', { value: p.id, selected: p.id === state.period ? 'selected' : null, text: p.label })));

  const head = el('div', { class: 'game-head' },
    el('div', {}, el('h2', { text: meta.name }), el('p', { class: 'muted', text: `${meta.description} Trekkingen: ${meta.drawDays}.` })),
    el('label', { class: 'field' }, el('span', { text: 'Analyseperiode' }), periodSelect));

  const odds = S.jackpotOdds(meta, state.pick);
  const stats = el('div', { class: 'stats' },
    stat('Laatste trekking', S.fmtDate(last.date)),
    stat('Trekkingen in analyse', nf.format(draws.length), `van ${nf.format(all.length)} in totaal`),
    stat(meta.key === 'keno' ? `Kans op ${state.pick}/${state.pick} juist` : 'Kans op de hoofdprijs', S.fmtOdds(odds)),
    jackpotStat(meta),
    isPool ? stat('Toevalstoets', ctx.mainFreq.p < 0.01 ? 'Opvallend' : 'Niets opvallends', ctx.mainFreq.p < 0.01 ? 'meer verschil dan toeval verklaart' : 'verschillen zijn gewoon toeval') : stat('Unieke combinaties', nf.format(ctx.digitPatterns.uniqueCombos)));
  const explain = details('Wat betekenen deze cijfers?', ...explainStats(meta, ctx, odds));

  const lastCard = card('Laatste uitslag', el('div', { class: 'last-draw' }, el('span', { class: 'muted', text: S.fmtDate(last.date) }), drawBalls(meta, last)));

  $app.replaceChildren(head, stats, explain, lastCard, renderGenerator(meta, ctx),
    ...(isPool ? renderPool(meta, ctx) : renderDigits(meta, ctx)),
    renderHistory(meta, all));
}

// ------------------------------------------------------------ jackpot + uitleg

const eur = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
function fmtMoney(v) {
  if (v >= 1e6) return `€ ${df1.format(v / 1e6)} miljoen`;
  return eur.format(v);
}
function weekday(iso) {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('nl-BE', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
}

function jackpotStat(meta) {
  const j = (state.jackpots || {})[meta.key];
  if (!j) return null;
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = j.nextDraw && j.nextDraw >= today;
  if (meta.key === 'eurodreams') {
    return stat('Hoofdprijs', '€ 20.000 per maand', `gedurende 30 jaar${upcoming ? ` · trekking ${weekday(j.nextDraw)}` : ''}`);
  }
  if (upcoming && j.nextJackpot) return stat('Jackpot volgende trekking', fmtMoney(j.nextJackpot), weekday(j.nextDraw));
  if (j.lastJackpot) {
    return stat('Jackpot volgende trekking', 'Nog niet bekend',
      `vorige: ${fmtMoney(j.lastJackpot)} (${S.fmtDate(j.lastDraw).slice(0, 5)})`);
  }
  return null;
}

function explainStats(meta, ctx, odds) {
  const out = [];
  out.push(el('p', {}, el('strong', { text: 'Kans op de hoofdprijs: ' }),
    `met één rooster win je gemiddeld één keer op ${nf.format(Math.round(1 / odds))} trekkingen de hoofdprijs. Elke combinatie heeft precies die kans, welke methode je ook gebruikt.`));
  if (state.jackpots?.[meta.key]) {
    out.push(el('p', {}, el('strong', { text: 'Jackpot: ' }),
      meta.key === 'eurodreams'
        ? 'EuroDreams heeft geen opbouwende jackpot: de hoofdprijs is altijd € 20.000 per maand gedurende 30 jaar.'
        : 'het geraamde bedrag voor de volgende trekking, zoals gepubliceerd door lotteryguru.com. Is de raming nog niet bekend, dan zie je de jackpot van de vorige trekking; werd die niet gewonnen, dan wordt de volgende hoger.'));
  }
  if (ctx.mainFreq) {
    const F = ctx.mainFreq;
    out.push(el('p', {}, el('strong', { text: 'Toevalstoets: ' }),
      'sommige getallen zijn vaker getrokken dan andere. De vraag is: zijn die verschillen groter dan je bij puur toeval zou verwachten? ' +
      'Ook bij een perfect eerlijke trekking valt niet elk getal even vaak, net zoals 100 keer een munt opgooien zelden precies 50 keer kop geeft. ' +
      'De chi-kwadraattoets meet dat. ',
      el('em', { text: '"Niets opvallends"' }),
      ` betekent: de verschillen zijn zo klein dat ze gewoon door toeval komen, dus de "warme" getallen hebben geen echte voorsprong. (Technisch: p = ${F.p.toFixed(2).replace('.', ',')}; pas onder 0,01 zou het opvallend zijn.) `,
      el('em', { text: '"Opvallend"' }),
      ' zou betekenen dat er iets meer speelt dan toeval, bijvoorbeeld een wijziging van de spelregels binnen de gekozen periode.'));
  }
  return out;
}

// ------------------------------------------------------------ generator

function renderGenerator(meta, ctx) {
  const results = el('div', { class: 'suggestions', 'aria-live': 'polite' });
  const help = el('p', { class: 'muted small', text: STRATEGIES[state.strategy].help });
  const run = () => {
    const out = generate({ ...ctx, pick: state.pick }, state.strategy, state.count, { avoidPast: state.avoidPast });
    clear(results);
    out.forEach((s, i) => {
      const info = [];
      if (s.info && meta.kind === 'pool') info.push(`som ${s.info.sum}`, `${s.info.odd} oneven / ${s.main.length - s.info.odd} even`, `${s.info.low} laag / ${s.main.length - s.info.low} hoog`);
      if (s.info && meta.kind === 'digits') info.push(`som ${s.info.sum}`);
      const text = s.main.join(meta.kind === 'digits' ? '' : ' ') + (s.extra.length ? ` + ${s.extra.join(' ')}` : '') + (s.sign ? ` ${s.sign}` : '');
      results.appendChild(el('div', { class: 'suggestion' },
        el('span', { class: 'idx', text: `${i + 1}.` }), drawBalls(meta, s),
        el('span', { class: 'muted small', text: info.join(' · ') }),
        historyBadge(meta, s),
        el('button', { class: 'ghost small', type: 'button', 'aria-label': `Kopieer voorstel ${i + 1}`, onclick: (e) => copy(text, e.currentTarget) }, 'Kopieer')));
    });
  };
  const strategy = el('select', { onchange: (e) => { state.strategy = e.target.value; help.textContent = STRATEGIES[state.strategy].help; run(); } },
    Object.entries(STRATEGIES).map(([k, v]) => el('option', { value: k, selected: k === state.strategy ? 'selected' : null, text: v.label })));
  const count = el('input', { type: 'number', min: '1', max: '50', value: String(state.count), inputmode: 'numeric', onchange: (e) => { state.count = clamp(parseInt(e.target.value, 10) || 1, 1, 50); e.target.value = state.count; run(); } });
  const controls = [
    el('label', { class: 'field' }, el('span', { text: 'Methode' }), strategy),
    el('label', { class: 'field narrow' }, el('span', { text: 'Aantal voorstellen' }), count),
  ];
  if (meta.key === 'keno') {
    controls.push(el('label', { class: 'field narrow' }, el('span', { text: 'Getallen per rooster' }),
      el('select', { onchange: (e) => { state.pick = Number(e.target.value); renderGame(meta); } },
        Array.from({ length: meta.pickMax - meta.pickMin + 1 }, (_, i) => meta.pickMin + i)
          .map((k) => el('option', { value: String(k), selected: k === state.pick ? 'selected' : null, text: String(k) })))));
  }
  controls.push(el('button', { type: 'button', class: 'primary', onclick: run }, 'Genereer voorstellen'));
  const toggle = el('label', { class: 'switch' },
    el('input', { type: 'checkbox', role: 'switch', checked: state.avoidPast ? 'checked' : null,
      onchange: (e) => { state.avoidPast = e.target.checked; savePref('avoidPast', state.avoidPast); run(); } }),
    el('span', { class: 'switch-track', 'aria-hidden': 'true' }),
    el('span', { text: meta.key === 'keno' ? 'Enkel getallen die nog nooit samen getrokken werden' : 'Enkel combinaties die nog nooit gevallen zijn' }));
  const box = card('Voorstellen voor je volgende rooster',
    el('div', { class: 'controls' }, controls), toggle, help,
    details('Hoe werken de methodes?', ...Object.values(STRATEGIES).map((st) =>
      el('div', { class: 'method' }, el('h4', { text: st.label }), ...st.detail.map((line) => el('p', { text: line })))),
      el('div', { class: 'method' }, el('h4', { text: 'Schakelaar "nog nooit gevallen"' }),
        el('p', { text: 'Staat hij aan, dan krijg je enkel combinaties die in de hele geschiedenis van het spel nog nooit getrokken werden (bij Keno: getallen die nog nooit allemaal samen vielen). Een oude winnende combinatie heeft evenveel kans als elke andere, maar sommige mensen spelen die bewust opnieuw - bij winst deel je dan.' }),
        el('p', { text: 'Onder elk voorstel zie je hoe vaak die combinatie al viel en wanneer laatst. Bij Pick3 zijn bijna alle 1.000 combinaties al eens gevallen; dan meldt de app dat een nieuwe niet mogelijk is.' }))),
    results,
    el('p', { class: 'note', text: 'Eerlijk is eerlijk: elke combinatie heeft bij een eerlijke trekking exact dezelfde kans. De gebalanceerde methode kiest combinaties met de meest voorkomende patronen en vermijdt populaire keuzes (enkel verjaardagen, rijtjes). Met de schakelaar sluit je bovendien combinaties uit die al eens gevallen zijn: sommige spelers spelen die bewust opnieuw. Dat verhoogt niet je kans, maar wel je verwachte uitbetaling: win je, dan deel je de pot met minder mensen.' }));
  queueMicrotask(run);
  return box;
}

function historyBadge(meta, s) {
  const h = s.history;
  if (!h) return null;
  const when = (n, last) => `${n}× · laatst op ${S.fmtDate(last)}`;
  let text;
  if (meta.key === 'keno') {
    text = h.count ? `Al ${when(h.count, h.last)} samen getrokken` : 'Nog nooit samen getrokken';
  } else if (meta.hasSign) {
    text = h.count ? `Cijfers vielen al ${when(h.count, h.last)}` : 'Cijfers nog nooit gevallen';
    if (h.count) text += h.countWithSign ? ` (met dit sterrenbeeld ${h.countWithSign}×)` : ' (nooit met dit sterrenbeeld)';
  } else {
    text = h.count ? `Viel al ${when(h.count, h.last)}` : 'Nog nooit gevallen';
  }
  const fresh = h.count === 0;
  return el('span', { class: `badge ${fresh ? 'fresh' : 'seen'}`, title: s.notFresh ? 'Er werd geen combinatie gevonden die nog nooit viel: bij dit spel zijn bijna alle combinaties al eens getrokken.' : null },
    el('span', { 'aria-hidden': 'true', text: fresh ? '✓ ' : '↻ ' }), text,
    s.notFresh ? el('span', { text: ' - geen nieuwe combinatie mogelijk' }) : null);
}

async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); btn.textContent = 'Gekopieerd'; }
  catch { btn.textContent = 'Niet gelukt'; }
  setTimeout(() => { btn.textContent = 'Kopieer'; }, 1500);
}
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// ------------------------------------------------------------ pool-spellen

function freqList(rows, total, key, dir, n, valueFn) {
  const sorted = [...rows].sort((a, b) => dir * (a[key] - b[key]) || a.n - b.n).slice(0, n);
  return el('ol', { class: 'rank' }, sorted.map((r) => el('li', {}, el('span', { class: 'ball sm', text: String(r.n) }), el('span', { text: valueFn(r) }))));
}

function renderPool(meta, ctx) {
  const { mainFreq: F, patterns: P, draws } = ctx;
  const n = draws.length;
  const keno = meta.key === 'keno';
  const out = [];
  const cnt = (r) => `${nf.format(r.count)}× (${pf.format(r.pct)})`;

  out.push(el('div', { class: 'grid3' },
    card('Meest getrokken', freqList(F.rows, n, 'count', -1, 10, cnt)),
    card('Minst getrokken', freqList(F.rows, n, 'count', 1, 10, cnt)),
    card('Langst niet getrokken', freqList(F.rows, n, 'since', -1, 10, (r) => `${r.since} trekkingen${r.avgGap ? ` (gem. ${df1.format(r.avgGap)})` : ''}`))));

  const freqRows = F.rows.map((r) => ({ label: String(r.n), value: r.count, tip: [`Getal ${r.n}`, `${nf.format(r.count)} keer (${pf.format(r.pct)})`, `afwijking t.o.v. toeval: ${r.deviation >= 0 ? '+' : ''}${pf.format(r.deviation)}`, `laatst: ${S.fmtDate(r.lastDate)} (${r.since} trekkingen geleden)`] }));
  const avgExpected = F.rows.reduce((s, r) => s + r.expected, 0) / F.rows.length;
  out.push(card('Hoe vaak werd elk getal getrokken?',
    heatGrid(F.rows, { cols: 10 }),
    details('Toon als staafdiagram', barChart(freqRows, { expected: avgExpected, title: 'Frequentie per getal' })),
    details('Toon volledige tabel', table(['Getal', 'Aantal', '%', 'Verwacht', 'Afwijking', 'Laatst getrokken', 'Trekkingen geleden', 'Gem. interval', 'Langste interval'],
      F.rows.map((r) => [String(r.n), nf.format(r.count), pf.format(r.pct), nf.format(Math.round(r.expected)), `${r.deviation >= 0 ? '+' : ''}${pf.format(r.deviation)}`, S.fmtDate(r.lastDate), String(r.since), r.avgGap ? df1.format(r.avgGap) : '-', String(r.maxGap)]), { class: 'num' })),
    el('p', { class: 'note', text: `Chi-kwadraattoets: χ² = ${df1.format(F.chi)} bij ${F.df} vrijheidsgraden, p = ${F.p.toFixed(3)}. ${F.p < 0.01 ? 'De verschillen zijn groter dan je bij puur toeval zou verwachten - mogelijk door formulewijzigingen in de gekozen periode.' : 'Niets opvallends: de verschillen tussen "warme" en "koude" getallen zijn volledig te verklaren door toeval.'}` })));

  if (meta.extraCount && ctx.extraFreq) {
    const E = ctx.extraFreq;
    out.push(card(`${meta.extraName}: frequentie`,
      barChart(E.rows.map((r) => ({ label: String(r.n), value: r.count, tip: [`${meta.extraName} ${r.n}`, `${nf.format(r.count)} keer (${pf.format(r.pct)})`, `${r.since} trekkingen geleden`] })), { expected: E.rows.reduce((s, r) => s + r.expected, 0) / E.rows.length, title: meta.extraName, height: 180 }),
      el('div', { class: 'grid2' },
        el('div', {}, el('h4', { text: 'Meest' }), freqList(E.rows, n, 'count', -1, 5, cnt)),
        el('div', {}, el('h4', { text: 'Langst niet' }), freqList(E.rows, n, 'since', -1, 5, (r) => `${r.since} trekkingen`)))));
  }

  // patronen
  const k = meta.mainCount;
  const sumHist = histogram(P.sum.values, keno ? 40 : 25);
  out.push(el('h2', { class: 'section', text: 'Patronen' }));
  out.push(el('div', { class: 'grid2' },
    card('Som van de getallen',
      el('p', { class: 'muted small', text: `Gemiddeld ${df1.format(P.sum.mean)} · de middelste 50% ligt tussen ${Math.round(P.sum.p25)} en ${Math.round(P.sum.p75)} · min ${P.sum.min}, max ${P.sum.max}` }),
      barChart(sumHist.map((b) => ({ label: String(b.from), value: b.count, tip: [`som ${b.from}-${b.to}`, `${nf.format(b.count)} trekkingen (${pf.format(b.count / n)})`] })), { title: 'Verdeling van de som', height: 180 })),
    card('Aantal oneven getallen per trekking',
      distChart(P.odd, (i) => String(i), n, 'Aantal oneven getallen', expectedOdd(meta, k, n)),
      el('p', { class: 'muted small', text: `Meest voorkomend: ${argmax(P.odd)} oneven en ${k - argmax(P.odd)} even (${pf.format(Math.max(...P.odd) / n)}).` })),
    card('Aantal lage getallen per trekking',
      distChart(P.low, (i) => String(i), n, 'Aantal lage getallen'),
      el('p', { class: 'muted small', text: `"Laag" = in de onderste helft van de getallen. Meest voorkomend: ${argmax(P.low)} laag / ${k - argmax(P.low)} hoog.` })),
    card('Aantal opeenvolgende paren per trekking',
      distChart(P.consec, (i) => String(i), n, 'Aantal opeenvolgende paren'),
      el('p', { class: 'muted small', text: `In ${pf.format(1 - P.consec[0] / n)} van de trekkingen zat minstens één paar opeenvolgende getallen (bv. 12-13).` })),
    card('Aantal getallen herhaald uit de vorige trekking',
      distChart(P.repeats, (i) => `${i}`, n - 1, 'Getallen herhaald uit vorige trekking'),
      el('p', { class: 'muted small', text: `In ${pf.format(1 - P.repeats[0] / Math.max(1, n - 1))} van de trekkingen kwam minstens één getal van de vorige trekking terug.` })),
    card('Eindcijfers',
      barChart(P.endDigits.map((c, i) => ({ label: String(i), value: c, tip: [`eindigend op ${i}`, `${nf.format(c)} keer`] })), { title: 'Eindcijfers', height: 180 }),
      keno ? null : el('p', { class: 'muted small', text: `Slechts ${pf.format(P.birthdayOnly / n)} van de trekkingen bestond enkel uit getallen ≤ 31 ("verjaardagen"), terwijl veel spelers net die kiezen.` }))));

  const pairs = S.topCombos(draws, S.currentEra(meta).mainMax, 2, 10);
  const triples = S.topCombos(draws, S.currentEra(meta).mainMax, 3, 10);
  out.push(el('div', { class: 'grid2' },
    card('Vaakst samen getrokken: paren', table(['Paar', 'Keer'], pairs.map((p) => [balls(p.nums, 'sm'), nf.format(p.count)]))),
    card('Vaakst samen getrokken: drietallen', table(['Drietal', 'Keer'], triples.map((p) => [balls(p.nums, 'sm'), nf.format(p.count)])))));
  return out;
}

function expectedOdd(meta, k, n) {
  // hypergeometrisch: aantal oneven bij k getallen uit 1..N
  const N = S.currentEra(meta).mainMax;
  const odd = Math.ceil(N / 2), even = N - odd;
  const tot = S.binom(N, k);
  return Array.from({ length: k + 1 }, (_, i) => (S.binom(odd, i) * S.binom(even, k - i) / tot) * n);
}
function argmax(a) { let b = 0; a.forEach((v, i) => { if (v > a[b]) b = i; }); return b; }
function histogram(values, bins) {
  const lo = Math.min(...values), hi = Math.max(...values);
  const w = Math.max(1, Math.ceil((hi - lo + 1) / bins));
  const out = [];
  for (let f = lo; f <= hi; f += w) out.push({ from: f, to: f + w - 1, count: 0 });
  for (const v of values) out[Math.floor((v - lo) / w)].count++;
  return out;
}

// ------------------------------------------------------------ cijferspellen

function renderDigits(meta, ctx) {
  const D = ctx.digitPatterns;
  const n = D.n;
  const out = [];
  const exp = n / 10;
  const posHeaders = ['Cijfer', ...D.pos.map((_, i) => `Positie ${i + 1}`)];
  const posRows = Array.from({ length: 10 }, (_, d) => [String(d), ...D.pos.map((p) => {
    const ratio = p[d] / exp;
    return el('span', { class: `pos-cell ${ratio > 1.03 ? 'hi' : ratio < 0.97 ? 'lo' : ''}`, title: `${pf.format(p[d] / n)} (verwacht 10%)`, text: nf.format(p[d]) });
  })]);
  const best = D.pos.map((p) => argmax(p));
  const worst = D.pos.map((p) => { let b = 0; p.forEach((v, i) => { if (v < p[b]) b = i; }); return b; });
  out.push(el('div', { class: 'grid2' },
    card('Meest getrokken cijfer per positie', balls(best, 'digit'), el('p', { class: 'muted small', text: 'Per positie het cijfer dat het vaakst viel in de gekozen periode.' })),
    card('Minst getrokken cijfer per positie', balls(worst, 'digit'), el('p', { class: 'muted small', text: 'Per positie het cijfer dat het minst vaak viel.' }))));
  out.push(card('Frequentie per cijfer en positie', table(posHeaders, posRows, { class: 'num' }),
    el('p', { class: 'note', text: `Bij puur toeval valt elk cijfer op elke positie in ongeveer 10% van de trekkingen (${nf.format(Math.round(exp))} keer). Vet = meer dan 3% boven verwachting, grijs = meer dan 3% eronder.` })));
  const total = D.pos.reduce((acc, p) => acc.map((v, i) => v + p[i]), new Array(10).fill(0));
  out.push(el('div', { class: 'grid2' },
    card('Alle posities samen', barChart(total.map((c, i) => ({ label: String(i), value: c, tip: [`cijfer ${i}`, `${nf.format(c)} keer`] })), { expected: (n * meta.mainCount) / 10, height: 180, title: 'Cijfers alle posities' })),
    card('Aantal verschillende cijfers per trekking',
      distChart(D.distinct, (i) => String(i), n, 'Verschillende cijfers', D.expectedDistinct),
      el('p', { class: 'muted small', text: meta.mainCount === 3 ? `Drie gelijke cijfers (bv. 777): ${nf.format(D.distinct[1])} keer. Alle drie verschillend: ${pf.format(D.distinct[3] / n)}.` : `Meest voorkomend: ${argmax(D.distinct)} verschillende cijfers.` }))));
  out.push(el('div', { class: 'grid2' },
    card('Som van de cijfers', el('p', { class: 'muted small', text: `Gemiddeld ${df1.format(D.sum.mean)} · middelste 50% tussen ${D.sum.p25} en ${D.sum.p75}` }),
      barChart(histogram(D.sum.values, 30).map((b) => ({ label: String(b.from), value: b.count, tip: [`som ${b.from}${b.to > b.from ? '-' + b.to : ''}`, `${nf.format(b.count)} trekkingen`] })), { height: 180, title: 'Som' })),
    card('Vaakst getrokken volledige combinaties', table(['Combinatie', 'Keer'], D.topCombos.map((c) => [balls(c.combo.split(''), 'digit sm'), nf.format(c.count)])))));
  if (meta.hasSign && D.signs.length) {
    out.push(card('Sterrenbeelden', barChart(D.signs.map((s) => ({ label: s.sign.slice(0, 4), value: s.count, tip: [s.sign, `${nf.format(s.count)} keer (${pf.format(s.count / n)})`] })), { expected: n / 12, height: 200, title: 'Sterrenbeelden' })));
  }
  return out;
}

// ------------------------------------------------------------ historiek

function renderHistory(meta, all) {
  const body = el('div');
  const input = el('input', { type: 'search', placeholder: 'Zoek op datum (bv. 2024-05) of getal', 'aria-label': 'Zoek trekkingen' });
  const show = () => {
    const q = input.value.trim();
    let list = all;
    if (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(q)) list = all.filter((d) => d.date.startsWith(q));
    else if (/^\d{1,2}$/.test(q)) list = all.filter((d) => d.main.includes(Number(q)) || d.extra.includes(Number(q)));
    else if (q) list = [];
    const rows = list.slice(-25).reverse().map((d) => [S.fmtDate(d.date), drawBalls(meta, d)]);
    body.replaceChildren(el('p', { class: 'muted small', text: `${nf.format(list.length)} trekkingen gevonden${list.length > 25 ? ' - de 25 recentste worden getoond (alles staat in het CSV-bestand)' : ''}.` }), table(['Datum', 'Uitslag'], rows));
  };
  input.addEventListener('input', show);
  show();
  return card('Uitslagen', el('div', { class: 'controls' }, input,
    el('a', { class: 'button ghost', href: `${DATA}/csv/${meta.key}.csv`, download: `${meta.key}.csv` }, 'Download alle uitslagen (CSV)')), body);
}

// ------------------------------------------------------------ databestanden

function renderData() {
  state.game = null;
  const rows = state.index.games.map((g) => [g.name, nf.format(g.count), `${S.fmtDate(g.first)} - ${S.fmtDate(g.last)}`,
    el('span', { class: 'links' },
      el('a', { href: `${DATA}/csv/${g.key}.csv`, download: `${g.key}.csv` }, 'CSV'), ' · ',
      el('a', { href: `${DATA}/json/${g.key}.json`, download: `${g.key}.json` }, 'JSON'))]);
  $app.replaceChildren(
    el('div', { class: 'game-head' }, el('div', {}, el('h2', { text: 'Databestanden' }),
      el('p', { class: 'muted', text: 'Alle uitslagen staan als gewone bestanden in de map "data" van het project. Je kunt ze openen in Excel, LibreOffice of Numbers, of de SQLite-database bevragen.' }))),
    card('Per spel', table(['Spel', 'Trekkingen', 'Periode', 'Bestanden'], rows)),
    card('Alles in één database',
      el('p', {}, el('a', { href: `${DATA}/loterij.sqlite`, download: 'loterij.sqlite' }, 'loterij.sqlite'),
        ' - tabellen ', el('code', { text: 'spellen' }), ', ', el('code', { text: 'trekkingen' }), ', ', el('code', { text: 'getallen' }), ' en view ', el('code', { text: 'frequentie' }), '. Wordt aangemaakt met "python -m lottery rebuild" als ze nog niet bestaat.'),
      el('pre', { text: "-- voorbeeld: meest getrokken Lotto-getallen\nSELECT getal, aantal FROM frequentie\nWHERE spel = 'lotto' AND soort = 'hoofd'\nORDER BY aantal DESC LIMIT 10;" })),
    card('Hoe worden de gegevens bijgewerkt?',
      el('p', { text: 'Na elke trekking haalt een automatische taak (GitHub Actions, zie .github/workflows/update.yml) de nieuwe uitslagen op, werkt de CSV- en JSON-bestanden bij en commit ze (de SQLite-database bouw je lokaal opnieuw met "python -m lottery update" of "rebuild"). De statistieken in deze app worden telkens bij het openen opnieuw berekend uit die bestanden. Handmatig bijwerken kan met "python -m lottery update".' })));
}

// Laat de service worker alle uitslagen bewaren, zodat elk spel ook offline werkt.
function prefetchForOffline(games) {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready.then((reg) => {
    const urls = games.map((g) => new URL(`${DATA}/json/${encodeURIComponent(g.key)}.json`, location.href).href);
    urls.push(new URL(`${DATA}/json/index.json`, location.href).href);
    urls.push(new URL(`${DATA}/json/jackpots.json`, location.href).href);
    reg.active?.postMessage({ type: 'prefetch', urls });
  }).catch(() => {});
}

// Installeerbare app (PWA): offline werken en icoon op het beginscherm.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === '127.0.0.1' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker niet geregistreerd:', e));
}

init();
