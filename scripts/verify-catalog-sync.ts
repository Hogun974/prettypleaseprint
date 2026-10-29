import "./_env";
/**
 * The catalogue following a spool inventory: POST /api/catalog/sync.
 *
 *   npm run verify:catalog-sync
 *
 * Needs the stack started with CATALOG_SYNC_TOKEN_HASH set to the SHA-256 of
 * CATALOG_SYNC_TOKEN (default "ci-catalog-sync"), as scripts/full-test.sh and
 * CI do. Asserts on the database rows the upload form reads and on the audit
 * trail, not on the response alone.
 *
 * DESTRUCTIVE: wipes stories and catalogue rows. Development database only.
 */
import { db } from "../src/lib/db";

const APP = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const TOKEN = process.env.CATALOG_SYNC_TOKEN ?? "ci-catalog-sync";
const RAINBOW = "linear-gradient(135deg, #e4322f 0%, #f6c945 20%, #43aa8b 40%, #2787c9 60%, #7557c7 80%, #e4328c 100%)";

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  console.info(`  ${ok ? "ok  " : "FAIL"}  ${name}${ok || !detail ? "" : `\n          ${detail}`}`);
  ok ? passed++ : failures.push(name);
}
const section = (title: string) =>
  console.info(`\n── ${title} ${"─".repeat(Math.max(0, 54 - title.length))}`);

async function sync(body: unknown, token: string | null = TOKEN) {
  const response = await fetch(`${APP}/api/catalog/sync`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token === null ? {} : { authorization: `Bearer ${token}` }) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json().catch(() => null)) as Record<string, unknown> | null };
}

/** The catalogue as a compact, comparable picture: "PLA:on[Rouge#ff0000:on,…]". */
async function picture(): Promise<string> {
  const materials = await db.catalogMaterial.findMany({
    orderBy: { sortOrder: "asc" },
    include: { colors: { orderBy: { sortOrder: "asc" } } },
  });
  return materials
    .map((m) => `${m.name}:${m.active ? "on" : "off"}[${m.colors.map((c) => `${c.name}${c.hex}${c.mode === "solid" ? "" : `/${c.mode}`}:${c.active ? "on" : "off"}`).join(",")}]`)
    .join(" ");
}

async function seed() {
  await db.story.deleteMany();
  await db.catalogColor.deleteMany();
  await db.catalogMaterial.deleteMany();
  await db.catalogMaterial.create({
    data: {
      name: "PLA",
      sortOrder: 0,
      colors: {
        create: [
          { name: "Teal", hex: "#2a9d8f", style: "#2a9d8f", mode: "solid", sortOrder: 0 },
          { name: "Bone white", hex: "#f2efe6", style: "#f2efe6", mode: "solid", sortOrder: 1, active: false },
          { name: "Whatever's on", hex: "#b6bcc2", style: RAINBOW, mode: "whatever", sortOrder: 2 },
        ],
      },
    },
  });
  await db.catalogMaterial.create({
    data: {
      name: "TPU",
      sortOrder: 1,
      colors: { create: [{ name: "Teal", hex: "#2a9d8f", style: "#2a9d8f", mode: "solid", sortOrder: 0 }] },
    },
  });
  await db.catalogMaterial.create({ data: { name: "Resin", sortOrder: 2, active: false } });
}

const INVENTORY = {
  materials: [
    { name: "pla", colors: [{ name: "Rouge", hex: "#FF0000" }, { name: "bone white", hex: "#eeeeee" }] },
    { name: "PETG-HF", colors: [{ name: "Noir", hex: "#000000" }] },
  ],
};

