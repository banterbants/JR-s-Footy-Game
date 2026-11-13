// Small math helpers shared by the simulation and the renderer.
import { F } from './config.js';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const hypot = Math.hypot;
export const TAU = Math.PI * 2;

/** Deterministic PRNG (mulberry32) so matches can be replayed in tests. */
export function makeRng(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Signed smallest difference between two angles. */
export function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

/** Ellipse value: < 1 inside the boundary line, > 1 outside. */
export function fieldValue(x, z, margin = 0) {
  const a = F.A - margin;
  const b = F.B - margin;
  return (x * x) / (a * a) + (z * z) / (b * b);
}

/** Pull a point back inside the boundary (shrunk by `margin` metres). */
export function clampToField(x, z, margin = 0) {
  const v = fieldValue(x, z, margin);
  if (v <= 1) return [x, z];
  const s = 1 / Math.sqrt(v);
  return [x * s, z * s];
}

export function dist(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
}

/** Roughly normal random number from a uniform rng (mean 0, sd 1). */
export function gauss(rng) {
  return (rng() + rng() + rng() + rng() - 2) * 1.732;
}

export function fmtClock(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function scoreLine(t) {
  return `${t.goals}.${t.behinds} (${t.goals * 6 + t.behinds})`;
}
