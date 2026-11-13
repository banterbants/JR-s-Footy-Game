// Headless smoke test: plays full matches at high speed and reports stats.
// Usage: node tools/sim-test.mjs [matches] [mode]
//   mode "demo"  - AI v AI (default)
//   mode "bot"   - a scripted "human" on team 0, to exercise the control code
import { Match } from '../src/sim/match.js';
import { TEAMS, F } from '../src/config.js';
import { makeRng } from '../src/util.js';

const N = Number(process.argv[2] || 6);
const MODE = process.argv[3] || 'demo';
const DT = 1 / 60;
const DIFF = process.argv[4] || 'medium';
const SKILL = Number(process.argv[5] || 0.7); // how tidy the bot's set shots are

/** Plays roughly like a competent person would: runs at goal, picks out team-mates, tackles and flies for marks. */
function botInput(m, rng, st) {
  const p = m.control;
  const inp = { mx: 0, mz: 0, kick: false, kickPressed: false, hbPressed: false, sprint: false };
  if (!p) return inp;
  const dir = p.team.dir;
  const gx = dir * F.GX;
  st.t -= DT;
  if (p.hasBall) {
    const dG = Math.hypot(gx - p.x, p.z);
    const maxK = m.maxKick(p);
    const press = m.nearestOpp(p);
    if (m.setShot) {
      if (Math.abs(m.setShot.needle) < m.setShot.zone * SKILL) inp.kickPressed = true;
      return inp;
    }
    if (m.phase === 'free' && m.free && m.free.canSetShot) {
      if (m.free.t > 0.5) inp.kickPressed = true;
      return inp;
    }
    // where do we want to kick?
    if (st.planFor !== p) {
      st.planFor = p;
      st.plan = null;
      st.wait = 0.2 + rng() * 0.4;
      st.hold = 0;
    }
    st.wait -= DT;
    let ax = gx - p.x;
    let az = -p.z * 0.6;
    if (st.plan) {
      ax = st.plan.x - p.x;
      az = st.plan.z - p.z;
    }
    const al = Math.hypot(ax, az) || 1;
    inp.mx = ax / al;
    inp.mz = az / al;
    inp.sprint = press.d < 7;
    if (st.hold > 0) {
      st.hold -= DT;
      inp.kick = st.hold > 0;
      if (st.hold <= 0) st.planFor = null;
      return inp;
    }
    if (m.phase !== 'free' && press.d < 1.7 && st.wait > 0.15 && rng() < 0.1) {
      inp.hbPressed = true;
      return inp;
    }
    if (st.wait <= 0) {
      let target = null;
      if (dG < maxK - 3) target = { x: gx, z: 0, power: 1 };
      else {
        let best = -1e9;
        for (const t of p.team.players) {
          if (t === p) continue;
          const d = Math.hypot(t.x - p.x, t.z - p.z);
          const prog = (t.x - p.x) * dir;
          if (d < 14 || d > maxK || prog < 5) continue;
          let open = 99;
          for (const o of m.teams[1 - p.team.idx].players) open = Math.min(open, Math.hypot(o.x - t.x, o.z - t.z));
          const v = prog * 0.03 + Math.min(open, 6) * 0.15 + rng() * 0.3;
          if (v > best) {
            best = v;
            target = { x: t.x + t.vx * 0.8, z: t.z + t.vz * 0.8, power: (d - 13) / (maxK - 13) };
          }
        }
        if (!target) target = { x: p.x + dir * 40, z: p.z * 0.5, power: 0.9 };
      }
      st.plan = target;
      st.hold = Math.max(0.08, target.power * 0.85 + (rng() - 0.5) * 0.12);
      inp.kickPressed = true;
      inp.kick = true;
      const l = Math.hypot(target.x - p.x, target.z - p.z) || 1;
      inp.mx = (target.x - p.x) / l;
      inp.mz = (target.z - p.z) / l;
    }
  } else {
    st.plan = null;
    st.planFor = null;
    const b = m.ball;
    const c = b.holder;
    let fx = b.x + b.vx * 0.3;
    let fz = b.z + b.vz * 0.3;
    if (b.state === 'free' && b.land && !b.hasBounced) {
      fx = b.land.x;
      fz = b.land.z;
    } else if (c) {
      fx = c.x + c.vx * 0.3;
      fz = c.z + c.vz * 0.3;
    }
    const dx = fx - p.x;
    const dz = fz - p.z;
    const d = Math.hypot(dx, dz) || 1;
    if (d > 0.4) {
      inp.mx = dx / d;
      inp.mz = dz / d;
    }
    inp.sprint = d > 4;
    if (st.t <= 0) {
      if (c && c.team !== p.team && d < 2.3) {
        inp.kickPressed = true;
        st.t = 0.6;
      } else if (b.state === 'free' && b.kind === 'kick' && b.land && !b.hasBounced && b.land.t < 0.33 && d < 2.5) {
        inp.kickPressed = true;
        st.t = 0.8;
      } else if (c && c.team !== p.team && d > 14 && rng() < 0.05) {
        inp.hbPressed = true;
        st.t = 0.8;
      }
    }
  }
  return inp;
}

