import { getLocale, getMessages, getTranslations } from "next-intl/server";

import { relativeTime } from "@/lib/catalog";
import { CLIENT_GROUPS } from "./client-groups";

/**
 * `relativeTime`, in the language of this request.
 *
 *   const ago = await getRelativeTime();
 *   ago(story.createdAt)   // "3 hours ago" / "il y a 3 heures"
 *
 * Only translated screens use this. The others call `relativeTime` directly
 * and stay English, so a page that is not translated yet never reads
 * "Ruben · il y a 3 heures" in the middle of English copy.
 */
export async function getRelativeTime(): Promise<(date: Date) => string> {
  const [locale, t] = await Promise.all([getLocale(), getTranslations("time")]);
  const words = { locale, justNow: t("justNow") };
  return (date) => relativeTime(date, words);
}

/**
 * This request's messages, cut down to the groups client components use —
 * the root layout hands these to `NextIntlClientProvider`. Which groups, and
 * why not all of them: ./client-groups.ts.
 */
export async function getClientMessages(): Promise<Record<string, unknown>> {
  const all = (await getMessages()) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const path of CLIENT_GROUPS) {
    const parts = path.split(".");
    let from: unknown = all;
    let to = out;
    parts.forEach((part, i) => {
      from = (from as Record<string, unknown> | undefined)?.[part];
      if (i === parts.length - 1) to[part] = from;
      else to = (to[part] ??= {}) as Record<string, unknown>;
    });
  }
  return out;
}
