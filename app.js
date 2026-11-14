import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { evaluate, paramsForModel, RANK } from './fit.js?v=14';

// ---------- Parameters ----------
const PARAMS = [
  { key: 'cupW', group: 'cupboard', label: 'Internal width', min: 250, max: 1200, step: 5, def: 470 },
  { key: 'cupD', group: 'cupboard', label: 'Internal depth (to back of door)', min: 250, max: 900, step: 5, def: 415 },
  { key: 'cupH', group: 'cupboard', label: 'Internal height (floor to shelf)', min: 150, max: 1200, step: 5, def: 605 },
  { key: 'gapH', group: 'cupboard', label: 'Gap under door', min: 40, max: 200, step: 1, def: 108 },
  { key: 'openW', group: 'cupboard', label: 'Opening width', min: 250, max: 1200, step: 5, def: 470 },
  { key: 'robotDia', group: 'robot', label: 'Diameter', min: 250, max: 400, step: 1, def: 353 },
  { key: 'robotH', group: 'robot', label: 'Height (tallest point)', min: 50, max: 130, step: 0.5, def: 80 },
  { key: 'dockW', group: 'dock', label: 'Width', min: 50, max: 700, step: 1, def: 340 },
  { key: 'dockD', group: 'dock', label: 'Depth (incl. ramp)', min: 30, max: 700, step: 1, def: 487 },
  { key: 'dockH', group: 'dock', label: 'Height', min: 50, max: 800, step: 1, def: 521 },
  { key: 'dockTowerD', group: 'dock', label: 'Tower depth (without ramp) – optional', min: 30, max: 700, step: 1, def: null, show: 300, optional: true },
  { key: 'heightMargin', group: 'clearance', label: 'Minimum space above robot (under door)', min: 0, max: 30, step: 1, def: 10 },
  { key: 'maxOverhang', group: 'clearance', label: 'Maximum poke-out under door', min: 0, max: 300, step: 5, def: 90 },
  { key: 'sideClear', group: 'clearance', label: 'Minimum space each side of dock', min: 0, max: 200, step: 1, def: 10 },
];
const BYKEY = Object.fromEntries(PARAMS.map((p) => [p.key, p]));
const DEFAULTS = { ...Object.fromEntries(PARAMS.map((p) => [p.key, p.def])), robotOnDock: true, modelId: 'custom' };
const MODEL_KEYS = ['robotDia', 'robotH', 'dockW', 'dockD', 'dockH', 'dockTowerD'];

const COLORS = { ok: '#2e8b57', warn: '#d08a12', fail: '#c8372d', info: '#2f6fb0', unknown: '#8a8f96' };
const VERDICT = { ok: 'Fits', info: 'Fits', warn: 'Fits – with caveats', fail: "Won't fit", unknown: 'Missing data' };
const BADGE = { ok: 'Fits', info: 'Fits', warn: 'Caveats', fail: 'No', unknown: '?' };
const WALL = 16;      // drawn wall thickness, mm
const DOOR_T = 18;    // drawn door thickness, mm

let models = [];
let state = { ...DEFAULTS };
const inputs = {};
const $ = (id) => document.getElementById(id);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ---------- Price ----------
const aud = (n) => '$' + n.toLocaleString('en-AU');
function priceText(p) {
  if (!p || (!p.rrp && !p.seen)) return p?.note ? '–' : '–';
  const parts = [];
  if (p.rrp) parts.push(`RRP ${aud(p.rrp)}`);
  if (p.seen) parts.push(`seen ${aud(p.seen)}`);
  return parts.join(' · ');
}

// ---------- Colour ----------
const SWATCH = { black: '#1f2328', grey: '#8a8f96', white: '#f7f7f5', blue: '#7aa7d6', green: '#86b98a', rose: '#e3b5b5' };
const DARK = new Set(['black', 'grey']);
function swatches(cols) {
  const span = document.createElement('span');
  span.className = 'swatches';
  if (!cols || !cols.length) { span.textContent = '?'; span.title = 'Colour not checked'; return span; }
  for (const c of cols) {
    const dot = document.createElement('span');
    dot.className = 'swatch';
    dot.style.background = SWATCH[c] || '#ccc';
    dot.title = c;
    span.append(dot);
  }
  const label = document.createElement('span');
  label.className = 'swatch-label';
  label.textContent = cols.join(' / ');
  span.append(label);
  return span;
}
const hasDark = (m) => (m.colours || []).some((c) => DARK.has(c));

