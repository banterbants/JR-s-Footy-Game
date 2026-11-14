// Writes each club's crest to branding/clubs/<ID>.svg so they can be used outside the game.
// Usage: node tools/export-crests.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEAMS } from '../src/config.js';
import { emblemSVG } from '../src/emblems.js';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'branding', 'clubs');
fs.mkdirSync(out, { recursive: true });
for (const t of TEAMS) {
  const file = path.join(out, `${t.id}-${t.nick.toLowerCase()}.svg`);
  fs.writeFileSync(file, emblemSVG(t).replace('<svg ', `<svg role="img" aria-label="${t.city} ${t.nick}" `));
  console.log('wrote', path.relative(process.cwd(), file));
}
