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
 * A translucent fill (glass, a fork-only theme) has no single colour: what
 * text sits on is the fill composited over whatever is behind it. So a
 * ground is a set of colours and a pair is as good as its worst. A fill is
 * translucent when its theme gives it `--color-fill-<name>` (globals.css,
 * --background-color-*); its grounds are then the fill over each of:
 *
 *   - every colour the room can be, for a panel in the page. The room is
 *     --color-backdrop under the --color-glow-* layers, with the build
 *     plate's grid over it, and is never blurred under a panel (only what
 *     floats is). When the theme's CSS keeps each glow in its own quarter
 *     of the room (see apart()), a point is lit by one glow at most, at some
 *     strength between none and full: those are measured, each with and
 *     without the grid's lines over it. Otherwise any glows can stack, and
 *     what is measured is the per-channel minimum and maximum of every
 *     combination at full strength, a bound no mixture of them crosses;
 *   - --color-veil over pure black and over pure white, for what floats
 *     (the sticky header, its menus): the page scrolls anything under them;
 *   - and the opaque colour of the same name, which is what is drawn when
 *     the system asks for reduced transparency or more contrast.
 *
 * A frost nested in another frost is lighter than either over the room, as
 * long as no frost is darker than the room's floor; the check fails a theme
 * where one is. A frost on a sign is drawn opaque (themes/glass.css).
 *
 * A theme can also make some signs dark — glass's cherry and -dk fills, deep
 * colours on a light counter — by a rule in its file that gives them
 * `--color-dark-sign-ink`; text inherited on those is measured in it.
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
/** Per theme, the signs it makes dark: they carry --color-dark-sign-ink. */
const darkSigns = new Map<string, Set<string>>([["diner", new Set()]]);
const themeCss = new Map<string, string>([["diner", ""]]);
for (const file of themeFiles) {
  const id = file.replace(/\.css$/, "");
  const css = readFileSync(join(THEME_DIR, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  themeCss.set(id, css);
  overrides.set(id, declarations(block(css, new RegExp(`@variant ${id}\\s*\\{`))));
  const dark = new Set<string>();
  for (const [, selector] of css.matchAll(/([^{}]+)\{[^{}]*--color-ink:\s*var\(--color-dark-sign-ink\)/g)) {
    for (const [, fill] of selector!.matchAll(/\.bg-([\w-]+)/g)) dark.add(fill!);
  }
  darkSigns.set(id, dark);
}

const problems: string[] = [];
for (const t of THEMES) if (!overrides.has(t.id)) problems.push(`${t.id} is in src/lib/theme.ts and has no ${THEME_DIR}/${t.id}.css.`);
for (const id of overrides.keys()) if (!THEMES.some((t) => t.id === id)) problems.push(`${THEME_DIR}/${id}.css is not in src/lib/theme.ts.`);

/** A colour: red, green and blue in 0–255, alpha in 0–1. */
type Rgba = [number, number, number, number];
const BLACK: Rgba = [0, 0, 0, 1];
const WHITE: Rgba = [255, 255, 255, 1];

function fromHex(hex: string): Rgba {
  const h = hex.slice(1);
  const full = h.length <= 4 ? [...h].map((c) => c + c).join("") : h;
  const [r, g, b, a] = [0, 2, 4, 6].map((i) => parseInt(full.slice(i, i + 2) || "ff", 16));
  return [r!, g!, b!, a! / 255];
}

/** `top` painted over an opaque `under`, as the browser composites it. */
function over(top: Rgba, under: Rgba): Rgba {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i]! * a + under[i]! * (1 - a)).concat(1) as Rgba;
}

/**
 * A theme's tokens as colours, each var() resolved at the root as the browser
 * does. Understands a hex, a var() of another token, `transparent`, and the
 * one color-mix() form the CSS uses: a colour at a percentage, mixed with
 * transparent — which is that colour at that alpha.
 */
function palette(id: string): Map<string, Rgba> {
  const raw = new Map([...diner, ...overrides.get(id)!]);
  const parse = (v: string, seen: string[]): Rgba | undefined => {
    const ref = /^var\(--color-([\w-]+)\)$/.exec(v);
    if (ref) return resolve(ref[1]!, seen);
    if (/^#[0-9a-f]{3,8}$/i.test(v)) return fromHex(v);
    if (v === "transparent") return [0, 0, 0, 0];
    const mix = /^color-mix\(in srgb,\s*(.+?)\s+([\d.]+)%,\s*transparent\)$/.exec(v);
    const base = mix ? parse(mix[1]!, seen) : undefined;
    return base && [base[0], base[1], base[2], (base[3] * Number(mix![2])) / 100];
  };
  const resolve = (name: string, seen: string[] = []): Rgba | undefined => {
    const v = raw.get(name);
    return !v || seen.includes(name) ? undefined : parse(v, [...seen, name]);
  };
  const out = new Map<string, Rgba>();
  for (const name of raw.keys()) {
    const colour = resolve(name);
    if (colour) out.set(name, colour);
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

/**
 * The ink a fill's content gets: a sign swaps the inks for its own, and a
 * sign the theme makes dark for the dark sign's. The dark swap is on the
 * plain fill class only (themes/glass.css says why), so a fill that comes
 * from a variant — `hover:bg-cherry` — carries the sign's ink.
 */
function inkOn(id: string, fill: string, text: string, plain = true): string {
  if (scope.get(fill) !== "sign" || !/^ink(-[23])?$/.test(text)) return text;
  return plain && darkSigns.get(id)!.has(fill) ? `dark-sign-${text}` : `sign-${text}`;
}
const anyDark = (fill: string) => [...darkSigns.values()].some((s) => s.has(fill));

// --- what the source writes ----------------------------------------------

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, found);
    else if (/\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

/** `plain`: the fill is a plain class, not a variant's (see inkOn). */
type Pair = { text: string; fill: string; need: number; plain: boolean; where: Set<string> };
const pairs = new Map<string, Pair>();
function add(text: string, fill: string, need: number, where: string, plain = true) {
  // Only a pair whose ink a dark sign would swap is told apart by it.
  const tell = !plain && /^ink(-[23])?$/.test(text) && anyDark(fill);
  const key = `${text}|${fill}|${need}${tell ? "|variant" : ""}`;
  const p = pairs.get(key) ?? { text, fill, need, plain: !tell, where: new Set<string>() };
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
      const plain = variant === "" || !slot.bg;
      if (text && fill) add(text, fill, need, `${file.replace(/^src\//, "")} ${variant}`.trim(), plain);
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
// And straight on the page — headings and notes outside any panel. In the
// diner that is cream; in a theme with a room, the room (see grounds()).
for (const t of COUNTER_INKS) add(t, "page", 4.5, `${ANY} text on the page`);
for (const t of ["ink", "ink-2", "ink-3"]) for (const f of signs) add(t, f, 4.5, `${ANY} sign`);
add("sign-ink", "sun", 4.5, "::selection (globals.css)");
// Written on an ancestor, so no single class string pairs them.
add("board-ink", "board", 4.5, "components/app-header.tsx: the band's links and wordmark");
add("ink-3", "porcelain", 4.5, "most cards: the typed meta line");
add("ink-3", "page", 4.5, "components/source-link.tsx: the footer, on the page");
add("cherry", "cream", 4.5, "hover:text-cherry on links (user-menu, invite, set-password)");

// --- measure -------------------------------------------------------------

function luminance([r, g, b]: Rgba): number {
  const [lr, lg, lb] = [r, g, b].map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr! + 0.7152 * lg! + 0.0722 * lb!;
}
function ratio(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((hi! + 0.05) / (lo! + 0.05)) * 100) / 100;
}

const ids = [...overrides.keys()];
const palettes = new Map(ids.map((id) => [id, palette(id)]));
const has = (id: string, name: string) => palettes.get(id)!.has(name);
const get = (id: string, name: string) => {
  const colour = palettes.get(id)!.get(name);
  if (!colour) throw new Error(`${id}: --color-${name} does not resolve to a colour.`);
  return colour;
};
/** A colour that is drawn as text or a line, so must be opaque. */
const solid = (id: string, name: string) => {
  const colour = get(id, name);
  if (colour[3] !== 1) throw new Error(`${id}: --color-${name} is drawn as a colour and must be opaque.`);
  return colour;
};

/**
 * The build plate's grid, drawn over the page in every theme: two layers of
 * ink at the alpha `.plate` gives them in globals.css, one per direction.
 */
const PLATE = Number(/\.plate\s*\{[\s\S]*?var\(--color-ink\)\s+([\d.]+)%/.exec(globals)?.[1]);
if (!PLATE) throw new Error(`No .plate grid alpha in ${GLOBALS}.`);

/**
 * The darkest and lightest the room can be, channel by channel — see the
 * header. Every layer either absent or at full alpha, in every combination,
 * painted bottom to top: the backdrop, the glows (the first listed is on
 * top, as in CSS), then the grid. A theme without a backdrop is drawn on
 * cream, the diner's page.
 */
function room(id: string): Rgba[] {
  if (!has(id, "backdrop")) return [solid(id, "cream")];
  const names = [...palettes.get(id)!.keys()].filter((n) => /^glow-\d+$/.test(n));
  const base = solid(id, "backdrop");
  const line: Rgba = [...solid(id, "ink").slice(0, 3), PLATE / 100] as Rgba;
  const grid = (c: Rgba) => [c, over(line, c), over(line, over(line, c))];
  if (apart(id, names)) {
    // One glow at a time, at every strength from none to full (in twentieths:
    // luminance along a strength is smooth, and can dip between the ends).
    return names.flatMap((n) => {
      const glow = get(id, n);
      return Array.from({ length: 21 }, (_, k) => over([glow[0], glow[1], glow[2], (glow[3] * k) / 20], base));
    }).flatMap(grid);
  }
  // Glows that may overlap: every combination at full strength, painted
  // bottom to top (the first listed is on top, as in CSS), reduced to the
  // per-channel bounds, which hold for any mixture of them.
  const layers = [...names].sort((a, b) => Number(b.slice(5)) - Number(a.slice(5))).map((n) => get(id, n));
  const lo: Rgba = [255, 255, 255, 1];
  const hi: Rgba = [0, 0, 0, 1];
  for (let mask = 0; mask < 1 << layers.length; mask++) {
    for (const c of grid(layers.reduce((under, layer, i) => (mask & (1 << i) ? over(layer, under) : under), base))) {
      for (const i of [0, 1, 2]) {
        lo[i] = Math.min(lo[i]!, c[i]!);
        hi[i] = Math.max(hi[i]!, c[i]!);
      }
    }
  }
  return [lo, hi];
}

/**
 * Whether no two glows can ever overlap, read from the theme's CSS: each is a
 * radial gradient from its own corner of the room, no more than half the
 * room's width and height across, so each stays in its own quarter at any
 * window size. Then a point of the room is lit by one glow at most.
 */
function apart(id: string, names: string[]): boolean {
  const corners = new Map<string, string>();
  for (const [, rx, ry, x, y, glow] of themeCss.get(id)!.matchAll(
    /radial-gradient\(\s*([\d.]+)%\s+([\d.]+)%\s+at\s+([\d.]+)%\s+([\d.]+)%\s*,\s*var\(--color-(glow-\d+)\)/g,
  )) {
    const corner = `${x} ${y}`;
    if (Number(rx) > 50 || Number(ry) > 50 || !/^(0|100) (0|100)$/.test(corner) || corners.has(corner)) return false;
    corners.set(corner, glow!);
  }
  const drawn = [...corners.values()];
  return names.every((n) => drawn.filter((g) => g === n).length === 1);
}

/** What a floating layer is laid on: its veil over anything at all. */
function veiled(id: string): Rgba[] {
  return has(id, "veil") ? [over(get(id, "veil"), BLACK), over(get(id, "veil"), WHITE)] : [];
}

/**
 * Every colour a fill can be in a theme. An opaque fill is its colour. A
 * translucent one (--color-fill-<name>) is the fill over the room, over a
 * veil over black and white, under a veil over black and white (a menu's veil
 * is its background-image, painted over its fill), and its opaque colour, for
 * reduced transparency. "page" is the room itself.
 */
function grounds(id: string, fill: string): Rgba[] {
  if (fill === "page") return room(id);
  const paint = has(id, `fill-${fill}`) ? get(id, `fill-${fill}`) : get(id, fill);
  if (paint[3] === 1) return [paint];
  const opaque = solid(id, fill);
  const veil = has(id, "veil") ? get(id, "veil") : undefined;
  return [
    opaque,
    ...[...room(id), ...veiled(id)].map((under) => over(paint, under)),
    ...(veil ? [BLACK, WHITE].map((under) => over(veil, over(paint, under))) : []),
  ];
}

/** The worst of a text colour against every colour its ground can be. */
const worstOn = (id: string, text: Rgba, ground: Rgba[]) => Math.min(...ground.map((g) => ratio(text, g)));
/** A pair: the ink the fill gives its content, on every colour of the fill. */
const measure = (id: string, text: string, fill: string, plain = true) =>
  worstOn(id, solid(id, inkOn(id, fill, text, plain)), grounds(id, fill));
/** An edge at 3:1: the fill or its keyline, whichever stands out more, on the worst ground. */
const edge = (id: string, fill: string, keyline: string, on: Rgba[]) =>
  Math.min(...on.map((g) => Math.max(ratio(solid(id, fill), g), ratio(solid(id, keyline), g))));

// The nesting argument in the header holds only if no frost is darker than
// what it can be laid on, channel by channel.
const hex = (c: Rgba) => "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
for (const id of ids) {
  if (has(id, "backdrop")) {
    const points = [...room(id)].sort((a, b) => luminance(a) - luminance(b));
    const how = points.length > 2 ? "glows apart, each at every strength" : "glows that may overlap: per-channel bounds";
    console.info(`${id}: the room's darkest point is ${hex(points[0]!)}, its lightest ${hex(points.at(-1)!)} (${how}).`);
  }
  const floor = [...room(id), ...veiled(id)].reduce((lo, c) => lo.map((v, i) => Math.min(v, c[i]!)) as Rgba);
  for (const [name, colour] of palettes.get(id)!) {
    // The frosts something can be nested in: the counter's, and the band's.
    if (![...counter, "board"].some((f) => name === `fill-${f}`) || colour[3] === 1) continue;
    if ([0, 1, 2].some((i) => colour[i]! < floor[i]!)) {
      problems.push(`${id}: --color-${name} is darker than the room's floor in a channel; a frost nested in it could be darker than measured.`);
    }
  }
}

type Row = { label: string; where: string; written: boolean; need: number; ratios: number[] };
const rows: Row[] = [];
for (const p of pairs.values()) {
  const where = [...p.where];
  rows.push({
    label: `${p.text} on ${p.fill}${p.plain ? "" : " (a variant's fill)"}`,
    where: where.slice(0, 3).join("; ") + (where.length > 3 ? ` (+${where.length - 3})` : ""),
    written: where.some((w) => !w.startsWith(ANY)),
    need: p.need,
    ratios: ids.map((id) => measure(id, p.text, p.fill, p.plain)),
  });
}

// Edges, at 3:1: what tells a card, a ring or a sign from what it sits on.
// A sign's edge is its fill or its own keyline, whichever stands out more —
// by day the dark keyline does it, at night the lit fill. A sign's keyline
// is `border-ink` in the ink the sign carries.
for (const f of [...counter, "page"]) {
  rows.push({
    label: `keyline (ink) on ${f}`, where: "border-ink", written: true, need: 3,
    ratios: ids.map((id) => worstOn(id, solid(id, "ink"), grounds(id, f))),
  });
  rows.push({
    label: `focus ring (cherry-dk) on ${f}`, where: ":focus-visible", written: true, need: 3,
    ratios: ids.map((id) => worstOn(id, solid(id, "cherry-dk"), grounds(id, f))),
  });
}
for (const f of signs) {
  rows.push({
    label: `${f} sign's edge on the page`, where: "its fill or its keyline, against the page", written: true, need: 3,
    ratios: ids.map((id) => edge(id, f, inkOn(id, f, "ink"), room(id))),
  });
}

// The header's band, components/app-header.tsx. What sits on it: the active
// pill (sun) and the avatar (aqua), signs with a sign's keyline; the Activity
// button and a hovered link, counter (cream, cream-2) with the counter's
// keyline; the wordmark's disc (cherry); the focus ring. The text inside each
// is a pair above already (ink on sun, ink on cream, ink on cream-2).
const BAND = "components/app-header.tsx, on the band";
const onBand: Array<[string, (id: string) => number]> = [
  ["sun pill's edge", (id) => edge(id, "sun", inkOn(id, "sun", "ink"), grounds(id, "board"))],
  ["aqua avatar's edge", (id) => edge(id, "aqua", inkOn(id, "aqua", "ink"), grounds(id, "board"))],
  ["cherry disc's edge", (id) => edge(id, "cherry", inkOn(id, "cherry", "ink"), grounds(id, "board"))],
  ["Activity button's edge (cream, keyline ink)", (id) => edge(id, "cream", "ink", grounds(id, "board"))],
  ["hovered link's edge (cream-2, keyline ink)", (id) => edge(id, "cream-2", "ink", grounds(id, "board"))],
  ["focus ring (cherry-dk)", (id) => worstOn(id, solid(id, "cherry-dk"), grounds(id, "board"))],
];
for (const [what, measure] of onBand) {
  rows.push({ label: `${what} on board`, where: BAND, written: true, need: 3, ratios: ids.map(measure) });
}

// The toast, components/toast.tsx: a sun sign, frosted in a theme that gives
// it --color-fill-toast, floating over anything with no veil of its own.
rows.push({
  label: "sign-ink on the toast", where: "components/toast.tsx", written: true, need: 4.5,
  ratios: ids.map((id) => {
    const paint = has(id, "fill-toast") ? get(id, "fill-toast") : solid(id, "sun");
    const on = paint[3] === 1 ? [paint] : [solid(id, "sun"), over(paint, BLACK), over(paint, WHITE)];
    return worstOn(id, solid(id, "sign-ink"), on);
  }),
});

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
