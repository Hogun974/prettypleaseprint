/**
 * Every translation held against English, key by key.
 *
 *   npm run check:messages
 *
 * `messages/en.json` is the source of truth; every other file in messages/ is
 * a translation of it. A translation drifts silently in both directions: a key
 * added in English renders in English for French readers (the request config
 * falls back key by key, which is right for the reader and invisible to
 * everyone else), and a key removed from English lingers in fr.json being
 * translated and reviewed for nothing. Nothing else notices either — the
 * typecheck only knows English, and the suites only read English.
 *
 * Per language it lists:
 *
 *   missing   in English, not in the translation — shown in English meanwhile
 *   stale     in the translation, no longer in English — delete it
 *   shape     a string where English has a group, or the reverse
 *   empty     an empty string, which would blank the text rather than fall back
 *   arguments the {placeholders} differ from English's — `{name}` renamed or
 *             dropped is a sentence that silently loses its subject
 *   quote     an ASCII apostrophe right before `{`, `}` or `#`, which ICU reads
 *             as the start of a quoted literal: `l'{x}` renders "l{x}". The
 *             catalogues use the typographic ’ for exactly this reason.
 *
 * And, once, for the source: every `useTranslations("…")` in a client
 * component names a group the browser is actually sent (see the end).
 *
 * Any of them fails the run. docs/i18n.md says what to do about each.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { CLIENT_GROUPS } from "../src/i18n/client-groups";

const DIR = "messages";
const SOURCE = "en";

type Leaves = Map<string, string>;

/** `{ a: { b: "x" } }` → `a.b` → "x", keeping groups apart from strings. */
function flatten(
  value: unknown,
  file: string,
  problems: string[],
  prefix = "",
  leaves: Leaves = new Map(),
  groups: Set<string> = new Set(),
): { leaves: Leaves; groups: Set<string> } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    problems.push(`${file}: the top level must be an object of groups and strings`);
    return { leaves, groups };
  }
  for (const [key, v] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (key.includes(".")) {
      // next-intl reads a dot as nesting, so this key can never be asked for.
      problems.push(`${file}: ${path} — a key cannot contain "."`);
    } else if (typeof v === "string") {
      leaves.set(path, v);
    } else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      groups.add(path);
      flatten(v, file, problems, path, leaves, groups);
    } else {
      problems.push(`${file}: ${path} — only strings and groups belong here, not ${JSON.stringify(v)}`);
    }
  }
  return { leaves, groups };
}

/** The names of an ICU message's arguments: `{name}`, `{count, plural, …}`. */
function argumentsOf(message: string): string[] {
  return [...new Set([...message.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)].map((m) => m[1]!))].sort();
}

function load(file: string, problems: string[]) {
  try {
    return flatten(JSON.parse(readFileSync(join(DIR, file), "utf8")), file, problems);
  } catch (e) {
    problems.push(`${file}: not valid JSON — ${(e as Error).message}`);
    return { leaves: new Map() as Leaves, groups: new Set<string>() };
  }
}

const fatal: string[] = [];
const source = load(`${SOURCE}.json`, fatal);
const translations = readdirSync(DIR)
  .filter((f) => f.endsWith(".json") && f !== `${SOURCE}.json`)
  .sort();

console.info(
  `check:messages — ${SOURCE}: ${source.leaves.size} key(s); ` +
    `${translations.length} translation(s): ${translations.map((f) => f.replace(/\.json$/, "")).join(", ") || "none"}`,
);

let failed = fatal.length > 0;
for (const p of fatal) console.error(`  ${p}`);

const QUOTE = /'[{}#]/;
for (const [key, message] of source.leaves) {
  if (QUOTE.test(message)) {
    console.error(`  ${SOURCE}: ${key} — an ASCII apostrophe before { } or # starts an ICU quote; use ’`);
    failed = true;
  }
}

for (const file of translations) {
  const lang = file.replace(/\.json$/, "");
  const problems: string[] = [];
  const { leaves, groups } = load(file, problems);

  const sections: Array<[string, string[]]> = [
    ["missing (shown in English until translated)", []],
    ["stale (no longer in en.json — delete)", []],
    ["shape (a string against a group, or the reverse)", []],
    ["empty (would blank the text instead of falling back)", []],
    ["arguments (placeholders differ from English)", []],
    ["quote (ASCII apostrophe before { } or # — use ’)", []],
  ];
  const [missing, stale, shape, empty, args, quote] = sections.map(([, list]) => list) as string[][];

  for (const [key, english] of source.leaves) {
    if (groups.has(key)) shape!.push(`${key}  (a group here, a string in English)`);
    else if (!leaves.has(key)) missing!.push(key);
    else {
      const translated = leaves.get(key)!;
      if (translated.trim() === "") empty!.push(key);
      const want = argumentsOf(english).join(", ");
      const got = argumentsOf(translated).join(", ");
      if (want !== got) args!.push(`${key}  (English has {${want}}, ${lang} has {${got}})`);
      if (QUOTE.test(translated)) quote!.push(key);
    }
  }
  for (const key of leaves.keys()) {
    if (source.groups.has(key)) shape!.push(`${key}  (a string here, a group in English)`);
    else if (!source.leaves.has(key)) stale!.push(key);
  }

  const count = sections.reduce((n, [, list]) => n + list.length, 0) + problems.length;
  if (count === 0) {
    console.info(`  ${lang}: every key translated, nothing stale`);
    continue;
  }
  failed = true;
  console.error(`\n  ${lang}: ${count} problem(s)`);
  for (const p of problems) console.error(`    ${p}`);
  for (const [title, list] of sections) {
    if (list.length === 0) continue;
    console.error(`    ${title}:`);
    for (const item of list.sort()) console.error(`      ${item}`);
  }
}

// --- client components ask only for groups the browser is sent -------------
//
// The root layout sends client components the groups in CLIENT_GROUPS, not
// the whole catalogue (client-groups.ts says why). A `useTranslations("x")` in
// a client file whose group is not sent renders the key's name instead of the
// text, and the typecheck cannot see it — the types know every key, not which
// ones were sent. So it is checked here, where it fails loudly, rather than
// found by someone reading the page.
const uncovered: string[] = [];
function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, found);
    else if (/\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}
for (const file of sourceFiles("src")) {
  const text = readFileSync(file, "utf8");
  if (!/^\s*["']use client["']/.test(text)) continue;
  for (const m of text.matchAll(/useTranslations\(([^)]*)\)/g)) {
    const arg = /^\s*["']([^"']+)["']\s*$/.exec(m[1]!)?.[1];
    if (!arg) uncovered.push(`${file}: useTranslations(${m[1]}) — name the group as a string literal`);
    else if (!CLIENT_GROUPS.some((g) => arg === g || arg.startsWith(`${g}.`))) {
      uncovered.push(`${file}: "${arg}" is not sent to the browser — add it to CLIENT_GROUPS`);
    }
  }
}
if (uncovered.length) {
  failed = true;
  console.error(`\n  client components: ${uncovered.length} problem(s)`);
  for (const u of uncovered) console.error(`    ${u}`);
} else {
  console.info(`  client components: every group they ask for is sent (${CLIENT_GROUPS.join(", ")})`);
}

if (failed) process.exitCode = 1;
