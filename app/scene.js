import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const T = THREE;
const canvas = document.querySelector('#scene');
const wrap = canvas.parentElement;
const coarse = matchMedia('(pointer: coarse)').matches;
const PHONE = coarse || innerWidth < 700;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const capture = /(?:\?|&)capture=1(?:&|$)/.test(location.search);
const seg = (n) => Math.max(3, Math.round(n * (PHONE ? 0.5 : 1)));
const texSize = (n) => (PHONE ? Math.max(64, Math.round(n * 0.5)) : n);

const FALLBACK = [
  ['agent-01', 'Category Researcher', '#e07a3d', '#3a2a24', 'beanie'],
  ['agent-02', 'Listing Analyst', '#d4a054', '#2a211c', 'glasses'],
  ['agent-03', 'Niche Hunter', '#c45c26', '#4a3428', 'bun'],
  ['agent-04', 'Template Designer', '#e8a04a', '#5a3a28', 'scarf'],
  ['agent-05', 'SEO Copywriter', '#f1641e', '#2c2420', 'glasses'],
  ['agent-06', 'Content Planner', '#c47b6a', '#3a2a28', 'beanie'],
  ['agent-07', 'Policy Researcher', '#8d6b4a', '#2a2420', 'none'],
  ['agent-08', 'Brand Designer', '#f3ede2', '#6b4a32', 'scarf'],
  ['agent-09', 'Competitor Tracker', '#6e7c8a', '#1c1a18', 'none'],
  ['agent-10', 'Launch Lead', '#3d4e66', '#241c18', 'beanie'],
].map(([id, name, color, hair, accessory]) => ({ id, name, color, hair, accessory }));

function giveUp() {
  window.__studioNo3d = true;
  wrap.classList.add('no3d');
  wrap.classList.remove('is-3d');
  canvas.style.display = 'none';
}

let renderer;
try {
  renderer = new T.WebGLRenderer({
    canvas,
    antialias: !PHONE,
    alpha: false,
    powerPreference: 'default',
    preserveDrawingBuffer: capture,
  });
} catch (e) {
  giveUp();
}
if (!renderer) {
  // WebGL unavailable. The still image stays up, and the page below does not need the canvas.
} else {
renderer.setClearColor(0x000000, 1);
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = !PHONE;
renderer.shadowMap.type = T.PCFSoftShadowMap;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PHONE ? 1.25 : 2));

const scene = new T.Scene();
const camera = new T.PerspectiveCamera(42, 1, 0.1, 500);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotateSpeed = coarse ? 0.6 : 0.75;
controls.zoomSpeed = 0.9;
controls.panSpeed = 0.8;
controls.screenSpacePanning = false;
controls.maxPolarAngle = Math.PI / 2 - 0.06;
controls.minPolarAngle = 0.18;
controls.touches = { ONE: T.TOUCH.ROTATE, TWO: T.TOUCH.DOLLY_PAN };
controls.mouseButtons = { LEFT: T.MOUSE.ROTATE, MIDDLE: T.MOUSE.DOLLY, RIGHT: T.MOUSE.PAN };
canvas.style.touchAction = 'none';

const POSES = {
  exterior: { pos: [15.5, 7.4, 18.5], target: [0, 3.6, 1], min: 10, max: 46 },
  interior: { pos: [7.2, 10.4, 13.2], target: [0, 0.6, -0.4], min: 6, max: 22 },
};
let view = location.hash === '#studio' ? 'interior' : 'exterior';

function placeCamera(v) {
  const p = POSES[v];
  camera.position.set(...p.pos);
  controls.target.set(...p.target);
  controls.minDistance = p.min;
  controls.maxDistance = p.max;
  controls.update();
}
controls.addEventListener('start', () => {
  document.querySelector('#scene-hint')?.classList.add('gone');
});

