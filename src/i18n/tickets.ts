import "server-only";
import { getLocale, getTranslations } from "next-intl/server";
import type { StoryStatus } from "@prisma/client";

import { formatBytes } from "@/lib/upload-limits";
import { getRelativeTime } from "./server";

const STATUSES: readonly string[] = ["Requested", "Accepted", "Printing", "Delivery", "Done", "Declined"] satisfies StoryStatus[];

/**
 * The words every screen of the print-request track says about a ticket, in
 * this request's language:
 *
 *   const words = await getTicketWords();
 *   words.status("Printing")   // "Printing" / "En impression"
 *   words.quantity(4)          // "4 prints" / "4 exemplaires"
 *   words.bytes(2_400_000)     // "2.3 MB"   / "2,3 Mo"
 *   words.ago(story.createdAt) // "3 hours ago" / "il y a 3 heures"
 *
 * The English helpers they stand for (`quantityText`, `formatBytes`,
 * `relativeTime`) are unchanged and stay what the API and the logs use.
 * Server only: a client component is handed the words, or the locale.
 */
export async function getTicketWords() {
  const [t, ago, locale] = await Promise.all([getTranslations("common"), getRelativeTime(), getLocale()]);
  return {
    locale,
    /** A status's name; anything that is not a print status is shown as it is. */
    status: (status: string) => (STATUSES.includes(status) ? t(`status.${status as StoryStatus}`) : status),
    quantity: (count: number) => t("quantity", { count }),
    /** A ticket's priority, as the chip and the form name it. */
    priority: (priority: string) =>
      priority === "low" || priority === "medium" || priority === "high"
        ? t(`priority.${priority}`)
        : priority,
    bytes: (n: number) => formatBytes(n, locale),
    ago,
  };
}
