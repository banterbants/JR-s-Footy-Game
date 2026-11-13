// Team and player AI. Every player gets a role each tick, a spot to run to,
// and (when not human-controlled) decides when to kick, handball, tackle or leap.
import { F } from '../config.js';
import { clamp, lerp, clampToField, dist } from '../util.js';

/** Where a position "lives" given where the ball is. */
export function formationSpot(p, bx, bz, strict = false) {
  const pos = p.pos;
  const hx = pos.fx * F.A * p.team.dir;
  const hz = pos.fz * F.B;
  if (strict) return [hx, hz];
  const tx = hx + (bx - hx) * pos.w;
  const tz = hz + (bz - hz) * pos.w * 0.8;
  return clampToField(tx, tz, 3);
}

const isDown = (p) => p.action === 'down' || p.action === 'stumble';

function byDistance(players, x, z, filter) {
  const out = [];
  for (const p of players) {
    if (filter && !filter(p)) continue;
    out.push({ p, d: dist(p.x, p.z, x, z) });
  }
  out.sort((a, b) => a.d - b.d);
  return out;
}

function ruckRoles(m, team) {
  const ps = team.players;
  const R = m.ruck;
  let ruckman = ps.find((p) => p.pos.id === 'RUC');
  if (!ruckman || isDown(ruckman) || dist(ruckman.x, ruckman.z, R.x, R.z) > 38) {
    const near = byDistance(ps, R.x, R.z, (p) => !isDown(p) && p.ai.role !== 'fetch');
    ruckman = near.length ? near[0].p : ruckman;
  }
  if (ruckman) ruckman.ai.role = 'ruck';
  const ring = byDistance(ps, R.x, R.z, (p) => p !== ruckman && p.ai.role === 'form' && p.pos.line !== 'B' && p.pos.line !== 'F');
  for (let i = 0; i < Math.min(3, ring.length); i++) {
    ring[i].p.ai.role = 'ring';
    ring[i].p.ai.slot = i;
  }
}

function assignRoles(m, team) {
  const b = m.ball;
  const ps = team.players;
  for (const p of ps) p.ai.role = 'form';
  const phase = m.phase;

  if (phase === 'goal' || phase === 'behind' || phase === 'quarter' || phase === 'full') {
    for (const p of ps) p.ai.role = phase === 'goal' && m.lastScore && m.lastScore.team === team.idx ? 'celebrate' : 'idle';
    return;
  }

  if (phase === 'bounce') {
    for (const p of ps) p.ai.role = 'idle';
    return;
  }

  if (phase === 'stoppage') {
    const pd = m.pending;
    if (pd && pd.player && pd.player.team === team) pd.player.ai.role = 'fetch';
    if (m.ruck) ruckRoles(m, team);
    return;
  }

  // A ruck contest is coming (centre bounce, ball-up or boundary throw-in).
  if (m.ruck) {
    ruckRoles(m, team);
    return;
  }

  if (b.state === 'held') {
    const c = b.holder;
    if (c.team === team) {
      c.ai.role = 'carrier';
      const dir = team.dir;
      let slots = 0;
      const near = byDistance(ps, c.x, c.z, (p) => p !== c && !isDown(p));
      for (const { p, d } of near) {
        const ahead = (p.x - c.x) * dir;
        const line = p.pos.line;
        if (ahead > 12 && line !== 'B' && line !== 'HB') {
          p.ai.role = 'lead';
        } else if (slots < 2 && d < 34 && line !== 'B') {
          p.ai.role = 'support';
          p.ai.slot = slots++;
        }
      }
    } else if (phase === 'free') {
      const f = m.free;
      const near = byDistance(ps, f.x, f.z, (p) => !isDown(p));
      if (near.length) near[0].p.ai.role = 'onMark';
      for (let i = 1; i < near.length && near[i].d < 7; i++) near[i].p.ai.role = 'away';
    } else {
      const near = byDistance(ps, c.x + c.vx * 0.3, c.z + c.vz * 0.3, (p) => !isDown(p));
      if (near[0]) near[0].p.ai.role = 'press';
      if (near[1]) near[1].p.ai.role = near[1].d < 9 ? 'press' : 'cover';
      if (near[2] && near[2].d < 22) near[2].p.ai.role = 'cover';
    }
    return;
  }

  if (b.state === 'free') {
    const inFlight = b.land && !b.hasBounced && (b.kind === 'kick' || b.kind === 'handball' || b.kind === 'tap');
    if (inFlight) {
      const L = b.land;
      const near = byDistance(ps, L.x, L.z, (p) => !isDown(p) && !(p === b.kicker && b.age < 0.5));
      let n = 0;
      if (b.intended && b.intended.team === team && !isDown(b.intended)) {
        b.intended.ai.role = 'contest';
        n = 1;
      }
      for (const { p, d } of near) {
        if (p.ai.role === 'contest') continue;
        const canReach = (d - 1.2) / (p.maxSpd * 1.2) <= L.t + 0.4;
        if (n === 0 && (canReach || d < 14)) {
          p.ai.role = 'contest';
          n = 1;
        } else if (n === 1 && d < 26 && b.kind === 'kick') {
          p.ai.role = 'crumb';
          n = 2;
          break;
        } else if (n >= 1) break;
      }
    } else {
      const px = b.x + b.vx * 0.3;
      const pz = b.z + b.vz * 0.3;
      const near = byDistance(ps, px, pz, (p) => !isDown(p));
      if (near[0]) near[0].p.ai.role = 'chase';
      if (near[1] && near[1].d < 30) near[1].p.ai.role = 'chase2';
      if (near[2] && near[2].d < 26) near[2].p.ai.role = 'cover';
    }
  }
}