const std = (c, r = 0.7, m = 0, extra = {}) => new T.MeshStandardMaterial({ color: c, roughness: r, metalness: m, ...extra });
function add(parent, geo, mat, x = 0, y = 0, z = 0, opts = {}) {
  const mesh = new T.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = !PHONE && opts.cast !== false;
  mesh.receiveShadow = !PHONE && opts.receive !== false;
  if (opts.rot) mesh.rotation.set(opts.rot[0], opts.rot[1], opts.rot[2]);
  parent.add(mesh);
  return mesh;
}
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = texSize(w);
  c.height = texSize(h);
  const g = c.getContext('2d');
  draw(g, c.width, c.height);
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = PHONE ? 1 : 4;
  return t;
}
const rand = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(7);

const skyTex = canvasTex(256, 512, (g, w, h) => {
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, '#0c1024');
  grd.addColorStop(0.42, '#3a2a4e');
  grd.addColorStop(0.7, '#c46a45');
  grd.addColorStop(1, '#e7a56e');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
});
const sky = new T.Mesh(new T.SphereGeometry(280, seg(28), seg(16)), new T.MeshBasicMaterial({ map: skyTex, side: T.BackSide, depthWrite: false, fog: false }));
scene.add(sky);
const starGeo = new T.BufferGeometry();
const sp = [];
for (let i = 0; i < (PHONE ? 160 : 380); i++) {
  const th = rand() * Math.PI * 2;
  const ph = Math.acos(0.2 + rand() * 0.8);
  sp.push(220 * Math.sin(ph) * Math.cos(th), 220 * Math.cos(ph), 220 * Math.sin(ph) * Math.sin(th));
}
starGeo.setAttribute('position', new T.Float32BufferAttribute(sp, 3));
scene.add(new T.Points(starGeo, new T.PointsMaterial({ color: 0xfff4e0, size: 1.25, sizeAttenuation: false, transparent: true, opacity: 0.75, fog: false })));
scene.fog = new T.Fog(0x3a2a44, 36, 150);

const hemi = new T.HemisphereLight(0x9aa6d4, 0x3a2418, 0.85);
scene.add(hemi);
const sun = new T.DirectionalLight(0xffc49a, 1.65);
sun.position.set(-28, 36, 22);
sun.castShadow = !PHONE;
if (!PHONE) {
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -18, near: 4, far: 90 });
  sun.shadow.bias = -0.0004;
}
scene.add(sun);

const ext = new T.Group();
scene.add(ext);
const groundTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#3a342c';
  g.fillRect(0, 0, w, h);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const v = 70 + ((rand() * 28) | 0);
      g.fillStyle = `rgb(${v + 8},${v},${v - 10})`;
      g.fillRect(x * (w / 8) + 1, y * (h / 8) + 1, w / 8 - 2, h / 8 - 2);
    }
  }
});
groundTex.wrapS = groundTex.wrapT = T.RepeatWrapping;
groundTex.repeat.set(8, 6);
add(ext, new T.BoxGeometry(90, 0.4, 70), std(0xffffff, 0.9, 0, { map: groundTex }), 0, -0.2, 4, { cast: false });
add(ext, new T.BoxGeometry(90, 0.08, 14), std(0x232028, 0.7, 0.05), 0, 0.02, 16, { cast: false });
for (let x = -28; x <= 28; x += 7) add(ext, new T.BoxGeometry(2.2, 0.02, 0.18), std(0xe7d3a4, 0.5), x, 0.07, 16, { cast: false });

