// A home-and-away season: every club plays every other once (with a bye week
// when there's an odd number of clubs), then the top two meet in the Grand Final.
import { TEAMS, teamById } from './config.js';

/** Round-robin draw (circle method). With an odd number of clubs one sits out each round. */
function makeFixtures(teamIds) {
  const ids = teamIds.slice();
  // shuffle so every season has a different draw
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  if (ids.length % 2) ids.push(null); // null = the bye
  const n = ids.length;
  const rounds = [];
  const arr = ids.slice();
  for (let r = 0; r < n - 1; r++) {
    const games = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a === null || b === null) continue;
      games.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(games);
    arr.splice(1, 0, arr.pop());
  }
  return rounds;
}

export function newSeason(teamId, opts) {
  const ladder = {};
  for (const t of TEAMS) ladder[t.id] = { p: 0, w: 0, l: 0, d: 0, pf: 0, pa: 0 };
  return { teamId, opts, round: 0, fixtures: makeFixtures(TEAMS.map((t) => t.id)), ladder, last: [], final: null, premier: null };
}

/** How many home-and-away rounds this season has. */
export function rounds(s) {
  return s.fixtures.length;
}

/** Make up a believable score for a game the player isn't in. */
export function simulate(homeId, awayId) {
  const h = teamById(homeId);
  const a = teamById(awayId);
  const edge = (h.rating - a.rating) * 0.22 + 0.5;
  const g = (bias) => Math.max(3, Math.round(11 + bias + (Math.random() + Math.random() - 1) * 5));
  const b = () => Math.round(5 + Math.random() * 8);
  return { home: homeId, away: awayId, hg: g(edge), hb: b(), ag: g(-edge), ab: b() };
}

const pts = (g, b) => g * 6 + b;

function apply(ladder, r) {
  const hs = pts(r.hg, r.hb);
  const as = pts(r.ag, r.ab);
  const H = ladder[r.home];
  const A = ladder[r.away];
  H.p++;
  A.p++;
  H.pf += hs;
  H.pa += as;
  A.pf += as;
  A.pa += hs;
  if (hs > as) {
    H.w++;
    A.l++;
  } else if (as > hs) {
    A.w++;
    H.l++;
  } else {
    H.d++;
    A.d++;
  }
}

/** Ladder for the clubs in this season (a saved season keeps the clubs it started with). */
export function sortedLadder(s) {
  return Object.keys(s.ladder)
    .map((id) => {
      const r = s.ladder[id];
      return { id, team: teamById(id), ...r, points: r.w * 4 + r.d * 2, pct: r.pa ? (r.pf / r.pa) * 100 : 100 };
    })
    .sort((x, y) => y.points - x.points || y.pct - x.pct);
}

/**
 * The player's next game, or null when the season is over.
 * A week off comes back as { bye: true }.
 */
export function nextFixture(s) {
  if (s.premier) return null;
  if (s.round < rounds(s)) {
    const label = `Round ${s.round + 1}`;
    const g = s.fixtures[s.round].find((f) => f.includes(s.teamId));
    if (!g) return { bye: true, label, final: false };
    return { home: g[0], away: g[1], label, final: false };
  }
  if (!s.final) {
    const top = sortedLadder(s);
    s.final = { home: top[0].id, away: top[1].id };
  }
  if (s.final.home !== s.teamId && s.final.away !== s.teamId) return null;
  return { home: s.final.home, away: s.final.away, label: 'Grand Final', final: true };
}

/**
 * Record the player's result ({hg, hb, ag, ab} from the home side's view) and
 * play out the rest of the round. On a bye week pass nothing.
 */
export function recordResult(s, result) {
  const fx = nextFixture(s);
  if (!fx) return;
  if (fx.final) {
    const mine = { home: fx.home, away: fx.away, ...result };
    s.last = [mine];
    let hs = pts(mine.hg, mine.hb);
    const as = pts(mine.ag, mine.ab);
    if (hs === as) hs += 1; // no draws in a Grand Final: the home side scrapes in after the siren
    s.premier = hs > as ? fx.home : fx.away;
    return;
  }
  const results = [];
  for (const [h, a] of s.fixtures[s.round]) {
    const r = !fx.bye && h === fx.home && a === fx.away ? { home: h, away: a, ...result } : simulate(h, a);
    results.push(r);
    apply(s.ladder, r);
  }
  s.last = results;
  s.round++;
  if (s.round >= rounds(s)) {
    const top = sortedLadder(s);
    s.final = { home: top[0].id, away: top[1].id };
    // If the player missed the Grand Final, it is played without them.
    if (top[0].id !== s.teamId && top[1].id !== s.teamId) {
      const r = simulate(top[0].id, top[1].id);
      let hs = pts(r.hg, r.hb);
      const as = pts(r.ag, r.ab);
      if (hs === as) {
        r.hb++;
        hs++;
      }
      s.finalResult = r;
      s.premier = hs > as ? r.home : r.away;
    }
  }
}