// ---------- Vacuum Wars ----------
function vwCell(vw) {
  if (!vw) { const s = document.createElement('span'); s.textContent = '–'; s.title = 'Not rated by Vacuum Wars'; return s; }
  const a = Object.assign(document.createElement('a'), { href: vw.url, target: '_blank', rel: 'noopener', textContent: `★ ${vw.stars.toFixed(2)}` });
  a.className = 'vw';
  if (vw.note) a.title = vw.note;
  a.addEventListener('click', (e) => e.stopPropagation());
  return a;
}

// ---------- Controls ----------
function buildControls() {
  for (const p of PARAMS) {
    const wrap = document.createElement('div');
    wrap.className = 'slider';
    const label = document.createElement('label');
    label.htmlFor = `r-${p.key}`;
    label.textContent = p.label;
    const range = Object.assign(document.createElement('input'), { type: 'range', id: `r-${p.key}`, min: p.min, max: p.max, step: p.step });
    const num = Object.assign(document.createElement('input'), { type: 'number', id: `n-${p.key}`, min: 0, max: 5000, step: p.step });
    num.setAttribute('aria-label', `${p.label} (mm)`);
    range.addEventListener('input', () => setParam(p.key, +range.value));
    num.addEventListener('change', () => {
      if (num.value === '') return;
      setParam(p.key, +num.value);
    });
    wrap.append(label, range, num);
    $(`grp-${p.group}`).append(wrap);
    inputs[p.key] = { range, num, wrap };
  }
  $('robotOnDock').addEventListener('change', (e) => {
    state.robotOnDock = e.target.checked;
    state.modelId = 'custom';
    update();
  });
  $('modelSelect').addEventListener('change', (e) => loadModel(e.target.value));
  $('reset').addEventListener('click', () => { state = { ...DEFAULTS }; loadModel(DEFAULT_MODEL); resetCamera(); });
  $('copyLink').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); flash($('copyLink'), 'Copied!'); }
    catch { flash($('copyLink'), 'Copy failed'); }
  });
  $('showDoor').addEventListener('change', update);
  $('resetCam').addEventListener('click', resetCamera);
  $('darkOnly').addEventListener('change', renderTable);
}

function flash(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => (btn.textContent = old), 1400);
}

function setParam(key, v) {
  state[key] = v;
  if (MODEL_KEYS.includes(key)) state.modelId = 'custom';
  update();
}

// Cupboard settings with side clearance reset, so one model's recommendation doesn't carry over to another
function modelBase() {
  return { ...state, sideClear: DEFAULTS.sideClear };
}

function loadModel(id) {
  const m = models.find((x) => x.id === id);
  if (!m) { state.modelId = 'custom'; update(); return; }
  state = { ...paramsForModel(modelBase(), m), modelId: id };
  update();
}

function syncInputs() {
  for (const p of PARAMS) {
    const { range, num, wrap } = inputs[p.key];
    const v = state[p.key];
    const known = isNum(v);
    wrap.classList.toggle('unknown', !known && !p.optional);
    range.value = known ? v : (p.show ?? p.def);
    if (document.activeElement !== num) num.value = known ? v : '';
    num.placeholder = known ? '' : (p.optional ? '–' : '?');
  }
  $('robotOnDock').checked = !!state.robotOnDock;
  $('modelSelect').value = state.modelId;
  const m = models.find((x) => x.id === state.modelId);
  const notes = $('modelNotes');
  notes.replaceChildren();
  if (m) {
    const pt = priceText(m.price);
    const pLine = document.createElement('strong');
    pLine.textContent = (pt !== '–' ? `${pt} (AUD)` : 'Price: ') + (m.price?.note ? ` – ${m.price.note}` : '');
    if (m.price?.source) {
      const pa = Object.assign(document.createElement('a'), { href: m.price.source, target: '_blank', rel: 'noopener', textContent: ' [price]' });
      pLine.append(pa);
    }
    notes.append(pLine, document.createElement('br'));
    const cLine = document.createElement('span');
    cLine.append('Colour: ', swatches(m.colours));
    if (m.colourNote) cLine.append(` (${m.colourNote})`);
    notes.append(cLine, document.createElement('br'));
    const vLine = document.createElement('span');
    vLine.append('Vacuum Wars: ', vwCell(m.vacuumWars));
    if (m.vacuumWars?.note) vLine.append(` (${m.vacuumWars.note})`);
    notes.append(vLine, document.createElement('br'));
    notes.append(document.createTextNode(`${m.dock.type}. ${m.notes || ''} `));
    m.sources.forEach((url, i) => {
      const a = Object.assign(document.createElement('a'), { href: url, target: '_blank', rel: 'noopener', textContent: `[${i + 1}]` });
      notes.append(a, document.createTextNode(' '));
    });
  } else {
    notes.textContent = 'Custom dimensions – move the robot or dock sliders, or pick a model above.';
  }
}