/** Formation spot, with defenders sticking goal-side of their direct opponent. */
function formTarget(m, p) {
  let [tx, tz] = formationSpot(p, m.focus.x, m.focus.z);
  const defending = m.possTeam !== p.team.idx;
  const line = p.pos.line;
  const o = p.opp;
  if (o && (line === 'B' || line === 'HB' || (defending && (line === 'C' || line === 'R')))) {
    const gx = -p.team.dir * F.GX;
    const dx = gx - o.x;
    const dz = -o.z;
    const d = Math.hypot(dx, dz) || 1;
    const mx = o.x + (dx / d) * 1.7;
    const mz = o.z + (dz / d) * 1.7;
    if (dist(mx, mz, tx, tz) < 34) {
      const k = defending ? 0.85 : 0.45;
      tx = lerp(tx, mx, k);
      tz = lerp(tz, mz, k);
    }
  }
  return [tx, tz];
}

function computeTarget(m, p, dt) {
  const ai = p.ai;
  const b = m.ball;
  const dir = p.team.dir;
  let tx = p.x;
  let tz = p.z;
  ai.sprint = false;
  ai.pace = 0.78;
  if (ai.leadCd > 0) ai.leadCd -= dt;

  switch (ai.role) {
    case 'idle':
      break;
    case 'form': {
      [tx, tz] = formTarget(m, p);
      if (dist(p.x, p.z, tx, tz) > 14) ai.pace = 1;
      ai.leadT = 0;
      break;
    }
    case 'lead': {
      const c = b.holder;
      if (ai.leadT > 0) {
        ai.leadT -= dt;
        tx = ai.leadX;
        tz = ai.leadZ;
        ai.sprint = true;
        ai.pace = 1;
        if (dist(p.x, p.z, tx, tz) < 1) ai.leadT = 0;
      } else {
        [tx, tz] = formTarget(m, p);
        if (ai.leadCd <= 0 && c) {
          const dx = c.x - p.x;
          const dz = c.z - p.z;
          const d = Math.hypot(dx, dz);
          if (d > 16 && d < 78) {
            // Lead toward the kicker, or peel off into the corridor in front of goal.
            let ang = Math.atan2(dz, dx) + (m.rng() - 0.5) * 1.7;
            if (m.rng() < 0.25) ang = Math.atan2(-p.z, dir * 20);
            const len = 9 + m.rng() * 9;
            const [lx, lz] = clampToField(p.x + Math.cos(ang) * len, p.z + Math.sin(ang) * len, 5);
            ai.leadX = lx;
            ai.leadZ = lz;
            ai.leadT = 1.1 + m.rng() * 1.0;
          }
          ai.leadCd = 1.4 + m.rng() * 2.4;
        }
      }
      break;
    }
    case 'support': {
      const c = b.holder;
      if (c) {
        const side = ai.slot === 0 ? 1 : -1;
        const a = Math.atan2(0, dir) + side * 1.0;
        [tx, tz] = clampToField(c.x + Math.cos(a) * 11, c.z + Math.sin(a) * 11, 3);
        ai.pace = 1;
      }
      break;
    }
    case 'carrier':
      // movement is set by aiCarrier()
      tx = ai.tx;
      tz = ai.tz;
      ai.pace = 1;
      break;
    case 'press': {
      const c = b.holder;
      if (c) {
        const d = dist(p.x, p.z, c.x, c.z);
        const lead = clamp(d / 10, 0, 0.55);
        tx = c.x + c.vx * lead;
        tz = c.z + c.vz * lead;
        ai.sprint = true;
        ai.pace = 1;
      }
      break;
    }
    case 'cover': {
      const c = b.holder;
      const ox = c ? c.x : b.x;
      const oz = c ? c.z : b.z;
      const gx = -dir * F.GX;
      const dx = gx - ox;
      const dz = -oz;
      const d = Math.hypot(dx, dz) || 1;
      tx = ox + (dx / d) * 8;
      tz = oz + (dz / d) * 8;
      ai.pace = 1;
      break;
    }
    case 'onMark': {
      const f = m.free;
      if (f) {
        const gx = f.player.team.dir * F.GX;
        const dx = gx - f.x;
        const dz = -f.z;
        const d = Math.hypot(dx, dz) || 1;
        tx = f.x + (dx / d) * 4.5;
        tz = f.z + (dz / d) * 4.5;
        ai.pace = 1;
      }
      break;
    }
    case 'away': {
      const f = m.free;
      if (f) {
        const dx = p.x - f.x;
        const dz = p.z - f.z;
        const d = Math.hypot(dx, dz) || 1;
        tx = f.x + (dx / d) * 8;
        tz = f.z + (dz / d) * 8;
      }
      break;
    }
    case 'contest': {
      const L = b.land;
      if (L) {
        tx = L.x;
        tz = L.z;
        ai.sprint = true;
        ai.pace = 1;
      }
      break;
    }
    case 'crumb': {
      const L = b.land;
      if (L) {
        const sp = Math.hypot(b.vx, b.vz) || 1;
        tx = L.x + (b.vx / sp) * 3.5 + (b.vz / sp) * 2 * dir;
        tz = L.z + (b.vz / sp) * 3.5 - (b.vx / sp) * 2 * dir;
        ai.pace = 1;
      }
      break;
    }
    case 'chase':
    case 'chase2': {
      const d = dist(p.x, p.z, b.x, b.z);
      const t = clamp(d / (p.maxSpd * 1.2), 0, 0.7);
      tx = b.x + b.vx * t;
      tz = b.z + b.vz * t;
      if (b.y > 3 && b.land) {
        tx = b.land.x;
        tz = b.land.z;
      }
      if (ai.role === 'chase2') tx -= dir * 2.5;
      ai.sprint = true;
      ai.pace = 1;
      break;
    }
    case 'ruck': {
      const R = m.ruck;
      if (R) {
        tx = R.x - dir * 0.7;
        tz = R.z;
        ai.pace = 1;
        ai.sprint = dist(p.x, p.z, tx, tz) > 10;
      }
      break;
    }
    case 'ring': {
      const R = m.ruck;
      if (R) {
        const offs = [1.15, -1.15, Math.PI];
        const a = Math.atan2(0, dir) + offs[ai.slot % 3];
        [tx, tz] = clampToField(R.x + Math.cos(a) * 6, R.z + Math.sin(a) * 6, 2);
        ai.pace = 1;
      }
      break;
    }
    case 'fetch': {
      const pd = m.pending;
      if (pd) {
        tx = pd.x;
        tz = pd.z;
        ai.sprint = true;
        ai.pace = 1;
      }
      break;
    }
    case 'celebrate': {
      const s = m.lastScore && m.lastScore.scorer;
      if (s && s !== p && dist(p.x, p.z, s.x, s.z) < 28) {
        const dx = p.x - s.x;
        const dz = p.z - s.z;
        const d = Math.hypot(dx, dz) || 1;
        tx = s.x + (dx / d) * 2;
        tz = s.z + (dz / d) * 2;
        ai.pace = 0.9;
      }
      break;
    }
    default:
      break;
  }
  ai.tx = tx;
  ai.tz = tz;
}

