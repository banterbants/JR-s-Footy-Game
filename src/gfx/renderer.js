// Scene management: stadium, player models, ball, on-field markers, particles and cameras.
import * as THREE from '../../vendor/three.module.min.js';
import { F } from '../config.js';
import { clamp, lerp } from '../util.js';
import * as TX from './textures.js';
import { Stadium } from './stadium.js';
import { PlayerView, VIS_SCALE } from './players.js';
import { emblemImage } from '../emblems.js';
import { RUCK_RING } from '../sim/match.js';

const MAX_PARTICLES = 520;
const TRAIL = 16;
const UP = new THREE.Vector3(0, 1, 0);

export class GameRenderer {
  constructor(canvas, quality) {
    this.canvas = canvas;
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.antialias, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = !!quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1.78, 0.5, 3000);
    this.camPos = new THREE.Vector3(0, 60, 110);
    this.camLook = new THREE.Vector3(0, 0, 0);
    this.camera.position.copy(this.camPos);
    this.camMode = 'orbit';
    this.shakeAmt = 0;
    this.time = 0;
    this.views = new Map();
    this.stadium = null;
    this.mode = null;
    this.tmp = new THREE.Vector3();
    this.tmp2 = new THREE.Vector3();
    this.dummy = new THREE.Object3D();
    this.buildProps();
    this.resize();
  }

  // ------------------------------------------------------------------ setup

  buildProps() {
    const sc = this.scene;
    const blob = TX.blobTexture();
    // soft shadows under every player (one draw call)
    const sg = new THREE.PlaneGeometry(1, 1);
    sg.rotateX(-Math.PI / 2);
    this.shadowMat = new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false, opacity: 0.9, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.blobs = new THREE.InstancedMesh(sg, this.shadowMat, 40);
    this.blobs.frustumCulled = false;
    this.blobs.renderOrder = 1;
    sc.add(this.blobs);

    // the footy
    const bg = new THREE.SphereGeometry(1, 18, 12);
    bg.rotateX(Math.PI / 2);
    this.ballSpin = new THREE.Mesh(bg, new THREE.MeshLambertMaterial({ map: TX.ballTexture() }));
    this.ballSpin.scale.set(0.165, 0.165, 0.275);
    this.ballSpin.castShadow = true;
    this.ball = new THREE.Group();
    this.ball.add(this.ballSpin);
    sc.add(this.ball);
    this.ballShadow = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    this.ballShadow.renderOrder = 2;
    sc.add(this.ballShadow);

    // markers painted on the turf
    const flat = (geo, color, opacity = 1) => {
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }));
      m.position.y = 0.05;
      m.renderOrder = 3;
      m.visible = false;
      sc.add(m);
      return m;
    };
    this.controlRing = flat(new THREE.RingGeometry(0.78, 1.02, 40), 0xffe14a, 0.95);
    this.targetRing = flat(new THREE.RingGeometry(0.85, 1.1, 40), 0x39e6ff, 0.95);
    this.landRing = flat(new THREE.RingGeometry(0.82, 1.0, 40), 0xffffff, 0.9);
    this.landDot = flat(new THREE.CircleGeometry(0.28, 20), 0xffffff, 0.9);
    this.ruckRing = flat(new THREE.RingGeometry(0.88, 1.06, 48), 0xffe14a, 0.95);
    this.ruckFill = flat(new THREE.CircleGeometry(0.88, 36), 0x46e07a, 0.0);
    this.freeZone = flat(new THREE.RingGeometry(3.45, 3.6, 64), 0xffffff, 0.35);
    // aiming arrow in front of the kicker
    const sh = new THREE.Shape();
    sh.moveTo(0, -0.22);
    sh.lineTo(0.72, -0.22);
    sh.lineTo(0.72, -0.5);
    sh.lineTo(1, 0);
    sh.lineTo(0.72, 0.5);
    sh.lineTo(0.72, 0.22);
    sh.lineTo(0, 0.22);
    sh.closePath();
    this.aimArrow = flat(new THREE.ShapeGeometry(sh), 0xffe14a, 0.85);
    // little pointer floating over the controlled player
    this.pointer = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.5, 4), new THREE.MeshBasicMaterial({ color: 0xffe14a }));
    this.pointer.rotation.x = Math.PI;
    this.pointer.visible = false;
    sc.add(this.pointer);
    // goal mouth highlight when a shot is lined up
    this.goalGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(F.GOAL_HALF * 2, 9),
      new THREE.MeshBasicMaterial({ color: 0xffe14a, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.goalGlow.rotation.y = Math.PI / 2;
    this.goalGlow.visible = false;
    sc.add(this.goalGlow);

    // ball trail
    const tg = new THREE.BufferGeometry();
    this.trailPos = new Float32Array(TRAIL * 3);
    this.trailCol = new Float32Array(TRAIL * 3);
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    tg.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 3));
    this.trail = new THREE.Points(tg, new THREE.PointsMaterial({ size: 0.55, map: TX.blobTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)'), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.trail.frustumCulled = false;
    this.trailHead = 0;
    sc.add(this.trail);

    // particles: confetti, turf, camera flashes
    const pg = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PARTICLES * 3).fill(-999);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    this.pVel = new Float32Array(MAX_PARTICLES * 3);
    this.pLife = new Float32Array(MAX_PARTICLES);
    this.pKind = new Uint8Array(MAX_PARTICLES);
    pg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.particles = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.42, vertexColors: true, transparent: true, depthWrite: false }));
    this.particles.frustumCulled = false;
    this.pNext = 0;
    sc.add(this.particles);
    this.flashT = 0;
  }

  /** (Re)build the ground for a time of day. */
  setStadium(mode) {
    if (this.mode === mode && this.stadium) return;
    if (this.stadium) {
      this.scene.remove(this.stadium.group);
      this.stadium.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      });
    }
    this.mode = mode;
    this.stadium = new Stadium(mode, this.aniso);
    this.scene.add(this.stadium.group);
    const fogCol = mode === 'night' ? 0x0b1226 : mode === 'dusk' ? 0xd9a284 : 0xcfe6f7;
    this.scene.fog = new THREE.Fog(fogCol, 190, 700);
    this.renderer.setClearColor(fogCol);
    this.shadowMat.opacity = mode === 'night' ? 0.75 : 0.9;
    const sun = this.stadium.sun;
    if (this.quality.shadows) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const c = sun.shadow.camera;
      c.left = -46;
      c.right = 46;
      c.top = 46;
      c.bottom = -46;
      c.near = 10;
      c.far = 400;
      sun.shadow.bias = -0.0008;
      sun.shadow.normalBias = 0.04;
      this.sunOffset = sun.position.clone().normalize().multiplyScalar(160);
      this.scene.add(sun.target);
    }
  }

  setMatch(match, timeOfDay) {
    this.setStadium(timeOfDay || 'day');
    for (const v of this.views.values()) {
      this.scene.remove(v.root);
      v.dispose();
    }
    this.views.clear();
    const kits = TX.makeKits(match.teams[0].def, match.teams[1].def);
    this.kits = kits;
    for (const p of match.players) {
      const v = new PlayerView(p, kits[p.team.idx], !!this.quality.shadows);
      this.views.set(p, v);
      this.scene.add(v.root);
    }
    this.stadium.setTeams(match.teams[0].def, match.teams[1].def);
    this.paintCrest(match.teams[0].def);
    this.syncEnds(match);
    this.buildUmpires();
    this.pPos.fill(-999);
    this.pLife.fill(0);
    this.trailCol.fill(0);
    this.match = match;
  }

  /** The home club's crest, painted on the grass inside each fifty. */
  paintCrest(team) {
    if (!this.crestDecals) {
      const geo = new THREE.PlaneGeometry(13, 13 * 1.11);
      geo.rotateX(-Math.PI / 2);
      this.crestMat = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      this.crestDecals = [1, -1].map((end) => {
        const mesh = new THREE.Mesh(geo, this.crestMat);
        mesh.position.set(end * 46, 0.02, 0);
        mesh.renderOrder = 0.5;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        return mesh;
      });
    }
    const img = emblemImage(team);
    for (const d of this.crestDecals) d.visible = !!img;
    if (!img) return;
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 444;
    c.getContext('2d').drawImage(img, 0, 0, 400, 444);
    if (this.crestTex) this.crestTex.dispose();
    this.crestTex = new THREE.CanvasTexture(c);
    this.crestTex.colorSpace = THREE.SRGBColorSpace;
    this.crestTex.anisotropy = this.aniso;
    this.crestMat.map = this.crestTex;
    this.crestMat.needsUpdate = true;
  }

  /** A goal umpire in the traditional white coat and hat stands behind each goal line. */
  buildUmpires() {
    if (this.umpires) return;
    const kit = { base: '#f4f4f0', trim: '#f4f4f0', pattern: 'panel', shorts: '#f4f4f0', socks: '#2a2d34', boots: '#15171c', sleeve: '#f4f4f0', thigh: '#2a2d34', hat: '#f4f4f0', flags: true };
    this.umpires = [1, -1].map((end, i) => {
      const p = {
        idx: 100 + i, number: null, attr: { height: 1.8 }, look: { skin: i ? '#c98f66' : '#f1c9a5', hair: '#4a3222', style: 0 },
        x: end * (F.GX + 1.7), z: 0, vx: 0, vz: 0, face: end > 0 ? Math.PI : 0,
        action: null, actionT: 0, actionDur: 0, hasBall: false, charging: false, carryDist: 0, end,
      };
      const view = new PlayerView(p, kit, !!this.quality.shadows);
      this.scene.add(view.root);
      return { p, view };
    });
    this.umpScore = null;
  }

  updateUmpires(dt, match) {
    const ls = match.lastScore;
    const scoring = match.phase === 'goal' || match.phase === 'behind';
    if (scoring && ls && ls !== this.umpScore) {
      this.umpScore = ls;
      const u = this.umpires.find((o) => o.p.end === ls.end);
      u.p.action = ls.kind === 'goal' ? 'signalGoal' : 'signalBehind';
      u.p.actionT = 0;
      u.p.actionDur = ls.kind === 'goal' ? 3.3 : 2.1;
    }
    for (const { p, view } of this.umpires) {
      if (p.action) {
        p.actionT += dt;
        if (p.actionT >= p.actionDur) p.action = null;
      }
      view.update(dt, this.time, { onMark: false, setShot: false });
    }
  }

  syncEnds(match) {
    const plus = match.teams[0].dir > 0 ? match.teams[0] : match.teams[1];
    const minus = match.teams[0].dir > 0 ? match.teams[1] : match.teams[0];
    this.stadium.setEnds(plus.def, minus.def);
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality.maxDpr);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // keep a constant horizontal field of view on narrow screens
    const base = 34;
    const ref = 1.6;
    if (aspect >= ref) this.camera.fov = base;
    else this.camera.fov = clamp((2 * Math.atan((Math.tan((base * Math.PI) / 360) * ref) / aspect) * 180) / Math.PI, base, 95);
    this.camera.updateProjectionMatrix();
    this.w = w;
    this.h = h;
    this.small = Math.min(w, h) < 520;
  }

  // ---------------------------------------------------------------- effects

  spawn(x, y, z, vx, vy, vz, color, life, kind = 0) {
    const i = this.pNext;
    this.pNext = (i + 1) % MAX_PARTICLES;
    this.pPos[i * 3] = x;
    this.pPos[i * 3 + 1] = y;
    this.pPos[i * 3 + 2] = z;
    this.pVel[i * 3] = vx;
    this.pVel[i * 3 + 1] = vy;
    this.pVel[i * 3 + 2] = vz;
    this.pCol[i * 3] = color.r;
    this.pCol[i * 3 + 1] = color.g;
    this.pCol[i * 3 + 2] = color.b;
    this.pLife[i] = life;
    this.pKind[i] = kind;
  }

  /** Team-coloured confetti from behind the goals. */
  confetti(end, colours) {
    const cols = colours.map((c) => new THREE.Color(c));
    for (let i = 0; i < 260; i++) {
      const z = (Math.random() - 0.5) * 60;
      const x = end * (F.GX + 6 + Math.random() * 14);
      this.spawn(x, 3 + Math.random() * 10, z, -end * (2 + Math.random() * 9), 9 + Math.random() * 9, (Math.random() - 0.5) * 8, cols[i % cols.length], 2.8 + Math.random() * 2.2, 1);
    }
    this.flashT = 2.6;
  }

  turf(x, z, n = 8) {
    const c = new THREE.Color(0x6fae4a);
    const d = new THREE.Color(0x8a7a4a);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28;
      const s = 1 + Math.random() * 3;
      this.spawn(x, 0.15, z, Math.cos(a) * s, 2 + Math.random() * 3, Math.sin(a) * s, Math.random() < 0.7 ? c : d, 0.5 + Math.random() * 0.4, 0);
    }
  }

  shake(amount) {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  updateParticles(dt) {
    const pos = this.pPos;
    const vel = this.pVel;
    const life = this.pLife;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      const j = i * 3;
      if (life[i] <= 0) {
        pos[j + 1] = -999;
        continue;
      }
      const kind = this.pKind[i];
      if (kind === 2) continue; // camera flash: just sits there briefly
      vel[j + 1] -= (kind === 1 ? 6 : 14) * dt;
      if (kind === 1) {
        // confetti flutters
        vel[j] *= 1 - 1.2 * dt;
        vel[j + 2] *= 1 - 1.2 * dt;
        if (vel[j + 1] < -3.5) vel[j + 1] = -3.5;
        pos[j] += Math.sin(this.time * 6 + i) * dt * 1.5;
      }
      pos[j] += vel[j] * dt;
      pos[j + 1] += vel[j + 1] * dt;
      pos[j + 2] += vel[j + 2] * dt;
      if (pos[j + 1] < 0.05) {
        pos[j + 1] = 0.05;
        vel[j] = vel[j + 1] = vel[j + 2] = 0;
      }
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      const white = this.tmpColor || (this.tmpColor = new THREE.Color(0xffffff));
      for (let n = 0; n < 3; n++) {
        const t = Math.random() * Math.PI * 2;
        const off = 10 + Math.random() * 34;
        const y = off < 27 ? 1.7 + ((off - 8) / 19) * 10.3 : 14.8 + ((off - 27) / 19) * 13.7;
        this.spawn((F.A + off) * Math.cos(t), y + 1, (F.B + off) * Math.sin(t), 0, 0, 0, white, 0.09, 2);
      }
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
    this.particles.geometry.attributes.color.needsUpdate = true;
  }

  // ------------------------------------------------------------------ frame

  update(dt, match, hud) {
    this.time += dt;
    const time = this.time;
    const b = match.ball;
    const ctrl = match.control;
    const free = match.phase === 'free' ? match.free : null;

    // set shots are watched from behind the kicker, right through the ball's flight
    if (match.setShot) this.ssPlayer = match.setShot.player;
    const flying = !!this.ssPlayer && b.state === 'free' && b.isShot && b.kicker === this.ssPlayer && !b.hasBounced && match.phase === 'play';
    this.shotCam = hud && (!!match.setShot || flying);
    if (!this.shotCam) this.ssPlayer = null;

    // players
    let i = 0;
    const d = this.dummy;
    const realShadows = !!this.quality.shadows;
    for (const p of match.players) {
      const v = this.views.get(p);
      v.update(dt, time, {
        onMark: !!free && p.ai.role === 'onMark',
        setShot: !!match.setShot && match.setShot.player === p,
      });
      // don't let bystanders block the view down the barrel
      v.root.visible = !(this.shotCam && p !== this.ssPlayer && Math.hypot(p.x - this.camPos.x, p.z - this.camPos.z) < 9.5);
      const s = realShadows ? 0 : clamp(1.75 - v.cur.yOff * 0.5, 0.9, 1.75);
      d.position.set(p.x, 0.03, p.z);
      d.scale.set(s, 1, s);
      d.updateMatrix();
      this.blobs.setMatrixAt(i++, d.matrix);
    }
    this.blobs.count = i;
    this.blobs.instanceMatrix.needsUpdate = true;

    // ball
    const bp = this.ball.position;
    if (b.state === 'held' && b.holder) {
      this.views.get(b.holder).ballHoldPos(bp, time);
      this.ball.rotation.set(0, -b.holder.face, 0);
      this.ballSpin.rotation.x = 0.5;
    } else {
      bp.set(b.x, Math.max(b.y, 0.17), b.z);
      const sp = Math.hypot(b.vx, b.vz);
      if (b.state === 'free') {
        if (sp > 0.5) this.ball.rotation.y = Math.atan2(b.vx, b.vz);
        // drop punts spin backwards end over end; on the deck it just tumbles
        this.ballSpin.rotation.x -= dt * (b.kind === 'kick' && !b.hasBounced ? 16 : clamp(sp * 2.5, 0, 22));
      }
    }
    const hgt = bp.y;
    const bs = clamp(0.75 + hgt * 0.08, 0.75, 2.2);
    this.ballShadow.position.set(bp.x, 0.045, bp.z);
    this.ballShadow.scale.set(bs, 1, bs);
    this.ballShadow.material.opacity = clamp(0.95 - hgt * 0.035, 0.4, 0.95);
    this.ball.visible = !(match.phase === 'quarter' || match.phase === 'full');
    this.ballShadow.visible = this.ball.visible;

    // trail behind a kicked ball
    const fast = b.state === 'free' && Math.hypot(b.vx, b.vy, b.vz) > 11;
    for (let k = 0; k < TRAIL * 3; k++) this.trailCol[k] *= 1 - Math.min(1, dt * 7);
    if (fast) {
      const h = this.trailHead;
      this.trailHead = (h + 1) % TRAIL;
      this.trailPos[h * 3] = bp.x;
      this.trailPos[h * 3 + 1] = bp.y;
      this.trailPos[h * 3 + 2] = bp.z;
      this.trailCol[h * 3] = this.trailCol[h * 3 + 1] = this.trailCol[h * 3 + 2] = 0.55;
    }
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.geometry.attributes.color.needsUpdate = true;

    // markers
    const live = match.phase === 'play' || match.phase === 'free';
    const pulse = 1 + Math.sin(time * 7) * 0.07;
    const ruckSetup = (match.phase === 'bounce' || match.phase === 'stoppage') && !!match.ruck;
    if (ctrl && (live || ruckSetup) && hud && !this.shotCam) {
      this.controlRing.visible = true;
      this.controlRing.position.set(ctrl.x, 0.05, ctrl.z);
      this.controlRing.scale.setScalar(pulse);
      this.controlRing.rotation.y = time * 1.5;
      const cv = this.views.get(ctrl);
      this.pointer.visible = true;
      this.pointer.position.set(ctrl.x, (2.35 + cv.cur.yOff) * cv.scale + Math.sin(time * 5) * 0.08, ctrl.z);
      this.pointer.rotation.y = time * 3;
    } else {
      this.controlRing.visible = false;
      this.pointer.visible = false;
    }
    const tgt = ctrl && hud ? match.ctrl.target : null;
    this.targetRing.visible = false;
    this.goalGlow.visible = false;
    this.aimArrow.visible = false;
    if (tgt && ctrl.charging) {
      if (tgt.type === 'goal') {
        this.goalGlow.visible = true;
        this.goalGlow.position.set(tgt.x, 4.5, 0);
        this.goalGlow.material.opacity = 0.22 + Math.sin(time * 10) * 0.1;
      } else {
        this.targetRing.visible = true;
        const tx = tgt.player ? tgt.player.x : tgt.x;
        const tz = tgt.player ? tgt.player.z : tgt.z;
        this.targetRing.position.set(tx, 0.05, tz);
        this.targetRing.scale.setScalar(tgt.player ? 1.15 * pulse : 0.8 * pulse);
      }
      this.aimArrow.visible = true;
      this.aimArrow.position.set(ctrl.x, 0.05, ctrl.z);
      const ang = Math.atan2(tgt.z - ctrl.z, tgt.x - ctrl.x);
      this.aimArrow.rotation.y = -ang;
      const len = 3 + ctrl.charge * 6;
      this.aimArrow.scale.set(len, 1, 1.6);
      this.aimArrow.material.color.setHSL(lerp(0.15, 0.0, ctrl.charge), 1, 0.6);
    }
    const land = b.state === 'free' && b.land && !b.hasBounced && b.kind === 'kick' && live ? b.land : null;
    const ruck = b.state === 'free' && b.kind === 'toss' && b.land && match.ruckC && live ? b.land : null;
    this.ruckRing.visible = false;
    this.ruckFill.visible = false;
    if (land && hud) {
      const k = 1 + clamp(land.t, 0, 2.5) * 0.9;
      this.landRing.visible = true;
      this.landDot.visible = true;
      this.landRing.position.set(land.x, 0.05, land.z);
      this.landDot.position.set(land.x, 0.05, land.z);
      this.landRing.scale.setScalar(k);
      this.landRing.material.color.setHex(0xffffff);
    } else if (ruck && hud) {
      // ruck timing: the white ring closes onto the gold one - jump as they meet
      const off = ruck.t - RUCK_RING;
      const inWindow = Math.abs(off) <= 0.09;
      const k = 1 + clamp(off, 0, 2.2) * 1.5;
      this.landRing.visible = true;
      this.landDot.visible = false;
      this.landRing.position.set(ruck.x, 0.06, ruck.z);
      this.landRing.scale.setScalar(k);
      this.landRing.material.color.setHex(inWindow ? 0x46e07a : 0xffffff);
      this.ruckRing.visible = true;
      this.ruckRing.position.set(ruck.x, 0.055, ruck.z);
      this.ruckRing.scale.setScalar(1);
      this.ruckRing.material.color.setHex(inWindow ? 0x46e07a : 0xffe14a);
      if (inWindow) {
        this.ruckFill.visible = true;
        this.ruckFill.position.set(ruck.x, 0.052, ruck.z);
        this.ruckFill.material.opacity = 0.35;
      }
    } else {
      this.landRing.visible = false;
      this.landDot.visible = false;
    }
    // where a hit-out would go, if you're aiming it
    if (ruck && hud && ctrl && match.ctrl.ruck && match.ctrl.ruck.player) {
      const mate = match.ctrl.ruck.player;
      this.targetRing.visible = true;
      this.targetRing.position.set(mate.x, 0.05, mate.z);
      this.targetRing.scale.setScalar(1.15 * pulse);
      this.aimArrow.visible = true;
      this.aimArrow.position.set(ruck.x, 0.05, ruck.z);
      this.aimArrow.rotation.y = -Math.atan2(mate.z - ruck.z, mate.x - ruck.x);
      this.aimArrow.scale.set(Math.min(9, Math.max(3, Math.hypot(mate.x - ruck.x, mate.z - ruck.z) * 0.6)), 1, 1.4);
      this.aimArrow.material.color.setHex(0x39e6ff);
    }
    if (free && hud && free.player === ctrl && !match.setShot) {
      this.freeZone.visible = true;
      this.freeZone.position.set(free.x, 0.05, free.z);
    } else {
      this.freeZone.visible = false;
    }

    this.updateUmpires(dt, match);
    this.updateParticles(dt);
    this.stadium.update(dt);
    this.stadium.scoreboard.draw(match);
    this.updateCamera(dt, match);

    if (realShadows) {
      const sun = this.stadium.sun;
      sun.target.position.set(this.camLook.x, 0, this.camLook.z);
      sun.position.copy(sun.target.position).add(this.sunOffset);
    }
  }

  updateCamera(dt, match) {
    const b = match.ball;
    const pos = this.tmp;
    const look = this.tmp2;
    let rate = 4;
    const bx = this.ball.position.x;
    const bz = this.ball.position.z;
    const mode = this.camMode;

    if (mode === 'orbit') {
      const a = this.time * 0.06 + 1.2;
      pos.set(Math.cos(a) * 128, 46, Math.sin(a) * 108);
      look.set(bx * 0.35, 2, bz * 0.35);
      rate = 1.5;
    } else if (this.shotCam && this.ssPlayer) {
      const p = this.ssPlayer;
      const gx = p.team.dir * F.GX;
      let dx = gx - p.x;
      let dz = -p.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      pos.set(p.x - dx * 10.5 - dz * 2.6, 5.4, p.z - dz * 10.5 + dx * 2.6);
      look.set(gx, 2.4, 0);
      if (!match.setShot) {
        // follow the ball a little once it's kicked
        look.x = lerp(gx, b.x, 0.3);
        look.y = lerp(2.4, b.y, 0.45);
        look.z = lerp(0, b.z, 0.3);
      }
      rate = 3.4;
    } else if (match.phase === 'goal' && match.lastScore && match.lastScore.scorer && match.phaseT < 2.9) {
      const s = match.lastScore.scorer;
      const l = Math.hypot(s.x, s.z) || 1;
      const sweep = (2.9 - match.phaseT) * 0.9;
      pos.set(s.x - (s.x / l) * 11 + sweep, 3.4, s.z - (s.z / l) * 11 + 3);
      look.set(s.x, 1.9, s.z);
      rate = 2.6;
    } else {
      // side-on broadcast view that pans with the play
      const D = this.camD || (this.small ? 33 : 38);
      const H = this.camH || (this.small ? 17 : 19.5);
      const lead = clamp(b.state === 'free' ? b.vx * 0.22 : (b.holder ? b.holder.vx : 0) * 0.5, -7, 7);
      let fx = clamp(bx + lead, -F.A, F.A);
      let fz = clamp(bz, -F.B, F.B);
      let zoom = 1;
      if (b.state === 'free' && b.kind === 'kick' && b.land && !b.hasBounced) {
        // pan ahead to where a kick is coming down, easing back so both ends stay in shot
        const far = Math.hypot(b.land.x - bx, b.land.z - bz);
        fx = clamp(lerp(bx, b.land.x, 0.58), -F.A, F.A);
        fz = clamp(lerp(bz, b.land.z, 0.58), -F.B, F.B);
        zoom = 1 + clamp((far - 16) / 70, 0, 0.42);
      }
      const high = clamp(this.ball.position.y - 3, 0, 14);
      pos.set(fx * 0.84, (H + high * 0.3) * zoom, Math.min(fz * 0.92 + D * zoom + high * 0.4, F.B + 44));
      look.set(fx, 1 + high * 0.25, fz * 0.94 - 2);
      rate = match.phase === 'bounce' ? 2.5 : 4.2;
    }

    const k = this.snap ? 1 : Math.min(1, dt * rate);
    this.snap = false;
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, Math.min(1, k * 1.4));
    this.camera.position.copy(this.camPos);
    if (this.shakeAmt > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmt;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmt;
      this.shakeAmt *= Math.max(0, 1 - dt * 6);
    }
    this.camera.up.copy(UP);
    this.camera.lookAt(this.camLook);
  }

  /** Turn real-time shadows off (used when the frame rate is struggling). */
  setShadows(on) {
    this.quality.shadows = on;
    this.renderer.shadowMap.enabled = on;
    if (this.stadium) this.stadium.sun.castShadow = on;
    this.scene.traverse((o) => {
      if (o.material) o.material.needsUpdate = true;
    });
  }

  /** Jump the camera straight to where it wants to be (after cuts). */
  cut() {
    this.snap = true;
  }

  /** Ground-plane directions for screen-relative controls. */
  basis() {
    let fx = this.camLook.x - this.camPos.x;
    let fz = this.camLook.z - this.camPos.z;
    const l = Math.hypot(fx, fz) || 1;
    fx /= l;
    fz /= l;
    return { fx, fz, rx: -fz, rz: fx };
  }

  /** World position -> CSS pixel position (and whether it's in front of the camera). */
  project(x, y, z, out) {
    const v = this.tmp.set(x, y, z).project(this.camera);
    out.x = (v.x * 0.5 + 0.5) * this.w;
    out.y = (-v.y * 0.5 + 0.5) * this.h;
    out.visible = v.z < 1;
    return out;
  }

  playerHeadY(p) {
    const v = this.views.get(p);
    return v ? (2.0 + v.cur.yOff) * v.scale : 2.4 * VIS_SCALE;
  }

  onCatch(p) {
    const v = this.views.get(p);
    if (v) v.catchT = 0.28;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
