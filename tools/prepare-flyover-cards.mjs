/**
 * The flyover cards' pictures (src/data/flyover-cards/) made ready to keep in
 * the repo: every JPEG or PNG turned into WebP, and anything wider than
 * 2000 px brought down to that -- the page shows them at 1600 at most. A
 * picture that changes name (photo.jpg -> photo.webp) is renamed in cards.md
 * too. Pictures already small WebPs are left as they are.
 *
 *   node tools/prepare-flyover-cards.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const DIR = 'src/data/flyover-cards';
const WIDEST = 2000;
const md = path.join(DIR, 'cards.md');
let cards = fs.readFileSync(md, 'utf8');

for (const name of fs.readdirSync(DIR)) {
  const ext = path.extname(name).toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) continue;
  const file = path.join(DIR, name);
  const { width } = await sharp(file).metadata();
  if (ext === '.webp' && width <= WIDEST) continue;
  const out = path.join(DIR, `${path.basename(name, path.extname(name))}.webp`);
  const before = fs.statSync(file).size;
  const buf = await sharp(file).rotate().resize({ width: WIDEST, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  fs.writeFileSync(out, buf);
  if (out !== file) {
    fs.unlinkSync(file);
    cards = cards.replace(new RegExp(`^(Image:\\s*)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'gim'), `$1${path.basename(out)}`);
  }
  console.log(`${name}: ${width} px, ${Math.round(before / 1024)} KB -> ${path.basename(out)}: ${Math.min(width, WIDEST)} px, ${Math.round(buf.length / 1024)} KB`);
}
fs.writeFileSync(md, cards);
