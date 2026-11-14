// Club crests. Each one is drawn as a small SVG: a shared shield in club colours
// with the mascot inside. They're built from code so there are no image files to load.

const INK = '#0b1530';
const SHIELD = 'M100 8C128 22 160 26 188 24V112C188 166 150 198 100 214 50 198 12 166 12 112V24C40 26 72 22 100 8Z';
const INNER = 'translate(100 111) scale(0.85) translate(-100 -111)';

/** Shared outline style for the artwork. */
const line = (w = 5, c = INK) => `stroke="${c}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;

/** A row of triangular teeth between two points. */
function teeth(x0, y0, x1, y1, n, h) {
  let d = '';
  const dx = (x1 - x0) / n;
  const dy = (y1 - y0) / n;
  for (let i = 0; i < n; i++) {
    const ax = x0 + dx * i;
    const ay = y0 + dy * i;
    d += `M${ax.toFixed(1)} ${ay.toFixed(1)}L${(ax + dx / 2).toFixed(1)} ${(ay + dy / 2 + h).toFixed(1)}L${(ax + dx).toFixed(1)} ${(ay + dy).toFixed(1)}Z`;
  }
  return d;
}

// ------------------------------------------------------------- the mascots
// All artwork is drawn in a 200 x 200 box, facing right where it has a direction.

const ART = {
  // Darwin Crocs: a saltie with its jaws open
  DRW: () => `
    <path d="M62 98L176 86 180 128 62 126Z" fill="#7a1220" ${line(4)}/>
    <path d="M28 108L38 76 60 56 90 50 104 62 148 70 164 62 184 76 182 92 70 104 46 116Z" fill="#5fca6e" ${line()}/>
    <path d="M70 104L182 92 182 84 148 84 104 78 66 92 46 116Z" fill="#2f9a4a"/>
    <path d="M28 108L38 76 60 56 90 50 104 62 148 70 164 62 184 76 182 92 70 104 46 116Z" fill="none" ${line()}/>
    <path d="M34 122L66 122 180 128 172 144 130 160 84 162 46 150Z" fill="#f6c62e" ${line()}/>
    <path d="${teeth(78, 102.5, 178, 92, 7, 12)}" fill="#fff" ${line(3)}/>
    <path d="${teeth(80, 123, 174, 127.5, 6, -11)}" fill="#fff" ${line(3)}/>
    <path d="M70 62L92 54 104 64 96 76 76 78Z" fill="#2f9a4a" ${line(4)}/>
    <ellipse cx="88" cy="68" rx="8" ry="6.5" fill="#ffe14a" ${line(3)}/>
    <ellipse cx="89" cy="68" rx="2.2" ry="5.5" fill="${INK}"/>
    <ellipse cx="170" cy="74" rx="4" ry="2.6" fill="${INK}"/>
    <path d="M38 76L42 58 52 66M50 62L58 44 68 54" fill="#2f9a4a" ${line(4)}/>`,

  // Cairns Cyclones: a spinning storm
  CNS: () => {
    const arm = 'M0 -24C24 -64 70 -52 84 -6 64 -30 36 -34 16 -17Z';
    const arms = [0, 120, 240].map((a) => `<path d="${arm}" transform="translate(100 100) rotate(${a}) scale(1.06)" fill="#22d3c5" ${line()}/>`).join('');
    const inner = [60, 180, 300].map((a) => `<path d="${arm}" transform="translate(100 100) rotate(${a}) scale(0.62)" fill="#fff" ${line(5)}/>`).join('');
    return `${arms}${inner}
      <circle cx="100" cy="100" r="25" fill="#2b1454" ${line()}/>
      <circle cx="100" cy="100" r="11" fill="#22d3c5" ${line(3)}/>
      <path d="M30 150Q52 172 86 174M170 50Q148 28 114 26" fill="none" ${line(5, '#fff')} opacity="0.75"/>`;
  },

  // Canberra Cockatoos: sulphur crest up
  CBR: () => `
    <path d="M96 70C80 50 62 34 40 30 56 44 66 60 74 82Z" fill="#ffd21f" ${line()}/>
    <path d="M102 66C96 44 86 24 68 10 78 30 82 48 84 72Z" fill="#ffd21f" ${line()}/>
    <path d="M112 64C114 42 112 24 100 6 104 28 100 46 96 68Z" fill="#ffe66b" ${line()}/>
    <path d="M122 68C132 50 136 32 132 14 126 34 118 50 108 66Z" fill="#ffd21f" ${line()}/>
    <path d="M62 178C48 146 48 104 76 80 100 60 138 66 150 92 158 110 152 128 140 138 132 152 130 166 130 178Z" fill="#fbfbf7" ${line()}/>
    <path d="M62 178C52 152 50 124 60 102 60 134 72 160 92 178Z" fill="#dfe3ea"/>
    <circle cx="112" cy="122" r="11" fill="#ffe66b" opacity="0.85"/>
    <path d="M146 92C170 90 184 110 170 138 164 126 156 120 144 120Z" fill="#454b57" ${line()}/>
    <path d="M144 120C154 122 160 128 162 138 152 140 144 136 140 128Z" fill="#2b2f36" ${line(4)}/>
    <circle cx="126" cy="98" r="8" fill="${INK}"/>
    <circle cx="128.500" cy="95.500" r="2.600" fill="#fff"/>`,

  // Hobart Icebreakers: a bow smashing through the pack ice
  HOB: () => `
    <path d="M100 14V52" ${line(5)}/>
    <path d="M100 16L122 24 100 32Z" fill="#ffd21f" ${line(3)}/>
    <path d="M72 52H128V84H72Z" fill="#fff" ${line()}/>
    <path d="M80 62H92V72H80ZM108 62H120V72H108ZM94 62H106V72H94Z" fill="#12264f"/>
    <path d="M56 84H144L100 164Z" fill="#8fd8ff" ${line()}/>
    <path d="M100 84H144L100 164Z" fill="#4fa8dc"/>
    <path d="M56 84H144L100 164Z" fill="none" ${line()}/>
    <path d="M62 84H138L134 94H66Z" fill="#e5383b"/>
    <path d="M14 150L40 118 60 142 76 126 96 168 60 184 20 178Z" fill="#fff" ${line()}/>
    <path d="M186 150L160 118 140 142 124 126 104 168 140 184 180 178Z" fill="#e9f7ff" ${line()}/>
    <path d="M40 118L50 150 30 164M160 118L150 150 170 164M76 126L70 156M124 126L130 156" fill="none" ${line(3, '#8fd8ff')}/>`,

  // Newcastle Miners: helmet lamp and crossed picks
  NEW: () => {
    const pick = (rot) => `<g transform="translate(100 114) rotate(${rot})">
      <rect x="-5.5" y="-82" width="11" height="156" rx="4" fill="#d9a05b" ${line(4)}/>
      <path d="M-38 -70Q0 -96 38 -70L35 -64Q0 -82 -35 -64Z" fill="#e3e9f0" ${line(4)}/>
      <rect x="-8" y="-88" width="16" height="14" rx="3" fill="#9aa6b8" ${line(3)}/></g>`;
    return `${pick(-48)}${pick(48)}
      <path d="M52 126C52 78 74 58 100 58 126 58 148 78 148 126Z" fill="#ff7a1a" ${line()}/>
      <path d="M52 126C52 98 58 80 72 68 66 88 66 106 68 126Z" fill="#ffa65c"/>
      <path d="M91 58H109V126H91Z" fill="#e0620a"/>
      <rect x="40" y="120" width="120" height="16" rx="8" fill="#e0620a" ${line()}/>
      <circle cx="100" cy="94" r="18" fill="#fff6c8" ${line()}/>
      <circle cx="100" cy="94" r="9" fill="#ffd21f"/>`;
  },

  // Alice Springs Dingoes
  ASP: () => `
    <path d="M46 34L88 70 52 100Z" fill="#f0c27a" ${line()}/>
    <path d="M154 34L112 70 148 100Z" fill="#f0c27a" ${line()}/>
    <path d="M56 52L78 72 60 88Z" fill="#d98f5a"/>
    <path d="M144 52L122 72 140 88Z" fill="#d98f5a"/>
    <path d="M48 96L82 66H118L152 96 160 126 128 158 100 176 72 158 40 126Z" fill="#f0c27a" ${line()}/>
    <path d="M82 66L100 86 118 66Z" fill="#d9a05b"/>
    <path d="M40 126L72 158 100 176 128 158 160 126 130 132 100 150 70 132Z" fill="#fbf1d8" ${line(4)}/>
    <path d="M78 106L100 96 122 106 120 150 100 164 80 150Z" fill="#fbf1d8" ${line(4)}/>
    <path d="M84 142H116L100 160Z" fill="${INK}" ${line(3)}/>
    <path d="M100 160V168" ${line(3)}/>
    <path d="M58 100L86 108 80 120 62 114Z" fill="${INK}"/>
    <path d="M142 100L114 108 120 120 138 114Z" fill="${INK}"/>
    <circle cx="74" cy="111" r="3.200" fill="#ffb400"/>
    <circle cx="126" cy="111" r="3.200" fill="#ffb400"/>`,

  // Wollongong Kookaburras
  WOL: () => `
    <path d="M40 186C34 150 36 116 52 94 70 68 106 60 130 80 142 90 144 108 136 122 124 142 120 162 120 186Z" fill="#f6eedd" ${line()}/>
    <path d="M40 186C36 162 36 142 42 122 50 150 64 172 84 186Z" fill="#2f8fd0" ${line(4)}/>
    <path d="M46 104C50 70 92 50 126 72 100 70 70 82 46 104Z" fill="#5b3a22" ${line()}/>
    <path d="M126 92L62 106 56 128 100 118 128 110Z" fill="#5b3a22" ${line(4)}/>
    <path d="M122 82L192 102 188 111 124 111Z" fill="#3a3f48" ${line()}/>
    <path d="M124 111L186 111 164 126 122 127Z" fill="#e9d9a0" ${line()}/>
    <circle cx="107" cy="98" r="7.500" fill="${INK}"/>
    <circle cx="109.500" cy="95.500" r="2.400" fill="#fff"/>`,

  // Bendigo Bushrangers: hat low, bandana up
  BEN: () => `
    <path d="M60 104H140L134 138 100 176 66 138Z" fill="#e9b949" ${line()}/>
    <path d="M66 138L100 150 134 138M84 108L80 134M116 108L120 134" fill="none" ${line(3, '#b9892a')}/>
    <path d="M64 84H136V108H64Z" fill="#e2b08a" ${line()}/>
    <path d="M72 92L92 96 90 104 74 102Z" fill="#fff" ${line(3)}/>
    <path d="M128 92L108 96 110 104 126 102Z" fill="#fff" ${line(3)}/>
    <circle cx="84" cy="99" r="3.200" fill="${INK}"/>
    <circle cx="116" cy="99" r="3.200" fill="${INK}"/>
    <path d="M68 84C66 44 78 30 100 30 122 30 134 44 132 84Z" fill="#33211a" ${line()}/>
    <path d="M69 70H131V80H69Z" fill="#e9b949"/>
    <path d="M22 88C40 70 160 70 178 88 160 98 40 98 22 88Z" fill="#4a3226" ${line()}/>`,

  // Abbotsford Magpies
  ABB: () => `
    <path d="M44 188C36 146 44 100 78 76 100 60 130 62 144 82L192 102 146 116C142 138 132 152 130 188Z" fill="#17171a" ${line(5, '#17171a')}/>
    <path d="M142 82L194 102 146 117Z" fill="#dfe5ee" ${line(4, '#17171a')}/>
    <path d="M172 94L194 102 172 110Z" fill="#17171a"/>
    <path d="M50 116C54 94 68 78 88 70 78 92 76 118 84 144 68 140 54 130 50 116Z" fill="#fff" ${line(4, '#17171a')}/>
    <path d="M44 188C44 172 50 160 62 152L92 188Z" fill="#fff" ${line(4, '#17171a')}/>
    <circle cx="122" cy="92" r="8.500" fill="#c0392b" ${line(3, '#17171a')}/>
    <circle cx="122" cy="92" r="4" fill="#17171a"/>
    <circle cx="124.400" cy="89.600" r="1.900" fill="#fff"/>`,
};

/** What each crest's shield looks like: [field colour, border colour]. */
const FRAME = {
  DRW: ['#0c6b43', '#f6c62e'],
  CNS: ['#5b2a9d', '#22d3c5'],
  CBR: ['#2b2f36', '#ffd21f'],
  HOB: ['#12264f', '#8fd8ff'],
  NEW: ['#17171a', '#ff7a1a'],
  ASP: ['#c2461f', '#f3dfb0'],
  WOL: ['#39a9e8', '#5b3a22'],
  BEN: ['#7a1230', '#e9b949'],
  ABB: ['#c9d0da', '#17171a'],
};

/** A club with no artwork of its own gets a star on its colours. */
function fallbackArt(team) {
  return `<path d="M100 38L116 84 164 84 126 112 140 160 100 132 60 160 74 112 36 84 84 84Z" fill="${team.c2}" ${line()}/>`;
}

const cache = new Map();

/** The crest for a club as SVG markup. */
export function emblemSVG(team) {
  let svg = cache.get(team.id);
  if (svg) return svg;
  const [field, border] = FRAME[team.id] || [team.c1, team.c2];
  const art = ART[team.id] ? ART[team.id]() : fallbackArt(team);
  svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 222" width="200" height="222">
  <defs><clipPath id="c"><path d="${SHIELD}" transform="${INNER}"/></clipPath></defs>
  <path d="${SHIELD}" fill="${border}" stroke="${INK}" stroke-width="9" stroke-linejoin="round"/>
  <path d="${SHIELD}" transform="${INNER}" fill="${field}" stroke="${INK}" stroke-width="4.5"/>
  <g clip-path="url(#c)">
    <g transform="translate(100 108) scale(0.86) translate(-100 -100)">${art}</g>
    <path d="M12 8H118L64 222H12Z" fill="#fff" fill-opacity="0.07"/>
  </g>
</svg>`;
  cache.set(team.id, svg);
  return svg;
}

/** The crest as a data: URL, for <img> tags and CSS. */
export function emblemURL(team) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(emblemSVG(team))}`;
}

const images = new Map();

/** Decode every crest up front so canvases (scoreboard, turf) can draw them straight away. */
export function loadEmblems(teams) {
  return Promise.all(
    teams.map(
      (t) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            images.set(t.id, img);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = emblemURL(t);
        }),
    ),
  );
}

/** A loaded crest image (or null if it isn't ready). */
export function emblemImage(team) {
  return images.get(team.id) || null;
}
