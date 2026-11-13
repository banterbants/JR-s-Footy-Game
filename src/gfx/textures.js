// Every texture in the game is painted at runtime onto a canvas - there are no image files.
import * as THREE from '../../vendor/three.module.min.js';
import { F } from '../config.js';
import { makeRng } from '../util.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(c, { repeat = false, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function shade(hex, amt) {
  const c = new THREE.Color(hex);
  if (amt >= 0) c.lerp(new THREE.Color('#ffffff'), amt);
  else c.lerp(new THREE.Color('#000000'), -amt);
  return '#' + c.getHexString();
}

export function luminance(hex) {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

export function colourDistance(a, b) {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  return Math.hypot(ca.r - cb.r, ca.g - cb.g, ca.b - cb.b);
}

/** Mown turf for the whole ground. The plane it sits on is `w` x `h` metres. */
export function grassTexture(w, h, night, aniso) {
  const S = 2048;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const sx = S / w;
  const sz = S / h;
  const base = night ? ['#1f7a34', '#1a6b2d'] : ['#3fa544', '#379a3d'];
  g.fillStyle = base[0];
  g.fillRect(0, 0, S, S);
  // mowing stripes across the ground, then lighter cross-cuts for a checker pattern
  const band = 9;
  for (let i = 0, x = -w / 2; x < w / 2; x += band, i++) {
    if (i % 2) continue;
    g.fillStyle = base[1];
    g.fillRect((x + w / 2) * sx, 0, band * sx, S);
  }
  g.globalAlpha = 0.16;
  for (let i = 0, z = -h / 2; z < h / 2; z += band, i++) {
    if (i % 2) continue;
    g.fillStyle = '#0b3d14';
    g.fillRect(0, (z + h / 2) * sz, S, band * sz);
  }
  g.globalAlpha = 1;
  // gentle wear in the centre square and goal squares
  const wear = (x, z, r, a) => {
    const gr = g.createRadialGradient((x + w / 2) * sx, (z + h / 2) * sz, 0, (x + w / 2) * sx, (z + h / 2) * sz, r * sx);
    gr.addColorStop(0, `rgba(150,160,90,${a})`);
    gr.addColorStop(1, 'rgba(150,160,90,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  };
  wear(0, 0, 9, 0.2);
  wear(F.GX - 5, 0, 9, 0.16);
  wear(-F.GX + 5, 0, 9, 0.16);
  // fine grain
  const rng = makeRng(7);
  const img = g.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * 22;
    d[i] += n * 0.6;
    d[i + 1] += n;
    d[i + 2] += n * 0.5;
  }
  g.putImageData(img, 0, 0);
  // darker apron outside the boundary line
  g.save();
  g.beginPath();
  g.rect(0, 0, S, S);
  g.ellipse(S / 2, S / 2, (F.A + 0.4) * sx, (F.B + 0.4) * sz, 0, 0, Math.PI * 2, true);
  g.fillStyle = 'rgba(8,40,14,0.28)';
  g.fill('evenodd');
  g.restore();
  return toTexture(c, { aniso });
}

const CASUAL = ['#e8e8e8', '#30384a', '#b33a3a', '#4a6fa5', '#d9c9a3', '#2d2d2d', '#7a8c5c', '#c96f2a', '#8a5a9c', '#f0d24a'];
const SKINS = ['#f1c9a5', '#e2b08a', '#c98f66', '#a56b45', '#7a4a2d'];

/** A tileable block of spectators. `cheer` draws them on their feet with arms up. */
export function crowdTexture(homeDef, awayDef, cheer, night, seed = 1) {
  const W = 512;
  const H = 512;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const rng = makeRng(seed * 31 + 5);
  g.fillStyle = night ? '#141821' : '#343a48';
  g.fillRect(0, 0, W, H);
  const cw = 16;
  const rh = 32;
  const home = homeDef ? [homeDef.c1, homeDef.c2, homeDef.c1] : CASUAL;
  const away = awayDef ? [awayDef.c1, awayDef.c2] : CASUAL;
  for (let r = 0; r < H / rh; r++) {
    // seat row riser
    g.fillStyle = night ? '#0e1118' : '#272c38';
    g.fillRect(0, r * rh, W, 5);
    for (let i = 0; i < W / cw; i++) {
      if (rng() < 0.07) continue;
      const x = i * cw + (r % 2 ? cw / 2 : 0);
      const y = r * rh + rh;
      const k = rng();
      const pal = k < 0.5 ? home : k < 0.68 ? away : CASUAL;
      let col = pal[Math.floor(rng() * pal.length)];
      if (night) col = shade(col, -0.25);
      const skin = SKINS[Math.floor(rng() * SKINS.length)];
      const up = cheer && rng() < 0.8;
      const bodyH = up ? 19 : 14;
      for (const dx of [0, W, -W]) {
        const px = x + dx;
        if (px < -cw || px > W + cw) continue;
        g.fillStyle = col;
        g.fillRect(px + 2, y - bodyH + 2, cw - 4, bodyH - 2);
        g.fillRect(px + 4, y - bodyH, cw - 8, 2);
        g.fillStyle = night ? shade(skin, -0.2) : skin;
        g.beginPath();
        g.arc(px + cw / 2, y - bodyH - 4, 4.2, 0, Math.PI * 2);
        g.fill();
        if (up) {
          g.strokeStyle = col;
          g.lineWidth = 2.5;
          g.beginPath();
          g.moveTo(px + 3, y - bodyH + 3);
          g.lineTo(px + 1, y - bodyH - 10);
          g.moveTo(px + cw - 3, y - bodyH + 3);
          g.lineTo(px + cw - 1, y - bodyH - 10);
          g.stroke();
        }
      }
    }
  }
  return toTexture(c, { repeat: true, aniso: 4 });
}

const SPONSORS = [
  ["JR'S FOOTY", '#12264f', '#ffd21f'],
  ['SOUTHERN CROSS LEAGUE', '#f4f4f0', '#12264f'],
  ['SNAGS & SAUCE', '#b3261e', '#ffffff'],
  ['TRUE BLUE TYRES', '#1a5fd0', '#ffffff'],
  ['DROP PUNT COFFEE', '#3b2416', '#f3dfb0'],
  ['OUTBACK AIRWAYS', '#f6c62e', '#17171a'],
  ['FOUR POSTS BANK', '#0c6b43', '#ffffff'],
  ['SPECKY SPORTS', '#17171a', '#22d3c5'],
];

/** Advertising hoardings on the boundary fence. */
export function boardsTexture() {
  const pw = 512;
  const c = canvas(pw * SPONSORS.length, 64);
  const g = c.getContext('2d');
  SPONSORS.forEach(([text, bg, fg], i) => {
    g.fillStyle = bg;
    g.fillRect(i * pw, 0, pw, 64);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(i * pw, 0, pw, 26);
    g.fillStyle = fg;
    g.font = 'italic 800 40px "Barlow Condensed", "Arial Narrow", Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, i * pw + pw / 2, 35, pw - 30);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(i * pw, 0, 3, 64);
  });
  return toTexture(c, { repeat: true, aniso: 8 });
}

/** Windows of the corporate boxes between the two tiers. */
export function facadeTexture(night) {
  const c = canvas(256, 32);
  const g = c.getContext('2d');
  g.fillStyle = night ? '#0d1017' : '#252a35';
  g.fillRect(0, 0, 256, 32);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = night ? (i % 3 ? '#ffe9a8' : '#bfe4ff') : i % 3 ? '#5d7fa3' : '#7f9fbf';
    g.fillRect(i * 32 + 3, 7, 26, 16);
  }
  return toTexture(c, { repeat: true });
}

export function skyTexture(mode) {
  const c = canvas(16, 512);
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 512);
  if (mode === 'night') {
    gr.addColorStop(0, '#02040b');
    gr.addColorStop(0.45, '#0a1230');
    gr.addColorStop(0.5, '#1b2a55');
    gr.addColorStop(1, '#1b2a55');
  } else if (mode === 'dusk') {
    gr.addColorStop(0, '#1d2f6f');
    gr.addColorStop(0.3, '#5a4b8f');
    gr.addColorStop(0.43, '#f08a5d');
    gr.addColorStop(0.5, '#ffd08a');
    gr.addColorStop(1, '#ffd08a');
  } else {
    gr.addColorStop(0, '#1f6fd0');
    gr.addColorStop(0.3, '#4a9be8');
    gr.addColorStop(0.47, '#bfe2fb');
    gr.addColorStop(0.5, '#e6f4ff');
    gr.addColorStop(1, '#e6f4ff');
  }
  g.fillStyle = gr;
  g.fillRect(0, 0, 16, 512);
  return toTexture(c);
}

