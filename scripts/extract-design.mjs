#!/usr/bin/env node
/**
 * Decode the Claude Design bundler artifact into readable reference files.
 *
 * The design ships as one self-contained HTML: a `__bundler/manifest` of gzipped,
 * base64 resources plus a `__bundler/template` holding the app itself. Neither is
 * readable as shipped, and neither is what we ship — this writes the decoded parts
 * to `browser/.design/` so the port can be copied from them line by line, and so a
 * reviewer can diff what we wrote against what was designed.
 *
 * `browser/.design/` is gitignored. It is a build input, not a source file: nothing
 * in `browser/src/` may import from it.
 *
 *   node scripts/extract-design.mjs [path-to-sdk-playground.html]
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { gunzipSync, inflateSync } from 'node:zlib';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

const SOURCE = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(REPO, '../kaafil-presentation/slides/sdk-playground.html');

const OUT = join(REPO, 'browser', '.design');

/** Pull one `<script type="__bundler/NAME">…</script>` payload out of the artifact. */
function bundlerBlock(html, name) {
  const open = `<script type="__bundler/${name}">`;
  const i = html.indexOf(open);
  if (i === -1) throw new Error(`no __bundler/${name} block in ${SOURCE}`);
  const j = html.indexOf('</script>', i);
  if (j === -1) throw new Error(`unterminated __bundler/${name} block`);
  return html.slice(i + open.length, j).trim();
}

function decode(entry) {
  const raw = Buffer.from(entry.data, 'base64');
  if (!entry.compressed) return raw;
  try {
    return gunzipSync(raw);
  } catch {
    return inflateSync(raw);
  }
}

const html = readFileSync(SOURCE, 'utf8');
const manifest = JSON.parse(bundlerBlock(html, 'manifest'));
// The template block is a JSON string literal, not raw markup.
const template = JSON.parse(bundlerBlock(html, 'template'));

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'fonts'), { recursive: true });

// --- 1. the app's markup + logic -------------------------------------------
// The template is one document: <head> · <helmet> (global CSS) · the markup ·
// then a `<script type="text/x-dc" data-dc-script>` carrying the whole logic class.
const helmetEnd = template.indexOf('</helmet>');
const scriptOpen = template.indexOf('<script type="text/x-dc"');
if (helmetEnd === -1 || scriptOpen === -1) {
  throw new Error('template does not have the expected <helmet> + data-dc-script shape');
}
const scriptBodyStart = template.indexOf('>', scriptOpen) + 1;
const scriptBodyEnd = template.lastIndexOf('</script>');

const markup = template.slice(helmetEnd + '</helmet>'.length, scriptOpen).trim();
const logic = template.slice(scriptBodyStart, scriptBodyEnd).trim();

writeFileSync(join(OUT, 'template.html'), markup + '\n');
writeFileSync(join(OUT, 'logic.js'), logic + '\n');

// --- 2. the global CSS ------------------------------------------------------
// Everything inside <helmet>. Two <style> blocks: the @font-face declarations
// (whose src: urls are bundler uuids, rewritten below) and the real global sheet.
const helmetOpen = template.indexOf('<helmet>');
const helmet = template.slice(helmetOpen + '<helmet>'.length, helmetEnd);
const styles = [...helmet.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);

// --- 3. the fonts -----------------------------------------------------------
// The bundler names every resource by uuid. Recover a readable name from the
// @font-face rule that points at it — family + the subset comment above it —
// because `geist-mono-latin.woff2` is greppable in a review and a uuid is not.
// One file backs several weights (the woff2 is variable), so names must dedupe
// on the uuid, not on the rule.
const fontNames = new Map();
for (const css of styles) {
  const rules = [...css.matchAll(
    /\/\* ([\w-]+) \*\/\s*@font-face \{[^}]*?font-family: '([^']+)'[^}]*?url\("([0-9a-f-]{36})"\)/g,
  )];
  for (const [, subset, family, uuid] of rules) {
    if (fontNames.has(uuid)) continue;
    const slug = family.toLowerCase().replace(/\s+/g, '-');
    fontNames.set(uuid, `${slug}-${subset}`);
  }
}

const fonts = [];
for (const [uuid, entry] of Object.entries(manifest)) {
  if (!entry.mime?.startsWith('font/')) continue;
  const ext = entry.mime.split('/')[1];
  const bytes = decode(entry);
  const name = `${fontNames.get(uuid) ?? uuid}.${ext}`;
  writeFileSync(join(OUT, 'fonts', name), bytes);
  fonts.push({ uuid, name, bytes: bytes.length });
}

const rewriteFontUrls = (css) =>
  css.replace(/url\("([0-9a-f-]{36})"\)/g, (whole, uuid) => {
    const hit = fonts.find((f) => f.uuid === uuid);
    return hit ? `url("./fonts/${hit.name}")` : whole;
  });

writeFileSync(
  join(OUT, 'global.css'),
  styles.map(rewriteFontUrls).join('\n').trim() + '\n',
);

// --- 4. the runtime, for reference only ------------------------------------
// Not shipped and not ported — kept so anyone can check what `sc-if` / `sc-for` /
// `setState` actually did in the original before trusting our shim.
for (const [uuid, entry] of Object.entries(manifest)) {
  if (entry.mime !== 'text/javascript') continue;
  writeFileSync(join(OUT, `runtime-${uuid}.js`), decode(entry));
}

const report = {
  source: SOURCE,
  markupBytes: markup.length,
  markupLines: markup.split('\n').length,
  logicBytes: logic.length,
  logicLines: logic.split('\n').length,
  cssBytes: styles.join('').length,
  fonts: fonts.length,
};
writeFileSync(join(OUT, 'EXTRACT.json'), JSON.stringify(report, null, 2) + '\n');

console.log('extracted to browser/.design/');
for (const [k, v] of Object.entries(report)) console.log(`  ${k}: ${v}`);
