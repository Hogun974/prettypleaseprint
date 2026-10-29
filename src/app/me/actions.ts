"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { parsePreferencesForm } from "@/lib/preferences";

/**
 * Save the signed-in person's language, theme and slicer, from the plain form
 * on /me — owner and invited members alike, each for themselves.
 *
 * Whose row is decided here and only here: the session's. Rendering /me is not
 * authorisation, so the session is read again, and nothing in the form names
 * a person — an id added to a forged form is never read. `verify:preferences`
 * posts one and checks the other person's row did not move.
 *
 * No fresh sign-in, unlike the owner's settings. These change how this one
 * person's own pages look and speak, and nothing anybody else sees or the
 * server does; a stolen twenty minutes that switched someone's theme would
 * have gained nothing the session did not already give. Nor an audit row, for
 * the same reason: the trail is for what changes access or the instance.
 */
export async function savePreferencesAction(formData: FormData): Promise<void> {
  const user = await requireUser("/me");

  const parsed = parsePreferencesForm(formData);
  if ("problem" in parsed) redirect("/me?preferences=refused#preferences");

  await db.user.update({ where: { id: user.id }, data: parsed.changes });

  // Every page: the theme and the language are in the root layout.
  revalidatePath("/", "layout");
  redirect("/me?preferences=saved#preferences");
}