const brick = std(0x9a4e3c, 0.82);
const brickDark = std(0x6e382c, 0.8);
const cream = std(0xf3eadf, 0.7);
const wood = std(0x6b412c, 0.55, 0.04);
const ink = std(0x241c18, 0.55, 0.08);
const orange = std(0xf1641e, 0.5, 0.05);
const glassWarm = std(0x2a1a0e, 0.18, 0.15, { emissive: 0xffb35c, emissiveIntensity: 1.15 });
add(ext, new T.BoxGeometry(13.2, 7.6, 10), brick, 0, 3.8, 1);
add(ext, new T.BoxGeometry(14.2, 0.42, 11), brickDark, 0, 7.85, 1);
add(ext, new T.BoxGeometry(4.2, 1.5, 2.2), brickDark, 3.6, 8.6, -1.2);
const signTex = canvasTex(512, 160, () => {});
const signMat = std(0xfff6ea, 0.6, 0, { map: signTex, emissive: 0x3a2a18, emissiveMap: signTex, emissiveIntensity: 0.25 });
const sign = add(ext, new T.BoxGeometry(7.2, 1.35, 0.18), signMat, -1.5, 6.35, 6.12, { cast: false });
function drawSign() {
  const c = signTex.image;
  const g = c.getContext('2d');
  g.fillStyle = '#fff4e6';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#f1641e';
  g.fillRect(0, 0, c.width, c.height * 0.08);
  g.fillStyle = '#2a2118';
  g.font = `italic ${Math.floor(c.height * 0.46)}px "Instrument Serif", Georgia, serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('STUDIO', c.width / 2, c.height * 0.46);
  g.font = `600 ${Math.floor(c.height * 0.16)}px Inter, sans-serif`;
  g.fillStyle = '#8a5a3a';
  g.fillText('DIGITAL FILES', c.width / 2, c.height * 0.78);
  signTex.needsUpdate = true;
}
drawSign();
const awning = add(ext, new T.BoxGeometry(10.4, 0.22, 2.8), orange, -0.5, 5.15, 7.2);
awning.rotation.x = -0.32;
add(ext, new T.BoxGeometry(6.4, 3.15, 0.12), glassWarm, -2.35, 2.55, 6.06, { cast: false });
add(ext, new T.BoxGeometry(0.08, 3.15, 0.16), cream, -2.35, 2.55, 6.14, { cast: false });
add(ext, new T.BoxGeometry(6.4, 0.08, 0.16), cream, -2.35, 2.55, 6.14, { cast: false });
const door = add(ext, new T.BoxGeometry(1.7, 3.15, 0.16), std(0x4a2c18, 0.45, 0.1, { emissive: 0xff9a45, emissiveIntensity: 0.35 }), 2.55, 1.7, 6.08, { cast: false });
door.name = 'door';
add(ext, new T.BoxGeometry(2.05, 3.4, 0.1), orange, 2.55, 1.75, 6.02, { cast: false });
add(ext, new T.SphereGeometry(0.18, seg(10), seg(8)), std(0xffe1b0, 0.3, 0, { emissive: 0xffc98a, emissiveIntensity: 1.4 }), 2.55, 3.55, 6.2, { cast: false });
for (let i = 0; i < 3; i++) {
  const x = -3.6 + i * 2.5;
  add(ext, new T.BoxGeometry(1.35, 1.55, 0.1), glassWarm, x, 5.55, 6.08, { cast: false });
  add(ext, new T.BoxGeometry(1.55, 0.1, 0.16), cream, x, 4.7, 6.12, { cast: false });
}
for (const [y, z] of [[2.4, 2], [4.8, -1]]) {
  add(ext, new T.BoxGeometry(0.1, 1.3, 1.5), glassWarm, 6.62, y, z, { cast: false });
}
for (let i = 0; i < 3; i++) add(ext, new T.BoxGeometry(2.4 - i * 0.25, 0.22, 1.1), std(0xcbbba6, 0.75), 2.55, 0.16 + i * 0.22, 6.7 + i * 0.35);
const bulbMat = std(0xfff1d0, 0.3, 0, { emissive: 0xffc98a, emissiveIntensity: 1.8 });
const bulbs = [];
for (let i = 0; i < 7; i++) {
  const b = add(ext, new T.SphereGeometry(0.09, seg(8), seg(6)), bulbMat, -4.2 + i * 1.15, 4.85, 7.55, { cast: false });
  bulbs.push(b);
}
for (const x of [-5.4, 5.3]) {
  add(ext, new T.BoxGeometry(1.15, 0.7, 1.15), std(0x6d6458, 0.85), x, 0.45, 7.5);
  add(ext, new T.IcosahedronGeometry(0.72, PHONE ? 0 : 1), std(0x2f4a35, 0.85), x, 1.25, 7.5);
}
add(ext, new T.CylinderGeometry(0.08, 0.1, 4.2, seg(8)), ink, 8.4, 2.2, 6.2);
add(ext, new T.SphereGeometry(0.28, seg(10), seg(8)), bulbMat, 8.4, 4.4, 6.2, { cast: false });
const boardTex = canvasTex(256, 256, () => {});
const boardMat = new T.MeshBasicMaterial({ map: boardTex });
function drawBoard() {
  const c = boardTex.image;
  const g = c.getContext('2d');
  g.fillStyle = '#f6efe4';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#2a2118';
  g.lineWidth = 8;
  g.strokeRect(8, 8, c.width - 16, c.height - 16);
  g.fillStyle = '#f1641e';
  g.font = `700 ${Math.floor(c.width * 0.16)}px Inter, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('SAMPLE', c.width / 2, c.height * 0.42);
  g.fillStyle = '#2a2118';
  g.font = `${Math.floor(c.width * 0.09)}px Inter, sans-serif`;
  g.fillText('PREVIEW', c.width / 2, c.height * 0.62);
  boardTex.needsUpdate = true;
}
drawBoard();
const boardA = add(ext, new T.PlaneGeometry(1.15, 1.35), boardMat, -6.15, 1.15, 8.15, { cast: false, receive: false });
boardA.rotation.y = 0.35;
const boardB = add(ext, new T.PlaneGeometry(1.15, 1.35), boardMat, -5.35, 1.15, 8.55, { cast: false, receive: false });
boardB.rotation.y = -0.4;
const shopLight = new T.PointLight(0xffb36b, PHONE ? 18 : 28, 16, 1.6);
shopLight.position.set(-1.5, 3.2, 8.2);
ext.add(shopLight);

