"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getTranslations } from "next-intl/server";

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/authz";
import { record } from "@/lib/audit";
import { COLOR_MODES } from "@/lib/catalog";

const Name = z.string().trim().min(1).max(40).transform((value) => value.replace(/\s+/g, " "));
const Hex = z.string().regex(/^#[0-9a-f]{6}$/i).transform((value) => value.toLowerCase());
/**
 * What a "whatever" colour stands for where a single colour is needed: the
 * 3D viewer and the audit tally. A neutral grey, because the colour is by
 * definition not known yet. The rainbow is the swatch, not the model.
 */
const WHATEVER_HEX = "#b6bcc2";
const WHATEVER_STYLE = "linear-gradient(135deg, #e4322f 0%, #f6c945 20%, #43aa8b 40%, #2787c9 60%, #7557c7 80%, #e4328c 100%)";
const Direction = z.enum(["up", "down"]);
const Mode = z.enum(COLOR_MODES);

async function colorInput(formData: FormData) {
  const p = await getTranslations("problems.catalog");
  const parsedName = Name.safeParse(formData.get("name"));
  if (!parsedName.success) back("error", p("colourName"));
  const name = parsedName.data;
  const parsedMode = Mode.safeParse(formData.get("mode"));
  if (!parsedMode.success) back("error", p("swatch"));
  const mode = parsedMode.data;
  const parsedHex = mode === "whatever" ? null : Hex.safeParse(formData.get("hex"));
  const parsedHexTo = mode !== "gradient" ? null : Hex.safeParse(formData.get("hexTo"));
  if (parsedHex && !parsedHex.success) back("error", p("colour"));
  if (parsedHexTo && !parsedHexTo.success) back("error", p("secondColour"));
  const hex = mode === "whatever" ? WHATEVER_HEX : parsedHex!.data;
  const style = mode === "whatever"
    ? WHATEVER_STYLE
    : mode === "gradient"
      ? `linear-gradient(135deg, ${hex}, ${parsedHexTo!.data})`
      : hex;
  return { name, hex, style, mode };
}

/**
 * The toast and the refusal travel in the query string as sentences, in the
 * language of the request that made them — as they did in English before.
 */
function translators() {
  return Promise.all([getTranslations("admin.catalog.done"), getTranslations("problems.catalog")]);
}

function back(kind: "toast" | "error", message: string): never {
  redirect(`/admin/catalog?${kind}=${encodeURIComponent(message)}`);
}

function duplicate(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function addMaterialAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const [t, p] = await translators();
  const parsed = Name.safeParse(formData.get("name"));
  if (!parsed.success) back("error", p("materialName"));

  const last = await db.catalogMaterial.aggregate({ _max: { sortOrder: true } });
  try {
    await db.catalogMaterial.create({
      data: { name: parsed.data, sortOrder: (last._max.sortOrder ?? -1) + 1 },
    });
  } catch (error) {
    if (duplicate(error)) back("error", p("materialTaken", { name: parsed.data }));
    throw error;
  }
  await record({ action: "catalog.material_added", actor: admin, subject: parsed.data });
  revalidatePath("/admin/catalog");
  revalidatePath("/upload");
  back("toast", t("materialAdded", { name: parsed.data }));
}

export async function toggleMaterialAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const [t, p] = await translators();
  const id = String(formData.get("id") ?? "");
  const material = await db.catalogMaterial.findUnique({ where: { id } });
  if (!material) back("error", p("materialGone"));
  const updated = await db.catalogMaterial.update({
    where: { id },
    data: { active: !material.active },
  });
  await record({
    action: "catalog.material_availability_changed",
    actor: admin,
    subject: material.name,
    detail: { active: updated.active },
  });
  revalidatePath("/admin/catalog");
  revalidatePath("/upload");
  back("toast", t(updated.active ? "materialOn" : "materialOff", { name: material.name }));
}

export async function editMaterialAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const [t, p] = await translators();
  const id = String(formData.get("id") ?? "");
  const parsedName = Name.safeParse(formData.get("name"));
  if (!parsedName.success) back("error", p("materialName"));
  const material = await db.catalogMaterial.findUnique({ where: { id }, select: { name: true } });
  if (!material) back("error", p("materialGone"));
  try {
    await db.catalogMaterial.update({ where: { id }, data: { name: parsedName.data } });
  } catch (error) {
    if (duplicate(error)) back("error", p("materialTaken", { name: parsedName.data }));
    throw error;
  }
  await record({
    action: "catalog.material_updated",
    actor: admin,
    subject: parsedName.data,
    detail: { previousName: material.name },
  });
  revalidatePath("/admin/catalog");
  revalidatePath("/upload");
  back("toast", t("materialRenamed", { from: material.name, to: parsedName.data }));
}

export async function removeMaterialAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const [t, p] = await translators();
  const id = String(formData.get("id") ?? "");
  const material = await db.catalogMaterial.findUnique({
    where: { id },
    select: { name: true, _count: { select: { colors: true } } },
  });
  if (!material) back("error", p("materialGone"));
  await db.catalogMaterial.delete({ where: { id } });
  await record({
    action: "catalog.material_removed",
    actor: admin,
    subject: material.name,
    detail: { colorsRemoved: material._count.colors },
  });
  revalidatePath("/admin/catalog");
  revalidatePath("/upload");
  back("toast", t("materialRemoved", { name: material.name }));
}

