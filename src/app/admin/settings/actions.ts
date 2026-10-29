"use server";

import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/authz";
import { requireFreshAuth } from "@/lib/reauth";
import { SettingsProblem, saveSettings } from "@/lib/settings-admin";

/**
 * Save the instance settings, as a plain server-action form — the rules and
 * the audit live in `src/lib/settings-admin.ts`; this reads the `FormData`,
 * calls the operation and redirects with a toast, as the benefits screen does.
 */

function back(params: Record<string, string>): never {
  redirect(`/admin/settings?${new URLSearchParams(params).toString()}`);
}

export async function saveSettingsAction(formData: FormData): Promise<void> {
  // Every action re-checks the role. Rendering the page is not authorisation.
  const admin = await requireAdmin();
  // Gated like the invite actions, unlike benefits and the catalogue: these
  // change what the server does for everybody, not what a form offers.
  // Switching importing on has the server fetch from a third party on any
  // signed-in person's say-so, and the sender name is what every invitation
  // and reset link arrives signed with — a name people are asked to trust
  // enough to click. Both outlive a stolen twenty minutes. The defaults for
  // language, theme and slicer ride the same form and so the same gate; on
  // their own they would not need it (see the /me action, which has none).
  await requireFreshAuth("/admin/settings");
  try {
    const changed = await saveSettings(admin, formData);
    back({
      toast: changed.length > 0 ? "Saved — in effect from the next request" : "Nothing to change",
    });
  } catch (error) {
    if (error instanceof SettingsProblem) back({ error: error.message });
    throw error;
  }
}
