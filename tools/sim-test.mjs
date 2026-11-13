// Headless smoke test: plays full matches at high speed and reports stats.
// Usage: node tools/sim-test.mjs [matches] [mode]
//   mode "demo"  - AI v AI (default)
//   mode "bot"   - a scripted "human" on team 0, to exercise the control code
import { Match } from '../src/sim/match.js';
import { TEAMS } from '../src/config.js';
import { makeRng } from '../src/util.js';

const N = Number(process.argv[2] || 6);
const MODE = process.argv[3] || 'demo';
const DT = 1 / 60;

function botInput(m, rng, st) {
  const p = m.control;
  const inp = { mx: 0, mz: 0, kick: false, kickPressed: false, hbPressed: false, sprint: false };
  if (!p) return inp;
  const dir = p.team.dir;
  st.t -= DT;
  if (p.hasBall) {
    inp.mx = dir;
    inp.mz = -Math.sign(p.z) * 0.3;
    inp.sprint = rng() < 0.5;
    if (m.setShot) {
      if (Math.abs(m.setShot.needle) < 0.15) inp.kickPressed = true;
      return inp;
    }
    if (st.hold > 0) {
      st.hold -= DT;
      inp.kick = st.hold > 0;
    } else if (st.t <= 0) {
      st.t = 0.5 + rng() * 1.5;
      if (rng() < 0.7) {
        inp.kickPressed = true;
        inp.kick = true;
        st.hold = 0.15 + rng() * 0.8;
      } else {
        inp.hbPressed = true;
      }
    }
  } else {
    const b = m.ball;
    const fx = b.land ? b.land.x : b.x;
    const fz = b.land ? b.land.z : b.z;
    const dx = fx - p.x;
    const dz = fz - p.z;
    const d = Math.hypot(dx, dz) || 1;
    if (rng() < 0.8) {
      inp.mx = dx / d;
      inp.mz = dz / d;
    }
    inp.sprint = d > 6;
    if (st.t <= 0) {
      st.t = 0.3 + rng() * 0.8;
      if (rng() < 0.6) inp.kickPressed = true;
      else if (rng() < 0.2) inp.hbPressed = true;
    }
  }
  return inp;
}

const totals = { goals: 0, behinds: 0, marks: 0, tackles: 0, kicks: 0, handballs: 0, events: {} };
let humanWins = 0;
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const home = TEAMS[i % TEAMS.length];
  const away = TEAMS[(i * 3 + 1) % TEAMS.length === i % TEAMS.length ? (i + 2) % TEAMS.length : (i * 3 + 1) % TEAMS.length];
  const m = new Match({ home, away, humanTeam: MODE === 'bot' ? 0 : -1, difficulty: 'medium', quarterLen: 180, seed: 1000 + i * 77 });
  const rng = makeRng(99 + i);
  const st = { t: 0, hold: 0 };
  let steps = 0;
  let lastPhase = '';
  let phaseSteps = 0;
  const phaseTime = {};
  while (m.phase !== 'full') {
    if (m.phase === 'quarter') m.nextQuarter();
    m.step(DT, MODE === 'bot' ? botInput(m, rng, st) : null);
    for (const e of m.events) totals.events[e.type] = (totals.events[e.type] || 0) + 1;
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
if (MODE === 'bot') console.log(`team 0 (bot) won ${humanWins}/${N}`);
