/**
 * Every pair of colours the app puts text or a keyline on, measured against
 * WCAG AA in every theme.
 *
 *   npm run check:contrast             # the table, worst first; exit 1 on a failure
 *   npm run check:contrast -- --all    # every row, not only the ones near the line
 *
 * Reads the palette out of the CSS rather than restating it: the diner from
 * the `@theme` blocks in src/app/globals.css, every other theme from its file
 * in src/app/themes/, and which fills are signs and which are counter from
 * the `@utility bg-…` lines at the end of globals.css (see "Signs and the
 * counter" there). Then, in each theme:
 *
 *   - every text-on-fill pair written on one element in src/ — each class
 *     string's text-* against its bg-*, and again for hover:, disabled: and
 *     the rest, because a hover that swaps the fill swaps the ink with it;
 *   - every ink the counter uses on every counter ground, and every sign ink
 *     on every sign — text inherits, so which card a line of ink-3 lands on
 *     is not something a class string says, and the only safe answer is all;
 *   - the keyline and the focus ring on every counter ground, and every sign
 *     against the page, at 3:1, the bar for a component's edge.
 *
 * A theme other than the diner fails the check below AA. The diner is
 * reported and does not fail: it has pairs below AA that are older than this
 * check (docs/theming.md lists them), and a theme cannot fix them without
 * changing how the default looks. It also fails on a fill class it cannot
 * place as sign or counter, and on a theme in src/lib/theme.ts with no CSS.
 *
 * The 3D viewer and the "whatever" swatch are not here: one is lit, not
 * painted, and the other is a glyph with its own shade on a colour nobody
 * chose. `npm run shots` measures what pages actually render, inherited ink
 * and nested fills included, and is the other half of this.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { THEMES } from "../src/lib/theme";

const ALL = process.argv.includes("--all");
const GLOBALS = "src/app/globals.css";
const THEME_DIR = "src/app/themes";

// --- the palette ---------------------------------------------------------

/** The body of the block opened by the first match of `open`, braces balanced. */
function block(css: string, open: RegExp): string {
  const m = open.exec(css);
  if (!m) throw new Error(`No ${open} block.`);
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(m.index + m[0].length, i);
  }
  throw new Error(`Unclosed ${open} block.`);
}

function declarations(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, name, value] of body.matchAll(/--color-([\w-]+):\s*([^;]+);/g)) out.set(name!, value!.trim());
  return out;
}

