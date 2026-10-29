"use server";

import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/authz";
import { requireFreshAuth } from "@/lib/reauth";
import { SettingsProblem, saveSettings } from "@/lib/settings-admin";
import { SetupProblem, completeSetup, sendTestMail } from "@/lib/setup-admin";
import { nextStep, stepFrom, type SetupStep } from "@/lib/setup";

/**
 * The first-run setup's forms. Plain server actions that read the `FormData`,
 * call the operation and redirect, like the settings screen — so every step
 * works with JavaScript off. Every one re-checks the role first: rendering
 * the page is not authorisation, and `requireAdmin` answers a client 404.
 */

function to(step: SetupStep, params: Record<string, string> = {}): never {
  redirect(`/admin/setup?${new URLSearchParams({ step, ...params }).toString()}`);
}

/**
 * A step that sets instance defaults — the language and look, or the
 * slicer. The same call as /admin/settings, behind the same gate: what may
 * be saved, what the environment locks, the audit line, all decided once in
 * `saveSettings`. A crafted post that adds any other setting is held to the
 * same rules as it would be there, because it is the same function.
 *
 * The re-auth comes back to this step, not the settings page: the form has
 * to be filled in again either way, and it should be this one.
 */
export async function saveSetupStepAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const step = stepFrom(formData.get("step"));
  await requireFreshAuth(`/admin/setup?step=${step}`);
  try {
    const changed = await saveSettings(admin, formData);
    to(nextStep(step) ?? step, { saved: changed.length > 0 ? "1" : "0" });
  } catch (error) {
    if (error instanceof SettingsProblem) to(step, { error: error.message });
    throw error;
  }
}

/**
 * "Send me a test message". No re-auth: it writes to the owner's own
 * address and to nobody else, so a borrowed session gets a message sent to
 * the person it was borrowed from. The limit and the trail are in
 * `sendTestMail`.
 */
export async function sendTestMailAction(): Promise<void> {
  const admin = await requireAdmin();
  try {
    await sendTestMail(admin);
    to("mail", { sent: "1" });
  } catch (error) {
    if (error instanceof SetupProblem) {
      to("mail", { problem: error.code, ...(error.detail ? { code: error.detail } : {}) });
    }
    throw error;
  }
}

/**
 * Finish from the last step, or skip from any. Either way the setup stops
 * opening by itself; it is still at /admin/settings. Where to go next is one
 * of two places, picked by name rather than taken from the form, so the
 * button cannot be made to redirect anywhere else.
 */
export async function finishSetupAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const how = formData.get("how") === "skipped" ? "skipped" : "finished";
  await completeSetup(admin, how, stepFrom(formData.get("step")));
  redirect(formData.get("then") === "invites" ? "/admin/invites" : "/queue");
}