// ---------- URL state ----------
function writeURL() {
  const q = new URLSearchParams();
  if (state.modelId !== 'custom') q.set('m', state.modelId);
  for (const p of PARAMS) {
    if (MODEL_KEYS.includes(p.key) && state.modelId !== 'custom') continue;
    if (state[p.key] !== p.def && isNum(state[p.key])) q.set(p.key, state[p.key]);
  }
  if (state.modelId === 'custom' && !state.robotOnDock) q.set('front', '1');
  const s = q.toString();
  history.replaceState(null, '', s ? `?${s}` : location.pathname);
}

const DEFAULT_MODEL = 'ecovacs-t50-pro-omni';
function readURL() {
  const q = new URLSearchParams(location.search);
  const custom = MODEL_KEYS.some((k) => q.has(k)) || q.has('front');
  const id = q.get('m') || (custom ? null : DEFAULT_MODEL);
  const m = models.find((x) => x.id === id);
  if (m) state = { ...paramsForModel(modelBase(), m), modelId: id };
  for (const p of PARAMS) {
    if (q.has(p.key)) {
      const v = parseFloat(q.get(p.key));
      if (Number.isFinite(v)) state[p.key] = v;
    }
  }
  if (q.get('front') === '1') state.robotOnDock = false;
}

function robotStatus(result) {
  return result.checks.filter((c) => c.id === 'height' || c.id === 'width')
    .reduce((w, c) => (RANK[c.status] > RANK[w] ? c.status : w), 'ok');
}

// ---------- 3D view ----------
const container = $('view3d');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);
const camera = new THREE.PerspectiveCamera(38, 1, 5, 30000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d4c6, 1.7));
const sun = new THREE.DirectionalLight(0xffffff, 1.3);
sun.position.set(-900, 1600, -1400);
scene.add(sun);
const grid = new THREE.GridHelper(4000, 40, 0xd6d3c9, 0xebe9e2);
scene.add(grid);
const world = new THREE.Group();
scene.add(world);

function resize() {
  const w = container.clientWidth, h = container.clientHeight;
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(container);

function resetCamera() {
  const { cupW: W, cupD: D, cupH: H } = state;
  const span = Math.max(W, D, H);
  camera.position.set(-W * 0.4 - span * 0.85, H * 0.5 + span * 0.8, -D * 0.2 - span * 1.7);
  controls.target.set(0, H * 0.32, D * 0.35);
  controls.update();
}

function disposeGroup(g) {
  g.traverse((o) => {
    o.geometry?.dispose();
    if (o.material) [].concat(o.material).forEach((m) => m.dispose());
  });
  g.clear();
}

function addBox(w, h, d, x, y, z, color, opacity = 1, edges = true) {
  const geo = new THREE.BoxGeometry(Math.max(w, 0.1), Math.max(h, 0.1), Math.max(d, 0.1));
  const mat = new THREE.MeshStandardMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, roughness: 0.85 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  world.add(mesh);
  if (edges) {
    const line = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x4a4f55, transparent: true, opacity: 0.55 }));
    line.position.copy(mesh.position);
    world.add(line);
  }
  return mesh;
}

