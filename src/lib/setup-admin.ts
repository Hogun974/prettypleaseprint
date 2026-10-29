import "server-only";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import { record } from "@/lib/audit";
import { mailTransport, sendMail, testEmail } from "@/lib/email";
import type { Actor } from "@/lib/scope";
import type { SetupStep } from "@/lib/setup";

/**
 * The two things the first-run setup does that the settings page does not:
 * mark the setup as behind the instance, and send the owner a test message.
 * The steps that change a setting call `saveSettings` instead, so there is
 * one write path for settings whichever door they come through.
 *
 * Guarded and separate from `setup.ts` for the reason `settings-admin.ts` is
 * separate from `settings.ts`: these write the audit trail, which is
 * `server-only`, and the rules beside them must stay importable by a suite.
 */

/**
 * A refusal the page can explain. The code picks the sentence, in the
 * reader's language; nothing the transport said is put in front of the owner
 * except a nodemailer error code, which never carries a credential.
 */
export class SetupProblem extends Error {
  constructor(
    readonly code: "noTransport" | "tooMany" | "refused",
    readonly detail?: string,
  ) {
    super(`setup: ${code}${detail ? ` (${detail})` : ""}`);
    this.name = "SetupProblem";
  }
}

function assertAdmin(actor: Actor) {
  // The actions answer 404 before this; this is for a caller that forgot.
  if (actor.role !== "admin") throw new Error("Only the printer owner runs the setup.");
}

/**
 * At most this many test messages per owner in this many minutes, whatever
 * became of them.
 *
 * The button only ever writes to the owner's own address, so this is not
 * about who receives them: it is about a relay that counts messages, a Resend
 * plan with a daily quota, and a mail host that greylists a sender who sends
 * the same thing ten times in a minute. Three is enough to try, change
 * something in `.env.docker`, restart and try again.
 *
 * Counted from the audit trail rather than a table of its own: every attempt
 * writes a line there anyway, and a limit read from the trail cannot disagree
 * with it. Two presses in the same instant could both pass the count; for a
 * button only the owner has, that is two messages to themselves.
 */
export const TEST_MAIL_LIMIT = { count: 3, minutes: 15 } as const;

/**
 * Send one test message, to the signed-in owner's own address — the one on
 * their account, never one from the form, so the button cannot be turned
 * into a way to mail somebody else.
 *
 * Every attempt is in the trail as `mail.test_sent`, with the transport's
 * kind and how it went; never its address or credentials.
 */
export async function sendTestMail(actor: Actor): Promise<void> {
  assertAdmin(actor);
  const transport = mailTransport();
  if (transport === "none") throw new SetupProblem("noTransport");

  const recent = await db.auditEvent.count({
    where: {
      action: "mail.test_sent",
      actorId: actor.id,
      at: { gt: new Date(Date.now() - TEST_MAIL_LIMIT.minutes * 60_000) },
    },
  });
  if (recent >= TEST_MAIL_LIMIT.count) throw new SetupProblem("tooMany");

  try {
    await sendMail(testEmail({ to: actor.email }));
  } catch (error) {
    // The whole error goes to the log for whoever runs the host; the page
    // gets a code at most. A transport's message can quote its own URL.
    console.error("[setup] the test message was refused", error);
    const code = (error as { code?: unknown }).code;
    const safe = typeof code === "string" && /^[A-Z][A-Z0-9_]{1,31}$/.test(code) ? code : undefined;
    await record({
      action: "mail.test_sent",
      actor,
      subject: actor.email,
      detail: { transport, delivered: false, ...(safe ? { code: safe } : {}) },
    });
    throw new SetupProblem("refused", safe);
  }
  await record({ action: "mail.test_sent", actor, subject: actor.email, detail: { transport, delivered: true } });
}

/**
 * Mark the setup as behind this instance: finished from its last step, or
 * skipped from any of them. Says whether this call was the one that did it.
 *
 * Only ever from null to now, in one statement, so the date is the first
 * time it ended and two presses record it once. Going through it again from
 * /admin/settings later changes nothing here. The row may not exist yet on a
 * fresh install; the insert gives it every setting at its default, which is
 * what no row meant.
 */
export async function completeSetup(
  actor: Actor,
  how: "finished" | "skipped",
  step: SetupStep,
): Promise<boolean> {
  assertAdmin(actor);
  const marked = await db.$executeRaw`
    INSERT INTO "instanceSettings" ("id", "updatedAt", "setupCompletedAt")
    VALUES (1, now(), now())
    ON CONFLICT ("id") DO UPDATE SET "setupCompletedAt" = now()
      WHERE "instanceSettings"."setupCompletedAt" IS NULL`;
  if (marked === 0) return false;

  await record({ action: "setup.completed", actor, subject: how, detail: { how, step } });
  revalidatePath("/");
  return true;
}
