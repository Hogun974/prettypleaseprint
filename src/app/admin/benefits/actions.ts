"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { say } from "@/i18n/spoken";
import { requireAdmin } from "@/lib/authz";
import { BenefitProblem, createBenefit, updateBenefit } from "@/lib/benefits";

/**
 * The owner's controls for the benefits catalogue, as plain server-action
 * forms — the rules and the audit live in `src/lib/benefits.ts`; this reads a
 * `FormData`, calls the operation and redirects with a toast. Every action
 * re-checks the role: rendering the page is not authorisation.
 *
 * The toast and the refusal travel in the query string as sentences, in the
 * language of the request that made them, as they did in English before.
 */

function back(params: Record<string, string>): never {
  redirect(`/admin/benefits?${new URLSearchParams(params).toString()}`);
}

/** Back with the refusal said in the reader's language, or rethrow. */
async function refused(error: unknown): Promise<never> {
  if (error instanceof BenefitProblem) back({ error: await say(error) });
  throw error;
}

export async function createBenefitAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const t = await getTranslations("admin.benefits.toast");
  try {
    const b = await createBenefit(admin, formData.get("label") ?? "");
    back({ toast: t("added", { label: b.label }) });
  } catch (error) {
    await refused(error);
  }
}

export async function renameBenefitAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const t = await getTranslations("admin.benefits.toast");
  const id = String(formData.get("id") ?? "");
  try {
    const b = await updateBenefit(admin, id, { label: formData.get("label") ?? "" });
    back({ toast: t("renamed", { label: b.label }) });
  } catch (error) {
    await refused(error);
  }
}

export async function setPreferredAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const t = await getTranslations("admin.benefits.toast");
  const id = String(formData.get("id") ?? "");
  const preferred = formData.get("preferred") === "true";
  try {
    const b = await updateBenefit(admin, id, { preferred });
    back({ toast: t(preferred ? "preferred" : "notPreferred", { label: b.label }) });
  } catch (error) {
    await refused(error);
  }
}

export async function setActiveAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const t = await getTranslations("admin.benefits.toast");
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "true";
  try {
    const b = await updateBenefit(admin, id, { active });
    back({ toast: t(active ? "restored" : "retired", { label: b.label }) });
  } catch (error) {
    await refused(error);
  }
}
