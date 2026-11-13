// Game-wide constants: field geometry, positions, clubs and difficulty tuning.

/** Field geometry in metres. The oval's long axis runs along X, goals at both X ends. */
export const F = {
  A: 80, // semi-axis along X (ground is 160 m long)
  B: 64, // semi-axis along Z (ground is 128 m wide)
  GX: 79.1, // goal line X
  GOAL_HALF: 3.2, // goal posts are 6.4 m apart
  BEHIND_HALF: 9.6, // behind posts sit a further 6.4 m out
  POST_H: 15,
  BPOST_H: 10,
  SQUARE: 25, // half-size of the centre square
  ARC: 50, // "fifty" arc radius
  GSQ: 9, // goal square depth
};

export const G = 10; // gravity, m/s^2

/**
 * The 18 positions, for a team attacking +X. fx/fz are fractions of the field
 * semi-axes; `w` is how strongly the player is drawn toward the ball.
 */
export const POSITIONS = [
  { id: 'FB', name: 'Full Back', fx: -0.84, fz: 0.0, line: 'B', w: 0.14 },
  { id: 'BPL', name: 'Back Pocket', fx: -0.78, fz: -0.3, line: 'B', w: 0.16 },
  { id: 'BPR', name: 'Back Pocket', fx: -0.78, fz: 0.3, line: 'B', w: 0.16 },
  { id: 'CHB', name: 'Centre Half Back', fx: -0.48, fz: 0.0, line: 'HB', w: 0.3 },
  { id: 'HBL', name: 'Half Back Flank', fx: -0.46, fz: -0.5, line: 'HB', w: 0.3 },
  { id: 'HBR', name: 'Half Back Flank', fx: -0.46, fz: 0.5, line: 'HB', w: 0.3 },
  { id: 'C', name: 'Centre', fx: -0.09, fz: 0.02, line: 'C', w: 0.55 },
  { id: 'WL', name: 'Wing', fx: 0.0, fz: -0.66, line: 'C', w: 0.42 },
  { id: 'WR', name: 'Wing', fx: 0.0, fz: 0.66, line: 'C', w: 0.42 },
  { id: 'CHF', name: 'Centre Half Forward', fx: 0.48, fz: 0.0, line: 'HF', w: 0.3 },
  { id: 'HFL', name: 'Half Forward Flank', fx: 0.46, fz: -0.5, line: 'HF', w: 0.3 },
  { id: 'HFR', name: 'Half Forward Flank', fx: 0.46, fz: 0.5, line: 'HF', w: 0.3 },
  { id: 'FF', name: 'Full Forward', fx: 0.84, fz: 0.0, line: 'F', w: 0.14 },
  { id: 'FPL', name: 'Forward Pocket', fx: 0.78, fz: -0.3, line: 'F', w: 0.16 },
  { id: 'FPR', name: 'Forward Pocket', fx: 0.78, fz: 0.3, line: 'F', w: 0.16 },
  { id: 'RUC', name: 'Ruck', fx: -0.02, fz: 0.0, line: 'R', w: 0.8 },
  { id: 'RR', name: 'Ruck Rover', fx: -0.06, fz: -0.09, line: 'R', w: 0.8 },
  { id: 'ROV', name: 'Rover', fx: -0.05, fz: 0.1, line: 'R', w: 0.8 },
];

/** Who each position lines up on (index into POSITIONS of the other team). */
export const OPPONENT_OF = {
  FB: 'FF', BPL: 'FPL', BPR: 'FPR', CHB: 'CHF', HBL: 'HFL', HBR: 'HFR',
  C: 'C', WL: 'WL', WR: 'WR', CHF: 'CHB', HFL: 'HBL', HFR: 'HBR',
  FF: 'FB', FPL: 'BPL', FPR: 'BPR', RUC: 'RUC', RR: 'RR', ROV: 'ROV',
};

/**
 * The clubs of the (entirely fictional) Southern Cross Footy League.
 * pattern: how the guernsey is drawn - see gfx/players.js.
 */
