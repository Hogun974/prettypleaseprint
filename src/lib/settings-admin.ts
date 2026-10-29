import "server-only";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import { record } from "@/lib/audit";
import type { Actor } from "@/lib/scope";
import type { Spoken } from "@/i18n/spoken";
import { SETTINGS, parseSettingsForm, type SettingKey } from "@/lib/settings";

/**
 * The owner's write path for instance settings — the half of
 * `src/lib/settings.ts` that changes something, and so the half that checks
 * the role and writes the audit trail.
 *
 * Separate from the reads because those must stay importable outside a
 * request (see the note at the top of `settings.ts`), and the trail is
 * `server-only`. The rules are the same ones the page renders from: what a
 * field may hold and whether the environment locks it are decided in
 * `parseSettingsForm`, once.
 */

/**
 * `message` is English; `spoken`, when there is one, is the key of the same
 * sentence, for the page to say in the reader's language (src/i18n/spoken.ts).
 */
export class SettingsProblem extends Error {
  constructor(
    message: string,
    readonly spoken?: Spoken,
  ) {
    super(message);
    this.name = "SettingsProblem";
  }
}

function assertAdmin(actor: Actor) {
  if (actor.role !== "admin") {
    throw new SettingsProblem("Only the printer owner changes the settings.", {
      key: "problems.settings.ownerOnly",
    });
  }
}

type Change = { from: string | null; to: string | null };

/**
 * Save what the form sent, and say which settings it changed.
 *
 * The row is created if it is missing and locked before it is read, inside
 * one transaction, so the `from` the trail records is the value this save
 * actually replaced — two saves cannot both read the same "before". Nothing
 * that is unchanged is written or recorded, so saving an untouched form is a
 * no-op rather than a line in the trail.
 *
 * The trail gets the stored text, old and new, null meaning "not set here".
 * No setting is a secret, and none may become one: a credential belongs in
 * the environment, where this page cannot show or record it.
 */
export async function saveSettings(actor: Actor, form: FormData): Promise<SettingKey[]> {
  assertAdmin(actor);

  const parsed = parseSettingsForm(form, process.env);
  if ("problem" in parsed) throw new SettingsProblem(parsed.problem, parsed.spoken);

  const detail: Partial<Record<SettingKey, Change>> = await db.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO "instanceSettings" ("id", "updatedAt") VALUES (1, now()) ON CONFLICT ("id") DO NOTHING`;
    await tx.$queryRaw`SELECT "id" FROM "instanceSettings" WHERE "id" = 1 FOR UPDATE`;
    const before = await tx.instanceSettings.findUniqueOrThrow({ where: { id: 1 } });

    const changed: Partial<Record<SettingKey, Change>> = {};
    for (const [key, to] of Object.entries(parsed.changes) as Array<[SettingKey, string | null]>) {
      const from = before[key] ?? null;
      if (from !== to) changed[key] = { from, to };
    }
    if (Object.keys(changed).length > 0) {
      await tx.instanceSettings.update({
        where: { id: 1 },
        data: Object.fromEntries(Object.entries(changed).map(([key, c]) => [key, c!.to])),
      });
    }
    return changed;
  });

  const keys = Object.keys(detail) as SettingKey[];
  if (keys.length === 0) return [];

  // After the commit, so the trail cannot claim a change that rolled back.
  await record({
    action: "settings.changed",
    actor,
    subject: keys.map((key) => SETTINGS[key].label).join(", "),
    detail,
  });
  revalidatePath("/admin/settings");
  revalidatePath("/upload");
  // The defaults reach every page: the theme and the language are decided in
  // the root layout.
  revalidatePath("/", "layout");
  return keys;
}