function windowTex() {
  const cols = 4;
  const rows = 6;
  const cell = PHONE ? 8 : 16;
  return canvasTex(cols * cell, rows * cell, (g, w, h) => {
    g.fillStyle = '#1c2030';
    g.fillRect(0, 0, w, h);
    const cw = w / cols;
    const ch = h / rows;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        g.fillStyle = rand() < 0.55 ? (rand() < 0.5 ? '#ffd7a1' : '#c9d7ff') : '#2a3144';
        g.fillRect(x * cw + 2, y * ch + 2, cw - 4, ch - 4);
      }
    }
  });
}
const farMat = std(0x7d879c, 0.55, 0.1, { map: windowTex(), emissive: 0xffffff, emissiveMap: windowTex(), emissiveIntensity: 0.35 });
for (const [x, y, z, w, h, d] of [[-22, 6, -8, 8, 12, 7], [20, 5, -6, 8, 10, 7], [-4, 7, -16, 10, 14, 7]].slice(0, PHONE ? 2 : 3)) {
  add(ext, new T.BoxGeometry(w, h, d), farMat, x, y, z);
}

const int = new T.Group();
scene.add(int);
const floorTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#6a4630';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgb(${120 + ((rand() * 30) | 0)},${78 + ((rand() * 20) | 0)},${48})`;
    g.fillRect(0, i * (h / 14), w, h / 14 - 2);
  }
});
floorTex.wrapS = floorTex.wrapT = T.RepeatWrapping;
floorTex.repeat.set(4, 3);
add(int, new T.BoxGeometry(22, 0.2, 16), std(0xffffff, 0.72, 0.02, { map: floorTex }), 0, -0.1, 0, { cast: false });
add(int, new T.BoxGeometry(16, 0.04, 9), std(0x8a3e2c, 0.9), 0, 0.02, -0.2, { cast: false });
const wall = std(0xf0e6d8, 0.86);
add(int, new T.BoxGeometry(22, 4.4, 0.3), wall, 0, 2.2, -8);
add(int, new T.BoxGeometry(0.3, 4.4, 16), wall, -11, 2.2, 0);
add(int, new T.BoxGeometry(0.3, 4.4, 16), wall, 11, 2.2, 0);
add(int, new T.BoxGeometry(22, 0.18, 0.4), orange, 0, 4.3, -7.85);

