import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { record, type AuditAction } from "@/lib/audit";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/scope";
import { hashToken, initialsFor, safeEqual } from "@/lib/tokens";

/**
 * The catalogue, kept in step with a spool inventory.
 *
 * A script next to the inventory (Spoolman, on the owner's network) posts the
 * materials and colours it has spools of; this applies the difference to the
 * catalogue the upload form offers. It does what the owner would do by hand at
 * /admin/catalog, and nothing they could not:
 *
 * - a material or colour that is listed is added, or switched back on;
 * - a solid colour whose hex has changed takes the new hex;
 * - one that is no longer listed is switched off — **never removed**, so
 *   switching a spool back on brings back the same row, and a ticket that
 *   names it is untouched either way (tickets copy the colour when they are
 *   filed);
 * - a listed material keeps, or gets, its "whatever's loaded" choice: the
 *   inventory knows spools, not whether the requester minds which;
 * - a material that is not listed is switched off, its colours left as they
 *   are, so switching it back on restores what it offered.
 *
 * Each change is audited as the owner's, with `via: "catalog-sync"` in its
 * detail, through the same actions the admin forms record. A run that changes
 * nothing records nothing.
 *
 * An empty list is refused rather than applied. An inventory that answers
 * with nothing is far more often an inventory that failed than a shop with no
 * filament left, and applying it would switch the whole catalogue off.
 */

const Name = z.string().trim().min(1).max(40).transform((value) => value.replace(/\s+/g, " "));
const Hex = z.string().regex(/^#[0-9a-f]{6}$/i).transform((value) => value.toLowerCase());

export const SyncSchema = z.object({
  materials: z
    .array(
      z.object({
        name: Name,
        colors: z.array(z.object({ name: Name, hex: Hex })).max(200),
      }),
    )
    .min(1, "An empty list would switch the whole catalogue off; refused.")
    .max(50),
  dryRun: z.boolean().optional().default(false),
});

export type SyncInput = z.infer<typeof SyncSchema>;

export type SyncChange =
  | { change: "material_added" | "material_on" | "material_off"; material: string }
  | { change: "color_added" | "color_on" | "color_off"; material: string; color: string }
  | { change: "color_recoloured"; material: string; color: string; from: string; to: string };

/** The name and swatch a material's "whatever's loaded" choice is given when sync adds one. */
const WHATEVER_NAME = "Whatever's on";
const WHATEVER_HEX = "#b6bcc2";
const WHATEVER_STYLE =
  "linear-gradient(135deg, #e4322f 0%, #f6c945 20%, #43aa8b 40%, #2787c9 60%, #7557c7 80%, #e4328c 100%)";

const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;

/**
 * Whether a bearer token is the one this instance was given for syncing.
 * The environment holds its SHA-256 (`CATALOG_SYNC_TOKEN_HASH`), never the
 * token; unset, the feature is off and the route answers as if absent.
 */
export function catalogSyncEnabled(): boolean {
  return /^[0-9a-f]{64}$/i.test(process.env.CATALOG_SYNC_TOKEN_HASH ?? "");
}

export function catalogSyncTokenMatches(token: string): boolean {
  const expected = (process.env.CATALOG_SYNC_TOKEN_HASH ?? "").toLowerCase();
  if (!catalogSyncEnabled() || !token) return false;
  return safeEqual(hashToken(token), expected);
}

/** The person the changes are recorded as: the instance's first owner. */
export async function catalogSyncActor(): Promise<Actor | null> {
  const owner = await db.user.findFirst({
    where: { role: "admin" },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true },
  });
  if (!owner) return null;
  return { ...owner, initials: initialsFor(owner.name), role: "admin" };
}

