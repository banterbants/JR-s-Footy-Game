// The ground: turf, line markings, goal posts, fence, grandstands, lights and sky.
import * as THREE from '../../vendor/three.module.min.js';
import { F } from '../config.js';
import { fieldValue } from '../util.js';
import * as TX from './textures.js';

const TAU = Math.PI * 2;

/** A band swept around the oval between two (offset, height) rails. */
function ringStrip({ off0, y0, off1, y1, t0 = 0, t1 = TAU, seg = 96, uRep = 1, vRep = 1, want = 'in' }) {
  const pos = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i <= seg; i++) {
    const t = t0 + ((t1 - t0) * i) / seg;
    const c = Math.cos(t);
    const s = Math.sin(t);
    pos.push((F.A + off0) * c, y0, (F.B + off0) * s, (F.A + off1) * c, y1, (F.B + off1) * s);
    uv.push((i / seg) * uRep, 0, (i / seg) * uRep, vRep);
  }
  // work out the winding that makes the surface face the way we want
  const a = new THREE.Vector3(pos[0], pos[1], pos[2]);
  const b = new THREE.Vector3(pos[3], pos[4], pos[5]);
  const c2 = new THREE.Vector3(pos[6], pos[7], pos[8]);
  const n = new THREE.Vector3().subVectors(c2, a).cross(new THREE.Vector3().subVectors(b, a));
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const dirs = {
    in: new THREE.Vector3(-mid.x, 0, -mid.z).normalize().add(new THREE.Vector3(0, 0.3, 0)),
    out: new THREE.Vector3(mid.x, 0, mid.z).normalize(),
    up: new THREE.Vector3(0, 1, 0),
    down: new THREE.Vector3(0, -1, 0),
  };
  const flip = n.dot(dirs[want]) < 0;
  for (let i = 0; i < seg; i++) {
    const p = i * 2;
    if (flip) idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2);
    else idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Collects painted lines (flat ribbons just above the turf) into one mesh. */
class LineBuilder {
  constructor(width = 0.22) {
    this.w = width;
    this.pos = [];
    this.idx = [];
  }

  path(pts, closed = false) {
    const n = pts.length;
    const start = this.pos.length / 3;
    const h = this.w / 2;
    for (let i = 0; i < n; i++) {
      const prev = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
      const next = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      let dx = next[0] - prev[0];
      let dz = next[1] - prev[1];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      this.pos.push(pts[i][0] - dz * h, 0.035, pts[i][1] + dx * h, pts[i][0] + dz * h, 0.035, pts[i][1] - dx * h);
    }
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = start + i * 2;
      const b = start + ((i + 1) % n) * 2;
      this.idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setIndex(this.idx);
    return g;
  }
}

export class Stadium {
  constructor(mode = 'day', aniso = 4) {
    this.mode = mode;
    this.group = new THREE.Group();
    this.cheerT = 0;
    this.time = 0;
    const night = mode === 'night';
    const dusk = mode === 'dusk';
    const g = this.group;

    // ---- sky
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(1400, 24, 16),
      new THREE.MeshBasicMaterial({ map: TX.skyTexture(mode), side: THREE.BackSide, fog: false, depthWrite: false }),
    );
    sky.renderOrder = -10;
    g.add(sky);
    if (!night) {
      const ct = TX.cloudTexture();
      const cm = new THREE.SpriteMaterial({ map: ct, transparent: true, opacity: dusk ? 0.55 : 0.9, fog: false, depthWrite: false, color: dusk ? 0xffc9a0 : 0xffffff });
      for (let i = 0; i < 9; i++) {
        const s = new THREE.Sprite(cm);
        const a = (i / 9) * TAU + 0.4;
        s.position.set(Math.cos(a) * 900, 190 + ((i * 53) % 170), Math.sin(a) * 900);
        s.scale.set(520 + ((i * 97) % 240), 190, 1);
        g.add(s);
      }
    }
    const outside = new THREE.Mesh(new THREE.CircleGeometry(1400, 32), new THREE.MeshBasicMaterial({ color: night ? 0x070a12 : dusk ? 0x4a4552 : 0x6f8a78, fog: false }));
    outside.rotation.x = -Math.PI / 2;
    outside.position.y = -1;
    g.add(outside);

    // ---- lights
    this.lights = new THREE.Group();
    g.add(this.lights);
    if (night) {
      this.lights.add(new THREE.HemisphereLight(0x9fb4ff, 0x1c3a22, 1.25));
      const l1 = new THREE.DirectionalLight(0xf2f6ff, 1.7);
      l1.position.set(90, 80, 90);
      const l2 = new THREE.DirectionalLight(0xf2f6ff, 1.3);
      l2.position.set(-90, 80, -70);
      this.lights.add(l1, l2);
      this.sun = l1;
    } else if (dusk) {
      this.lights.add(new THREE.HemisphereLight(0xffd3b0, 0x35503a, 1.7));
      const sun = new THREE.DirectionalLight(0xffb37a, 2.3);
      sun.position.set(-150, 55, 70);
      this.lights.add(sun);
      this.sun = sun;
    } else {
      this.lights.add(new THREE.HemisphereLight(0xe4f2ff, 0x4d7f48, 2.1));
      const sun = new THREE.DirectionalLight(0xfff1d6, 2.5);
      sun.position.set(70, 130, 90);
      this.lights.add(sun);
      this.sun = sun;
    }