function render3D(result) {
  disposeGroup(world);
  const s = state;
  const W = s.cupW, D = s.cupD, H = s.cupH, t = WALL;
  const wallColor = 0xe6dfcd;

  // Cupboard carcass (z = 0 at the door, +z into the cupboard)
  addBox(W + 2 * t, H + t, t, 0, (H + t) / 2, D + t / 2, wallColor, 0.35);
  addBox(t, H + t, D, -W / 2 - t / 2, (H + t) / 2, D / 2, wallColor, 0.3);
  addBox(t, H + t, D, W / 2 + t / 2, (H + t) / 2, D / 2, wallColor, 0.3);
  addBox(W, t, D, 0, H + t / 2, D / 2, wallColor, 0.3);
  addBox(W, 1, D, 0, -0.5, D / 2, 0xf1ede3, 1, false);
  if (s.openW < W) {
    const stile = (W - s.openW) / 2;
    addBox(stile, H, t, -W / 2 + stile / 2, H / 2, -t / 2, wallColor, 0.45);
    addBox(stile, H, t, W / 2 - stile / 2, H / 2, -t / 2, wallColor, 0.45);
  }

  // Door (above the gap) and the gap line
  if ($('showDoor').checked && H > s.gapH) {
    addBox(W + 2 * t, H + t - s.gapH, DOOR_T, 0, s.gapH + (H + t - s.gapH) / 2, -DOOR_T / 2 - (s.openW < W ? t : 0), 0xc9a46a, 0.4);
  }
  const gapLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-W / 2 - 60, s.gapH, -DOOR_T - 2), new THREE.Vector3(W / 2 + 60, s.gapH, -DOOR_T - 2)]),
    new THREE.LineDashedMaterial({ color: 0xc8372d, dashSize: 20, gapSize: 12 })
  );
  gapLine.computeLineDistances();
  world.add(gapLine);

  // Dock
  const dockKnown = isNum(s.dockH);
  const dW = s.dockW || 0, dD = s.dockD || 0, dH = dockKnown ? s.dockH : Math.min(500, H);
  const tD = isNum(s.dockTowerD) ? Math.min(s.dockTowerD, dD) : dD;
  if (dW && dD) {
    addBox(dW, dH, tD, 0, dH / 2, D - tD / 2, dockKnown ? 0x3a4048 : 0x9a9ea4, dockKnown ? 0.6 : 0.3);
    if (dD > tD) addBox(dW, 12, dD - tD, 0, 6, D - tD - (dD - tD) / 2, 0x5a6068, 0.7);
  }

  // Robot (parked)
  if (isNum(s.robotDia) && isNum(s.robotH)) {
    const r = s.robotDia / 2;
    const zc = s.robotOnDock ? D - dD + r : D - dD - r;
    const status = robotStatus(result);
    const geo = new THREE.CylinderGeometry(r, r, s.robotH, 64);
    const mat = new THREE.MeshStandardMaterial({ color: COLORS[status], roughness: 0.5 });
    const robot = new THREE.Mesh(geo, mat);
    robot.position.set(0, s.robotH / 2 + 0.5, zc);
    world.add(robot);
    const rim = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: 0x222222 }));
    rim.position.copy(robot.position);
    world.add(rim);
  }
}

function animate() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

// ---------- SVG outlines ----------
const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.append(e);
  return e;
}
function text(parent, x, y, str, size, opts = {}) {
  const t = el('text', { x, y, 'font-size': size, fill: opts.fill || '#4a4f55', 'text-anchor': opts.anchor || 'middle', 'dominant-baseline': 'middle', ...(opts.rotate ? { transform: `rotate(${opts.rotate} ${x} ${y})` } : {}) }, parent);
  t.textContent = str;
  return t;
}
function dim(parent, x1, y1, x2, y2, label, size, opts = {}) {
  const c = opts.color || '#2f6fb0';
  const vertical = Math.abs(x2 - x1) < Math.abs(y2 - y1);
  const tick = size * 0.35;
  el('line', { x1, y1, x2, y2, ...stroke(c, 1.2) }, parent);
  if (vertical) {
    el('line', { x1: x1 - tick, y1, x2: x1 + tick, y2: y1, ...stroke(c, 1.2) }, parent);
    el('line', { x1: x2 - tick, y1: y2, x2: x2 + tick, y2, ...stroke(c, 1.2) }, parent);
    text(parent, x1 + tick + 4, (y1 + y2) / 2, label, size, { anchor: 'start', fill: c });
  } else {
    el('line', { x1, y1: y1 - tick, x2: x1, y2: y1 + tick, ...stroke(c, 1.2) }, parent);
    el('line', { x1: x2, y1: y2 - tick, x2, y2: y2 + tick, ...stroke(c, 1.2) }, parent);
    text(parent, (x1 + x2) / 2, y1 - size * 0.8, label, size, { fill: c });
  }
}
const stroke = (c, w = 1.5, extra = {}) => ({ stroke: c, 'stroke-width': w, 'vector-effect': 'non-scaling-stroke', ...extra });

