import type { User } from "@prisma/client";

import { isLocale, type Locale } from "@/i18n/locales";
import { isSlicer, type SlicerId } from "@/lib/slicers";
import { isThemeChoice, type ThemeChoice } from "@/lib/theme";

/**
 * A person's own preferences — language, theme, slicer — as stored on their
 * `User` row and as sent by the form on /me.
 *
 * Each is null until the person chooses, and null means "follow the
 * instance": the owner's default at /admin/settings, which is itself the
 * built-in one until the owner sets it. Which value wins is decided in one
 * place per preference — `resolveLocale` (src/i18n/locales.ts),
 * `resolveTheme` (theme.ts), `resolveSlicer` (slicers.ts) — and the request
 * side that feeds them is `viewer-preferences.ts`.
 *
 * Pure, with no `server-only`, so `verify:preferences` can call the rules
 * directly, as `verify:settings` does with `settings.ts`.
 */

export type PreferenceColumn = "preferredLocale" | "preferredTheme" | "preferredSlicer";

export type Preferences = {
  locale: Locale | null;
  theme: ThemeChoice | null;
  slicer: SlicerId | null;
};

/** The three columns, for a `select` that reads nothing else off the row. */
export const PREFERENCE_COLUMNS = {
  preferredLocale: true,
  preferredTheme: true,
  preferredSlicer: true,
} as const satisfies Partial<Record<keyof User, true>>;

/**
 * The row's text, to values the app has.
 *
 * A value this version does not know — a theme or language since removed, or
 * a row edited by hand — reads as null, "follow the instance", rather than
 * failing the page. Unlike an unknown import source, which is refused loudly
 * because it decides what the server fetches, these only decide how a page
 * looks to the one person who chose it. Their form then shows "same as the
 * house" — which is what they are getting — and the next save stores that.
 */
export function readPreferences(row: Pick<User, PreferenceColumn>): Preferences {
  return {
    locale: isLocale(row.preferredLocale) ? row.preferredLocale : null,
    theme: isThemeChoice(row.preferredTheme) ? row.preferredTheme : null,
    slicer: isSlicer(row.preferredSlicer) ? row.preferredSlicer : null,
  };
}

/** Form field → column, and the check a submitted value must pass. */
const FIELDS: Record<string, { column: PreferenceColumn; valid: (v: string) => boolean }> = {
  locale: { column: "preferredLocale", valid: isLocale },
  theme: { column: "preferredTheme", valid: isThemeChoice },
  slicer: { column: "preferredSlicer", valid: isSlicer },
};

/**
 * What the /me form sent, to the columns it changes — or a refusal.
 *
 * An empty value is "follow the instance" and stored as null. A field the
 * form did not carry is left alone. Anything not on the lists is refused
 * whole, nothing saved: the page only offers the lists, so a value that is
 * not on them is a crafted request — and storing it, only for it to read back
 * as null, would be a save that quietly did something other than was asked.
 *
 * Whose row is never read from here. There is no id in the form, and one added
 * to it is ignored: the action writes to the session's own row.
 */
export function parsePreferencesForm(
  form: FormData,
): { changes: Partial<Record<PreferenceColumn, string | null>> } | { problem: string } {
  const changes: Partial<Record<PreferenceColumn, string | null>> = {};
  for (const [field, { column, valid }] of Object.entries(FIELDS)) {
    if (!form.has(field)) continue;
    const value = String(form.get(field) ?? "").trim();
    if (value === "") changes[column] = null;
    else if (valid(value)) changes[column] = value;
    else return { problem: `${field}: "${value}" is not one of the choices.` };
  }
  return { changes };
}
