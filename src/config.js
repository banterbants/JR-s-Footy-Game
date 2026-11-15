// Game-wide constants: field geometry, positions, clubs and difficulty tuning.

/** Shown on the title screen so you can tell which version a device is running. */
export const VERSION = '1.5.0';

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
  { id: 'ABB', city: 'Abbotsford', nick: 'Magpies', c1: '#111114', c2: '#f4f4f0', shorts: '#111114', socks: '#111114', pattern: 'stripes', rating: 85 },
];

export function teamById(id) {
  return TEAMS.find((t) => t.id === id) || TEAMS[0];
}

/**
 * How hard each level is.
 *  aiSpeed      - opposition run speed
 *  react        - seconds before defenders react to a kick in the air
 *  spoilChance  - how often a defender flies for a spoil
 *  pressure     - how much a close defender puts you off a mark
 *  markPenalty  - taken off the player's chance of holding a mark (the opposition gets half of it as a bonus)
 *  humanReach / humanMark - small marking helps for the player (Rookie only, really)
 *  humanSpread  - kicking accuracy for the player (higher = wilder)
 *  kickAssist   - how much the aim-assist tightens the player's passes
 *  aiSpread     - opposition kicking (lower = straighter)
 *  tackleAdj / tackleDelay / priorOpp - tackling and "holding the ball"
 *  ruckSigma / aiRuck - how well the opposition ruckman times his jump, and a bonus to their hit-outs
 */
export const DIFFICULTY = {
  easy: { label: 'Rookie', aiSpeed: 1.0, react: 0.5, spoilChance: 0.58, pressure: 0.8, markPenalty: 0.0, tackleAdj: -0.06, tackleDelay: 0.18, decideAdj: 0.1, aiSpread: 1.12, humanMark: 0.04, humanReach: 0.12, humanSpread: 0.9, kickAssist: 0.85, priorOpp: 2.0, ruckSigma: 0.14, aiRuck: -0.07 },
  medium: { label: 'Pro', aiSpeed: 1.0, react: 0.38, spoilChance: 0.72, pressure: 0.8, markPenalty: 0.03, tackleAdj: -0.015, tackleDelay: 0.17, decideAdj: 0.03, aiSpread: 1.2, humanMark: 0.03, humanReach: 0.1, humanSpread: 0.9, kickAssist: 1.05, priorOpp: 1.85, ruckSigma: 0.09, aiRuck: -0.045 },
  hard: { label: 'Legend', aiSpeed: 1.015, react: 0.26, spoilChance: 0.9, pressure: 0.88, markPenalty: 0.06, tackleAdj: 0.01, tackleDelay: 0.11, decideAdj: 0.01, aiSpread: 1.085, humanMark: 0.02, humanReach: 0.07, humanSpread: 0.93, kickAssist: 1.06, priorOpp: 1.6, ruckSigma: 0.05, aiRuck: -0.015 },
  extreme: { label: 'Immortal', aiSpeed: 1.045, react: 0.14, spoilChance: 0.93, pressure: 1.1, markPenalty: 0.09, tackleAdj: 0.05, tackleDelay: 0.07, decideAdj: -0.05, aiSpread: 0.9, humanMark: 0.0, humanReach: 0, humanSpread: 1.05, kickAssist: 1.1, priorOpp: 1.3, ruckSigma: 0.03, aiRuck: 0.05 },
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