function bestKickOption(m, p) {
  const team = p.team;
  const opp = m.teams[1 - team.idx];
  const dir = team.dir;
  const gx = dir * F.GX;
  const maxK = m.maxKick(p);
  let best = null;
  for (const t of team.players) {
    if (t === p || isDown(t)) continue;
    const d0 = dist(p.x, p.z, t.x, t.z);
    if (d0 < 12 || d0 > maxK) continue;
    const T = m.flightTime(d0);
    const [px, pz] = clampToField(t.x + t.vx * T * 0.7, t.z + t.vz * T * 0.7, 3);
    const prog = (px - p.x) * dir;
    if (prog < -8) continue;
    let open = 99;
    for (const o of opp.players) {
      const d = dist(px, pz, o.x + o.vx * T * 0.5, o.z + o.vz * T * 0.5);
      if (d < open) open = d;
    }
    const dGt = dist(px, pz, gx, 0);
    let val = prog * 0.03 + Math.min(open, 7) * 0.13 - 0.45;
    if (dGt < 45) val += 0.35;
    if (dGt < 25) val += 0.2;
    val -= (Math.abs(pz) / F.B) * 0.2;
    if (t.ai.leadT > 0) val += 0.25;
    if (!best || val > best.val) best = { t, x: px, z: pz, val };
  }
  return best;
}

