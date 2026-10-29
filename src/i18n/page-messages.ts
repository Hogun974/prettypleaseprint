import "server-only";
import { getLocale, getMessages } from "next-intl/server";
import type { Locale, Messages } from "next-intl";

/**
 * Some of the catalogue, for one client component on one page.
 *
 * `CLIENT_GROUPS` (./client-groups.ts) is sent with every page, which is right
 * for the header and wrong for a request form: its words — and the refusals it
 * can show, and a placeholder that is also a suite's test title — would ride
 * along on the rail, a ticket and everyone's sign-in page. So the page that
 * draws such a component picks the groups here and hands them down as a prop,
 * and the component says them with `createTranslator`: the same messages, the
 * same ICU, on that page only.
 *
 *   const words = await getPageMessages(UPLOAD_FORM_WORDS);
 *   <UploadForm words={words} … />
 *   // in the component:
 *   const t = useMemo(() => createTranslator({ ...words, namespace: "upload.form" }), [words]);
 */
export type PageMessages = { locale: Locale; messages: Messages };

/** What the request form says, and every refusal it can be answered with. */
export const UPLOAD_FORM_WORDS = [
  "upload.form",
  "common.priority",
  "problems.wish",
  "problems.upload",
  "problems.requeue",
  "problems.api",
] as const;

/** What the 3D viewer says while it loads, and when it cannot. */
export const VIEWER_WORDS = ["viewer"] as const;

export async function getPageMessages(paths: readonly string[]): Promise<PageMessages> {
  const [locale, all] = await Promise.all([getLocale(), getMessages()]);
  const out: Record<string, unknown> = {};
  for (const path of paths) {
    const parts = path.split(".");
    let from: unknown = all;
    let to = out;
    parts.forEach((part, i) => {
      from = (from as Record<string, unknown> | undefined)?.[part];
      if (i === parts.length - 1) to[part] = from;
      else to = (to[part] ??= {}) as Record<string, unknown>;
    });
  }
  // English's shape, partly: `createTranslator` only reads the namespaces picked.
  return { locale, messages: out as Messages };
}
