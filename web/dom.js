// Kleine DOM-helpers. Alle tekst gaat via textContent (nooit innerHTML), zodat
// gegevens uit externe bronnen nooit als HTML/JS kunnen worden uitgevoerd.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) { if (typeof v === 'function') node.addEventListener(k.slice(2), v); } // nooit inline handlers
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) node.setAttribute(k, String(v));
  for (const c of children.flat()) if (c) node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

export const nf = new Intl.NumberFormat('nl-BE');
export const pf = new Intl.NumberFormat('nl-BE', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const df1 = new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 1 });