export function cloudTexture() {
  const c = canvas(256, 128);
  const g = c.getContext('2d');
  const rng = makeRng(42);
  for (let i = 0; i < 16; i++) {
    const x = 50 + rng() * 156;
    const y = 50 + rng() * 40;
    const r = 22 + rng() * 26;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.7)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 128);
  }
  return toTexture(c);
}

/** Soft round blob used for shadows, glows and particles. */
export function blobTexture(inner = 'rgba(0,0,0,0.55)', outer = 'rgba(0,0,0,0)') {
  const c = canvas(64, 64);
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, inner);
  gr.addColorStop(0.55, inner.replace(/[\d.]+\)$/, '0.3)'));
  gr.addColorStop(1, outer);
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return toTexture(c);
}

/** The red leather footy, with seams and laces. */
export function ballTexture() {
  const c = canvas(256, 128);
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, '#c9341f');
  gr.addColorStop(0.5, '#b02a18');
  gr.addColorStop(1, '#8a1f12');
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = 'rgba(60,10,5,0.55)';
  g.lineWidth = 2;
  for (const x of [0, 64, 128, 192, 256]) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 128);
    g.stroke();
  }
  // laces
  g.strokeStyle = '#f3ead8';
  g.lineWidth = 3;
  for (let y = 44; y <= 84; y += 8) {
    g.beginPath();
    g.moveTo(120, y);
    g.lineTo(136, y);
    g.stroke();
  }
  g.fillStyle = '#f3ead8';
  g.font = 'bold 15px sans-serif';
  g.textAlign = 'center';
  g.fillText('JR', 32, 70);
  return toTexture(c);
}

