// Eenvoudige, toegankelijke SVG-grafieken zonder externe bibliotheken.
import { el, svg, nf } from './dom.js';

let tooltip;
function tip() {
  if (!tooltip) {
    tooltip = el('div', { class: 'viz-tooltip', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(tooltip);
  }
  return tooltip;
}
function showTip(evt, lines) {
  const t = tip();
  t.replaceChildren(...lines.map((l, i) => el(i === 0 ? 'strong' : 'div', { text: l })));
  t.style.display = 'block';
  const r = t.getBoundingClientRect();
  let x, y;
  if (evt.clientX !== undefined && evt.type.startsWith('pointer')) { x = evt.clientX; y = evt.clientY; }
  else { const b = evt.target.getBoundingClientRect(); x = b.left + b.width / 2; y = b.top; }
  let left = x + 12, top = y - r.height - 12;
  if (left + r.width > window.innerWidth - 8) left = x - r.width - 12;
  if (top < 8) top = y + 16;
  t.style.left = `${Math.max(8, left)}px`;
  t.style.top = `${top}px`;
}
function hideTip() { if (tooltip) tooltip.style.display = 'none'; }

// data: [{ label, value, tip: [regels] }]
// opts: { expected, height, yLabel, title }
export function barChart(data, opts = {}) {
  const W = Math.max(520, data.length * 18 + 50);
  const H = opts.height || 220;
  const m = { t: 14, r: 8, b: 26, l: 42 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const maxV = Math.max(1, ...data.map((d) => d.value), opts.expected || 0) * 1.08;
  const y = (v) => m.t + ih - (v / maxV) * ih;
  const band = iw / data.length;
  const bw = Math.max(2, Math.min(56, band - 2));
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'viz', role: 'img', 'aria-label': opts.title || 'staafdiagram', preserveAspectRatio: 'xMidYMid meet' });

  // rasterlijnen + y-as
  const ticks = niceTicks(maxV, 4);
  for (const t of ticks) {
    root.appendChild(svg('line', { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), class: 'viz-grid' }));
    root.appendChild(svg('text', { x: m.l - 6, y: y(t) + 4, class: 'viz-axis', 'text-anchor': 'end' }, nf.format(t)));
  }
  const labelEvery = data.length > 60 ? 10 : data.length > 30 ? 5 : 1;
  data.forEach((d, i) => {
    const cx = m.l + band * i + band / 2;
    const h = Math.max(0, m.t + ih - y(d.value));
    const g = svg('g', { class: 'viz-bar', tabindex: '0', 'aria-label': `${d.label}: ${d.value}` });
    // grotere onzichtbare raakzone
    g.appendChild(svg('rect', { x: cx - band / 2, y: m.t, width: band, height: ih, class: 'viz-hit' }));
    g.appendChild(svg('path', { d: roundedTop(cx - bw / 2, y(d.value), bw, h, Math.min(4, bw / 2)), class: 'viz-mark' }));
    const lines = d.tip || [String(d.label), nf.format(d.value)];
    g.addEventListener('pointermove', (e) => showTip(e, lines));
    g.addEventListener('pointerleave', hideTip);
    g.addEventListener('focus', (e) => showTip(e, lines));
    g.addEventListener('blur', hideTip);
    root.appendChild(g);
    if (i % labelEvery === 0 || data.length <= 30)
      root.appendChild(svg('text', { x: cx, y: H - 8, class: 'viz-axis', 'text-anchor': 'middle' }, d.label));
  });
  root.appendChild(svg('line', { x1: m.l, x2: W - m.r, y1: m.t + ih, y2: m.t + ih, class: 'viz-baseline' }));
  if (opts.expected) {
    const ey = y(opts.expected);
    root.appendChild(svg('line', { x1: m.l, x2: W - m.r, y1: ey, y2: ey, class: 'viz-ref' }));
    root.appendChild(svg('text', { x: W - m.r - 2, y: ey - 5, class: 'viz-ref-label', 'text-anchor': 'end' }, `verwacht bij toeval: ${nf.format(Math.round(opts.expected))}`));
  }
  return el('div', { class: 'viz-wrap' }, root);
}

function roundedTop(x, y, w, h, r) {
  if (h <= 0) return '';
  r = Math.min(r, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function niceTicks(max, n) {
  const step0 = max / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= step0) || mag * 10;
  const out = [];
  for (let v = 0; v <= max; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

// Raster met alle getallen, gekleurd volgens hoe vaak ze getrokken werden.
// rows: frequentierijen uit stats.frequencies
export function heatGrid(rows, { cols = 10, label = 'getal' } = {}) {
  const counts = rows.map((r) => r.count);
  const lo = Math.min(...counts), hi = Math.max(...counts);
  const grid = el('div', { class: 'heat-grid', style: { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }, role: 'list' });
  for (const r of rows) {
    const t = hi > lo ? (r.count - lo) / (hi - lo) : 0.5;
    const step = Math.min(6, Math.floor(t * 7)); // 0..6 -> ramp-stappen
    const lines = [`${label} ${r.n}`, `${nf.format(r.count)} keer getrokken`, `verwacht: ${nf.format(Math.round(r.expected))}`, `${r.since} trekkingen geleden laatst`];
    const cell = el('div', { class: `heat-cell heat-${step}`, role: 'listitem', tabindex: '0', 'aria-label': lines.join(', ') }, el('span', { text: String(r.n) }));
    cell.addEventListener('pointermove', (e) => showTip(e, lines));
    cell.addEventListener('pointerleave', hideTip);
    cell.addEventListener('focus', (e) => showTip(e, lines));
    cell.addEventListener('blur', hideTip);
    grid.appendChild(cell);
  }
  const legend = el('div', { class: 'heat-legend' },
    el('span', { text: `minst (${nf.format(lo)}×)` }),
    ...[0, 1, 2, 3, 4, 5, 6].map((s) => el('i', { class: `heat-${s}`, 'aria-hidden': 'true' })),
    el('span', { text: `meest (${nf.format(hi)}×)` }));
  return el('div', {}, grid, legend);
}