const globals = readFileSync(GLOBALS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const diner = new Map([...declarations(block(globals, /@theme\s*\{/)), ...declarations(block(globals, /@theme static\s*\{/))]);

const themeFiles = readdirSync(THEME_DIR).filter((f) => f.endsWith(".css"));
const overrides = new Map<string, Map<string, string>>([["diner", new Map()]]);
for (const file of themeFiles) {
  const id = file.replace(/\.css$/, "");
  const css = readFileSync(join(THEME_DIR, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  overrides.set(id, declarations(block(css, new RegExp(`@variant ${id}\\s*\\{`))));
}

const problems: string[] = [];
for (const t of THEMES) if (!overrides.has(t.id)) problems.push(`${t.id} is in src/lib/theme.ts and has no ${THEME_DIR}/${t.id}.css.`);
for (const id of overrides.keys()) if (!THEMES.some((t) => t.id === id)) problems.push(`${THEME_DIR}/${id}.css is not in src/lib/theme.ts.`);

/** A theme's tokens as hex, each var() resolved at the root as the browser does. */
function palette(id: string): Map<string, string> {
  const raw = new Map([...diner, ...overrides.get(id)!]);
  const resolve = (name: string, seen: string[] = []): string | undefined => {
    const v = raw.get(name);
    if (!v || seen.includes(name)) return undefined;
    const ref = /^var\(--color-([\w-]+)\)$/.exec(v);
    return ref ? resolve(ref[1]!, [...seen, name]) : /^#[0-9a-f]{3,8}$/i.test(v) ? v : undefined;
  };
  const out = new Map<string, string>();
  for (const name of raw.keys()) {
    const hex = resolve(name);
    if (hex) out.set(name, hex);
  }
  return out;
}

// --- which fill is which -------------------------------------------------

const scope = new Map<string, "sign" | "counter">();
for (const [, fill, kind] of globals.matchAll(/@utility bg-([\w-]+)\s*\{\s*@apply on-(sign|counter);\s*\}/g)) {
  scope.set(fill!, kind as "sign" | "counter");
}
/** Fills that are neither, on purpose — globals.css says why for each. */
const NEITHER = new Set(["ink", "board", "transparent"]);
const signs = [...scope].filter(([, k]) => k === "sign").map(([f]) => f);
const counter = [...scope].filter(([, k]) => k === "counter").map(([f]) => f);

/** The ink a fill's content gets: a sign swaps the inks for its own. */
function inkOn(fill: string, text: string): string {
  return scope.get(fill) === "sign" && /^ink(-[23])?$/.test(text) ? `sign-${text}` : text;
}

// --- what the source writes ----------------------------------------------

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, found);
    else if (/\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

type Pair = { text: string; fill: string; need: number; where: Set<string> };
const pairs = new Map<string, Pair>();
function add(text: string, fill: string, need: number, where: string) {
  const key = `${text}|${fill}|${need}`;
  const p = pairs.get(key) ?? { text, fill, need, where: new Set<string>() };
  p.where.add(where);
  pairs.set(key, p);
}

/**
 * Every string literal is a candidate class list. Quoted strings are read
 * wherever they are, including inside a template's `${…}`; a template is read
 * with its `${…}` taken out. So a ternary's two halves are two lists, which is
 * what they are on the page, and never one list mixing both. Comments go
 * first: a stray backtick in one would pair classes from two elements.
 */
function classLists(code: string): string[] {
  const bare = code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|\s)\/\/.*$/gm, "$1");
  const quoted = [...bare.matchAll(/"([^"\n]*)"|'([^'\n]*)'/g)].map((m) => m[1] ?? m[2] ?? "");
  const templates = [...bare.matchAll(/`([^`]*)`/g)].map((m) => m[1]!.replace(/\$\{[^}]*\}/g, " "));
  return [...quoted, ...templates];
}

const colours = new Set(diner.keys());
for (const file of sources("src")) {
  for (const list of classLists(readFileSync(file, "utf8"))) {
    const classes = list.split(/\s+/);
    const by = new Map<string, { bg?: string; text?: string }>();
    for (const c of classes) {
      const m = /^((?:[\w-]+:)*)(bg|text)-([\w-]+)$/.exec(c);
      if (!m || !colours.has(m[3]!)) continue;
      const [, variant, kind, colour] = m as unknown as [string, string, "bg" | "text", string];
      if (kind === "bg" && !scope.has(colour) && !NEITHER.has(colour)) {
        problems.push(`${file}: ${c} is neither a sign nor counter in ${GLOBALS}.`);
      }
      const slot = by.get(variant) ?? {};
      slot[kind] = colour;
      by.set(variant, slot);
    }
    const base = by.get("") ?? {};
    const px = Math.max(0, ...classes.map((c) => Number(/^text-\[([\d.]+)px\]$/.exec(c)?.[1] ?? 0)));
    const bold = classes.includes("font-bold");
    const need = px >= 24 || (px >= 18.66 && bold) ? 3 : 4.5;
    for (const [variant, slot] of by) {
      const text = slot.text ?? base.text;
      const fill = slot.bg ?? base.bg;
      if (text && fill) add(text, fill, need, `${file.replace(/^src\//, "")} ${variant}`.trim());
    }
  }
}

// Inherited ink: everything the counter writes in, on every counter ground,
// and every sign ink on every sign. These are what a theme must survive, not
// pairs anyone wrote — so they hold a theme to AA, and do not count against
// the diner unless a class string or the list below also names them.
const ANY = "any";
const COUNTER_INKS = ["ink", "ink-2", "ink-3", "cherry-dk", "cherry", "sun-dk"];
for (const t of COUNTER_INKS) for (const f of counter) add(t, f, 4.5, `${ANY} counter ground`);
for (const t of ["ink", "ink-2", "ink-3"]) for (const f of signs) add(t, f, 4.5, `${ANY} sign`);
add("sign-ink", "sun", 4.5, "::selection (globals.css)");
// Written on an ancestor, so no single class string pairs them.
add("board-ink", "board", 4.5, "components/app-header.tsx: the band's links and wordmark");
add("ink-3", "porcelain", 4.5, "most cards: the typed meta line");
add("ink-3", "cream", 4.5, "components/source-link.tsx: the footer, on the page");
add("cherry", "cream", 4.5, "hover:text-cherry on links (user-menu, invite, set-password)");

// --- measure -------------------------------------------------------------

function luminance(hex: string): number {
  const h = hex.length === 4 ? hex.replace(/#(.)(.)(.)/, "#$1$1$2$2$3$3") : hex;
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((hi! + 0.05) / (lo! + 0.05)) * 100) / 100;
}

const ids = [...overrides.keys()];
const palettes = new Map(ids.map((id) => [id, palette(id)]));
const get = (id: string, name: string) => {
  const hex = palettes.get(id)!.get(name);
  if (!hex) throw new Error(`${id}: --color-${name} does not resolve to a colour.`);
  return hex;
};

type Row = { label: string; where: string; written: boolean; need: number; ratios: number[] };
const rows: Row[] = [];
for (const p of pairs.values()) {
  const where = [...p.where];
  rows.push({
    label: `${p.text} on ${p.fill}`,
    where: where.slice(0, 3).join("; ") + (where.length > 3 ? ` (+${where.length - 3})` : ""),
    written: where.some((w) => !w.startsWith(ANY)),
    need: p.need,
    ratios: ids.map((id) => ratio(get(id, inkOn(p.fill, p.text)), get(id, p.fill))),
  });
}

// Edges, at 3:1: what tells a card, a ring or a sign from what it sits on.
// A sign's edge is its fill or its own keyline, whichever stands out more —
// by day the dark keyline does it, at night the lit fill.
for (const f of counter) {
  rows.push({
    label: `keyline (ink) on ${f}`, where: "border-ink", written: true, need: 3,
    ratios: ids.map((id) => ratio(get(id, "ink"), get(id, f))),
  });
  rows.push({
    label: `focus ring (cherry-dk) on ${f}`, where: ":focus-visible", written: true, need: 3,
    ratios: ids.map((id) => ratio(get(id, "cherry-dk"), get(id, f))),
  });
}
for (const f of signs) {
  rows.push({
    label: `${f} sign's edge on the page`, where: "its fill or its keyline, against cream", written: true, need: 3,
    ratios: ids.map((id) => Math.max(ratio(get(id, f), get(id, "cream")), ratio(get(id, "sign-ink"), get(id, "cream")))),
  });
}

// The header's band, components/app-header.tsx. What sits on it: the active
// pill (sun) and the avatar (aqua), signs with a sign's keyline; the Activity
// button and a hovered link, counter (cream, cream-2) with the counter's
// keyline; the wordmark's disc (cherry); the focus ring. The text inside each
// is a pair above already (ink on sun, ink on cream, ink on cream-2).
const BAND = "components/app-header.tsx, on the band";
const onBand: Array<[string, (id: string) => number]> = [
  ["sun pill's edge", (id) => Math.max(ratio(get(id, "sun"), get(id, "board")), ratio(get(id, "sign-ink"), get(id, "board")))],
  ["aqua avatar's edge", (id) => Math.max(ratio(get(id, "aqua"), get(id, "board")), ratio(get(id, "sign-ink"), get(id, "board")))],
  ["cherry disc's edge", (id) => Math.max(ratio(get(id, "cherry"), get(id, "board")), ratio(get(id, "sign-ink"), get(id, "board")))],
  ["Activity button's edge (cream, keyline ink)", (id) => Math.max(ratio(get(id, "cream"), get(id, "board")), ratio(get(id, "ink"), get(id, "board")))],
  ["hovered link's edge (cream-2, keyline ink)", (id) => Math.max(ratio(get(id, "cream-2"), get(id, "board")), ratio(get(id, "ink"), get(id, "board")))],
  ["focus ring (cherry-dk)", (id) => ratio(get(id, "cherry-dk"), get(id, "board"))],
];
for (const [what, measure] of onBand) {
  rows.push({ label: `${what} on board`, where: BAND, written: true, need: 3, ratios: ids.map(measure) });
}

const worst = (r: Row) => Math.min(...r.ratios.slice(1).map((x) => x / r.need), Infinity);
rows.sort((x, y) => worst(x) - worst(y) || x.ratios[0]! / x.need - y.ratios[0]! / y.need);

const failures = rows.flatMap((r) =>
  r.ratios.flatMap((x, i) => (i > 0 && x < r.need ? [`${ids[i]}: ${r.label} is ${x}:1, needs ${r.need}:1 (${r.where})`] : [])),
);
const dinerBelow = rows.filter((r) => r.written && r.ratios[0]! < r.need);

const shown = ALL
  ? rows
  : rows.filter((r) => r.ratios.slice(1).some((x) => x < r.need * 1.1) || (r.written && r.ratios[0]! < r.need));
const mark = (x: number, need: number) => `${x.toFixed(2)}${x < need ? " ✗" : ""}`;
console.info(`| pair | needs | ${ids.join(" | ")} | where |`);
console.info(`| --- | --- | ${ids.map(() => "---").join(" | ")} | --- |`);
for (const r of shown) {
  console.info(`| ${r.label} | ${r.need} | ${r.ratios.map((x) => mark(x, r.need)).join(" | ")} | ${r.where} |`);
}
console.info(
  `\n${rows.length} pairs; shown: ${ALL ? "all" : "within 10% of the line in a theme, or written and below it in the diner"}. ` +
    `${dinerBelow.length} written pairs are below AA in the diner (reported, not failed).`,
);

for (const p of [...problems, ...failures]) console.error(`✗ ${p}`);
if (problems.length || failures.length) process.exitCode = 1;
else console.info(`Every theme but the diner clears AA on all ${rows.length}.`);