const totals = { goals: 0, behinds: 0, marks: 0, tackles: 0, kicks: 0, handballs: 0, events: {}, byTeam: {} };
let humanWins = 0;
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const home = TEAMS[i % TEAMS.length];
  const away = TEAMS[(i * 3 + 1) % TEAMS.length === i % TEAMS.length ? (i + 2) % TEAMS.length : (i * 3 + 1) % TEAMS.length];
  const m = new Match({ home, away, humanTeam: MODE === 'bot' ? 0 : -1, difficulty: DIFF, quarterLen: 180, seed: 1000 + i * 77 });
  const rng = makeRng(99 + i);
  const st = { t: 0, hold: 0, plan: null, planFor: null, wait: 0 };
  let steps = 0;
  let lastPhase = '';
  let phaseSteps = 0;
  const phaseTime = {};
  while (m.phase !== 'full') {
    if (m.phase === 'quarter') m.nextQuarter();
    m.step(DT, MODE === 'bot' ? botInput(m, rng, st) : null);
    for (const e of m.events) {
      totals.events[e.type] = (totals.events[e.type] || 0) + 1;
      const pl = e.player || e.scorer || e.tackler;
      const team = pl ? pl.team.idx : e.team;
      if (team != null) {
        const k = `${e.type}${e.rushed ? '(rushed)' : ''}${e.poster ? '(post)' : ''}${e.holding ? '(holding)' : ''}${e.kind && e.type === 'free' ? `(${e.kind})` : ''}`;
        const row = (totals.byTeam[k] = totals.byTeam[k] || [0, 0]);
        row[team]++;
      }
    }
    m.events.length = 0;
    phaseTime[m.phase] = (phaseTime[m.phase] || 0) + DT;
    if (m.phase === lastPhase) phaseSteps++;
    else {
      lastPhase = m.phase;
      phaseSteps = 0;
    }
    for (const p of m.players) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) throw new Error(`NaN player position at step ${steps}`);
    }
    if (!Number.isFinite(m.ball.x) || !Number.isFinite(m.ball.y)) throw new Error(`NaN ball at step ${steps}`);
    if (++steps > 60 * 60 * 40) throw new Error(`match ${i} never finished (phase ${m.phase}, q${m.quarter}, clock ${m.clock})`);
  }
  const [a, b] = m.teams;
  for (const t of m.teams) {
    totals.goals += t.goals;
    totals.behinds += t.behinds;
    totals.marks += t.stats.marks;
    totals.tackles += t.stats.tackles;
    totals.kicks += t.stats.kicks;
    totals.handballs += t.stats.handballs;
  }
  if (m.winner === 0) humanWins++;
  const pt = Object.entries(phaseTime).map(([k, v]) => `${k}:${v.toFixed(0)}s`).join(' ');
  console.log(
    `${a.def.id} ${a.goals}.${a.behinds} (${a.goals * 6 + a.behinds})  v  ${b.def.id} ${b.goals}.${b.behinds} (${b.goals * 6 + b.behinds})` +
      `   real ${(steps * DT / 60).toFixed(1)} min   ${pt}`,
  );
}
const per = (v) => (v / N).toFixed(1);
console.log(`\n${N} matches in ${Date.now() - t0} ms (${MODE})`);
console.log(`per match: goals ${per(totals.goals)} behinds ${per(totals.behinds)} marks ${per(totals.marks)} tackles ${per(totals.tackles)} kicks ${per(totals.kicks)} handballs ${per(totals.handballs)}`);
console.log('events per match:', Object.fromEntries(Object.entries(totals.events).map(([k, v]) => [k, +(v / N).toFixed(1)])));
console.log('by team [team0, team1] per match:', Object.entries(totals.byTeam).sort().map(([k, v]) => `${k}=${(v[0] / N).toFixed(1)}/${(v[1] / N).toFixed(1)}`).join('  '));
if (MODE === 'bot') console.log(`team 0 (bot, ${DIFF}) won ${humanWins}/${N}`);