/** Work out the changes, and apply them unless `dryRun`. */
export async function syncCatalog(actor: Actor, input: SyncInput): Promise<SyncChange[]> {
  const changes: SyncChange[] = [];
  const audits: { action: AuditAction; subject: string; detail: Record<string, unknown> }[] = [];

  await db.$transaction(async (tx) => {
    const existing = await tx.catalogMaterial.findMany({
      include: { colors: true },
      orderBy: { sortOrder: "asc" },
    });
    let nextMaterialOrder = existing.reduce((max, m) => Math.max(max, m.sortOrder), -1) + 1;
    const listed = new Set<string>();

    for (const wanted of input.materials) {
      let material = existing.find((m) => same(m.name, wanted.name));
      if (listed.has(material?.id ?? wanted.name.toLowerCase())) continue; // listed twice
      if (!material) {
        changes.push({ change: "material_added", material: wanted.name });
        audits.push({ action: "catalog.material_added", subject: wanted.name, detail: {} });
        if (input.dryRun) {
          material = { id: "", name: wanted.name, active: true, sortOrder: nextMaterialOrder, colors: [] } as never;
        } else {
          material = {
            ...(await tx.catalogMaterial.create({ data: { name: wanted.name, sortOrder: nextMaterialOrder } })),
            colors: [],
          };
        }
        nextMaterialOrder++;
      } else if (!material.active) {
        changes.push({ change: "material_on", material: material.name });
        audits.push({
          action: "catalog.material_availability_changed",
          subject: material.name,
          detail: { active: true },
        });
        if (!input.dryRun) await tx.catalogMaterial.update({ where: { id: material.id }, data: { active: true } });
      }
      const m = material!;
      listed.add(m.id || wanted.name.toLowerCase());

      let nextColorOrder = m.colors.reduce((max, c) => Math.max(max, c.sortOrder), -1) + 1;
      const kept = new Set<string>();
      for (const color of wanted.colors) {
        const row = m.colors.find((c) => same(c.name, color.name));
        if (row && kept.has(row.id)) continue;
        if (!row) {
          changes.push({ change: "color_added", material: m.name, color: color.name });
          audits.push({
            action: "catalog.color_added",
            subject: `${m.name} · ${color.name}`,
            detail: { hex: color.hex, style: color.hex, mode: "solid" },
          });
          if (!input.dryRun) {
            await tx.catalogColor.create({
              data: { materialId: m.id, name: color.name, hex: color.hex, style: color.hex, mode: "solid", sortOrder: nextColorOrder },
            });
          }
          nextColorOrder++;
          continue;
        }
        kept.add(row.id);
        if (!row.active) {
          changes.push({ change: "color_on", material: m.name, color: row.name });
          audits.push({
            action: "catalog.color_availability_changed",
            subject: `${m.name} · ${row.name}`,
            detail: { active: true },
          });
          if (!input.dryRun) await tx.catalogColor.update({ where: { id: row.id }, data: { active: true } });
        }
        if (row.mode === "solid" && row.hex !== color.hex) {
          changes.push({ change: "color_recoloured", material: m.name, color: row.name, from: row.hex, to: color.hex });
          audits.push({
            action: "catalog.color_updated",
            subject: `${m.name} · ${row.name}`,
            detail: { hex: { from: row.hex, to: color.hex } },
          });
          if (!input.dryRun) {
            await tx.catalogColor.update({ where: { id: row.id }, data: { hex: color.hex, style: color.hex } });
          }
        }
      }

      for (const row of m.colors) {
        if (kept.has(row.id)) continue;
        if (row.mode === "whatever") {
          kept.add(row.id);
          if (row.active) continue;
          changes.push({ change: "color_on", material: m.name, color: row.name });
          audits.push({
            action: "catalog.color_availability_changed",
            subject: `${m.name} · ${row.name}`,
            detail: { active: true },
          });
          if (!input.dryRun) await tx.catalogColor.update({ where: { id: row.id }, data: { active: true } });
        } else if (row.active) {
          changes.push({ change: "color_off", material: m.name, color: row.name });
          audits.push({
            action: "catalog.color_availability_changed",
            subject: `${m.name} · ${row.name}`,
            detail: { active: false },
          });
          if (!input.dryRun) await tx.catalogColor.update({ where: { id: row.id }, data: { active: false } });
        }
      }

      if (!m.colors.some((c) => c.mode === "whatever") && !wanted.colors.some((c) => same(c.name, WHATEVER_NAME))) {
        changes.push({ change: "color_added", material: m.name, color: WHATEVER_NAME });
        audits.push({
          action: "catalog.color_added",
          subject: `${m.name} · ${WHATEVER_NAME}`,
          detail: { hex: WHATEVER_HEX, style: WHATEVER_STYLE, mode: "whatever" },
        });
        if (!input.dryRun) {
          await tx.catalogColor.create({
            data: {
              materialId: m.id,
              name: WHATEVER_NAME,
              hex: WHATEVER_HEX,
              style: WHATEVER_STYLE,
              mode: "whatever",
              sortOrder: nextColorOrder,
            },
          });
        }
      }
    }

    for (const material of existing) {
      if (listed.has(material.id) || !material.active) continue;
      changes.push({ change: "material_off", material: material.name });
      audits.push({
        action: "catalog.material_availability_changed",
        subject: material.name,
        detail: { active: false },
      });
      if (!input.dryRun) await tx.catalogMaterial.update({ where: { id: material.id }, data: { active: false } });
    }
  });

  if (!input.dryRun && changes.length > 0) {
    for (const audit of audits) {
      await record({ action: audit.action, actor, subject: audit.subject, detail: { ...audit.detail, via: "catalog-sync" } });
    }
    revalidatePath("/admin/catalog");
    revalidatePath("/upload");
  }
  return changes;
}