/**
 * Guernsey for one player: left half of the canvas is the front, right half the back.
 * kit = { base, trim, pattern }
 */
export function paintGuernsey(g, x, y, w, h, kit, number) {
  const { base, trim, pattern } = kit;
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = base;
  g.fillRect(x, y, w, h);
  g.fillStyle = trim;
  switch (pattern) {
    case 'vee':
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + w / 2, y + h * 0.5);
      g.lineTo(x + w, y);
      g.lineTo(x + w, y + h * 0.22);
      g.lineTo(x + w / 2, y + h * 0.72);
      g.lineTo(x, y + h * 0.22);
      g.closePath();
      g.fill();
      break;
    case 'sash':
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + w * 0.32, y);
      g.lineTo(x + w, y + h * 0.78);
      g.lineTo(x + w, y + h);
      g.lineTo(x + w * 0.68, y + h);
      g.lineTo(x, y + h * 0.22);
      g.closePath();
      g.fill();
      break;
    case 'yoke':
      g.fillRect(x, y, w, h * 0.3);
      g.fillStyle = shade(base, -0.72);
      g.fillRect(x, y + h * 0.3, w, h * 0.05);
      break;
    case 'hoops':
      for (let i = 0; i < 5; i += 2) g.fillRect(x, y + h * (0.12 + i * 0.17), w, h * 0.17);
      break;
    case 'stripes':
      for (let i = 0; i < 5; i += 2) g.fillRect(x + (w * (i + 0.5)) / 6, y, w / 6, h);
      break;
    case 'panel':
    default:
      g.fillRect(x, y, w * 0.16, h);
      g.fillRect(x + w * 0.84, y, w * 0.16, h);
      g.fillRect(x, y + h * 0.86, w, h * 0.14);
      break;
  }
  if (number != null) {
    const ink = luminance(base) > 0.55 ? '#16181d' : '#ffffff';
    g.font = `700 ${Math.round(h * 0.5)}px "Barlow Condensed", "Arial Narrow", Impact, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = Math.max(2, h * 0.06);
    g.strokeStyle = luminance(ink) > 0.5 ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.7)';
    g.strokeText(String(number), x + w / 2, y + h * 0.56);
    g.fillStyle = ink;
    g.fillText(String(number), x + w / 2, y + h * 0.56);
  }
  // collar
  g.fillStyle = shade(trim, -0.15);
  g.beginPath();
  g.ellipse(x + w / 2, y, w * 0.2, h * 0.09, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

export function guernseyTexture(kit, number) {
  const c = canvas(128, 64);
  const g = c.getContext('2d');
  paintGuernsey(g, 0, 0, 64, 64, kit, null);
  paintGuernsey(g, 64, 0, 64, 64, kit, number);
  const t = toTexture(c, { aniso: 2 });
  return t;
}

/** Works out what each side wears so the two teams never look alike. */
export function makeKits(homeDef, awayDef) {
  const home = { base: homeDef.c1, trim: homeDef.c2, pattern: homeDef.pattern, shorts: homeDef.shorts, socks: homeDef.socks };
  let away = { base: awayDef.c1, trim: awayDef.c2, pattern: awayDef.pattern, shorts: '#f4f4f0', socks: awayDef.socks };
  if (colourDistance(home.base, away.base) < 0.5) {
    away = { base: awayDef.c2, trim: awayDef.c1, pattern: awayDef.pattern, shorts: '#f4f4f0', socks: awayDef.c2 };
  }
  if (colourDistance(home.base, away.base) < 0.4) {
    away.base = luminance(home.base) > 0.5 ? '#1c1f26' : '#f4f4f0';
  }
  return [home, away];
}

/** Big screen at the end of the ground. */
export function makeScoreboard() {
  const c = canvas(512, 192);
  const g = c.getContext('2d');
  const tex = toTexture(c, { aniso: 4 });
  let last = '';
  function draw(m) {
    const [a, b] = m.teams;
    const key = `${a.goals}.${a.behinds}.${b.goals}.${b.behinds}.${m.quarter}.${Math.ceil(m.clock)}`;
    if (key === last) return;
    last = key;
    g.fillStyle = '#080b12';
    g.fillRect(0, 0, 512, 192);
    const row = (t, y) => {
      g.fillStyle = t.def.c1;
      g.fillRect(10, y, 14, 60);
      g.fillStyle = t.def.c2;
      g.fillRect(24, y, 6, 60);
      g.fillStyle = '#ffffff';
      g.font = 'italic 800 54px "Barlow Condensed", "Arial Narrow", Impact, sans-serif';
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText(t.def.id, 42, y + 33);
      g.fillStyle = '#ffd21f';
      g.textAlign = 'right';
      g.fillText(`${t.goals}.${t.behinds}`, 300, y + 33);
      g.fillStyle = '#ffffff';
      g.fillText(String(t.goals * 6 + t.behinds), 400, y + 33);
    };
    row(a, 14);
    row(b, 84);
    g.fillStyle = '#22d3c5';
    g.font = '700 30px "Barlow Condensed", "Arial Narrow", sans-serif';
    g.textAlign = 'center';
    g.fillText(`Q${m.quarter}`, 458, 50);
    const s = Math.max(0, Math.ceil(m.clock));
    g.fillStyle = '#ffffff';
    g.fillText(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, 458, 118);
    g.fillStyle = '#8a93a6';
    g.font = '600 20px "Barlow Condensed", "Arial Narrow", sans-serif';
    g.fillText("JR'S FOOTY  -  SOUTHERN CROSS LEAGUE", 256, 172);
    tex.needsUpdate = true;
  }
  return { tex, draw };
}