function bestHandballOption(m, p) {
  const team = p.team;
  const opp = m.teams[1 - team.idx];
  const dir = team.dir;
  let best = null;
  for (const t of team.players) {
    if (t === p || isDown(t)) continue;
    const d = dist(p.x, p.z, t.x, t.z);
    if (d < 3 || d > 14) continue;
    const prog = (t.x - p.x) * dir;
    if (prog < -7) continue;
    let open = 99;
    for (const o of opp.players) {
      const od = dist(t.x, t.z, o.x, o.z);
      if (od < open) open = od;
    }
    if (open < 2.4) continue;
    const val = Math.min(open, 8) + prog * 0.25;
    if (!best || val > best.val) best = { t, val };
  }
  return best;
}

function aiCarrier(m, p, dt) {
  const ai = p.ai;
  const dir = p.team.dir;
  const gx = dir * F.GX;
  const dG = dist(p.x, p.z, gx, 0);
  const maxK = m.maxKick(p);
  const shotAng = Math.abs(Math.atan2(p.z, Math.abs(gx - p.x)));
  const press = m.nearestOpp(p);
  ai.runT += dt;
  ai.decideT -= dt;

  if (m.phase === 'free' && m.free && m.free.player === p) {
    ai.tx = p.x;
    ai.tz = p.z;
    p.face = Math.atan2(-p.z, gx - p.x);
    if (m.free.t >= m.free.aiDelay) {
      if (dG <= maxK - 1 && shotAng < 1.2) {
        m.aiShoot(p, { set: true });
      } else {
        const o = bestKickOption(m, p);
        if (o && o.val > -0.2) m.aiKickTo(p, o, { set: true });
        else m.aiBomb(p, { set: true });
      }
    }
    return;
  }

  // Run at goal, veering away from the closest opponent.
  let mx = gx - p.x;
  let mz = -p.z * 0.6;
  let d = Math.hypot(mx, mz) || 1;
  mx /= d;
  mz /= d;
  if (press.o && press.d < 6) {
    const k = ((6 - press.d) / 6) * 1.3;
    const ox = p.x - press.o.x;
    const oz = p.z - press.o.z;
    const od = Math.hypot(ox, oz) || 1;
    mx += (ox / od) * k;
    mz += (oz / od) * k;
  }
  d = Math.hypot(mx, mz) || 1;
  [ai.tx, ai.tz] = clampToField(p.x + (mx / d) * 8, p.z + (mz / d) * 8, 2.5);
  ai.sprint = press.d < 8;
  if (ai.decideT > 0) return;
  ai.decideT = 0.14;

  const pressured = press.d < 2.6;
  if (dG < 28 && shotAng < 1.25) return void m.aiShoot(p, { pressured });
  if (dG < maxK - 4 && shotAng < 0.95 && (pressured || ai.runT > 0.5)) return void m.aiShoot(p, { pressured });

  if (pressured) {
    const h = bestHandballOption(m, p);
    if (h) return void m.aiHandball(p, h.t);
    const o = bestKickOption(m, p);
    if (o) return void m.aiKickTo(p, o, { pressured: true });
    return void m.aiBomb(p, { pressured: true });
  }

  const o = bestKickOption(m, p);
  const need = ai.runT > ai.maxRun ? -0.5 : 0.55;
  if (o && o.val > need) return void m.aiKickTo(p, o, {});
  if (ai.runT > ai.maxRun + 0.6) m.aiBomb(p, {});
}