function boardTexture(kind) {
  return canvasTex(512, 384, (g, w, h) => {
    g.fillStyle = '#f7f1e8';
    g.fillRect(0, 0, w, h);
    if (kind === 'swatch') {
      const cols = ['#14110e', '#f3ede2', '#f1641e', '#e8c27a', '#9a4e3c', '#2f4a35'];
      cols.forEach((c, i) => {
        g.fillStyle = c;
        g.fillRect(36 + (i % 3) * (w / 3.4), 40 + Math.floor(i / 3) * (h / 2.4), w / 3.8, h / 2.8);
      });
    } else if (kind === 'layout') {
      g.strokeStyle = '#2a2118';
      g.lineWidth = 3;
      g.strokeRect(28, 28, w - 56, h - 56);
      g.fillStyle = '#f1641e';
      g.fillRect(48, 52, w * 0.42, 28);
      for (let i = 0; i < 5; i++) {
        g.fillStyle = i % 2 ? '#e7d3b8' : '#d8c4a4';
        g.fillRect(48, 110 + i * 42, w - 96, 26);
      }
    } else {
      g.fillStyle = '#2a2118';
      g.fillRect(40, 40, w * 0.5, 18);
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 2; c++) {
          g.strokeStyle = '#c45c26';
          g.strokeRect(40 + c * (w * 0.46), 90 + r * 90, w * 0.4, 70);
        }
      }
    }
  });
}
const frameMat = std(0x8a6238, 0.45, 0.2);
[['swatch', -6], ['layout', -0.2], ['type', 5.6]].forEach(([kind, x]) => {
  add(int, new T.BoxGeometry(4.6, 3.1, 0.12), frameMat, x, 2.7, -7.7);
  const plane = add(int, new T.PlaneGeometry(4.2, 2.7), new T.MeshBasicMaterial({ map: boardTexture(kind) }), x, 2.7, -7.62, { cast: false, receive: false });
  plane.userData.decor = true;
});
add(int, new T.BoxGeometry(2.2, 1.15, 1.5), cream, -8.6, 0.7, 5.2);
add(int, new T.BoxGeometry(2.2, 0.18, 1.5), ink, -8.6, 1.32, 5.2);
const paper = add(int, new T.BoxGeometry(1.15, 0.02, 0.8), std(0xfffaf4, 0.8), -8.6, 1.46, 5.85, { cast: false });
add(int, new T.SphereGeometry(0.08, 8, 6), std(0xf1641e, 0.4, 0, { emissive: 0xf1641e, emissiveIntensity: 0.8 }), -7.7, 1.2, 5.15, { cast: false });
for (let i = 0; i < 4; i++) add(int, new T.BoxGeometry(1.3, 0.08, 0.95), std(0xfff7ee, 0.85), 9.4, 0.5 + i * 0.1, -2 + (i % 2) * 0.2, { cast: false });
add(int, new T.BoxGeometry(1.6, 1.4, 0.4), wood, 9.5, 0.8, -2);

const pendants = [];
for (const x of [-9.2, 9.2]) {
  add(int, new T.CylinderGeometry(0.03, 0.03, 0.7, 6), wood, x, 4.05, 0.2, { cast: false });
  add(int, new T.SphereGeometry(0.22, seg(12), seg(10)), bulbMat, x, 3.55, 0.2, { cast: false });
  const l = new T.PointLight(0xffb067, PHONE ? 12 : 18, 14, 1.5);
  l.position.set(x, 3.3, 0.2);
  int.add(l);
  pendants.push(l);
}

