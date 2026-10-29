import { fail, ok } from "@/lib/api";
import {
  SyncSchema,
  catalogSyncActor,
  catalogSyncEnabled,
  catalogSyncTokenMatches,
  syncCatalog,
} from "@/lib/catalog-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/catalog/sync — the catalogue follows a spool inventory.
 *
 * Not a session route: a script on the owner's network calls it on a timer,
 * with `Authorization: Bearer <token>`, the token whose SHA-256 is
 * `CATALOG_SYNC_TOKEN_HASH`. Without that variable the route does not exist
 * (404), which is how an instance that never asked for it stays as it was.
 * What it may change, and what it never does: src/lib/catalog-sync.ts.
 *
 *   { "materials": [{ "name": "PLA", "colors": [{ "name": "Rouge", "hex": "#ff0000" }] }],
 *     "dryRun": true }
 *   → { "changes": [...], "applied": false }
 */
export async function POST(request: Request): Promise<Response> {
  if (!catalogSyncEnabled()) return fail(404, "Not found.");

  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!catalogSyncTokenMatches(token)) return fail(401, "That token is not this instance's sync token.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Send the inventory as JSON.");
  }
  const parsed = SyncSchema.safeParse(body);
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "That is not an inventory.");

  const actor = await catalogSyncActor();
  if (!actor) return fail(409, "This instance has no owner yet to record the changes as.");

  const changes = await syncCatalog(actor, parsed.data);
  return ok({ changes, applied: !parsed.data.dryRun });
}
