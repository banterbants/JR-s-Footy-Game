// The match simulation: rules, ball physics, possession, contests and scoring.
// It knows nothing about rendering or sound - it just emits events.
import { F, G, POSITIONS, OPPONENT_OF, DIFFICULTY, SURNAMES, SKIN_TONES, HAIR_COLOURS } from '../config.js';
import { clamp, lerp, makeRng, hashStr, angDiff, fieldValue, clampToField, dist, gauss } from '../util.js';
import { updateAI, formationSpot } from './ai.js';

const BALL_R = 0.16;
const CATCH_R = 1.35; // how far a standing player can reach for the ball
const JUMP_R = 1.9;
const STAND_H = 2.45;
const JUMP_H = 3.5;
const PICKUP_R = 1.15;
const PRIOR_OPP = 1.4; // seconds with the ball before a tackle becomes "holding the ball"
const MARK_MIN = 15; // a kick must travel 15 m to be marked
const NO_INPUT = { mx: 0, mz: 0, kick: false, kickPressed: false, hbPressed: false, sprint: false };

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildTeam(idx, def, dir) {
  const r = makeRng(hashStr(def.id) + 17);
  const names = shuffle(SURNAMES, r);
  const nums = shuffle(Array.from({ length: 44 }, (_, i) => i + 1), r);
  const base = clamp((def.rating - 70) / 18, 0, 1);
  const team = {
    idx, def, dir, goals: 0, behinds: 0, players: [],
    stats: { kicks: 0, handballs: 0, marks: 0, tackles: 0, hitouts: 0, inside50: 0 },
    quarters: [],
  };
  POSITIONS.forEach((pos, i) => {
    const a = (bonus = 0) => clamp(0.46 + 0.18 * base + (r() - 0.5) * 0.28 + bonus, 0.15, 1);
    const key = ['FB', 'CHB', 'CHF', 'FF'].includes(pos.id);
    const ruck = pos.id === 'RUC';
    const mid = pos.line === 'C' || pos.id === 'RR' || pos.id === 'ROV';
    const fwd = pos.line === 'F' || pos.line === 'HF';
    const attr = {
      speed: a(ruck ? -0.18 : key ? -0.06 : mid ? 0.08 : 0.05),
      kick: a(fwd ? 0.1 : mid ? 0.05 : 0),
      mark: a(ruck ? 0.1 : key ? 0.15 : 0),
      tackle: a(fwd ? -0.05 : 0.05),
      strength: a(ruck || key ? 0.1 : 0),
      height: ruck ? 2.0 + r() * 0.06 : key ? 1.93 + r() * 0.05 : 1.78 + r() * 0.12,
    };
    team.players.push({
      team, idx: i, pos, name: names[i], number: nums[i], attr,
      look: { skin: SKIN_TONES[Math.floor(r() * SKIN_TONES.length)], hair: HAIR_COLOURS[Math.floor(r() * HAIR_COLOURS.length)], style: Math.floor(r() * 3) },
      maxSpd: 6.9 + 1.4 * attr.speed,
      x: 0, z: 0, vx: 0, vz: 0, face: dir > 0 ? 0 : Math.PI,
      action: null, actionT: 0, actionDur: 0, lungeX: 0, lungeZ: 0, tackleHit: false,
      stamina: 1, sprinting: false, hasBall: false, possT: 0, immuneT: 0, tackleCd: 0, carryDist: 0,
      charging: false, charge: 0, chargeHold: 0, aimX: dir, aimZ: 0,
      opp: null,
      ai: { role: 'form', slot: 0, tx: 0, tz: 0, sprint: false, pace: 0.8, leadT: 0, leadX: 0, leadZ: 0, leadCd: r() * 2, decideT: 0, runT: 0, maxRun: 2, tackleWait: 0, jumpFor: -1, tired: false },
      stats: { kicks: 0, handballs: 0, marks: 0, tackles: 0, goals: 0, behinds: 0 },
    });
  });
  return team;
}

export class Match {
  /**
   * @param {object} opts { home, away, humanTeam (0, 1 or -1 for a demo), difficulty, quarterLen, seed }
   */
  constructor(opts = {}) {
    this.rng = makeRng(opts.seed ?? (Date.now() & 0xffffffff));
    this.humanTeam = opts.humanTeam ?? 0;
    this.diff = DIFFICULTY[opts.difficulty] || DIFFICULTY.medium;
    this.quarterLen = opts.quarterLen ?? 180;
    this.teams = [buildTeam(0, opts.home, 1), buildTeam(1, opts.away, -1)];
    this.players = [...this.teams[0].players, ...this.teams[1].players];
    for (const t of this.teams) {
      const other = this.teams[1 - t.idx];
      for (const p of t.players) p.opp = other.players.find((o) => o.pos.id === OPPONENT_OF[p.pos.id]);
    }
    this.ball = {
      x: 0, y: 1.3, z: 0, vx: 0, vy: 0, vz: 0, px: 0, py: 0, pz: 0,
      state: 'dead', holder: null, kind: 'loose', kicker: null, lastTeam: -1,
      fromX: 0, fromZ: 0, hasBounced: false, land: null, intended: null, isShot: false,
      age: 0, noCatchT: 0, id: 0,
    };
    this.events = [];
    this.time = 0;
    this.quarter = 1;
    this.clock = this.quarterLen;
    this.sirenGone = false;
    this.phase = 'bounce';
    this.phaseT = 0;
    this.cutSent = false;
    this.free = null;
    this.setShot = null;
    this.pending = null;
    this.ruck = null;
    this.lastScore = null;
    this.possTeam = -1;
    this.focus = { x: 0, z: 0 };
    this.control = null;
    this.ctrl = { grace: 0, idleT: 0, checkT: 0, manualT: 0, target: null };
    this.startCentreBounce(true);
  }

  emit(type, data) {
    this.events.push(data ? { type, ...data } : { type });
  }

  // ---------------------------------------------------------------- helpers

  isHumanTeam(p) {
    return p.team.idx === this.humanTeam;
  }

  maxKick(p) {
    return 46 + 12 * p.attr.kick;
  }

  flightTime(d) {
    return clamp(0.5 + d / 25, 0.55, 2.9);
  }

  attackGoalX(p) {
    return p.team.dir * F.GX;
  }