async function main() {
  const owner = await db.user.findFirst({ where: { role: "admin" }, orderBy: { createdAt: "asc" } });
  if (!owner) throw new Error("no owner in the database: run the stack's migrator first");
  await db.auditEvent.deleteMany();
  await seed();
  const before = await picture();

  section("Who may sync");
  check("no token → 401", (await sync(INVENTORY, null)).status === 401);
  check("a wrong token → 401", (await sync(INVENTORY, "not-the-token")).status === 401);
  check("an empty token → 401", (await sync(INVENTORY, "")).status === 401);
  check("a session cookie is not a sync token", (await sync(INVENTORY, null)).status === 401);
  check("nothing changed by the refusals", (await picture()) === before);

  section("What is refused");
  const empty = await sync({ materials: [] });
  check("an empty inventory → 400, not a catalogue switched off", empty.status === 400, JSON.stringify(empty.json));
  check("not JSON → 400", (await sync("{nope")).status === 400);
  check("a hex with alpha → 400", (await sync({ materials: [{ name: "PLA", colors: [{ name: "Clear", hex: "#e8e8e840" }] }] })).status === 400);
  check("a name over 40 characters → 400", (await sync({ materials: [{ name: "P".repeat(41), colors: [] }] })).status === 400);
  check("nothing changed by them", (await picture()) === before);

  section("A dry run says what it would do, and does nothing");
  const dry = await sync({ ...INVENTORY, dryRun: true });
  const dryChanges = (dry.json?.changes ?? []) as Record<string, string>[];
  check("200, applied: false", dry.status === 200 && dry.json?.applied === false, JSON.stringify(dry.json));
  check("nothing changed", (await picture()) === before);
  check("nothing audited", (await db.auditEvent.count()) === 0);
  const said = dryChanges.map((c) => `${c.change}:${c.material}${c.color ? `·${c.color}` : ""}`).sort();
  const expected = [
    "color_added:PETG-HF·Noir",
    "color_added:PETG-HF·Whatever's on",
    "color_added:PLA·Rouge",
    "color_off:PLA·Teal",
    "color_on:PLA·Bone white",
    "color_recoloured:PLA·Bone white",
    "material_added:PETG-HF",
    "material_off:TPU",
  ];
  check("the changes, exactly", JSON.stringify(said) === JSON.stringify(expected), said.join(" | "));

  section("Applied");
  const run = await sync(INVENTORY);
  check("200, applied: true", run.status === 200 && run.json?.applied === true, JSON.stringify(run.json));
  check("the same changes as the dry run", JSON.stringify(run.json?.changes) === JSON.stringify(dry.json?.changes));
  const after = await picture();
  const want =
    "PLA:on[Teal#2a9d8f:off,Bone white#eeeeee:on,Whatever's on#b6bcc2/whatever:on,Rouge#ff0000:on] " +
    "TPU:off[Teal#2a9d8f:on] Resin:off[] " +
    "PETG-HF:on[Noir#000000:on,Whatever's on#b6bcc2/whatever:on]";
  check("the catalogue the upload form reads", after === want, after);
  check("matched case-insensitively, the owner's spelling kept", !after.includes("pla:") && after.includes("Bone white"));
  check("PETG-HF stays its own material", after.includes("PETG-HF:on") && !after.includes("PETG:"));
  check("nothing removed: Teal is off, not gone", after.includes("Teal#2a9d8f:off"));
  check("a material that is off keeps its colours as they were", after.includes("TPU:off[Teal#2a9d8f:on]"));

  const trail = await db.auditEvent.findMany({ orderBy: { at: "asc" } });
  check("one audit event per change", trail.length === expected.length, `${trail.length} events`);
  check("each recorded as the owner", trail.every((e) => e.actorId === owner.id));
  check(
    "each marked as the sync's",
    trail.every((e) => (e.detail as Record<string, unknown> | null)?.via === "catalog-sync"),
  );
  check("through the admin forms' own actions", trail.every((e) => e.action.startsWith("catalog.")));

  section("Run again: nothing to do, nothing recorded");
  const again = await sync(INVENTORY);
  check("no changes", again.status === 200 && Array.isArray(again.json?.changes) && (again.json?.changes as unknown[]).length === 0, JSON.stringify(again.json));
  check("catalogue unchanged", (await picture()) === after);
  check("no new audit events", (await db.auditEvent.count()) === expected.length);

  section("A spool comes back");
  const back = await sync({ materials: [...INVENTORY.materials, { name: "TPU", colors: [] }] });
  const tpu = (await picture()).split(" ").find((p) => p.startsWith("TPU"));
  check("its material is switched back on", back.status === 200 && tpu?.startsWith("TPU:on") === true, tpu);
  check("given a whatever choice, its unlisted colour switched off", tpu === "TPU:on[Teal#2a9d8f:off,Whatever's on#b6bcc2/whatever:on]", tpu);

  await seed();
  console.info(`\n${passed} checks passed, ${failures.length} failed${failures.length ? `:\n  - ${failures.join("\n  - ")}` : ""}`);
  process.exitCode = failures.length ? 1 : 0;
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => db.$disconnect());