const tagRedraws = [];
function makeTag(text) {
  const c = document.createElement('canvas');
  c.width = PHONE ? 256 : 512;
  c.height = PHONE ? 72 : 112;
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  const sprite = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.position.set(0, 2.05, 0);
  sprite.scale.set(2.15, 0.46, 1);
  function draw() {
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(22,16,12,0.82)';
    g.beginPath();
    const r = 18;
    g.moveTo(r, 8);
    g.arcTo(c.width - 8, 8, c.width - 8, c.height - 8, r);
    g.arcTo(c.width - 8, c.height - 8, 8, c.height - 8, r);
    g.arcTo(8, c.height - 8, 8, 8, r);
    g.arcTo(8, 8, c.width - 8, 8, r);
    g.fill();
    g.fillStyle = '#f1641e';
    g.fillRect(c.width / 2 - 18, c.height - 16, 36, 5);
    g.fillStyle = '#f6efe6';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = Math.floor(c.height * 0.34);
    g.font = `600 ${size}px Inter, sans-serif`;
    while (g.measureText(text).width > c.width - 36 && size > 14) {
      size -= 2;
      g.font = `600 ${size}px Inter, sans-serif`;
    }
    g.fillText(text, c.width / 2, c.height * 0.46);
    tex.needsUpdate = true;
  }
  draw();
  tagRedraws.push(draw);
  return sprite;
}