function outsideExtent(s) {
  const dD = s.dockD || 0;
  const parked = dD + (s.robotOnDock ? 0 : s.robotDia || 0);
  return Math.max(parked - s.cupD, 120);
}

function renderTop(svg, result) {
  const s = state, t = WALL;
  svg.replaceChildren();
  const W = s.cupW, D = s.cupD;
  const half = Math.max(W / 2 + t, s.openW / 2, (s.dockW || 0) / 2 + 10, (s.robotDia || 0) / 2 + 10);
  const out = outsideExtent(s);
  const minX = -half - 70, minY = -t - 70, w = 2 * half + 140, h = D + out + t + 220;
  svg.setAttribute('viewBox', `${minX} ${minY} ${w} ${h}`);
  const fs = Math.max(w, h) / 26;
  // walls (svg y = D - z: back wall at top, door at y = D)
  const wall = { fill: '#e6dfcd', ...stroke('#8d8676') };
  el('rect', { x: -W / 2 - t, y: -t, width: W + 2 * t, height: t, ...wall }, svg);
  el('rect', { x: -W / 2 - t, y: 0, width: t, height: D, ...wall }, svg);
  el('rect', { x: W / 2, y: 0, width: t, height: D, ...wall }, svg);
  el('rect', { x: -W / 2, y: 0, width: W, height: D, fill: '#faf8f2' }, svg);
  // opening + door
  if (s.openW < W) {
    el('rect', { x: -W / 2, y: D - t, width: (W - s.openW) / 2, height: t, ...wall }, svg);
    el('rect', { x: s.openW / 2, y: D - t, width: (W - s.openW) / 2, height: t, ...wall }, svg);
  }
  el('line', { x1: -W / 2 - t, y1: D + DOOR_T / 2, x2: W / 2 + t, y2: D + DOOR_T / 2, ...stroke('#b08a4e', 3, { 'stroke-dasharray': '10 6' }) }, svg);
  text(svg, W / 2 + t + 8, D + DOOR_T / 2, 'door', fs * 0.75, { anchor: 'start', fill: '#b08a4e' });
  const dD = s.dockD || 0, dW = s.dockW || 0;
  // dock
  if (dD && dW) {
    const known = isNum(s.dockH);
    const tD = isNum(s.dockTowerD) ? Math.min(s.dockTowerD, dD) : dD;
    if (dD > tD) el('rect', { x: -dW / 2, y: tD, width: dW, height: dD - tD, fill: '#5a6068', 'fill-opacity': 0.35, ...stroke('#22262a', 1, { 'stroke-dasharray': '5 4' }) }, svg);
    el('rect', { x: -dW / 2, y: 0, width: dW, height: tD, fill: known ? '#3a4048' : '#9a9ea4', 'fill-opacity': known ? 0.75 : 0.4, rx: 6, ...stroke('#22262a') }, svg);
    text(svg, 0, Math.min(tD / 2, 60), 'dock', fs * 0.8, { fill: '#fff' });
    const side = (W - dW) / 2;
    if (side > 0) {
      const yy = Math.min(tD * 0.35, 140);
      dim(svg, -W / 2, yy, -dW / 2, yy, `${Math.round(side)}`, fs * 0.7);
      dim(svg, dW / 2, yy, W / 2, yy, `${Math.round(side)}`, fs * 0.7);
    }
  }
  // robot
  if (isNum(s.robotDia)) {
    const r = s.robotDia / 2;
    const z = s.robotOnDock ? D - dD + r : D - dD - r;
    const st = robotStatus(result);
    el('circle', { cx: 0, cy: D - z, r, fill: COLORS[st], 'fill-opacity': 0.8, ...stroke('#1d2126') }, svg);
  }
  // dimensions
  text(svg, 0, -t - 35, `width ${W}`, fs);
  text(svg, -half - 40, D / 2, `depth ${D}`, fs, { rotate: -90 });
  text(svg, 0, D + out + fs * 1.4, `opening ${s.openW}`, fs * 0.85);
}