export const TEAMS = [
  { id: 'DRW', city: 'Darwin', nick: 'Crocs', c1: '#0c6b43', c2: '#f6c62e', shorts: '#0a3f29', socks: '#0c6b43', pattern: 'vee', rating: 80 },
  { id: 'CNS', city: 'Cairns', nick: 'Cyclones', c1: '#5b2a9d', c2: '#22d3c5', shorts: '#2b1454', socks: '#5b2a9d', pattern: 'sash', rating: 77 },
  { id: 'CBR', city: 'Canberra', nick: 'Cockatoos', c1: '#f4f4f0', c2: '#ffd21f', shorts: '#2b2f36', socks: '#ffd21f', pattern: 'yoke', rating: 82 },
  { id: 'HOB', city: 'Hobart', nick: 'Icebreakers', c1: '#12264f', c2: '#8fd8ff', shorts: '#12264f', socks: '#8fd8ff', pattern: 'hoops', rating: 79 },
  { id: 'NEW', city: 'Newcastle', nick: 'Miners', c1: '#17171a', c2: '#ff7a1a', shorts: '#17171a', socks: '#ff7a1a', pattern: 'stripes', rating: 84 },
  { id: 'ASP', city: 'Alice Springs', nick: 'Dingoes', c1: '#c2461f', c2: '#f3dfb0', shorts: '#5a1f0c', socks: '#c2461f', pattern: 'panel', rating: 75 },
  { id: 'WOL', city: 'Wollongong', nick: 'Kookaburras', c1: '#39a9e8', c2: '#5b3a22', shorts: '#5b3a22', socks: '#39a9e8', pattern: 'sash', rating: 78 },
  { id: 'BEN', city: 'Bendigo', nick: 'Bushrangers', c1: '#7a1230', c2: '#e9b949', shorts: '#3d0918', socks: '#7a1230', pattern: 'stripes', rating: 81 },
];

export function teamById(id) {
  return TEAMS.find((t) => t.id === id) || TEAMS[0];
}

export const DIFFICULTY = {
  easy: { label: 'Rookie', aiSpeed: 0.92, tackleAdj: -0.16, tackleDelay: 0.3, decideAdj: 0.3, aiSpread: 1.45, humanMark: 0.14, humanSpread: 0.75 },
  medium: { label: 'Pro', aiSpeed: 0.98, tackleAdj: -0.04, tackleDelay: 0.16, decideAdj: 0.08, aiSpread: 1.1, humanMark: 0.06, humanSpread: 0.9 },
  hard: { label: 'Legend', aiSpeed: 1.03, tackleAdj: 0.06, tackleDelay: 0.06, decideAdj: -0.05, aiSpread: 0.88, humanMark: 0.0, humanSpread: 1.0 },
};

export const SURNAMES = [
  'Riley', 'Walker', 'Harris', 'Bennett', 'Clarke', 'Murphy', 'Stewart', 'Campbell', 'Kelly', 'Ryan',
  'Wood', 'Taylor', 'Wilson', 'Anderson', 'Thompson', 'White', 'Hughes', 'Edwards', 'Turner', 'Parker',
  'Cook', 'Morgan', 'Cooper', 'Ward', 'Bailey', 'Reid', 'Fraser', 'Hayes', 'Fletcher', 'Sutton',
  'Barrett', 'Doyle', 'Quinn', 'Lawson', 'Hartley', 'Mackenzie', 'Sinclair', 'Brennan', 'Coleman', 'Dawson',
  'Fox', 'Gibson', 'Hunt', 'Jarvis', 'Keane', 'Lowe', 'Marsh', 'Nolan', 'Osborne', 'Pearce',
  'Rowe', 'Shaw', 'Tanner', 'Vance', 'Webb', 'Yates', 'Archer', 'Blake', 'Cross', 'Drummond',
  'Ellis', 'Flynn', 'Grant', 'Holt', 'Irwin', 'Jensen', 'Knight', 'Lang', 'Moss', 'Nash',
  'Okafor', 'Papas', 'Nguyen', 'Tran', 'Kowalski', 'Rossi', 'Tupou', 'Kaur', 'Singh', 'Watson',
];

export const SKIN_TONES = ['#f1c9a5', '#e2b08a', '#c98f66', '#a56b45', '#7a4a2d', '#f5d3b4'];
export const HAIR_COLOURS = ['#2a1d14', '#4a3222', '#8a5a2b', '#c9a45c', '#111111', '#a33b1f', '#d9d3c8'];
