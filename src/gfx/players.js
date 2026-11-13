// Low-poly footballers, built from primitives and animated procedurally.
// Model space: the player faces +X, +Y is up, his right hand is on +Z.
import * as THREE from '../../vendor/three.module.min.js';
import { clamp } from '../util.js';
import * as TX from './textures.js';

export const VIS_SCALE = 1.32; // players are drawn a little larger than life so they read on small screens
const HIP_Y = 0.93;

/** Merge primitive geometries into one, baking a colour into each. */
function merged(parts) {
  const pos = [];
  const nor = [];
  const col = [];
  const c = new THREE.Color();
  for (const [geo, colour, x = 0, y = 0, z = 0] of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.attributes.position;
    const n = g.attributes.normal;
    c.set(colour);
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i) + x, p.getY(i) + y, p.getZ(i) + z);
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(c.r, c.g, c.b);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

function torsoGeometry() {
  const g = new THREE.BoxGeometry(0.27, 0.58, 0.46, 1, 2, 1);
  const p = g.attributes.position;
  const uv = g.attributes.uv;
  const n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const v = (y + 0.29) / 0.58;
    const nx = n.getX(i);
    let u;
    if (nx > 0.5) u = uv.getX(i) * 0.5; // chest
    else if (nx < -0.5) u = 0.5 + uv.getX(i) * 0.5; // back, with the number
    else u = 0.008;
    uv.setXY(i, u, n.getY(i) > 0.5 ? 0.97 : n.getY(i) < -0.5 ? 0.03 : v);
    // taper to the waist, square the shoulders
    const k = 0.8 + 0.2 * v;
    p.setX(i, p.getX(i) * (0.9 + 0.1 * v));
    p.setZ(i, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

const cache = new Map();
function cached(key, make) {
  let v = cache.get(key);
  if (!v) {
    v = make();
    cache.set(key, v);
  }
  return v;
}

const sharedMat = () => cached('mat:vc', () => new THREE.MeshLambertMaterial({ vertexColors: true }));

function headGeometry(skin, hair, style, hat) {
  return cached(`head:${skin}:${hair}:${style}:${hat || ''}`, () => {
    const parts = [
      [new THREE.SphereGeometry(0.15, 12, 9), skin, 0, 0.02, 0],
      [new THREE.CylinderGeometry(0.06, 0.068, 0.12, 6), skin, 0, -0.14, 0],
    ];
    if (style !== 2) {
      const cap = new THREE.SphereGeometry(style === 1 ? 0.17 : 0.161, 12, 7, 0, Math.PI * 2, 0, Math.PI * (style === 1 ? 0.62 : 0.5));
      cap.rotateZ(0.32);
      parts.push([cap, hair, -0.014, 0.03, 0]);
    } else {
      const cap = new THREE.SphereGeometry(0.154, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.42);
      cap.rotateZ(0.3);
      parts.push([cap, TX.shade(hair, 0.15), -0.005, 0.022, 0]);
    }
    if (hat) {
      parts.push([new THREE.CylinderGeometry(0.27, 0.27, 0.025, 14), hat, 0, 0.1, 0]);
      parts.push([new THREE.CylinderGeometry(0.15, 0.165, 0.12, 12), hat, 0, 0.16, 0]);
    }
    return merged(parts);
  });
}

function limbGeometries(skin, socks, boot, sleeve = skin, thigh = skin) {
  return cached(`limbs:${skin}:${socks}:${boot}:${sleeve}:${thigh}`, () => ({
    upperArm: merged([
      [new THREE.SphereGeometry(0.075, 8, 6), sleeve, 0, 0, 0],
      [new THREE.CylinderGeometry(0.064, 0.054, 0.29, 7), sleeve, 0, -0.145, 0],
    ]),
    foreArm: merged([
      [new THREE.CylinderGeometry(0.054, 0.046, 0.27, 7), skin, 0, -0.135, 0],
      [new THREE.SphereGeometry(0.062, 7, 6), skin, 0, -0.29, 0],
    ]),
    thigh: merged([[new THREE.CylinderGeometry(0.098, 0.074, 0.44, 8), thigh, 0, -0.22, 0]]),
    shin: merged([
      [new THREE.CylinderGeometry(0.07, 0.056, 0.4, 8), socks, 0, -0.2, 0],
      [new THREE.SphereGeometry(0.075, 7, 6), thigh, 0, 0, 0],
      [new THREE.BoxGeometry(0.28, 0.11, 0.125), boot, 0.065, -0.44, 0],
    ]),
  }));
}

const torsoGeo = () => cached('torso', torsoGeometry);
const shortsGeo = () => cached('shorts', () => {
  const g = new THREE.BoxGeometry(0.29, 0.29, 0.41);
  return g;
});

// Joint angles the animation drives. Everything eases toward a target pose.
const JOINTS = ['armLz', 'armLx', 'foreL', 'armRz', 'armRx', 'foreR', 'legL', 'shinL', 'legR', 'shinR', 'lean', 'yOff', 'pitch', 'twist'];

export class PlayerView {
  constructor(p, kit, castShadow) {
    this.p = p;
    this.phase = Math.random() * 6;
    this.catchT = 0;
    this.cur = {};
    this.tgt = {};
    for (const j of JOINTS) {
      this.cur[j] = 0;
      this.tgt[j] = 0;
    }
    const s = (p.attr.height / 1.85) * VIS_SCALE;
    this.scale = s;
    const mat = sharedMat();
    const limbs = limbGeometries(p.look.skin, kit.socks, kit.boots || (p.idx % 4 === 0 ? '#f2f2f2' : '#15171c'), kit.sleeve, kit.thigh);

    this.root = new THREE.Group();
    this.root.scale.setScalar(s);
    this.pose = new THREE.Group();
    this.root.add(this.pose);
    this.body = new THREE.Group();
    this.body.position.y = HIP_Y;
    this.pose.add(this.body);

    this.tex = TX.guernseyTexture(kit, p.number);
    this.torsoMat = new THREE.MeshLambertMaterial({ map: this.tex });
    const torso = new THREE.Mesh(torsoGeo(), this.torsoMat);
    torso.position.y = 0.29;
    this.body.add(torso);
    const shorts = new THREE.Mesh(shortsGeo(), cached(`shorts:${kit.shorts}`, () => new THREE.MeshLambertMaterial({ color: kit.shorts })));
    shorts.position.y = -0.02;
    this.body.add(shorts);
    const head = new THREE.Mesh(headGeometry(p.look.skin, p.look.hair, p.look.style, kit.hat), mat);
    head.position.y = 0.79;
    this.body.add(head);
    this.head = head;

    const arm = (side) => {
      const sh = new THREE.Group();
      sh.position.set(0, 0.52, side * 0.285);
      sh.add(new THREE.Mesh(limbs.upperArm, mat));
      const el = new THREE.Group();
      el.position.y = -0.29;
      el.add(new THREE.Mesh(limbs.foreArm, mat));
      sh.add(el);
      this.body.add(sh);
      return [sh, el];
    };
    [this.armL, this.foreL] = arm(-1);
    [this.armR, this.foreR] = arm(1);

    const leg = (side) => {
      const hip = new THREE.Group();
      hip.position.set(0, HIP_Y, side * 0.105);
      hip.add(new THREE.Mesh(limbs.thigh, mat));
      const knee = new THREE.Group();
      knee.position.y = -0.44;
      knee.add(new THREE.Mesh(limbs.shin, mat));
      hip.add(knee);
      this.pose.add(hip);
      return [hip, knee];
    };
    [this.legL, this.shinL] = leg(-1);
    [this.legR, this.shinR] = leg(1);

    if (kit.flags) {
      const fm = cached('mat:flag', () => new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
      const fg = cached('geo:flag', () => {
        const g = new THREE.PlaneGeometry(0.5, 0.38);
        g.translate(0.27, -0.52, 0);
        return g;
      });
      const sg = cached('geo:stick', () => {
        const g = new THREE.CylinderGeometry(0.012, 0.012, 0.5, 5);
        g.translate(0, -0.5, 0);
        return g;
      });
      this.flags = [];
      for (const fore of [this.foreL, this.foreR]) {
        const f = new THREE.Group();
        f.add(new THREE.Mesh(fg, fm), new THREE.Mesh(sg, fm));
        f.visible = false;
        fore.add(f);
        this.flags.push(f);
      }
    }
    if (castShadow) this.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }

  dispose() {
    this.tex.dispose();
    this.torsoMat.dispose();
  }

  /** Where the ball sits when this player is carrying it (world space). */
  ballHoldPos(out, time) {
    const p = this.p;
    const s = this.scale;
    let fx = 0.3;
    let fy = 1.0;
    let fz = 0.17;
    if (p.charging) {
      fx = 0.4;
      fy = 0.92;
      fz = 0.04;
    }
    // running bounce every dozen metres or so
    const lap = p.carryDist % 13;
    if (p.carryDist > 8 && lap < 2.2 && Math.hypot(p.vx, p.vz) > 5 && !p.charging) {
      fy -= Math.sin((lap / 2.2) * Math.PI) * 0.86;
      fx += 0.25;
    }
    fy += this.cur.yOff;
    const c = Math.cos(p.face);
    const sn = Math.sin(p.face);
    out.set(p.x + (fx * c - fz * sn) * s, fy * s, p.z + (fx * sn + fz * c) * s);
    return out;
  }

  update(dt, time, info) {
    const p = this.p;
    const t = this.tgt;
    const speed = Math.hypot(p.vx, p.vz);
    const run = clamp(speed / 8, 0, 1.25);
    this.phase += dt * (speed > 0.3 ? 5 + speed * 1.2 : 0);
    const ph = this.phase;
    const sw = Math.sin(ph);
    const cw = Math.cos(ph);
    let rate = 16;

    // ---- base locomotion
    t.legL = sw * 0.95 * run;
    t.legR = -sw * 0.95 * run;
    t.shinL = -(0.15 + 1.25 * Math.max(0, cw)) * run;
    t.shinR = -(0.15 + 1.25 * Math.max(0, -cw)) * run;
    t.armLz = -sw * 0.9 * run + 0.05;
    t.armRz = sw * 0.9 * run + 0.05;
    t.armLx = 0.12;
    t.armRx = -0.12;
    t.foreL = 0.25 + 1.2 * Math.min(1, run);
    t.foreR = t.foreL;
    t.lean = -(0.03 + 0.2 * run);
    t.yOff = Math.abs(sw) * 0.05 * run;
    t.pitch = 0;
    t.twist = 0;
    if (speed < 0.3) {
      const b = Math.sin(time * 1.7 + p.idx);
      t.armLz = 0.04 + b * 0.03;
      t.armRz = 0.04 - b * 0.03;
      t.yOff = b * 0.006;
    }

    // ---- carrying the ball
    if (p.hasBall) {
      if (p.charging || info.setShot) {
        t.armLz = 0.95;
        t.armRz = 0.95;
        t.foreL = 0.7;
        t.foreR = 0.7;
        t.armLx = -0.2;
        t.armRx = 0.2;
      } else {
        t.armRz = 0.55;
        t.foreR = 1.5;
        t.armRx = 0.25;
      }
    }
    if (this.catchT > 0) {
      this.catchT -= dt;
      t.armLz = 1.9;
      t.armRz = 1.9;
      t.foreL = 0.5;
      t.foreR = 0.5;
      t.armLx = -0.15;
      t.armRx = 0.15;
    }
    if (info.onMark && speed < 2) {
      const w = Math.sin(time * 9 + p.idx) * 0.25;
      t.armLz = 2.5 + w;
      t.armRz = 2.5 - w;
      t.armLx = 0.45;
      t.armRx = -0.45;
      t.foreL = 0.2;
      t.foreR = 0.2;
    }

    // ---- one-off actions
    const a = p.action;
    const u = p.actionDur > 0 ? clamp(p.actionT / p.actionDur, 0, 1) : 0;
    if (a === 'kick') {
      rate = 40;
      const k = u < 0.3 ? u / 0.3 : 1 - (u - 0.3) / 0.7;
      t.legR = 0.25 + 1.5 * k;
      t.shinR = -0.1 - 0.5 * (1 - k);
      t.legL = -0.25;
      t.shinL = -0.15;
      t.armLz = 1.25;
      t.armLx = 0.5;
      t.armRz = -0.7;
      t.foreL = 0.3;
      t.foreR = 0.4;
      t.lean = 0.12;
      t.yOff = 0.06 * k;
    } else if (a === 'handball') {
      rate = 40;
      const k = u < 0.35 ? u / 0.35 : 1;
      t.armRz = -0.6 + 1.9 * k;
      t.foreR = 0.7;
      t.armLz = 0.95;
      t.foreL = 0.8;
      t.armLx = -0.25;
      t.lean = -0.3;
    } else if (a === 'jump') {
      rate = 26;
      t.yOff = Math.sin(u * Math.PI) * 1.15;
      t.armLz = 2.8;
      t.armRz = 2.8;
      t.armLx = 0.12;
      t.armRx = -0.12;
      t.foreL = 0.12;
      t.foreR = 0.12;
      t.legL = 0.75;
      t.shinL = -1.2;
      t.legR = -0.35;
      t.shinR = -0.5;
      t.lean = 0.05;
    } else if (a === 'tackle') {
      rate = 30;
      t.lean = -1.05;
      t.armLz = 1.6;
      t.armRz = 1.6;
      t.armLx = 0.55;
      t.armRx = -0.55;
      t.foreL = 0.3;
      t.foreR = 0.3;
      t.legL = -0.7;
      t.legR = -0.25;
      t.shinL = -0.3;
      t.shinR = -0.6;
      t.yOff = -0.12;
    } else if (a === 'down') {
      rate = 14;
      const up = u > 0.72 ? (u - 0.72) / 0.28 : 0;
      t.pitch = -1.45 * (1 - up);
      t.yOff = 0.12 * (1 - up);
      t.armLz = 1.9;
      t.armRz = 1.4;
      t.legL = 0.2;
      t.legR = -0.3;
      t.shinL = -0.5 * (1 - up);
      t.shinR = -0.2;
      t.lean = 0;
    } else if (a === 'stumble') {
      rate = 20;
      t.lean = -0.75;
      t.armLz = 0.9 + Math.sin(time * 22) * 0.5;
      t.armRz = 0.9 - Math.sin(time * 22) * 0.5;
      t.armLx = 0.6;
      t.armRx = -0.6;
      t.legL = 0.5;
      t.legR = -0.5;
      t.shinR = -0.7;
    } else if (a === 'signalGoal' || a === 'signalBehind') {
      // goal umpire: point first (two hands for a goal, one for a behind), then wave the flags
      const both = a === 'signalGoal';
      const wave = u > 0.3;
      const w = Math.sin(time * 10);
      if (!wave) {
        rate = 20;
        t.armRz = 1.45;
        t.foreR = 0.05;
        t.armRx = -0.1;
        if (both) {
          t.armLz = 1.45;
          t.foreL = 0.05;
          t.armLx = 0.1;
        }
      } else {
        rate = 22;
        t.armRz = 2.3 + w * 0.55;
        t.armRx = -0.25 - w * 0.5;
        t.foreR = 0.1;
        if (both) {
          t.armLz = 2.3 - w * 0.55;
          t.armLx = 0.25 - w * 0.5;
          t.foreL = 0.1;
        }
      }
      if (this.flags) {
        this.flags[1].visible = wave;
        this.flags[0].visible = wave && both;
      }
    } else if (a === 'celebrate') {
      const w = Math.sin(time * 9 + p.idx);
      t.armLz = 2.7 + w * 0.3;
      t.armRz = 2.7 - w * 0.3;
      t.armLx = 0.35;
      t.armRx = -0.35;
      t.foreL = 0.25;
      t.foreR = 0.25;
      t.yOff = Math.abs(Math.sin(time * 6.5 + p.idx)) * 0.28;
      t.lean = 0.08;
    }

    if (this.flags && a !== 'signalGoal' && a !== 'signalBehind') {
      this.flags[0].visible = false;
      this.flags[1].visible = false;
    }

    // ---- ease joints toward the target pose
    const k = Math.min(1, dt * rate);
    const c = this.cur;
    for (const j of JOINTS) c[j] += (t[j] - c[j]) * k;

    this.root.position.set(p.x, 0, p.z);
    this.root.rotation.y = -p.face;
    this.pose.position.y = c.yOff;
    this.pose.rotation.z = c.pitch;
    this.body.rotation.z = c.lean;
    this.armL.rotation.set(c.armLx, 0, c.armLz);
    this.armR.rotation.set(c.armRx, 0, c.armRz);
    this.foreL.rotation.z = c.foreL;
    this.foreR.rotation.z = c.foreR;
    this.legL.rotation.z = c.legL;
    this.legR.rotation.z = c.legR;
    this.shinL.rotation.z = c.shinL;
    this.shinR.rotation.z = c.shinR;
  }
}
