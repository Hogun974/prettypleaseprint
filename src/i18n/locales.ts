/**
 * Which languages the app speaks, and how one is chosen for a request.
 *
 * Pure on purpose — no `next/headers`, no next-intl — so the client bundle,
 * the check scripts and `src/lib/catalog.ts` can all import the `Locale` type
 * and the list without dragging the request machinery along. The request side
 * lives in `./request.ts` and calls `resolveLocale` below; docs/i18n.md is the
 * guide for translators.
 */

/**
 * English first, and English is the default: `messages/en.json` is the source
 * of truth that every other catalogue is checked against
 * (`npm run check:messages`) and falls back to, key by key.
 */
export const LOCALES = ["en", "fr"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/**
 * Each language in its own words, for the choosers on /me and the settings
 * page: someone looking for French looks for "Français", whatever language
 * the page around it is in. Not in the catalogues for that reason.
 */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  fr: "Français",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Everything a locale can be chosen from, trusted in this order — written
 * down here and nowhere else:
 *
 *   1. the person's own choice — `User.preferredLocale`, set on /me;
 *   2. what the browser asks for — `Accept-Language`, below;
 *   3. the instance's default — `defaultLocale`, from /admin/settings;
 *   4. English.
 *
 * A person's choice beats their browser because they made it in this app; the
 * instance default comes after the browser because it is a guess about a
 * stranger, and the browser is better placed to make that guess. A signed-out
 * page has no person, so it starts at 2.
 *
 * The two stored values were checked against LOCALES on the way out of the
 * database (`src/lib/preferences.ts`): a language this version no longer has
 * arrives as null and is skipped, never served.
 */
export type LocaleSources = {
  preference: Locale | null;
  acceptLanguage: string | null | undefined;
  instanceDefault: Locale | null;
};

export function resolveLocale(sources: LocaleSources): Locale {
  return (
    sources.preference ??
    negotiate(sources.acceptLanguage) ??
    sources.instanceDefault ??
    DEFAULT_LOCALE
  );
}

/**
 * The best language this app has for an `Accept-Language` header, or null
 * when it has none the browser accepts.
 *
 * Matched on the primary subtag, so `fr-CA` and `fr-BE` get French: there is
 * one French catalogue, and a Québécois reader is better served by it than by
 * English. Ranges are taken by quality, highest first, and in the order given
 * when two are equal — `de, fr;q=0.5` is French, because German is not on
 * offer and French was the next thing asked for.
 *
 * `*` and `q=0` are honoured as "anything" and "never", and anything that does
 * not parse is skipped rather than guessed at: a malformed header means the
 * default, never a language the person did not ask for.
 *
 * Written out rather than imported. next-intl's middleware does this with
 * `negotiator` and `@formatjs/intl-localematcher`, but this app does not run
 * its middleware (there is no locale in the URL), and those two are its
 * dependencies, not ours — importing a transitive package directly is how a
 * lockfile change breaks a build that nobody touched.
 */
export function negotiate(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranges: Array<{ primary: string; q: number; at: number }> = [];
  header.split(",").forEach((part, at) => {
    const [range, ...params] = part.trim().split(";");
    const tag = range?.trim().toLowerCase();
    if (!tag || !/^(\*|[a-z]{1,8}(-[a-z0-9]{1,8})*)$/.test(tag)) return;
    let q = 1;
    for (const p of params) {
      const m = /^\s*q\s*=\s*(0(\.\d{0,3})?|1(\.0{0,3})?)\s*$/.exec(p);
      if (m) q = Number(m[1]);
      else if (/^\s*q\s*=/.test(p)) return; // a q that is not a number: skip the range
    }
    ranges.push({ primary: tag.split("-")[0]!, q, at });
  });
  ranges.sort((a, b) => b.q - a.q || a.at - b.at);
  for (const { primary, q } of ranges) {
    if (q === 0) continue;
    if (primary === "*") return null;
    if (isLocale(primary)) return primary;
  }
  return null;
}