    // ---- turf
    const GW = (F.A + 12) * 2;
    const GH = (F.B + 12) * 2;
    const turf = new THREE.Mesh(new THREE.PlaneGeometry(GW, GH), new THREE.MeshLambertMaterial({ map: TX.grassTexture(GW, GH, night, aniso) }));
    turf.rotation.x = -Math.PI / 2;
    turf.receiveShadow = true;
    g.add(turf);
    this.turf = turf;

    // ---- line markings
    const lb = new LineBuilder(0.24);
    const boundary = [];
    for (let i = 0; i < 180; i++) {
      const t = (i / 180) * TAU;
      let x = F.A * Math.cos(t);
      const z = F.B * Math.sin(t);
      if (Math.abs(z) <= F.BEHIND_HALF && Math.abs(x) > 70) x = Math.sign(x) * F.GX;
      boundary.push([x, z]);
    }
    lb.path(boundary, true);
    const S = F.SQUARE;
    lb.path([[-S, -S], [S, -S], [S, S], [-S, S]], true);
    const circle = (r, n = 40) => Array.from({ length: n }, (_, i) => [r * Math.cos((i / n) * TAU), r * Math.sin((i / n) * TAU)]);
    lb.path(circle(1.5, 24), true);
    lb.path(circle(5), true);
    lb.path([[0, -7], [0, 7]]);
    for (const s of [1, -1]) {
      const arc = [];
      for (let i = 0; i <= 60; i++) {
        const a = -Math.PI / 2 + (i / 60) * Math.PI;
        const x = s * (F.GX - F.ARC * Math.cos(a));
        const z = F.ARC * Math.sin(a);
        if (fieldValue(x, z) <= 1) arc.push([x, z]);
      }
      lb.path(arc);
      lb.path([[s * F.GX, -F.GOAL_HALF], [s * (F.GX - F.GSQ), -F.GOAL_HALF], [s * (F.GX - F.GSQ), F.GOAL_HALF], [s * F.GX, F.GOAL_HALF]]);
    }
    const lines = new THREE.Mesh(lb.build(), new THREE.MeshBasicMaterial({ color: night ? 0xdfe8e2 : 0xf7fbf7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    g.add(lines);

    // ---- goal posts
    const postMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: night ? 0x555555 : 0x222222 });
    this.padMats = [new THREE.MeshLambertMaterial({ color: 0x1a5fd0 }), new THREE.MeshLambertMaterial({ color: 0xd0241a })];
    for (const s of [1, -1]) {
      for (const [z, h] of [[-F.BEHIND_HALF, F.BPOST_H], [-F.GOAL_HALF, F.POST_H], [F.GOAL_HALF, F.POST_H], [F.BEHIND_HALF, F.BPOST_H]]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, h, 10), postMat);
        post.position.set(s * F.GX, h / 2, z);
        post.castShadow = true;
        g.add(post);
        const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 2.4, 12), this.padMats[s > 0 ? 0 : 1]);
        pad.position.set(s * F.GX, 1.2, z);
        g.add(pad);
      }
    }

    // ---- fence with advertising, and the concourse behind it
    const boards = TX.boardsTexture();
    boards.anisotropy = aniso;
    const fence = new THREE.Mesh(
      ringStrip({ off0: 5.5, y0: 0, off1: 5.5, y1: 1.2, uRep: 10, vRep: 1, want: 'in', seg: 128 }),
      new THREE.MeshLambertMaterial({ map: boards, emissive: night ? 0x444444 : 0x000000, emissiveMap: night ? boards : null }),
    );
    g.add(fence);
    const concrete = new THREE.MeshLambertMaterial({ color: night ? 0x30343d : 0x9aa0a8 });
    g.add(new THREE.Mesh(ringStrip({ off0: 5.5, y0: 0.04, off1: 9, y1: 0.04, want: 'up' }), concrete));
    g.add(new THREE.Mesh(ringStrip({ off0: 5.5, y0: 1.2, off1: 5.8, y1: 1.2, want: 'up' }), concrete));

    // ---- grandstands
    const dark = new THREE.MeshLambertMaterial({ color: night ? 0x151924 : 0x2c3442 });
    this.crowdTex = [null, null];
    this.crowdMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    g.add(new THREE.Mesh(ringStrip({ off0: 8, y0: 0, off1: 8, y1: 1.7, want: 'in' }), dark));
    g.add(new THREE.Mesh(ringStrip({ off0: 8, y0: 1.7, off1: 27, y1: 12, uRep: 26, vRep: 1.72, want: 'in' }), this.crowdMat));
    const facade = TX.facadeTexture(night);
    g.add(new THREE.Mesh(
      ringStrip({ off0: 27, y0: 12, off1: 27, y1: 14.8, uRep: 60, vRep: 1, want: 'in' }),
      new THREE.MeshLambertMaterial({ map: facade, emissive: night ? 0x888888 : 0x000000, emissiveMap: night ? facade : null }),
    ));
    g.add(new THREE.Mesh(ringStrip({ off0: 27, y0: 14.8, off1: 46, y1: 28.5, uRep: 30, vRep: 1.84, want: 'in' }), this.crowdMat));
    g.add(new THREE.Mesh(ringStrip({ off0: 46, y0: 28.5, off1: 46, y1: 32, want: 'in' }), dark));
    g.add(new THREE.Mesh(ringStrip({ off0: 46, y0: 32, off1: 50, y1: 32, want: 'up' }), dark));
    g.add(new THREE.Mesh(ringStrip({ off0: 50, y0: 32, off1: 52, y1: -1, want: 'out' }), dark));
    // roof over the far (northern) stand
    const r0 = Math.PI + 0.42;
    const r1 = TAU - 0.42;
    const roofUnder = new THREE.MeshLambertMaterial({ color: night ? 0x3a4050 : 0xd9dee6 });
    const roofTop = new THREE.MeshLambertMaterial({ color: night ? 0x222733 : 0xb8c0cc });
    g.add(new THREE.Mesh(ringStrip({ off0: 30, y0: 40, off1: 50, y1: 36.5, t0: r0, t1: r1, want: 'down' }), roofUnder));
    g.add(new THREE.Mesh(ringStrip({ off0: 30, y0: 40.2, off1: 50, y1: 36.7, t0: r0, t1: r1, want: 'up' }), roofTop));
    g.add(new THREE.Mesh(ringStrip({ off0: 30, y0: 40, off1: 30, y1: 40.2, t0: r0, t1: r1, want: 'in' }), roofTop));
    g.add(new THREE.Mesh(ringStrip({ off0: 49, y0: 32, off1: 49, y1: 36.6, t0: r0, t1: r1, want: 'in' }), dark));

    // ---- light towers
    const towerMat = new THREE.MeshLambertMaterial({ color: night ? 0x2a2f3a : 0x7d8794 });
    const lampMat = new THREE.MeshBasicMaterial({ color: night || dusk ? 0xffffff : 0xdfe6ee });
    const glow = night || dusk ? new THREE.SpriteMaterial({ map: TX.blobTexture('rgba(255,255,235,0.9)', 'rgba(255,255,235,0)'), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }) : null;
    for (const t of [0.66, Math.PI - 0.66, Math.PI + 0.66, TAU - 0.66]) {
      const x = (F.A + 58) * Math.cos(t);
      const z = (F.B + 58) * Math.sin(t);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.3, 58, 8), towerMat);
      pole.position.set(x, 28, z);
      g.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(14, 8, 1.2), lampMat);
      head.position.set(x, 60, z);
      head.lookAt(0, 0, 0);
      g.add(head);
      if (glow) {
        const s = new THREE.Sprite(glow);
        s.position.set(x * 0.985, 60, z * 0.985);
        s.scale.set(46, 46, 1);
        g.add(s);
      }
    }

    // ---- scoreboards at each end
    this.scoreboard = TX.makeScoreboard();
    const frameMat = new THREE.MeshLambertMaterial({ color: 0x11151d });
    for (const s of [1, -1]) {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(2, 13, 34), frameMat);
      frame.position.set(s * (F.A + 48), 39, 0);
      g.add(frame);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(32, 12), new THREE.MeshBasicMaterial({ map: this.scoreboard.tex, fog: false }));
      screen.position.set(s * (F.A + 46.9), 39, 0);
      screen.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
      g.add(screen);
      for (const z of [-12, 12]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 6, 1.2), frameMat);
        leg.position.set(s * (F.A + 48), 30.5, z);
        g.add(leg);
      }
    }
  }

  /** Dress the ground for the two clubs playing. */
  setTeams(home, away) {
    const night = this.mode === 'night';
    for (const t of this.crowdTex) if (t) t.dispose();
    this.crowdTex = [TX.crowdTexture(home, away, false, night, 1), TX.crowdTexture(home, away, true, night, 1)];
    this.crowdMat.map = this.crowdTex[0];
    this.crowdMat.needsUpdate = true;
    this.home = home;
    this.away = away;
  }

  /** Colour the goal-post pads for whoever is kicking to each end. */
  setEnds(plusXTeam, minusXTeam) {
    this.padMats[0].color.set(plusXTeam.c1);
    this.padMats[1].color.set(minusXTeam.c1);
  }

  cheer(seconds = 3) {
    this.cheerT = Math.max(this.cheerT, seconds);
  }

  update(dt) {
    this.time += dt;
    if (this.cheerT > 0) {
      this.cheerT -= dt;
      const up = this.cheerT > 0 && Math.floor(this.time * 7) % 2 === 0;
      const want = this.crowdTex[up ? 1 : 0];
      if (want && this.crowdMat.map !== want) this.crowdMat.map = want;
    }
  }
}