function renderSide(svg, result) {
  const s = state, t = WALL;
  svg.replaceChildren();
  const D = s.cupD, H = s.cupH;
  const out = outsideExtent(s);
  const minX = -t - 80, minY = -t - 200, w = D + out + t + 200, h = H + t + 260;
  svg.setAttribute('viewBox', `${minX} ${minY} ${w} ${h}`);
  const fs = Math.max(w, h) / 26;
  const wall = { fill: '#e6dfcd', ...stroke('#8d8676') };
  // svg x = D - z (back wall at left, door at x = D); svg y = H - height
  el('rect', { x: 0, y: 0, width: D, height: H, fill: '#faf8f2' }, svg);
  el('rect', { x: -t, y: -t, width: t, height: H + t, ...wall }, svg);
  el('rect', { x: 0, y: -t, width: D, height: t, ...wall }, svg);
  el('line', { x1: -t - 40, y1: H, x2: D + out + 120, y2: H, ...stroke('#8d8676', 2) }, svg);
  // door
  if (H > s.gapH) el('rect', { x: D, y: -t, width: DOOR_T, height: H + t - s.gapH, fill: '#c9a46a', 'fill-opacity': 0.7, ...stroke('#8a6a36') }, svg);
  // gap limit
  el('line', { x1: D - 40, y1: H - s.gapH, x2: D + out + 60, y2: H - s.gapH, ...stroke(COLORS.fail, 1.2, { 'stroke-dasharray': '8 5' }) }, svg);
  const gx = D + DOOR_T + 30;
  el('line', { x1: gx, y1: H - s.gapH, x2: gx, y2: H, ...stroke('#4a4f55', 1) }, svg);
  text(svg, gx + 10, H - s.gapH / 2, `gap ${s.gapH}`, fs * 0.8, { anchor: 'start' });
  const dD = s.dockD || 0;
  // dock
  if (dD) {
    const known = isNum(s.dockH);
    const dH = known ? s.dockH : Math.min(500, H);
    const tD = isNum(s.dockTowerD) ? Math.min(s.dockTowerD, dD) : dD;
    if (dD > tD) el('rect', { x: tD, y: H - 12, width: dD - tD, height: 12, fill: '#5a6068', 'fill-opacity': 0.6, ...stroke('#22262a', 1) }, svg);
    el('rect', { x: 0, y: H - dH, width: tD, height: dH, fill: known ? '#3a4048' : '#9a9ea4', 'fill-opacity': known ? 0.75 : 0.35, rx: 6, ...stroke('#22262a', 1.5, known ? {} : { 'stroke-dasharray': '6 5' }) }, svg);
    text(svg, tD / 2, H - dH + fs * 1.0, known ? `dock ${s.dockH}` : 'dock ?', fs * 0.75, { fill: '#fff' });
    if (known && H - dH > 0) dim(svg, tD * 0.7, 0, tD * 0.7, H - dH, `${Math.round(H - dH)} above dock`, fs * 0.7);
  }
  // robot
  if (isNum(s.robotDia) && isNum(s.robotH)) {
    const r = s.robotDia / 2;
    const z = s.robotOnDock ? D - dD + r : D - dD - r;
    const st = robotStatus(result);
    el('rect', { x: D - z - r, y: H - s.robotH, width: s.robotDia, height: s.robotH, rx: Math.min(14, s.robotH / 3), fill: COLORS[st], 'fill-opacity': 0.85, ...stroke('#1d2126') }, svg);
  }
  text(svg, D / 2, -t - fs * 2.2, `height ${H}`, fs);
}

