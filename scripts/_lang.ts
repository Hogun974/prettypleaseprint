/**
 * What the suites need to say a screen speaks the reader's language: the text
 * a person sees, the page's `lang`, where two texts part, and the catalogue
 * itself, to say a sentence the way the app does.
 *
 * `verify:auth` has its own copies of the first three, from before there was
 * a second suite that needed them.
 */
import { createTranslator } from "next-intl";

import en from "../messages/en.json";
import fr from "../messages/fr.json";

/**
 * What a reader sees: the markup without scripts, styles or tags, entities
 * decoded, whitespace collapsed. Scripts go first because the RSC payload in
 * them carries the client components' message strings, so a check on the raw
 * HTML would find English in a French page that shows none.
 */
export function visibleText(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/g, " ")
    .replace(/<style\b[\s\S]*?<\/style>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/[ \t\r\n]+/g, " ")
    .trim();
}

export const htmlLang = (html: string) => /<html\b[^>]*\blang="([^"]*)"/.exec(html)?.[1] ?? null;

/** Where two texts part, for a failure message that says what changed. */
export function firstDifference(a: string, b: string): string {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `differs at ${i}: "${a.slice(Math.max(0, i - 30), i + 40)}" vs "${b.slice(Math.max(0, i - 30), i + 40)}"`;
}

/** Which of these strings the text contains — for "none of the English is left". */
export const foundIn = (text: string, strings: string[]) => strings.filter((s) => text.includes(s));

/**
 * A notification row said the way the Activity panel says it
 * (`getNotificationText` in src/lib/notifications.ts): from its key in this
 * language, or its stored English when it has no key.
 */
export function sayNotification(
  locale: "en" | "fr",
  row: { text: string; messageKey: string | null; messageValues: unknown },
): string {
  if (!row.messageKey) return row.text;
  const t = createTranslator({ locale, messages: locale === "en" ? en : fr, onError: () => {} });
  return t(row.messageKey as never, (row.messageValues ?? {}) as never) as string;
}