export async function moveMaterialAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const [t, p] = await translators();
  const id = String(formData.get("id") ?? "");
  const parsedDirection = Direction.safeParse(formData.get("direction"));
  if (!parsedDirection.success) back("error", p("direction"));

  const materials = await db.catalogMaterial.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
  const from = materials.findIndex((material) => material.id === id);
  if (from < 0) back("error", p("materialGone"));
  const to = parsedDirection.data === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= materials.length) back("error", p("materialAtEnd"));
  [materials[from], materials[to]] = [materials[to], materials[from]];
  await db.$transaction(
    materials.map((material, sortOrder) => db.catalogMaterial.update({
      where: { id: material.id },
      data: { sortOrder },
    })),
  );
  await record({
    action: "catalog.material_reordered",
    actor: admin,
    subject: materials[to].name,
    detail: { direction: parsedDirection.data, position: to + 1 },
  });
  revalidatePath("/admin/catalog");
  revalidatePath("/upload");
  back("toast", t(parsedDirection.data === "up" ? "materialUp" : "materialDown", { name: materials[to].name }));
}

export async function addColorAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const [t, p] = await translators();
  const materialId = String(formData.get("materialId") ?? "");
  const { name, hex, style, mode } = await colorInput(formData);

  const material = await db.catalogMaterial.findUnique({
    where: { id: materialId },
    include: { colors: { select: { sortOrder: true } } },
  });
  if (!material) back("error", p("materialGone"));
  const sortOrder = material.colors.reduce((max, color) => Math.max(max, color.sortOrder), -1) + 1;
  try {
    await db.catalogColor.create({
      data: { materialId, name, hex, style, mode, sortOrder },
    });
  } catch (error) {
    if (duplicate(error)) back("error", p("colourTaken", { material: material.name, name }));
    throw error;
  }
  await record({
    action: "catalog.color_added",
    actor: admin,
    subject: `${material.name} · ${name}`,
    detail: { hex, style, mode },
  });
  revalidatePath("/admin/catalog");
  revalidatePath("/upload");
  back("toast", t("colourAdded", { name, material: material.name }));
}

export async function editColorAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const [t, p] = await translators();
  const id = String(formData.get("id") ?? "");
  const { name, hex, style, mode } = await colorInput(formData);
  const color = await db.catalogColor.findUnique({
    where: { id },
    include: { material: { select: { name: true } } },
  });
  if (!color) back("error", p("colourGone"));
  try {
    await db.catalogColor.update({ where: { id }, data: { name, hex, style, mode } });
  } catch (error) {
    if (duplicate(error)) back("error", p("colourTaken", { material: color.material.name, name }));
    throw error;
  }
  await record({
    action: "catalog.color_updated",
    actor: admin,
    subject: `${color.material.name} · ${name}`,
    detail: { previousName: color.name, previousStyle: color.style, previousMode: color.mode, hex, style, mode },
  });
  revalidatePath("/admin/catalog");
  revalidatePath("/upload");
  back("toast", t("colourUpdated", { name, material: color.material.name }));
}

export async function toggleColorAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const [t, p] = await translators();
  const id = String(formData.get("id") ?? "");
  const color = await db.catalogColor.findUnique({
    where: { id },
    include: { material: { select: { name: true } } },
  });
  if (!color) back("error", p("colourGone"));
  const updated = await db.catalogColor.update({
    where: { id },
    data: { active: !color.active },
  });
  await record({
    action: "catalog.color_availability_changed",
    actor: admin,
    subject: `${color.material.name} · ${color.name}`,
    detail: { active: updated.active, hex: color.hex },
  });
  revalidatePath("/admin/catalog");
  revalidatePath("/upload");
  back("toast", t(updated.active ? "colourOn" : "colourOff", { name: color.name, material: color.material.name }));
}

export async function removeColorAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const [t, p] = await translators();
  const id = String(formData.get("id") ?? "");
  const color = await db.catalogColor.findUnique({
    where: { id },
    include: { material: { select: { name: true } } },
  });
  if (!color) back("error", p("colourGone"));
  await db.catalogColor.delete({ where: { id } });
  await record({
    action: "catalog.color_removed",
    actor: admin,
    subject: `${color.material.name} · ${color.name}`,
    detail: { hex: color.hex, style: color.style },
  });
  revalidatePath("/admin/catalog");
  revalidatePath("/upload");
  back("toast", t("colourRemoved", { name: color.name, material: color.material.name }));
}

export async function moveColorAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const [t, p] = await translators();
  const id = String(formData.get("id") ?? "");
  const parsedDirection = Direction.safeParse(formData.get("direction"));
  if (!parsedDirection.success) back("error", p("direction"));

  const selected = await db.catalogColor.findUnique({
    where: { id },
    select: { materialId: true, material: { select: { name: true } } },
  });
  if (!selected) back("error", p("colourGone"));
  const colors = await db.catalogColor.findMany({
    where: { materialId: selected.materialId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
  const from = colors.findIndex((color) => color.id === id);
  const to = parsedDirection.data === "up" ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= colors.length) back("error", p("colourAtEnd"));
  [colors[from], colors[to]] = [colors[to], colors[from]];
  await db.$transaction(
    colors.map((color, sortOrder) => db.catalogColor.update({
      where: { id: color.id },
      data: { sortOrder },
    })),
  );
  await record({
    action: "catalog.color_reordered",
    actor: admin,
    subject: `${selected.material.name} · ${colors[to].name}`,
    detail: { direction: parsedDirection.data, position: to + 1 },
  });
  revalidatePath("/admin/catalog");
  revalidatePath("/upload");
  back("toast", t(parsedDirection.data === "up" ? "colourUp" : "colourDown", { name: colors[to].name, material: selected.material.name }));
}