const agentObjs = [];
const pickables = [];
let dressed = false;
function deskAt(parent, x, z) {
  add(parent, new T.BoxGeometry(1.7, 0.08, 0.9), wood, x, 0.78, z);
  for (const [dx, dz] of [[-0.72, -0.32], [0.72, -0.32], [-0.72, 0.32], [0.72, 0.32]]) {
    add(parent, new T.BoxGeometry(0.08, 0.7, 0.08), ink, x + dx, 0.38, z + dz, { cast: false });
  }
  add(parent, new T.BoxGeometry(0.62, 0.4, 0.05), ink, x, 1.12, z - 0.28);
  const screen = add(parent, new T.PlaneGeometry(0.54, 0.32), new T.MeshBasicMaterial({ color: rand() < 0.5 ? 0xffb067 : 0xf3eadf }), x, 1.12, z - 0.24, { cast: false, receive: false });
  screen.userData.decor = true;
  add(parent, new T.BoxGeometry(0.55, 0.08, 0.55), std(0x3a332c, 0.7), x, 0.46, z - 1.05);
  add(parent, new T.BoxGeometry(0.55, 0.45, 0.08), std(0x2a2622, 0.7), x, 0.7, z - 1.22);
}
function makeAgent(a, x, z) {
  const g = new T.Group();
  const shirt = std(a.color || '#e07a3d', 0.62);
  const skin = std(0xf0d2b8, 0.55);
  const dark = std(0x2a241f, 0.7);
  const hair = std(a.hair || '#3a2a24', 0.7);
  add(g, new T.CapsuleGeometry(0.26, 0.42, PHONE ? 1 : 3, seg(8)), shirt, 0, 1.05, 0);
  const head = add(g, new T.SphereGeometry(0.22, seg(12), seg(10)), skin, 0, 1.62, 0);
  add(g, new T.SphereGeometry(0.23, seg(10), seg(8), 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0, 1.7, -0.02);
  add(g, new T.SphereGeometry(0.028, 6, 6), dark, -0.08, 1.64, 0.18, { cast: false });
  add(g, new T.SphereGeometry(0.028, 6, 6), dark, 0.08, 1.64, 0.18, { cast: false });
  if (a.accessory === 'glasses') {
    const ring = new T.TorusGeometry(0.055, 0.012, 6, 10);
    add(g, ring, ink, -0.08, 1.64, 0.2, { cast: false });
    add(g, ring, ink, 0.08, 1.64, 0.2, { cast: false });
  } else if (a.accessory === 'beanie') {
    add(g, new T.SphereGeometry(0.2, seg(8), seg(6)), orange, 0, 1.78, 0, { cast: false });
  } else if (a.accessory === 'bun') {
    add(g, new T.SphereGeometry(0.1, seg(8), seg(6)), hair, 0, 1.92, -0.05, { cast: false });
  } else if (a.accessory === 'scarf') {
    add(g, new T.BoxGeometry(0.34, 0.1, 0.28), orange, 0, 1.32, 0.04, { cast: false });
  }
  const legL = new T.Group();
  const legR = new T.Group();
  legL.position.set(-0.1, 0.78, 0);
  legR.position.set(0.1, 0.78, 0);
  add(legL, new T.BoxGeometry(0.12, 0.55, 0.14), dark, 0, -0.28, 0);
  add(legR, new T.BoxGeometry(0.12, 0.55, 0.14), dark, 0, -0.28, 0);
  legL.rotation.x = -1.15;
  legR.rotation.x = -1.15;
  g.add(legL, legR);
  const armL = new T.Group();
  const armR = new T.Group();
  armL.position.set(-0.32, 1.22, 0);
  armR.position.set(0.32, 1.22, 0);
  add(armL, new T.BoxGeometry(0.1, 0.42, 0.12), shirt, 0, -0.2, 0);
  add(armR, new T.BoxGeometry(0.1, 0.42, 0.12), shirt, 0, -0.2, 0);
  armL.rotation.x = -1.05;
  armR.rotation.x = -1.05;
  g.add(armL, armR);
  const ring = add(g, new T.RingGeometry(0.42, 0.52, seg(20)), new T.MeshBasicMaterial({ color: 0xe8c27a, transparent: true, opacity: 0, side: T.DoubleSide }), 0, 0.05, 0.9, { cast: false, receive: false });
  ring.rotation.x = -Math.PI / 2;
  const tag = makeTag(a.name);
  g.add(tag);
  g.position.set(x, 0, z - 0.72);
  g.traverse((o) => {
    if (o.isMesh || o.isSprite) {
      o.userData.agentId = a.id;
      if (o.isMesh) pickables.push(o);
    }
  });
  tag.userData.agentId = a.id;
  pickables.push(tag);
  int.add(g);
  agentObjs.push({ id: a.id, g, head, armL, armR, ring, phase: rand() * 6.28 });
}
function dress(agents) {
  if (dressed) return;
  dressed = true;
  const xs = [-8, -4, 0, 4, 8];
  const rows = [-2.6, 2.15];
  let i = 0;
  for (const z of rows) {
    for (const x of xs) {
      deskAt(int, x, z);
      const a = agents[i] || FALLBACK[i];
      if (a) makeAgent(a, x, z);
      i++;
    }
  }
  window.__studioDressed = true;
  if (window.__selectedAgent) window.highlightAgent?.(window.__selectedAgent);
}

const fade = document.querySelector('#scene-fade');
function applyVisibility() {
  const inside = view === 'interior';
  ext.visible = !inside;
  sky.visible = !inside;
  int.visible = inside;
  scene.background = inside ? new T.Color(0x1a1410) : null;
  scene.fog.color.set(inside ? 0x1a1410 : 0x3a2a44);
  scene.fog.near = inside ? 18 : 36;
  scene.fog.far = inside ? 40 : 150;
  hemi.intensity = inside ? 0.7 : 0.85;
  hemi.color.set(inside ? 0xffe2c4 : 0x9aa6d4);
  sun.intensity = inside ? 0.35 : 1.65;
  document.querySelectorAll('[data-view]').forEach((b) => {
    const on = b.dataset.view === view;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  document.body.dataset.view = view;
}
let busy = false;
function go(next) {
  if (busy || next === view || window.__studioNo3d) return;
  busy = true;
  controls.enabled = false;
  fade.classList.add('on');
  setTimeout(() => {
    view = next;
    applyVisibility();
    placeCamera(view);
    fade.classList.remove('on');
    controls.enabled = true;
    busy = false;
    history.replaceState(null, '', next === 'interior' ? '#studio' : '#exterior');
  }, reduced ? 0 : 280);
}
function reset() {
  if (busy) return;
  placeCamera(view);
}
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));
document.querySelector('#reset-view').addEventListener('click', reset);

const ray = new T.Raycaster();
const ndc = new T.Vector2();
let down = null;
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, moved: false }; });
canvas.addEventListener('pointermove', (e) => { if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 7) down.moved = true; });
canvas.addEventListener('pointerup', (e) => {
  if (!down || down.moved || busy || window.__studioNo3d) { down = null; return; }
  down = null;
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  if (view === 'exterior') {
    const hits = ray.intersectObjects(ext.children, true);
    if (hits.length) go('interior');
    return;
  }
  const hit = ray.intersectObjects(pickables, false)[0];
  if (hit?.object.userData.agentId) window.selectAgent?.(hit.object.userData.agentId);
});
window.highlightAgent = (id) => {
  agentObjs.forEach((o) => { o.ring.material.opacity = o.id === id ? 0.95 : 0; });
};

