import { headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import en from "../../messages/en.json";
import { resolveLocale, type Locale } from "./locales";

/**
 * next-intl's per-request configuration: which language, and its messages.
 *
 * Found by the plugin in next.config.ts. There is no locale in the URL and no
 * next-intl middleware — every link, redirect and `next=` parameter in the app
 * stays exactly what it was — so the language is decided here, from the
 * request, by the one function that knows the order of preference.
 *
 * Reading `headers()` makes the root layout dynamic. Every page already was:
 * middleware.ts mints a CSP nonce per request, and Next stamps it onto its own
 * inline scripts, which no static page could carry.
 */
export default getRequestConfig(async () => {
  const locale = resolveLocale({
    acceptLanguage: (await headers()).get("accept-language"),
  });
  return { locale, messages: await messagesFor(locale) };
});

type Messages = typeof en;

/**
 * Each catalogue laid over English, so a key the translation has not caught up
 * with renders in English rather than as its own name.
 *
 * Merged rather than left to next-intl's `getMessageFallback`, because that
 * hook only sees the key — it cannot reach for the English text, and showing
 * someone `signin.form.submit` on a button is the one outcome worse than
 * showing them English. `npm run check:messages` is what says a key is
 * missing; this is only what the person sees in the meantime.
 */
const CATALOGUES: Record<Exclude<Locale, "en">, () => Promise<{ default: unknown }>> = {
  fr: () => import("../../messages/fr.json"),
};

const merged = new Map<Locale, Messages>();

async function messagesFor(locale: Locale): Promise<Messages> {
  if (locale === "en") return en;
  let messages = merged.get(locale);
  if (!messages) {
    messages = overlay(en, (await CATALOGUES[locale]()).default) as Messages;
    merged.set(locale, messages);
  }
  return messages;
}

/**
 * English's shape, with the translation's strings wherever the translation has
 * a string in the same place. A translated value of the wrong shape — a string
 * where English has a group, or the reverse — is ignored rather than trusted,
 * and so is an empty string, so a slip in fr.json costs that one key its
 * translation and never blanks a button or breaks the page.
 */
function overlay(base: unknown, over: unknown): unknown {
  if (typeof base === "string") return typeof over === "string" && over.trim() !== "" ? over : base;
  if (!isGroup(base)) return base;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(base)) {
    out[key] = overlay(value, isGroup(over) && Object.hasOwn(over, key) ? over[key] : undefined);
  }
  return out;
}

function isGroup(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
