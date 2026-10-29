import "server-only";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { getTranslations } from "next-intl/server";

import { db } from "@/lib/db";
import type { Actor } from "@/lib/scope";

/**
 * The Activity feed.
 *
 * Notifications are per recipient, and every read and every write below is
 * scoped by `recipientId` — so a caller naming somebody else's notification id
 * changes nothing rather than erroring, which is both the quieter and the
 * safer failure. There is no id in this file that is trusted on its own.
 *
 * Shared by the header menu's server actions and by `/api/notifications`, so
 * the scoping rule has one home.
 */

/**
 * A notification's sentence, in the language of this request.
 *
 *   const said = await getNotificationText();
 *   said(row)   // "Ruben moved “Hook” to Printing." / "Ruben a lancé l’impression de « Hook »."
 *
 * Said from its key and values (`notify` in authz.ts stores both), so it is in
 * the reader's language at the time it is read. A row without a key — written
 * before keys were stored — or with a key or values the catalogue cannot use
 * shows its stored `text`, the English it always showed.
 *
 * The JSON API does not go through this: it returns `text`, in English, as it
 * always has (docs/i18n.md).
 */
export async function getNotificationText(): Promise<
  (row: { text: string; messageKey: string | null; messageValues: Prisma.JsonValue | null }) => string
> {
  const t = await getTranslations();
  return ({ text, messageKey, messageValues }) => {
    if (!messageKey?.startsWith("notifications.") || !t.has(messageKey as never)) return text;
    const values = valuesOf(messageValues);
    if (!values) return text;
    const said = t(messageKey as never, values as never) as string;
    // A value the sentence needs and the row lacks is not thrown: next-intl
    // reports it and answers with the key's name. Nobody should read that.
    return said === messageKey ? text : said;
  };
}

/** Stored values back to what a message takes: strings and numbers only. */
function valuesOf(stored: Prisma.JsonValue | null): Record<string, string | number> | null {
  if (stored === null) return {};
  if (typeof stored !== "object" || Array.isArray(stored)) return null;
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(stored)) {
    if (typeof v !== "string" && typeof v !== "number") return null;
    out[k] = v;
  }
  return out;
}

export const NOTIFICATION_FIELDS = {
  id: true,
  storyId: true,
  text: true,
  read: true,
  createdAt: true,
} as const;

export const NOTIFICATION_LIMIT_MAX = 100;

export async function listNotifications(
  actor: Actor,
  opts: { unreadOnly?: boolean; limit?: number } = {},
) {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), NOTIFICATION_LIMIT_MAX);
  const [items, unread] = await Promise.all([
    db.notification.findMany({
      where: { recipientId: actor.id, ...(opts.unreadOnly ? { read: false } : {}) },
      select: NOTIFICATION_FIELDS,
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    db.notification.count({ where: { recipientId: actor.id, read: false } }),
  ]);
  return { items, unread };
}

/**
 * Mark one notification read, or all of them.
 *
 * `updateMany` rather than `update` on purpose: with `recipientId` in the
 * where clause it matches nothing for somebody else's id, where `update`
 * would throw and thereby confirm the row exists.
 */
export async function markNotificationsRead(
  actor: Actor,
  id?: string,
): Promise<number> {
  const { count } = await db.notification.updateMany({
    where: { recipientId: actor.id, read: false, ...(id ? { id } : {}) },
    data: { read: true },
  });
  revalidatePath("/", "layout");
  return count;
}
