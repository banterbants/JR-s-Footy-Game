// Checks the ruck contest: how often a human ruckman wins the hit-out for each jump timing,
// against each difficulty. Offset 0 means the ring closed exactly as he pressed.
// Usage: node tools/ruck-test.mjs [trials-per-cell]
import { Match } from '../src/sim/match.js';
import { TEAMS } from '../src/config.js';

const N = Number(process.argv[2] || 120);
const DT = 1 / 60;
const NONE = { mx: 0, mz: 0, kick: false, kickPressed: false, hbPressed: false, sprint: false };
const offsets = [-0.4, -0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4, 'never'];

function trial(diff, off, seed) {
  const home = TEAMS[seed % TEAMS.length];
  const away = TEAMS[(seed * 5 + 3) % TEAMS.length === seed % TEAMS.length ? (seed + 1) % TEAMS.length : (seed * 5 + 3) % TEAMS.length];
  const m = new Match({ home, away, humanTeam: 0, difficulty: diff, quarterLen: 120, seed: 4000 + seed });
  let guard = 0;
  while (m.phase !== 'play' && guard++ < 60 * 12) m.step(DT, NONE);
  m.events.length = 0;
  let pressed = off === 'never';
  guard = 0;
  while (guard++ < 60 * 6) {
    const b = m.ball;
    const inp = { ...NONE };
    if (!pressed && b.land && b.kind === 'toss' && m.control && b.land.t <= 0.36 - off) {
      pressed = true;
      inp.kickPressed = true;
    }
    m.step(DT, inp);
    const r = m.events.find((e) => e.type === 'ruck');
    if (r) {
      return { won: r.winner.team.idx === 0, clean: r.clean, report: r.report, mine: r.human };
    }
  }
  return null;
}

const diffs = ['easy', 'medium', 'hard', 'extreme'];
const head = 'offset(s) ' + diffs.map((d) => d.padEnd(22)).join('');
console.log('Human ruckman wins the hit-out (%) / clean taps (%)   [offset: - = pressed early, + = pressed late]');
console.log(head);
for (const off of offsets) {
  let line = String(off).padEnd(10);
  for (const d of diffs) {
    let won = 0;
    let clean = 0;
    let n = 0;
    const labels = {};
    for (let i = 0; i < N; i++) {
      const r = trial(d, off, i);
      if (!r) continue;
      n++;
      if (r.won && r.clean) won++;
      if (r.clean) clean++;
      if (r.mine) labels[r.report] = (labels[r.report] || 0) + 1;
    }
    line += `${((100 * won) / n).toFixed(0).padStart(3)}% / ${((100 * clean) / n).toFixed(0).padStart(3)}%`.padEnd(22);
  }
  console.log(line);
}