// ---------- Leftover space ----------
function renderSpaces(result) {
  const sp = result.spaces;
  const tiles = [
    ['Above dock', sp.aboveDock, 'to underside of cabinet'],
    ['Each side of dock', sp.dockSides, 'dock to side wall'],
    ['Above robot', sp.aboveRobot, 'robot top to door bottom'],
    ['Spare across opening', sp.opening, 'total, robot in opening'],
    [sp.toDoor != null && sp.toDoor < 0 ? 'Pokes out under door' : 'Parked robot to door', sp.toDoor == null ? null : Math.abs(sp.toDoor), sp.toDoor != null && sp.toDoor < 0 ? 'ramp/robot past the door' : 'front of robot to door'],
  ];
  $('spaces').replaceChildren(...tiles.map(([label, v, sub]) => {
    const d = document.createElement('div');
    d.className = 'space-tile' + (v != null && v < 0 ? ' neg' : '');
    const n = document.createElement('div');
    n.className = 'space-num';
    n.textContent = v == null ? '?' : `${Math.round(v * 10) / 10}`;
    const u = document.createElement('span');
    u.textContent = v == null ? '' : ' mm';
    n.append(u);
    const l = document.createElement('div');
    l.className = 'space-label';
    l.textContent = label;
    const s2 = document.createElement('div');
    s2.className = 'space-sub';
    s2.textContent = sub;
    d.append(n, l, s2);
    return d;
  }));
}

// ---------- Checks + table ----------
function renderChecks(result) {
  const v = $('verdict');
  v.className = `verdict ${result.overall}`;
  v.textContent = VERDICT[result.overall];
  const box = $('checks');
  box.replaceChildren(...result.checks.map((c) => {
    const d = document.createElement('div');
    d.className = `check-card ${c.status}`;
    const strong = document.createElement('strong');
    strong.textContent = c.label;
    const span = document.createElement('span');
    span.textContent = c.detail;
    d.append(strong, span);
    return d;
  }));
}

function renderTable() {
  const tbody = $('modelTable').querySelector('tbody');
  const darkOnly = $('darkOnly').checked;
  const rows = models.filter((m) => !darkOnly || hasDark(m)).map((m) => {
    const r = evaluate(paramsForModel(modelBase(), m));
    const worst = r.checks.reduce((a, c) => (RANK[c.status] > RANK[a.status] ? c : a), r.checks[0]);
    return { m, r, worst };
  }).sort((a, b) => RANK[a.r.overall] - RANK[b.r.overall] || a.m.robot.height - b.m.robot.height);
  tbody.replaceChildren(...rows.map(({ m, r, worst }) => {
    const tr = document.createElement('tr');
    if (m.id === state.modelId) tr.className = 'selected';
    const fmt = (v) => (isNum(v) ? v : '?');
    const cells = [
      `<span class="badge ${r.overall}">${BADGE[r.overall]}</span>`,
      `${m.brand} ${m.model}`,
      null,
      null,
      fmt(m.robot.height), fmt(m.robot.diameter),
      `${fmt(m.dock.width)} × ${fmt(m.dock.depth)} × ${fmt(m.dock.height)}`,
      m.dock.type,
      r.spaces.toDoor != null && r.spaces.toDoor < 0 ? `${Math.round(-r.spaces.toDoor)}` : '–',
      priceText(m.price),
      r.overall === 'ok' || r.overall === 'info' ? '–' : `${worst.label}: ${worst.detail}`,
    ];
    cells.forEach((html, i) => {
      const td = document.createElement('td');
      if (i === 0) td.innerHTML = html;
      else if (i === 2) td.append(swatches(m.colours));
      else if (i === 3) td.append(vwCell(m.vacuumWars));
      else td.textContent = html;
      if ((i >= 3 && i <= 6) || i === 8 || i === 9) td.classList.add('num');
      if (i === 8 && r.spaces.toDoor < -(state.maxOverhang ?? Infinity)) td.classList.add('over');
      if (i === 9 && m.price?.note) td.title = m.price.note;
      tr.append(td);
    });
    tr.addEventListener('click', () => { loadModel(m.id); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    return tr;
  }));
}

// ---------- Main update ----------
function update() {
  syncInputs();
  const result = evaluate(state);
  renderChecks(result);
  renderSpaces(result);
  render3D(result);
  renderTop($('topView'), result);
  renderSide($('sideView'), result);
  renderTable();
  writeURL();
}

async function init() {
  buildControls();
  try {
    const res = await fetch('vacuums.json', { cache: 'no-cache' });
    models = (await res.json()).models;
  } catch (e) {
    console.error('Could not load vacuums.json', e);
  }
  const sel = $('modelSelect');
  sel.append(new Option('Custom dimensions', 'custom'));
  for (const m of models) sel.append(new Option(`${m.brand} ${m.model}`, m.id));
  readURL();
  resize();
  update();
  resetCamera();
  animate();
}

init();
