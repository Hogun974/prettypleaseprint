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

/** Where everyone starts, and what an unknown value falls back to. */
export const DEFAULT_THEME: ThemeChoice = "diner";

/**
 * The theme this request is drawn in — the value of `data-theme` on <html>.
 *
 * Today that is the default for everyone, because nobody can choose yet. When
 * someone can, the choice is made here and nowhere else, in this order: the
 * person's own preference, then the instance's default, then DEFAULT_THEME.
 * A stored value has to be checked against THEME_CHOICES on the way in, so
 * one naming a theme that has since been removed lands on the default rather
 * than on a page with no palette.
 *
 * Async, and called once per render of the root layout, so that reading a
 * session or a setting later changes this body and not its callers.
 */
export async function themeForRequest(): Promise<ThemeChoice> {
  return DEFAULT_THEME;
}