function act(m, p, dt) {
  const ai = p.ai;
  const b = m.ball;
  if (p.action === 'down' || p.action === 'stumble' || p.action === 'tackle') return;

  if (ai.role === 'carrier' && p.hasBall) {
    aiCarrier(m, p, dt);
    return;
  }

  // Tackling: any defender who gets hold of the ball carrier has a crack.
  const c = b.holder;
  if (m.phase === 'play' && c && c.team !== p.team && p.tackleCd <= 0) {
    if (dist(p.x, p.z, c.x, c.z) < 1.3) {
      ai.tackleWait += dt;
      const delay = c.team.idx === m.humanTeam ? m.diff.tackleDelay : 0.12;
      if (ai.tackleWait >= delay) {
        ai.tackleWait = 0;
        m.tryTackle(p, c);
      }
    } else {
      ai.tackleWait = 0;
    }
  }

  // Leaping for marks and ruck contests.
  if (!p.action && b.state === 'free') {
    if (ai.role === 'contest' && b.kind === 'kick' && ai.jumpFor !== b.id && b.land && b.land.t < 0.3 && dist(p.x, p.z, b.land.x, b.land.z) < 2.6) {
      ai.jumpFor = b.id; // decide once per kick: fly for it, or stay down for a chest mark
      if (m.rng() < 0.55) m.startJump(p);
    }
    if (ai.role === 'ruck' && b.kind === 'toss' && b.vy < 0 && b.y < 6.2 && dist(p.x, p.z, b.x, b.z) < 3) {
      m.startJump(p);
    }
  }
}

export function updateAI(m, dt) {
  for (const team of m.teams) assignRoles(m, team);
  for (const p of m.players) {
    computeTarget(m, p, dt);
    if (p !== m.control) act(m, p, dt);
  }
}
