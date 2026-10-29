"use server";

import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { safeRedirectPath } from "@/lib/safe-redirect";

import { requireAdmin, requireUser } from "@/lib/authz";
import {
  FeatureProblem,
  addFeatureComment as postComment,
  advanceFeature as advance,
  changeFeaturePriority as reprioritise,
  createFeature as create,
  declineFeature as decline,
  featureIdOr400,
  withdrawFeature as withdraw,
} from "@/lib/features";
import { say } from "@/i18n/spoken";

/**
 * The feature-request forms, as plain server actions.
 *
 * Adapters, exactly like `src/app/actions/stories.ts`: the rules live in
 * `src/lib/features.ts`; this reads a `FormData`, calls the operation, and
 * turns the outcome into a redirect with a toast. Everything works with
 * JavaScript off.
 *
 * The toast and the refusal travel in the URL as finished sentences, so they
 * are written here in the language of the person who pressed the button.
 */

function back(to: string, params: Record<string, string>): never {
  redirect(`${to}?${new URLSearchParams(params).toString()}`);
}

/** A same-origin absolute path from the form, or a fallback. Open-redirect guard. */
function safeFrom(from: FormDataEntryValue | null, fallback: string): string {
  return safeRedirectPath(from, fallback);
}

/** File a new request, then land on its detail page. */
export async function createFeature(formData: FormData): Promise<void> {
  const user = await requireUser();
  try {
    const feature = await create(user, {
      title: formData.get("title") ?? "",
      description: formData.get("description") ?? "",
      priority: formData.get("priority") ?? "medium",
      category: formData.get("category") ?? "other",
    });
    back(`/frr/${feature.id}`, { sent: "1" });
  } catch (error) {
    if (error instanceof FeatureProblem) back("/frr/new", { error: await say(error) });
    throw error;
  }
}

async function ownerStep(
  formData: FormData,
  op: (id: number) => Promise<{ toast: string }>,
): Promise<never> {
  const from = safeFrom(formData.get("from"), "/frr/queue");
  try {
    const id = featureIdOr400(formData.get("id"));
    const { toast } = await op(id);
    back(from, { toast });
  } catch (error) {
    if (error instanceof FeatureProblem) back(from, { error: await say(error) });
    throw error;
  }
}

export async function advanceFeature(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  await ownerStep(formData, async (id) => {
    const done = await advance(admin, id);
    const t = await getTranslations("frr");
    return {
      toast: t("toast.advanced", {
        title: done.title,
        status: t(`status.${done.to}`),
        name: done.requesterName,
      }),
    };
  });
}

export async function declineFeature(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  await ownerStep(formData, async (id) => {
    const done = await decline(admin, id);
    const t = await getTranslations("frr.toast");
    return { toast: t("declined", { name: done.requesterName }) };
  });
}

/** The requester takes their own back; lands on the board. */
export async function withdrawFeature(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = featureIdOr400(formData.get("id"));
  try {
    const done = await withdraw(user, id);
    const t = await getTranslations("frr.toast");
    back("/frr", { toast: t("withdrawn", { ref: done.ref }) });
  } catch (error) {
    if (error instanceof FeatureProblem) back(`/frr/${id}`, { toast: await say(error) });
    throw error;
  }
}

/**
 * Change a request's priority. Open to the requester (own, still live) and the
 * owner; the service decides. Lands back where the form was posted from.
 */
export async function changeFeaturePriority(formData: FormData): Promise<void> {
  const user = await requireUser();
  const from = safeFrom(formData.get("from"), "/frr");
  const id = featureIdOr400(formData.get("id"));
  try {
    const done = await reprioritise(user, id, formData.get("priority") ?? "");
    const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
    // The chip's word, lower-cased for the middle of a sentence: "high" in
    // English, exactly as before, and "haute" in French.
    const priority = t(`common.priority.${done.to as "high" | "medium" | "low"}`).toLocaleLowerCase(locale);
    back(from, {
      toast: done.unchanged
        ? t("frr.toast.priorityUnchanged", { priority })
        : t("frr.toast.priorityChanged", { priority }),
    });
  } catch (error) {
    if (error instanceof FeatureProblem) back(from, { error: await say(error) });
    throw error;
  }
}

/** Say something on a request. */
export async function addFeatureComment(formData: FormData): Promise<void> {
  const actor = await requireUser();
  const id = featureIdOr400(formData.get("featureId"));
  try {
    await postComment(actor, id, formData.get("body") ?? "");
  } catch (error) {
    if (error instanceof FeatureProblem) {
      if (error.status === 404) redirect("/frr");
      back(`/frr/${id}`, { error: await say(error) });
    }
    throw error;
  }
  const t = await getTranslations("frr.toast");
  back(`/frr/${id}`, { toast: t("sent") });
}
