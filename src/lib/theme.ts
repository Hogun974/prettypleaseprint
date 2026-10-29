/**
 * Themes: the list of them, and which one a request is drawn in.
 *
 * A theme is a set of colour tokens and nothing more. The diner's are the
 * `@theme` blocks in src/app/globals.css; every other theme is a file in
 * src/app/themes/ that redefines some of them under its own `data-theme`
 * value, and the root layout writes that value on <html>. Components never
 * ask which theme they are in — see "Signs and the counter" in globals.css
 * for how the colour rule survives a dark counter without them knowing.
 *
 * A person chooses on /me and the printer owner sets the default for everyone
 * else at /admin/settings; `themeForRequest()` below is where those meet.
 *
 * This is the one list. A theme added here and not in CSS draws as the diner
 * — `npm run check:contrast` refuses that — and one in CSS but not here can
 * never be chosen.
 */

export const THEMES = [
  {
    id: "diner",
    name: "Diner",
    description: "Cream counter, enamel signs, the lights on.",
  },
  {
    id: "after-hours",
    name: "Diner after hours",
    description: "The same diner at night: a dark counter, the neon still lit.",
  },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

/**
 * What a person or an instance can choose: a theme, or `auto`, which follows
 * the system's light or dark setting — the diner by day, after hours by
 * night. `auto` is resolved by the browser (a media query in
 * src/app/themes/after-hours.css), not here: the server never learns the
 * system setting, and it can change while the page is open.
 */
export type ThemeChoice = ThemeId | "auto";

export const THEME_CHOICES: readonly ThemeChoice[] = [...THEMES.map((t) => t.id), "auto"];

/**
 * Each choice's key in the `themes` message group, where the names a person
 * picks from are translated. `name` above is the English one, for the docs
 * and the scripts.
 */
export const THEME_KEY = {
  diner: "diner",
  "after-hours": "afterHours",
  auto: "auto",
} as const satisfies Record<ThemeChoice, string>;

/** Where everyone starts, and what an unknown value falls back to. */
export const DEFAULT_THEME: ThemeChoice = "diner";

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === "string" && (THEME_CHOICES as readonly string[]).includes(value);
}

/**
 * Which theme: the person's own preference, then the instance's default, then
 * DEFAULT_THEME — in that order, and decided here and nowhere else.
 *
 * Pure, so the order can be tested without a request. Both inputs were
 * checked against THEME_CHOICES on the way out of the database
 * (`src/lib/preferences.ts`), so a stored value naming a theme that has since
 * been removed arrives as null and lands on the next one down, rather than on
 * a page with no palette.
 */
export function resolveTheme(sources: {
  preference: ThemeChoice | null;
  instanceDefault: ThemeChoice | null;
}): ThemeChoice {
  return sources.preference ?? sources.instanceDefault ?? DEFAULT_THEME;
}

/**
 * The theme this request is drawn in — the value of `data-theme` on <html>.
 *
 * Called once per render of the root layout. A signed-out page (sign-in, a
 * reset link) has no person, so it gets the instance's default.
 *
 * The request side is imported when called rather than at the top: it reads
 * the session, which is `server-only`, and this file is also imported by
 * `npm run shots` and `check:contrast`, which run outside Next, where
 * `server-only` throws on import.
 */
export async function themeForRequest(): Promise<ThemeChoice> {
  const { viewerPreferences } = await import("@/lib/viewer-preferences");
  const { person, instance } = await viewerPreferences();
  return resolveTheme({ preference: person?.theme ?? null, instanceDefault: instance.theme });
}