  nearestOpp(p) {
    let best = null;
    let bd = 99;
    for (const o of this.teams[1 - p.team.idx].players) {
      if (o.action === 'down' || o.action === 'stumble') continue;
      const d = dist(p.x, p.z, o.x, o.z);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return { o: best, d: bd };
  }

  kickSpread(p, o = {}) {
    let s = 0.035 + 0.055 * (1 - p.attr.kick);
    if (o.pressured) s *= 1.6;
    if (o.set) s *= 0.65;
    if (Math.hypot(p.vx, p.vz) > 5) s *= 1.15;
    if (o.shot) s *= 0.8 + o.dG / 45;
    if (this.humanTeam >= 0) s *= this.isHumanTeam(p) ? this.diff.humanSpread : this.diff.aiSpread;
    return s;
  }

  computeLanding(h = 1.5) {
    const b = this.ball;
    // largest root of y + vy t - G/2 t^2 = h
    const disc = b.vy * b.vy + 2 * G * (b.y - h);
    if (disc < 0) return null;
    const t = (b.vy + Math.sqrt(disc)) / G;
    if (t <= 0) return null;
    return { x: b.x + b.vx * t, z: b.z + b.vz * t, t };
  }

  // ------------------------------------------------------------ restarts

  startCentreBounce(first = false) {
    const b = this.ball;
    for (const p of this.players) {
      const [x, z] = formationSpot(p, 0, 0, true);
      p.x = x;
      p.z = z;
      p.vx = p.vz = 0;
      p.face = p.team.dir > 0 ? 0 : Math.PI;
      p.action = null;
      p.hasBall = false;
      p.charging = false;
      p.ai.leadT = 0;
      p.stamina = Math.max(p.stamina, 0.7);
    }
    b.state = 'dead';
    b.holder = null;
    b.x = 0;
    b.y = 1.3;
    b.z = 0;
    b.vx = b.vy = b.vz = 0;
    b.kind = 'loose';
    b.land = null;
    b.intended = null;
    this.phase = 'bounce';
    this.phaseT = first ? 2.6 : 1.9;
    this.free = null;
    this.setShot = null;
    this.pending = null;
    this.ruck = { x: 0, z: 0 };
    this.possTeam = -1;
    this.cutSent = false;
    if (this.humanTeam >= 0) {
      const rover = this.teams[this.humanTeam].players.find((p) => p.pos.id === 'ROV');
      this.setControl(rover, 0);
    }
    this.emit('setup', { first });
  }

  tossUp(x, z, vx = 0, vz = 0, vy = 11) {
    const b = this.ball;
    b.state = 'free';
    b.holder = null;
    b.x = x;
    b.z = z;
    b.y = 1.5;
    b.vx = vx;
    b.vy = vy;
    b.vz = vz;
    b.kind = 'toss';
    b.kicker = null;
    b.hasBounced = false;
    b.intended = null;
    b.age = 0;
    b.id++;
    b.land = this.computeLanding(3.3);
    this.ruck = b.land ? { x: b.land.x, z: b.land.z } : { x, z };
    this.phase = 'play';
    this.pending = null;
    this.emit('toss', { x, z });
  }

  startBallUp(x, z) {
    const b = this.ball;
    [x, z] = clampToField(x, z, 6);
    this.dropBall();
    b.state = 'dead';
    b.x = x;
    b.y = 1.3;
    b.z = z;
    b.vx = b.vy = b.vz = 0;
    this.phase = 'stoppage';
    this.pending = { kind: 'ballup', x, z, t: 2.2 };
    this.ruck = { x, z };
    this.emit('ballup', { x, z });
  }

  dropBall() {
    const b = this.ball;
    if (b.holder) {
      b.holder.hasBall = false;
      b.holder.charging = false;
      b.holder = null;
    }
    b.land = null;
    b.intended = null;
    this.free = null;
    this.setShot = null;
  }

  // ------------------------------------------------------------ possession

  givePossession(p, how = 'gather') {
    const b = this.ball;
    if (b.holder && b.holder !== p) b.holder.hasBall = false;
    b.state = 'held';
    b.holder = p;
    b.kind = 'loose';
    b.land = null;
    b.intended = null;
    b.kicker = null;
    b.hasBounced = false;
    b.vx = b.vy = b.vz = 0;
    p.hasBall = true;
    p.possT = 0;
    p.immuneT = 0.3;
    p.carryDist = 0;
    p.charging = false;
    p.ai.runT = 0;
    p.ai.decideT = 0.22 + this.rng() * 0.2 + (this.isHumanTeam(p) || this.humanTeam < 0 ? 0 : this.diff.decideAdj);
    p.ai.maxRun = 1.0 + this.rng() * 1.6;
    this.ruck = null;
    this.possTeam = p.team.idx;
    if (this.isHumanTeam(p)) this.setControl(p, 0);
    this.emit('possession', { player: p, how });
  }

  awardFree(p, x, z, kind) {
    if (this.ball.holder !== p) this.givePossession(p, 'free');
    this.phase = 'free';
    const dG = dist(x, z, this.attackGoalX(p), 0);
    const human = this.isHumanTeam(p);
    this.free = {
      player: p, x, z, kind, t: 0,
      limit: human ? 8 : 6,
      canSetShot: human && dG <= this.maxKick(p) + 3 && dG > 4,
      declined: false,
      aiDelay: 1.0 + this.rng() * 1.1,
      dG,
    };
    this.setShot = null;
    this.pending = null;
    p.vx = p.vz = 0;
    p.charging = false;
    p.possT = 0;
    p.action = null;
    this.emit('free', { kind, player: p, x, z, setShot: this.free.canSetShot });
  }

  playOn(silent = false) {
    if (this.phase !== 'free') return;
    this.phase = 'play';
    this.free = null;
    this.setShot = null;
    if (!silent) this.emit('playon');
  }

  /** Common code for every disposal. */
  release(p, kind) {
    const b = this.ball;
    if (this.phase === 'free') this.playOn(true);
    b.state = 'free';
    b.holder = null;
    b.kind = kind;
    b.kicker = p;
    b.lastTeam = p.team.idx;
    b.fromX = p.x;
    b.fromZ = p.z;
    b.hasBounced = false;
    b.age = 0;
    b.noCatchT = 0;
    b.id++;
    p.hasBall = false;
    p.charging = false;
    p.charge = 0;
    this.setShot = null;
  }

  kickBall(p, tx, tz, o = {}) {
    const b = this.ball;
    const maxK = this.maxKick(p);
    const spread = o.spread ?? 0.04;
    const dx = tx - p.x;
    const dz = tz - p.z;
    let d = Math.hypot(dx, dz);
    const ang = Math.atan2(dz, dx) + (o.exactAngle ? 0 : gauss(this.rng) * spread) + (o.angleErr || 0);
    d *= 1 + gauss(this.rng) * spread * 0.9;
    if (o.isShot) d = Math.min(d + 9, maxK + (this.rng() - 0.5) * 5);
    else d = Math.min(d, maxK);
    d = Math.max(d, 5);
    const T = this.flightTime(d);
    const y0 = 0.45;
    const yEnd = o.isShot ? 2.0 : 1.4;
    const vh = d / T;
    this.release(p, 'kick');
    b.x = p.x + Math.cos(ang) * 0.6;
    b.z = p.z + Math.sin(ang) * 0.6;
    b.y = y0;
    b.vx = Math.cos(ang) * vh;
    b.vz = Math.sin(ang) * vh;
    b.vy = (yEnd - y0 + 0.5 * G * T * T) / T;
    b.intended = o.intended || null;
    b.isShot = !!o.isShot;
    b.land = this.computeLanding();
    p.face = ang;
    p.action = 'kick';
    p.actionT = 0;
    p.actionDur = 0.42;
    p.stats.kicks++;
    p.team.stats.kicks++;
    this.emit('kick', { player: p, power: d / maxK, shot: !!o.isShot, dist: d });
    this.onBallInFlight();
  }

  handball(p, tx, tz, intended) {
    const b = this.ball;
    const dx = tx - p.x;
    const dz = tz - p.z;
    const d = clamp(Math.hypot(dx, dz), 3, 18);
    const ang = Math.atan2(dz, dx) + gauss(this.rng) * 0.03;
    const T = 0.28 + d / 21;
    this.release(p, 'handball');
    b.x = p.x + Math.cos(ang) * 0.5;
    b.z = p.z + Math.sin(ang) * 0.5;
    b.y = 1.1;
    const vh = d / T;
    b.vx = Math.cos(ang) * vh;
    b.vz = Math.sin(ang) * vh;
    b.vy = (1.2 - 1.1 + 0.5 * G * T * T) / T;
    b.intended = intended || null;
    b.isShot = false;
    b.land = this.computeLanding(1.2);
    p.face = ang;
    p.action = 'handball';
    p.actionT = 0;
    p.actionDur = 0.3;
    p.stats.handballs++;
    p.team.stats.handballs++;
    this.emit('handball', { player: p });
    this.onBallInFlight();
  }

  // AI disposal helpers (called from ai.js)
  aiShoot(p, o) {
    const gx = this.attackGoalX(p);
    const dG = dist(p.x, p.z, gx, 0);
    this.kickBall(p, gx, 0, { isShot: true, spread: this.kickSpread(p, { ...o, shot: true, dG }) });
  }

  aiKickTo(p, opt, o) {
    this.kickBall(p, opt.x, opt.z, { intended: opt.t, spread: this.kickSpread(p, o) });
  }

  aiBomb(p, o) {
    const dir = p.team.dir;
    const gx = dir * F.GX;
    let tx = p.x + dir * 44;
    if ((gx - tx) * dir < 16) tx = gx - dir * 16;
    const tz = p.z * 0.45 + (this.rng() - 0.5) * 12;
    const [cx, cz] = clampToField(tx, tz, 4);
    this.kickBall(p, cx, cz, { spread: this.kickSpread(p, o) });
  }

  aiHandball(p, t) {
    this.handball(p, t.x + t.vx * 0.35, t.z + t.vz * 0.35, t);
  }

  startJump(p) {
    if (p.action === 'down' || p.action === 'stumble') return;
    p.action = 'jump';
    p.actionT = 0;
    p.actionDur = 0.75;
  }

  // --------------------------------------------------------------- control

  setControl(p, grace = 0) {
    if (this.control && this.control !== p) {
      this.control.charging = false;
    }
    this.control = p;
    this.ctrl.grace = grace;
    this.ctrl.idleT = 0;
    this.ctrl.target = null;
  }

  focusPoint() {
    const b = this.ball;
    if (b.state === 'held') return [b.holder.x, b.holder.z];
    if (b.state === 'free' && b.land && !b.hasBounced) return [b.land.x, b.land.z];
    if (this.ruck) return [this.ruck.x, this.ruck.z];
    return [b.x + b.vx * 0.3, b.z + b.vz * 0.3];
  }

  bestHumanPlayer(exclude) {
    const [fx, fz] = this.focusPoint();
    let best = null;
    let bd = 1e9;
    for (const p of this.teams[this.humanTeam].players) {
      if (p === exclude || p.action === 'down' || p.action === 'stumble') continue;
      const d = dist(p.x, p.z, fx, fz);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  onBallInFlight() {
    if (this.humanTeam < 0) return;
    const b = this.ball;
    let t = null;
    if (b.intended && this.isHumanTeam(b.intended)) t = b.intended;
    else t = this.bestHumanPlayer(b.kicker);
    if (t) this.setControl(t, 0.35);
    this.ctrl.checkT = 0.7;
    this.ctrl.manualT = 0;
  }

  autoControl(dt) {
    if (this.humanTeam < 0) {
      this.control = null;
      return;
    }
    const b = this.ball;
    const c = this.ctrl;
    if (c.manualT > 0) c.manualT -= dt;
    if (b.state === 'held' && this.isHumanTeam(b.holder)) {
      if (this.control !== b.holder) this.setControl(b.holder, 0);
      return;
    }
    if (!this.control) this.setControl(this.bestHumanPlayer(null), 0);
    c.checkT -= dt;
    if (c.checkT > 0) return;
    c.checkT = 0.3;
    const cur = this.control;
    const curDown = cur.action === 'down' || cur.action === 'stumble';
    const best = this.bestHumanPlayer(null);
    if (!best || best === cur) return;
    const [fx, fz] = this.focusPoint();
    const dc = dist(cur.x, cur.z, fx, fz);
    const db = dist(best.x, best.z, fx, fz);
    if (curDown || (c.manualT <= 0 && dc - db > 7)) this.setControl(best, 0.25);
  }

  switchControl() {
    const next = this.bestHumanPlayer(this.control);
    if (next) {
      this.setControl(next, 0);
      this.ctrl.manualT = 1.6;
      this.emit('switch', { player: next });
    }
  }

  /** Works out what a kick in direction (ax, az) with this much power is aimed at. */
  pickKickTarget(p, ax, az, power) {
    const team = p.team;
    const maxK = this.maxKick(p);
    const want = lerp(13, maxK, power);
    const gx = this.attackGoalX(p);
    const dgx = gx - p.x;
    const dgz = -p.z;
    const dG = Math.hypot(dgx, dgz) || 1;
    const aG = Math.acos(clamp((dgx * ax + dgz * az) / dG, -1, 1));
    const aLim = dG < 25 ? 0.95 : 0.6;
    let best = null;
    let bestCost = 1e9;
    if (dG < maxK + 8 && aG < aLim && (want > dG * 0.72 || dG < 22)) {
      best = { type: 'goal', x: gx, z: 0, d: dG, player: null };
      bestCost = (aG / aLim) * 0.7 + Math.max(0, dG - want) / maxK;
    }
    for (const t of team.players) {
      if (t === p || t.action === 'down' || t.action === 'stumble') continue;
      const d0 = dist(p.x, p.z, t.x, t.z);
      if (d0 < 5 || d0 > maxK + 6) continue;
      const T = this.flightTime(d0);
      let lx = t.vx * T * 0.75;
      let lz = t.vz * T * 0.75;
      const ll = Math.hypot(lx, lz);
      if (ll > 11) {
        lx *= 11 / ll;
        lz *= 11 / ll;
      }
      const [px, pz] = clampToField(t.x + lx, t.z + lz, 2.5);
      const dx = px - p.x;
      const dz = pz - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 6 || d > maxK + 3) continue;
      const a = Math.acos(clamp((dx * ax + dz * az) / d, -1, 1));
      if (a > (d < 14 ? 0.75 : 0.5)) continue;
      const cost = a / 0.5 + (Math.abs(d - want) / maxK) * 1.8;
      if (cost < bestCost) {
        bestCost = cost;
        best = { type: 'mate', x: px, z: pz, d, player: t };
      }
    }
    if (best) return best;
    const [sx, sz] = clampToField(p.x + ax * want, p.z + az * want, 2);
    return { type: 'space', x: sx, z: sz, d: want, player: null };
  }

  humanKick(p, ax, az, power) {
    const tgt = this.pickKickTarget(p, ax, az, power);
    const pressured = this.nearestOpp(p).d < 2.3;
    const set = this.phase === 'free';
    if (tgt.type === 'goal') {
      this.kickBall(p, tgt.x, tgt.z, { isShot: true, spread: this.kickSpread(p, { pressured, set, shot: true, dG: tgt.d }) });
    } else {
      this.kickBall(p, tgt.x, tgt.z, { intended: tgt.player, spread: this.kickSpread(p, { pressured, set }) * 0.8 });
    }
  }

  humanHandball(p, ax, az) {
    let best = null;
    let bc = 1e9;
    for (const t of p.team.players) {
      if (t === p || t.action === 'down' || t.action === 'stumble') continue;
      const dx = t.x - p.x;
      const dz = t.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 2 || d > 19) continue;
      const a = Math.acos(clamp((dx * ax + dz * az) / d, -1, 1));
      if (a > 1.25) continue;
      const cost = a * 1.2 + d * 0.035;
      if (cost < bc) {
        bc = cost;
        best = t;
      }
    }
    if (best) this.handball(p, best.x + best.vx * 0.35, best.z + best.vz * 0.35, best);
    else this.handball(p, p.x + ax * 7, p.z + az * 7, null);
  }

  beginSetShot(p) {
    const f = this.free;
    const gx = this.attackGoalX(p);
    const dG = dist(p.x, p.z, gx, 0);
    const angle = Math.abs(Math.atan2(p.z, Math.abs(gx - p.x)));
    const maxErr = 0.24;
    // Portion of the meter that scores, from the apparent width of the goal.
    const half = Math.atan((F.GOAL_HALF - 0.3) / dG) * Math.max(0.25, Math.cos(angle));
    const zone = clamp((half / maxErr) * (0.75 + 0.5 * p.attr.kick), 0.07, 0.8);
    const speed = (2.0 + dG / 40) * (this.diff === DIFFICULTY.easy ? 0.78 : this.diff === DIFFICULTY.hard ? 1.15 : 1);
    this.setShot = { player: p, t: this.rng() * 2, needle: 0, zone, maxErr, speed, dG };
    f.limit = Math.max(f.limit, f.t + 9);
    p.face = Math.atan2(-p.z, gx - p.x);
    p.vx = p.vz = 0;
    this.emit('setshot', { player: p, dist: dG });
  }

  finishSetShot() {
    const s = this.setShot;
    if (!s) return;
    const p = s.player;
    const gx = this.attackGoalX(p);
    const err = s.needle * s.maxErr + gauss(this.rng) * 0.008;
    this.kickBall(p, gx, 0, { isShot: true, exactAngle: true, angleErr: err });
  }

  /** Mark / tackle / dive button when we don't have the ball. */
  humanAction(p, ax, az) {
    const b = this.ball;
    const c = b.holder;
    if (b.state === 'free' && b.kind !== 'toss' && (b.y > 1.4 || (b.land && b.land.t > 0.15 && !b.hasBounced))) {
      this.startJump(p);
      this.emit('leap', { player: p });
      return;
    }
    if (this.phase !== 'play') return;
    let lx = ax;
    let lz = az;
    if (c && c.team !== p.team) {
      const d = dist(p.x, p.z, c.x, c.z);
      if (d < 5.5) {
        lx = (c.x + c.vx * 0.15 - p.x) / (d || 1);
        lz = (c.z + c.vz * 0.15 - p.z) / (d || 1);
      }
    } else if (b.state === 'free') {
      const d = dist(p.x, p.z, b.x, b.z);
      if (d < 5) {
        lx = (b.x - p.x) / (d || 1);
        lz = (b.z - p.z) / (d || 1);
      }
    } else {
      return;
    }
    const l = Math.hypot(lx, lz) || 1;
    p.action = 'tackle';
    p.actionT = 0;
    p.actionDur = 0.36;
    p.lungeX = lx / l;
    p.lungeZ = lz / l;
    p.tackleHit = false;
    p.face = Math.atan2(lz, lx);
  }

  updateHuman(p, inp, dt) {
    const c = this.ctrl;
    const mag = Math.hypot(inp.mx, inp.mz);
    const hasInput = mag > 0.2;
    if (hasInput) c.idleT = 0;
    else c.idleT += dt;
    if (c.grace > 0) c.grace -= dt;
    let ax;
    let az;
    if (hasInput) {
      ax = inp.mx / mag;
      az = inp.mz / mag;
    } else {
      ax = Math.cos(p.face);
      az = Math.sin(p.face);
    }
    p.aimX = ax;
    p.aimZ = az;
    c.target = null;
    const busy = p.action === 'down' || p.action === 'stumble' || p.action === 'tackle' || p.action === 'jump';

    if (p.hasBall) {
      const fr = this.phase === 'free' && this.free && this.free.player === p ? this.free : null;
      if (this.setShot) {
        if (inp.kickPressed) this.finishSetShot();
        else if (inp.hbPressed) {
          this.setShot = null;
          this.playOn();
        }
        return;
      }
      if (inp.kickPressed && !p.charging) {
        if (fr && fr.canSetShot) {
          this.beginSetShot(p);
          return;
        }
        p.charging = true;
        p.charge = 0;
        p.chargeHold = 0;
      }
      if (p.charging) {
        p.charge = Math.min(1, p.charge + dt / 0.85);
        if (p.charge >= 1) p.chargeHold += dt;
        c.target = this.pickKickTarget(p, ax, az, p.charge);
        if (!inp.kick || p.chargeHold > 0.6) this.humanKick(p, ax, az, p.charge);
      } else if (inp.hbPressed) {
        if (fr && fr.canSetShot) this.playOn();
        else this.humanHandball(p, ax, az);
      }
    } else {
      p.charging = false;
      if (!busy) {
        if (inp.kickPressed) this.humanAction(p, ax, az);
        else if (inp.hbPressed) this.switchControl();
      }
    }
  }

  // --------------------------------------------------------------- tackles

  tryTackle(t, c) {
    if (this.phase !== 'play' || !c.hasBall || c.immuneT > 0) return false;
    t.tackleCd = 1.3;
    let pr = 0.52 + 0.35 * (t.attr.tackle - c.attr.strength);
    if (this.humanTeam >= 0) {
      if (this.isHumanTeam(c)) pr += this.diff.tackleAdj;
      if (t === this.control) pr += 0.14;
    }
    if (c.sprinting) pr -= 0.08;
    pr = clamp(pr, 0.15, 0.9);
    if (this.rng() >= pr) {
      t.action = 'stumble';
      t.actionT = 0;
      t.actionDur = 0.7;
      this.emit('tacklemiss', { tackler: t, carrier: c });
      return false;
    }
    t.stats.tackles++;
    t.team.stats.tackles++;
    // newcomers get longer to get rid of it before it's "holding the ball"
    const holding = c.possT > (this.isHumanTeam(c) ? this.diff.priorOpp : PRIOR_OPP);
    c.action = 'down';
    c.actionT = 0;
    c.actionDur = holding ? 1.1 : 0.75;
    c.charging = false;
    this.emit('tackle', { tackler: t, carrier: c, holding });
    if (holding) {
      this.dropBall();
      this.awardFree(t, c.x, c.z, 'holding');
    } else {
      const b = this.ball;
      this.dropBall();
      b.state = 'free';
      b.kind = 'loose';
      b.kicker = null;
      b.lastTeam = c.team.idx;
      b.hasBounced = true;
      const a = this.rng() * Math.PI * 2;
      const sp = 2 + this.rng() * 3;
      b.x = c.x;
      b.z = c.z;
      b.y = 0.9;
      b.vx = Math.cos(a) * sp;
      b.vz = Math.sin(a) * sp;
      b.vy = 2 + this.rng() * 2;
      b.noCatchT = 0.3;
      b.age = 0;
      t.action = 'down';
      t.actionT = 0;
      t.actionDur = 0.45;
    }
    return true;
  }

  // ------------------------------------------------------------- contests

  resolveRuck() {
    const b = this.ball;
    const cands = [null, null];
    for (const p of this.players) {
      if (p.action === 'down' || p.action === 'stumble') continue;
      const d = dist(p.x, p.z, b.x, b.z);
      if (d > 2.8) continue;
      const s = (p.pos.id === 'RUC' ? 0.5 : 0) + p.attr.height * 2 + p.attr.mark * 0.5 - d * 0.2 + this.rng() * 0.5;
      const ti = p.team.idx;
      if (!cands[ti] || s > cands[ti].s) cands[ti] = { p, s };
    }
    this.ruck = null;
    b.land = null;
    if (!cands[0] && !cands[1]) {
      b.kind = 'loose';
      return;
    }
    let win;
    if (cands[0] && cands[1]) win = cands[0].s > cands[1].s ? cands[0].p : cands[1].p;
    else win = (cands[0] || cands[1]).p;
    this.startJump(win);
    win.actionT = 0.25;
    // tap it down to a team-mate at the feet of the pack
    let mate = null;
    let bw = 0;
    for (const t of win.team.players) {
      if (t === win || t.action === 'down') continue;
      const d = dist(t.x, t.z, b.x, b.z);
      if (d > 15) continue;
      const w = (1 / (d + 3)) * (0.6 + this.rng());
      if (w > bw) {
        bw = w;
        mate = t;
      }
    }
    let tx;
    let tz;
    if (mate) {
      tx = mate.x + mate.vx * 0.4 + (this.rng() - 0.5) * 3;
      tz = mate.z + mate.vz * 0.4 + (this.rng() - 0.5) * 3;
    } else {
      tx = b.x + win.team.dir * 5;
      tz = b.z + (this.rng() - 0.5) * 6;
    }
    const d = Math.max(1.5, dist(b.x, b.z, tx, tz));
    const T = 0.5 + d / 20;
    b.vx = (tx - b.x) / T;
    b.vz = (tz - b.z) / T;
    b.vy = (1.0 - b.y + 0.5 * G * T * T) / T;
    b.kind = 'tap';
    b.kicker = win;
    b.lastTeam = win.team.idx;
    b.intended = mate;
    b.age = 0;
    b.noCatchT = 0.15;
    b.id++;
    b.land = this.computeLanding(1.0);
    this.possTeam = win.team.idx;
    win.team.stats.hitouts++;
    this.emit('tap', { player: win });
    this.onBallInFlight();
  }

  fumble(p) {
    const b = this.ball;
    const a = this.rng() * Math.PI * 2;
    b.kind = 'loose';
    b.hasBounced = true;
    b.land = null;
    b.intended = null;
    b.vx = b.vx * 0.15 + Math.cos(a) * 2.5;
    b.vz = b.vz * 0.15 + Math.sin(a) * 2.5;
    b.vy = 1.5 + this.rng() * 2.5;
    b.noCatchT = 0.3;
    b.lastTeam = p.team.idx;
    this.emit('fumble', { player: p });
  }

  spoil(p) {
    const b = this.ball;
    const a = Math.atan2(b.vz, b.vx) + (this.rng() - 0.5) * 2.6;
    const sp = 4 + this.rng() * 4;
    b.kind = 'loose';
    b.hasBounced = true;
    b.land = null;
    b.intended = null;
    b.vx = Math.cos(a) * sp;
    b.vz = Math.sin(a) * sp;
    b.vy = 3 + this.rng() * 2.5;
    b.noCatchT = 0.35;
    b.lastTeam = p.team.idx;
    this.emit('spoil', { player: p });
  }

  takeMark(p, info) {
    const b = this.ball;
    const kd = dist(b.fromX, b.fromZ, p.x, p.z);
    const isMark = kd >= MARK_MIN && !this.sirenGone;
    const wasShotByTeam = b.lastTeam;
    this.givePossession(p, 'mark');
    if (isMark) {
      p.stats.marks++;
      p.team.stats.marks++;
      this.emit('mark', { player: p, contested: info.contested, specky: info.specky, intercept: wasShotByTeam !== p.team.idx });
      this.awardFree(p, p.x, p.z, 'mark');
    }
  }

  resolveCatches() {
    const b = this.ball;
    if (b.state !== 'free' || b.noCatchT > 0 || b.kind === 'toss' || b.age < 0.12) return;
    // a kick clears the man on the mark before anyone can get a hand to it
    if (b.kind === 'kick' && !b.hasBounced && b.age < 0.35) return;
    const ground = b.y < 0.9;
    const group = [];
    let any = false;
    for (const p of this.players) {
      if (p.action === 'down' || p.action === 'stumble') continue;
      if (p === b.kicker && b.age < 0.5) continue;
      const dh = dist(p.x, p.z, b.x, b.z);
      if (dh > 2.4) continue;
      const jumping = p.action === 'jump' && p.actionT > 0.08 && p.actionT < 0.62;
      const human = p === this.control ? 0.25 : 0;
      const H = jumping ? JUMP_H : STAND_H;
      const R = (ground ? PICKUP_R : jumping ? JUMP_R : CATCH_R) + human;
      const can = dh <= R && b.y <= H;
      if (can) any = true;
      if (b.y <= H + 0.6) group.push({ p, dh, jumping, can, s: 0 });
    }
    if (!any) return;

    const flyingKick = b.kind === 'kick' && !b.hasBounced;
    if (flyingKick) {
      for (const g of group) {
        const p = g.p;
        g.s = 0.55 * p.attr.mark + this.rng() * 0.55 + (p.attr.height - 1.85) * 1.2 + (g.jumping ? 0.22 : 0) +
          (p === b.intended ? 0.14 : 0) + (p === this.control ? this.diff.humanMark + 0.05 : 0) + (g.can ? 0.2 : 0) - g.dh * 0.08;
      }
      group.sort((a, c) => c.s - a.s);
      const w = group.find((g) => g.can);
      const rivals = group.filter((g) => g.p.team !== w.p.team && g.dh < 2.1);
      if (rivals.length === 0) {
        let pm = 0.84 + 0.14 * w.p.attr.mark + (w.jumping ? 0.04 : 0);
        if (w.p === this.control) pm += 0.06;
        if (this.rng() < pm) this.takeMark(w.p, { contested: false, specky: false });
        else this.fumble(w.p);
      } else {
        const margin = w.s - rivals[0].s;
        const pm = clamp(0.42 + margin * 1.1, 0.2, 0.88);
        if (this.rng() < pm) this.takeMark(w.p, { contested: true, specky: w.jumping && rivals[0].dh < 1.6 });
        else this.spoil(rivals[0].p);
      }
      return;
    }

    // Loose ball: nearest player who can reach it, with a 50/50 when it's contested.
    const cands = group.filter((g) => g.can);
    let pick = cands[0];
    let total = 0;
    for (const g of cands) {
      g.s = 1 / (0.3 + g.dh) + (g.p === b.intended ? 1.5 : 0);
      total += g.s;
    }
    let r = this.rng() * total;
    for (const g of cands) {
      r -= g.s;
      if (r <= 0) {
        pick = g;
        break;
      }
    }
    const contested = cands.some((g) => g.p.team !== pick.p.team);
    const sp = Math.hypot(b.vx, b.vy, b.vz);
    let pc = ground ? 0.9 : pick.p === b.intended ? 0.95 : 0.84;
    if (sp > 14) pc -= 0.15;
    if (contested) pc -= 0.12;
    if (pick.p === this.control) pc += 0.06;
    if (this.rng() < pc) this.givePossession(pick.p, ground ? 'gather' : 'catch');
    else this.fumble(pick.p);
  }

  // ---------------------------------------------------------------- scoring

  score(kind, team, scorer, extra = {}) {
    if (kind === 'goal') team.goals++;
    else team.behinds++;
    if (scorer) {
      if (kind === 'goal') scorer.stats.goals++;
      else scorer.stats.behinds++;
    }
    this.phase = kind;
    this.phaseT = kind === 'goal' ? 3.6 : 2.2;
    this.cutSent = false;
    this.lastScore = { kind, team: team.idx, scorer, end: team.dir, ...extra };
    this.free = null;
    this.setShot = null;
    this.ruck = null;
    this.pending = null;
    for (const p of this.players) p.charging = false;
    if (kind === 'goal') {
      for (const p of team.players) {
        if (p === scorer || dist(p.x, p.z, team.dir * F.GX, 0) < 45) {
          p.action = 'celebrate';
          p.actionT = 0;
          p.actionDur = 3.2;
        }
      }
    }
    this.emit(kind, { team: team.idx, scorer, ...extra });
  }

  resolveScore(s, zc, yc) {
    const b = this.ball;
    const atk = this.teams[0].dir === s ? this.teams[0] : this.teams[1];
    const az = Math.abs(zc);
    const hitGoalPost = Math.abs(az - F.GOAL_HALF) < 0.22 && yc < F.POST_H;
    const hitBehindPost = az > F.BEHIND_HALF - 0.2 && yc < F.BPOST_H;
    const clean = b.kind === 'kick' && b.lastTeam === atk.idx;
    if (hitBehindPost) {
      b.vx *= -0.3;
      this.emit('post', { behindPost: true });
      this.outOfBounds();
      return;
    }
    if (hitGoalPost) {
      b.vx *= -0.35;
      b.vz += (zc > 0 ? 1 : -1) * (az > F.GOAL_HALF ? 3 : -3);
      b.x = s * (F.GX - 0.3);
      this.emit('post', {});
      this.score('behind', atk, clean ? b.kicker : null, { poster: true });
    } else if (az < F.GOAL_HALF && clean) {
      this.score('goal', atk, b.kicker, { dist: dist(b.fromX, b.fromZ, s * F.GX, 0), z: zc });
    } else {
      this.score('behind', atk, clean ? b.kicker : null, { rushed: !clean, z: zc });
    }
  }

  outOfBounds() {
    const b = this.ball;
    const full = b.kind === 'kick' && !b.hasBounced;
    this.dropBall();
    this.ruck = null;
    this.phase = 'stoppage';
    if (full && b.kicker) {
      const other = this.teams[1 - b.kicker.team.idx];
      const [x, z] = clampToField(b.x, b.z, 2.5);
      let best = other.players[0];
      let bd = 1e9;
      for (const p of other.players) {
        const d = dist(p.x, p.z, x, z);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      this.pending = { kind: 'free', freeKind: 'outfull', player: best, x, z, t: 4, t0: 4 };
      this.emit('oob', { full: true, team: other.idx });
    } else {
      const [x, z] = clampToField(b.x, b.z, 0.3);
      // throw it back in along the inward normal of the boundary
      let nx = -x / (F.A * F.A);
      let nz = -z / (F.B * F.B);
      const n = Math.hypot(nx, nz) || 1;
      nx /= n;
      nz /= n;
      this.pending = { kind: 'throwin', x, z, nx, nz, t: 2.6, t0: 2.6 };
      this.ruck = { x: x + nx * 13, z: z + nz * 13 };
      this.emit('oob', { full: false });
    }
  }

  checkBoundary() {
    const b = this.ball;
    for (const s of [1, -1]) {
      if (s * b.px < F.GX && s * b.x >= F.GX) {
        const t = (F.GX - s * b.px) / (s * b.x - s * b.px || 1e-6);
        const zc = b.pz + (b.z - b.pz) * t;
        const yc = b.py + (b.y - b.py) * t;
        if (Math.abs(zc) <= F.BEHIND_HALF + 0.15) {
          this.resolveScore(s, zc, yc);
          return;
        }
      }
    }
    if (fieldValue(b.x, b.z) > 1) this.outOfBounds();
  }

  // ------------------------------------------------------------------ ball

  stepBall(dt) {
    const b = this.ball;
    b.age += dt;
    if (b.noCatchT > 0) b.noCatchT -= dt;
    if (b.state === 'held') {
      const h = b.holder;
      b.x = h.x + Math.cos(h.face) * 0.35;
      b.z = h.z + Math.sin(h.face) * 0.35;
      b.y = 1.1;
      b.vx = h.vx;
      b.vz = h.vz;
      b.vy = 0;
      return;
    }
    if (b.state === 'dead') return;
    b.px = b.x;
    b.py = b.y;
    b.pz = b.z;
    b.vy -= G * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    if (b.land) {
      b.land.t -= dt;
      if (b.land.t < -0.2) b.land = null;
    }
    if (b.y <= BALL_R) {
      b.y = BALL_R;
      if (b.vy < -1.5) {
        // The oval ball never bounces quite where you expect.
        const sp = Math.hypot(b.vx, b.vz);
        const e = 0.35 + this.rng() * 0.3;
        const a = Math.atan2(b.vz, b.vx) + (this.rng() - 0.5) * 0.8;
        const keep = 0.55 + this.rng() * 0.25;
        this.emit('bounce', { v: -b.vy });
        b.vy = -b.vy * e;
        b.vx = Math.cos(a) * sp * keep;
        b.vz = Math.sin(a) * sp * keep;
        b.hasBounced = true;
        b.land = null;
        b.intended = null;
        if (b.kind === 'toss') {
          b.kind = 'loose';
          this.ruck = null;
        }
      } else {
        b.vy = 0;
        const sp = Math.hypot(b.vx, b.vz);
        const dec = 6 * dt;
        if (sp <= dec) {
          b.vx = 0;
          b.vz = 0;
        } else {
          b.vx *= (sp - dec) / sp;
          b.vz *= (sp - dec) / sp;
        }
      }
    }
    if (this.phase === 'play') this.checkBoundary();
  }

  // --------------------------------------------------------------- players

  stepPlayer(p, inp, dt) {
    if (p.tackleCd > 0) p.tackleCd -= dt;
    if (p.immuneT > 0) p.immuneT -= dt;
    if (p.hasBall) p.possT += dt;
    if (p.action) {
      p.actionT += dt;
      if (p.actionT >= p.actionDur) p.action = null;
    }

    const human = p === this.control && (this.phase === 'play' || this.phase === 'free');
    if (human) this.updateHuman(p, inp, dt);

    let mx = 0;
    let mz = 0;
    let wantSprint = false;
    const act = p.action;
    if (act === 'down' || act === 'stumble') {
      // on the deck
    } else if (act === 'tackle') {
      const k = p.actionT < 0.22 ? 11 : 3;
      p.vx = p.lungeX * k;
      p.vz = p.lungeZ * k;
      const c = this.ball.holder;
      if (!p.tackleHit && c && c.team !== p.team && dist(p.x, p.z, c.x, c.z) < 1.5) {
        p.tackleHit = true;
        this.tryTackle(p, c);
      }
    } else if (this.setShot && this.setShot.player === p) {
      // standing over the ball
    } else {
      const c = this.ctrl;
      const mag = human ? Math.hypot(inp.mx, inp.mz) : 0;
      const stick = mag > 0.2;
      // The human's player is helped along by the AI right after a switch, or
      // when the stick is left alone (never while he has the ball).
      let useAI = !human;
      if (human && !p.hasBall) {
        if (c.grace > 0) useAI = true;
        else if (!stick && c.idleT > 0.3) useAI = true;
      }
      if (!useAI) {
        if (stick) {
          const k = Math.min(1, mag) / mag;
          mx = inp.mx * k;
          mz = inp.mz * k;
        }
        wantSprint = inp.sprint;
      } else {
        const ai = p.ai;
        const dx = ai.tx - p.x;
        const dz = ai.tz - p.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.35) {
          const k = clamp(d / 2.2, 0.25, 1) * ai.pace;
          mx = (dx / d) * k;
          mz = (dz / d) * k;
        }
        if (ai.sprint) {
          if (p.stamina < 0.08) ai.tired = true;
          else if (p.stamina > 0.4) ai.tired = false;
          wantSprint = !ai.tired && d > 3;
        }
      }
    }

    // stamina
    const moving = Math.hypot(mx, mz) > 0.5;
    p.sprinting = wantSprint && moving && p.stamina > 0.02;
    if (p.sprinting) p.stamina = Math.max(0, p.stamina - 0.26 * dt);
    else p.stamina = Math.min(1, p.stamina + (moving ? 0.11 : 0.2) * dt);

    if (act !== 'tackle') {
      let spd = p.maxSpd;
      if (this.humanTeam >= 0 && !this.isHumanTeam(p)) spd *= this.diff.aiSpeed;
      if (p.sprinting) spd *= 1.27;
      if (p.hasBall) spd *= 0.95;
      if (p.charging) spd *= 0.8;
      if (act === 'jump') spd *= 0.35;
      if (act === 'celebrate') spd *= 0.5;
      if (act === 'down' || act === 'stumble') spd = 0;
      if (this.phase === 'free' && this.free && this.free.player === p) spd *= 0.45;
      const k = Math.min(1, dt * (spd === 0 ? 6 : 9));
      p.vx += (mx * spd - p.vx) * k;
      p.vz += (mz * spd - p.vz) * k;
    }

    const ox = p.x;
    const oz = p.z;
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    // keep everyone on the park (and out of the goals)
    if (fieldValue(p.x, p.z, 0.4) > 1) [p.x, p.z] = clampToField(p.x, p.z, 0.4);
    if (Math.abs(p.x) > F.GX - 0.4) p.x = Math.sign(p.x) * (F.GX - 0.4);
    if (p.hasBall) p.carryDist += Math.hypot(p.x - ox, p.z - oz);

    // facing
    const sp = Math.hypot(p.vx, p.vz);
    let want = p.face;
    if (p.charging || (this.setShot && this.setShot.player === p)) {
      want = p.charging ? Math.atan2(p.aimZ, p.aimX) : p.face;
    } else if (sp > 0.9) {
      want = Math.atan2(p.vz, p.vx);
    } else if (!p.hasBall && act !== 'kick' && act !== 'handball' && act !== 'down') {
      const b = this.ball;
      want = Math.atan2(b.z - p.z, b.x - p.x);
    }
    p.face += angDiff(want, p.face) * Math.min(1, dt * 12);
  }

  separatePlayers() {
    const ps = this.players;
    const MIN = 0.8;
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i];
      for (let j = i + 1; j < ps.length; j++) {
        const c = ps[j];
        const dx = c.x - a.x;
        const dz = c.z - a.z;
        if (dx > MIN || dx < -MIN || dz > MIN || dz < -MIN) continue;
        const d2 = dx * dx + dz * dz;
        if (d2 >= MIN * MIN) continue;
        const d = Math.sqrt(d2) || 0.01;
        const push = (MIN - d) * 0.5;
        const nx = d > 0.02 ? dx / d : 1;
        const nz = d > 0.02 ? dz / d : 0;
        a.x -= nx * push;
        a.z -= nz * push;
        c.x += nx * push;
        c.z += nz * push;
      }
    }
  }

  // ------------------------------------------------------------- quarters

  endQuarter() {
    for (const t of this.teams) t.quarters.push({ goals: t.goals, behinds: t.behinds });
    this.dropBall();
    this.ball.state = 'dead';
    this.ruck = null;
    this.pending = null;
    for (const p of this.players) p.charging = false;
    this.phase = this.quarter >= 4 ? 'full' : 'quarter';
    this.emit(this.quarter >= 4 ? 'fulltime' : 'quarterend', { quarter: this.quarter });
  }

  nextQuarter() {
    if (this.phase !== 'quarter') return;
    this.quarter++;
    this.clock = this.quarterLen;
    this.sirenGone = false;
    for (const t of this.teams) t.dir = -t.dir;
    for (const p of this.players) p.stamina = 1;
    this.startCentreBounce(true);
  }

  get winner() {
    const a = this.teams[0].goals * 6 + this.teams[0].behinds;
    const b = this.teams[1].goals * 6 + this.teams[1].behinds;
    return a === b ? -1 : a > b ? 0 : 1;
  }

  // ------------------------------------------------------------------ step

  step(dt, input) {
    const inp = input || NO_INPUT;
    const b = this.ball;
    this.time += dt;

    // phase timers
    switch (this.phase) {
      case 'bounce':
        this.phaseT -= dt;
        if (this.phaseT <= 0) {
          this.emit('whistle', { kind: 'bounce' });
          this.tossUp(0, 0);
        }
        break;
      case 'goal':
      case 'behind':
        this.phaseT -= dt;
        if (this.phase === 'goal' && !this.cutSent && this.phaseT <= 0.4) {
          this.cutSent = true;
          this.emit('cut');
        }
        if (this.phaseT <= 0) {
          if (this.sirenGone) this.endQuarter();
          else if (this.phase === 'goal') this.startCentreBounce();
          else this.startKickIn();
        }
        break;
      case 'stoppage':
        this.stepStoppage(dt);
        break;
      case 'free': {
        const f = this.free;
        f.t += dt;
        if (this.setShot) {
          const s = this.setShot;
          s.t += dt;
          s.needle = Math.sin(s.t * s.speed * 2);
        }
        if (dist(f.player.x, f.player.z, f.x, f.z) > 3.6) this.playOn();
        else if (f.t > f.limit) {
          if (this.setShot) this.finishSetShot();
          else if (this.sirenGone) this.endQuarter();
          else this.playOn();
        }
        break;
      }
      default:
        break;
    }

    // game clock
    if ((this.phase === 'play' || this.phase === 'free') && !this.sirenGone) {
      this.clock -= dt;
      if (this.clock <= 0) {
        this.clock = 0;
        this.sirenGone = true;
        this.emit('siren', { quarter: this.quarter });
      }
    }
    if (this.sirenGone && this.phase === 'play') {
      const live = b.state === 'free' && b.kind === 'kick' && !b.hasBounced && b.age < 4;
      if (!live) this.endQuarter();
    }
    [this.focus.x, this.focus.z] = this.focusPoint();
    if (this.phase === 'quarter' || this.phase === 'full') {
      updateAI(this, dt);
      for (const p of this.players) this.stepPlayer(p, NO_INPUT, dt);
      return;
    }
    this.autoControl(dt);
    updateAI(this, dt);
    for (const p of this.players) this.stepPlayer(p, inp, dt);
    this.separatePlayers();
    this.stepBall(dt);

    if (this.phase === 'play') {
      // inside-50s: the ball arriving in a team's attacking arc
      for (const t of this.teams) {
        const inside = this.possTeam === t.idx && dist(b.x, b.z, t.dir * F.GX, 0) < F.ARC;
        if (inside && !t.in50) t.stats.inside50++;
        t.in50 = inside;
      }
      if (b.state === 'free') {
        if (b.kind === 'toss') {
          if (b.vy < 0 && b.y <= 3.3) this.resolveRuck();
        } else {
          this.resolveCatches();
        }
      }
      // if nobody can get clean hands on it, the umpire calls for a ball-up
      this.looseT = b.state === 'free' && b.kind !== 'toss' ? (this.looseT || 0) + dt : 0;
      if (this.looseT > 9 && this.phase === 'play' && !this.sirenGone) {
        this.looseT = 0;
        this.startBallUp(b.x, b.z);
      }
    }
  }

  stepStoppage(dt) {
    const pd = this.pending;
    const b = this.ball;
    if (!pd) {
      this.phase = 'play';
      return;
    }
    pd.t -= dt;
    if (pd.kind === 'ballup') {
      if (pd.t <= 0) {
        this.emit('whistle', { kind: 'bounce' });
        this.tossUp(pd.x, pd.z);
      }
    } else if (pd.kind === 'throwin') {
      if (pd.t <= pd.t0 - 0.9 && b.state !== 'dead') {
        b.state = 'dead';
        b.x = pd.x;
        b.z = pd.z;
        b.y = 1.3;
        b.vx = b.vy = b.vz = 0;
      }
      if (pd.t <= 0) this.tossUp(pd.x, pd.z, pd.nx * 5.4, pd.nz * 5.4, 12.5);
    } else {
      // someone jogs over to take a free kick or kick-in
      const p = pd.player;
      if (pd.t <= pd.t0 - 0.9 && b.state !== 'dead') {
        b.state = 'dead';
        b.x = pd.x;
        b.z = pd.z;
        b.y = BALL_R;
        b.vx = b.vy = b.vz = 0;
      }
      const d = dist(p.x, p.z, pd.x, pd.z);
      if ((d < 1.2 && pd.t <= pd.t0 - 0.6) || pd.t <= 0) {
        if (d > 3) {
          p.x = pd.x;
          p.z = pd.z;
          p.vx = p.vz = 0;
        }
        if (p.action === 'down' || p.action === 'stumble') p.action = null;
        this.awardFree(p, p.x, p.z, pd.freeKind);
      }
    }
  }

  startKickIn() {
    const ls = this.lastScore;
    const def = this.teams[1 - ls.team];
    const s = ls.end;
    const p = def.players.find((q) => q.pos.id === 'FB');
    this.phase = 'stoppage';
    this.pending = { kind: 'free', freeKind: 'kickin', player: p, x: s * (F.GX - 6.5), z: 0, t: 2.2, t0: 2.2 };
    this.ruck = null;
  }
}