let lostTimer = 0;
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  window.__studioContextLost = true;
  clearTimeout(lostTimer);
  lostTimer = setTimeout(() => { if (window.__studioContextLost) giveUp(); }, 2500);
}, false);
canvas.addEventListener('webglcontextrestored', () => {
  window.__studioContextLost = false;
  clearTimeout(lostTimer);
}, false);

function resize() {
  const w = wrap.clientWidth || 1;
  const h = wrap.clientHeight || 1;
  const phoneNow = coarse || w < 700;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, phoneNow ? 1.25 : 2));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < 520 ? 50 : 42;
  camera.updateProjectionMatrix();
}
resize();
placeCamera(view);
applyVisibility();
if (typeof ResizeObserver === 'function') new ResizeObserver(resize).observe(wrap);
else addEventListener('resize', resize);

function pixelsOk() {
  try {
    const gl = renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(4);
    let lit = 0;
    for (const [fx, fy] of [[0.5, 0.45], [0.3, 0.3], [0.7, 0.35], [0.5, 0.7], [0.2, 0.55]]) {
      gl.readPixels((w * fx) | 0, (h * fy) | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if (px[0] + px[1] + px[2] > 24) lit++;
    }
    return lit >= 2;
  } catch (e) {
    return true;
  }
}
function confirmIfReady() {
  if (window.__studioConfirmed || window.__studioNo3d) return;
  if ((window.__studioFrames || 0) < 10) return;
  if (PHONE && !pixelsOk()) return;
  window.__studioConfirmed = true;
  if (!wrap.classList.contains('no3d')) wrap.classList.add('is-3d');
}

let lastTick = 0;
let prev = performance.now();
function step(now) {
  if (window.__studioNo3d) return;
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;
  const t = now / 1000;
  if (!(document.hidden && window.__studioConfirmed)) {
    controls.update();
    if (ext.visible) {
      bulbs.forEach((b, i) => { b.material.emissiveIntensity = 1.4 + Math.sin(t * 3 + i) * 0.45; });
    }
    if (int.visible) {
      paper.position.z = 5.85 + Math.sin(t * 0.8) * 0.08;
      for (const o of agentObjs) {
        const k = Math.sin(t * 8 + o.phase);
        o.armL.rotation.x = -1.05 + k * 0.08;
        o.armR.rotation.x = -1.05 - k * 0.08;
        o.head.rotation.y = Math.sin(t * 0.5 + o.phase) * 0.25;
        if (o.ring.material.opacity > 0) o.ring.rotation.z = t;
      }
      pendants.forEach((l, i) => { l.intensity = (PHONE ? 12 : 18) * (1 + Math.sin(t * 1.6 + i) * 0.04); });
    }
    renderer.render(scene, camera);
    window.__studioFrames = (window.__studioFrames || 0) + 1;
    confirmIfReady();
  }
}
function frame(now) {
  if (window.__studioNo3d) return;
  const t = now || performance.now();
  if (t - lastTick < 14) return;
  lastTick = t;
  try { step(t); } catch (e) { giveUp(); }
}
renderer.setAnimationLoop((t) => frame(t));
(function beat() {
  if (window.__studioNo3d) return;
  if (performance.now() - lastTick > 80) frame(performance.now());
  setTimeout(beat, 48);
})();

fetch('data/preview.json')
  .then((r) => r.json())
  .then((data) => dress(data.agents || FALLBACK))
  .catch(() => dress(FALLBACK));

const fontsReady = Promise.race([
  document.fonts?.ready ?? Promise.resolve(),
  new Promise((res) => setTimeout(res, 2500)),
]);
fontsReady.then(() => {
  drawSign();
  drawBoard();
  tagRedraws.forEach((fn) => fn());
});
}
