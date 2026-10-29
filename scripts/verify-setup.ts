import "./_env";
/**
 * End-to-end check of the first-run setup at /admin/setup (#106).
 *
 *   npm run verify:setup
 *
 * Three parts. The rules — which step, which origin, which system, whether a
 * passkey domain covers a host — are pure functions in `src/lib/setup.ts`,
 * called with requests the stack never sends. The migration's backfill, the
 * one statement that decides whether an upgraded instance is sent through
 * the setup, is read out of the migration file and run against this database
 * in each state that should and should not count as "in use", each inside a
 * transaction that is rolled back. Then the page and its forms are driven
 * over HTTP the way a JavaScript-off browser does, asserting what a person
 * observes: where `/` sends them, a status code, the row, the audit trail,
 * and a real message in Mailpit.
 *
 * The test overlay sets `IMPORT_SOURCES`, so a crafted post through a setup
 * step can be refused by the same rule as at /admin/settings, and a bare
 * `MAIL_FROM` with SMTP to Mailpit, so the test message has somewhere to go.
 *
 * DESTRUCTIVE: removes the settings row, the setup's and the test message's
 * audit rows, and Mailpit's messages. Development database only.
 */
import { readFileSync } from "node:fs";

import { db } from "../src/lib/db";
import {
  INSTALLER,
  SETUP_STEPS,
  checkAddress,
  platformOf,
  requestOrigin,
  rpIdCovers,
  stepFrom,
} from "../src/lib/setup";
import { ensureCredentials, signInWithPassword, usernameFor } from "./_accounts";

const APP = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";
const MIGRATION = "prisma/migrations/20261031120000_setup_completed/migration.sql";

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  console.info(`  ${ok ? "ok  " : "FAIL"}  ${name}${ok || !detail ? "" : `\n          ${detail}`}`);
  ok ? passed++ : failures.push(name);
}
const section = (t: string) =>
  console.info(`\n── ${t} ${"─".repeat(Math.max(0, 54 - t.length))}`);

const unescapeHtml = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/** The page as text a person reads: React's text-node seams and entities gone. */
const rendered = (html: string) => unescapeHtml(html.replace(/<!--\s*-->/g, ""));
/** Only what is drawn: no scripts, so not the RSC payload either. */
const visible = (html: string) => rendered(html.replace(/<script\b[\s\S]*?<\/script>/g, ""));
/** The same JSON whatever order its keys are in — jsonb keeps its own. */
const sameJson = (a: unknown, b: unknown) => {
  const canon = (v: unknown): unknown =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y)).map(([k, x]) => [k, canon(x)]))
      : v;
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
};

class Browser {
  jar = new Map<string, string>();
  private store(r: Response) {
    for (const line of r.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const i = pair!.indexOf("=");
      const k = pair!.slice(0, i).trim();
      const v = pair!.slice(i + 1).trim();
      if (!v || line.includes("Max-Age=0")) this.jar.delete(k);
      else this.jar.set(k, v);
    }
  }
  private headers(): Record<string, string> {
    const h: Record<string, string> = { origin: APP };
    if (this.jar.size) h.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    return h;
  }
  async raw(url: string, init: RequestInit = {}) {
    const r = await fetch(url, { ...init, redirect: "manual", headers: { ...(init.headers ?? {}), ...this.headers() } });
    this.store(r);
    return r;
  }
  async go(url: string, init: RequestInit = {}) {
    let r = await this.raw(url, init);
    for (let i = 0; i < 8; i++) {
      const loc = r.headers.get("location");
      if (!loc || r.status < 300 || r.status >= 400) break;
      r = await this.raw(new URL(loc, url).toString(), { headers: init.headers });
    }
    return r;
  }
  /** Replay one server-action form: its hidden inputs, then `values` on top. */
  async submit(url: string, html: string, formIndex: number, values: Record<string, string>) {
    const forms = html.match(/<form\b[\s\S]*?<\/form>/g) ?? [];
    const form = forms[formIndex];
    if (!form) throw new Error(`no form #${formIndex} on ${url}`);
    const body = new FormData();
    for (const tag of form.match(/<input\b[^>]*>/g) ?? []) {
      if (!tag.includes('type="hidden"')) continue;
      const n = /name="([^"]*)"/.exec(tag)?.[1];
      const v = /value="([^"]*)"/.exec(tag)?.[1] ?? "";
      if (n) body.append(unescapeHtml(n), unescapeHtml(v));
    }
    for (const [k, v] of Object.entries(values)) body.set(k, v);
    return this.raw(url, { method: "POST", body });
  }
  sessionToken(): string {
    const raw = this.jar.get("ppp.session_token") ?? this.jar.get("__Secure-ppp.session_token") ?? "";
    return decodeURIComponent(raw).split(".")[0]!;
  }
}

/** Index of the first form whose markup contains every substring. */
function findForm(html: string, contains: string[]): number {
  const forms = html.match(/<form\b[\s\S]*?<\/form>/g) ?? [];
  return forms.findIndex((f) => contains.every((s) => f.includes(s)));
}

async function signIn(user: { id: string; email: string }): Promise<Browser> {
  const b = new Browser();
  await db.$executeRawUnsafe('DELETE FROM "rateLimit"');
  await ensureCredentials(APP, user.id, usernameFor(user.email));
  await signInWithPassword(b, APP, usernameFor(user.email));
  return b;
}

const where = (r: Response) => r.headers.get("location") ?? "";
const stepOf = (html: string) => /data-setup-step="([a-z]+)"/.exec(html)?.[1] ?? "";
const row = () => db.instanceSettings.findUnique({ where: { id: 1 } });
const audits = (action: string) =>
  db.auditEvent.findMany({ where: { action }, orderBy: { at: "asc" } });

/** Messages Mailpit holds, newest first, waiting briefly for `atLeast` of them. */
type MailpitMessage = {
  ID: string;
  Subject?: string;
  To?: Array<{ Address?: string }>;
  Cc?: Array<{ Address?: string }>;
  Bcc?: Array<{ Address?: string }>;
};
async function mailbox(atLeast = 0): Promise<MailpitMessage[]> {
  let messages: MailpitMessage[] = [];
  for (let i = 0; i < 20; i++) {
    const list = await (await fetch(`${MAILPIT}/api/v1/messages?limit=50`)).json();
    messages = list.messages ?? [];
    if (messages.length >= atLeast) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return messages;
}
const recipients = (m: MailpitMessage) =>
  [...(m.To ?? []), ...(m.Cc ?? []), ...(m.Bcc ?? [])].map((a) => a.Address?.toLowerCase());

/** Headers a request is sent with, as `Headers`, for the pure rules. */
const h = (init: Record<string, string>) => new Headers(init);

const UA = {
  windowsChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  android:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  chromebook:
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

class Rollback extends Error {}

/**
 * Run the migration's backfill in a database put into some state by
 * `prepare`, report what it left, and undo all of it.
 */
async function backfillIn(
  prepare: (tx: Pick<typeof db, "$executeRawUnsafe" | "$executeRaw">) => Promise<unknown>,
): Promise<{ row: boolean; completed: Date | null }> {
  const sql = /-- backfill:begin\n([\s\S]*?)-- backfill:end/.exec(readFileSync(MIGRATION, "utf8"))?.[1];
  if (!sql) throw new Error(`${MIGRATION} has lost its backfill markers`);
  let seen: { row: boolean; completed: Date | null } = { row: false, completed: null };
  try {
    await db.$transaction(
      async (tx) => {
        await prepare(tx);
        await tx.$executeRawUnsafe(sql);
        const found = await tx.$queryRawUnsafe<Array<{ setupCompletedAt: Date | null }>>(
          'SELECT "setupCompletedAt" FROM "instanceSettings" WHERE "id" = 1',
        );
        seen = { row: found.length > 0, completed: found[0]?.setupCompletedAt ?? null };
        throw new Rollback();
      },
      { timeout: 30_000, maxWait: 15_000 },
    );
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  return seen;
}

async function main() {
  const admin = await db.user.findFirst({ where: { role: "admin" } });
  if (!admin) throw new Error("No admin — run npm run db:seed");

  // ------------------------------------------------------------------
  section("the rules, with requests the stack never sends");

  check("an unknown or missing step is the first one",
        stepFrom("nope") === "account" && stepFrom(undefined) === "account" && stepFrom("mail") === "mail");
  check("six steps, in the order the issue gives",
        SETUP_STEPS.join() === "account,address,look,mail,slicer,people");

  check("the origin is the proxy's forwarded host and scheme, first value only",
        requestOrigin(h({ host: "app:3000", "x-forwarded-host": "Print.Example.org, inner", "x-forwarded-proto": "https" })) ===
          "https://print.example.org");
  check("with no proxy, the Host header over plain HTTP",
        requestOrigin(h({ host: "nas.local:3000" })) === "http://nas.local:3000");
  check("a scheme that is not http or https says nothing",
        requestOrigin(h({ host: "x", "x-forwarded-proto": "javascript" })) === null);
  check("APP_URL with a path still matches its origin",
        checkAddress("https://print.example.org/", "https://print.example.org").matches);
  check("another scheme is a different address",
        !checkAddress("https://print.example.org", "http://print.example.org").matches);
  check("another port is a different address",
        !checkAddress("http://localhost:3000", "http://localhost:3300").matches);
  check("an address the request did not give never matches",
        !checkAddress("http://localhost:3000", null).matches);

  check("a passkey domain covers itself and the hosts below it",
        rpIdCovers("print.example.org", "https://print.example.org") &&
        rpIdCovers("example.org", "https://print.example.org:8443"));
  check("but not a host that merely ends with the same letters",
        !rpIdCovers("print.example.org", "https://reprint.example.org") &&
        !rpIdCovers("example.org", "https://badexample.org"));
  check("nor a different domain", !rpIdCovers("localhost", "https://print.example.org"));

  check("Sec-CH-UA-Platform is believed over the User-Agent",
        platformOf(h({ "sec-ch-ua-platform": '"Windows"', "user-agent": UA.linuxFirefox })) === "windows" &&
        platformOf(h({ "sec-ch-ua-platform": '"macOS"', "user-agent": UA.windowsChrome })) === "macos" &&
        platformOf(h({ "sec-ch-ua-platform": '"Linux"', "user-agent": UA.windowsChrome })) === "linux");
  check("a hint for a system with no installer is 'other'",
        platformOf(h({ "sec-ch-ua-platform": '"Android"', "user-agent": UA.android })) === "other" &&
        platformOf(h({ "sec-ch-ua-platform": '"Chrome OS"' })) === "other");
  check("without a hint, the User-Agent: Windows, macOS, Linux",
        platformOf(h({ "user-agent": UA.windowsChrome })) === "windows" &&
        platformOf(h({ "user-agent": UA.macSafari })) === "macos" &&
        platformOf(h({ "user-agent": UA.linuxFirefox })) === "linux");
  check("Android and ChromeOS say Linux and are not; an iPhone says Mac OS X and is not",
        platformOf(h({ "user-agent": UA.android })) === "other" &&
        platformOf(h({ "user-agent": UA.chromebook })) === "other" &&
        platformOf(h({ "user-agent": UA.iphone })) === "other");
  check("nothing at all is 'other'", platformOf(h({})) === "other");

  // ------------------------------------------------------------------
  section("the migration's backfill: used instances, and only those");

  // What a fresh install is when its owner was seeded and never opened the
  // link: the owner's row with no password, the seeded benefits, nothing else.
  const seededOnly = async (tx: Pick<typeof db, "$executeRawUnsafe">) => {
    await tx.$executeRawUnsafe(
      'TRUNCATE "story", "invite", "passkey", "auditEvent", "instanceSettings", "featureRequest", "session" CASCADE',
    );
    await tx.$executeRawUnsafe(`DELETE FROM "user" WHERE "role" <> 'admin'`);
    await tx.$executeRawUnsafe('UPDATE "account" SET "password" = NULL');
  };
  const accountsNow = () =>
    db.account.findMany({ select: { id: true, password: true }, orderBy: { id: "asc" } });
  const accountsBefore = await accountsNow();
  const seeded = await backfillIn(seededOnly);
  check("an owner who never set a password, and nothing else: left for the setup",
        !seeded.row, JSON.stringify(seeded));

  const adminId = admin.id.replace(/'/g, "''");
  const conditions: Array<[string, string]> = [
    // As the set-password link leaves it: a credential account with a hash,
    // whether or not an earlier link had made the row already.
    ["the owner has set a password",
     `INSERT INTO "account" ("id", "accountId", "providerId", "userId", "password", "updatedAt")
      VALUES ('setup-probe', '${adminId}', 'credential', '${adminId}', 'hash', now())
      ON CONFLICT ("providerId", "accountId") DO UPDATE SET "password" = 'hash'`],
    ["somebody has a passkey",
     `INSERT INTO "passkey" ("id", "publicKey", "userId", "credentialID", "counter", "deviceType", "backedUp")
      VALUES ('setup-probe', 'k', '${adminId}', 'c', 0, 'singleDevice', false)`],
    ["there is an account other than the owner's",
     `INSERT INTO "user" ("id", "name", "email", "emailVerified", "role", "initials", "createdAt", "updatedAt")
      VALUES ('setup-probe', 'Probe', 'setup-probe@office.example', true, 'client', 'PR', now(), now())`],
    ["an invitation was sent",
     `INSERT INTO "invite" ("id", "email", "tokenHash", "invitedById", "expiresAt")
      VALUES ('setup-probe', 'x@office.example', 'setup-probe', '${adminId}', now())`],
    ["there is a ticket",
     `INSERT INTO "story" ("title", "uploaderId", "colorName", "colorHex", "tip", "filename", "fileSize", "mimeType", "storageKey", "updatedAt")
      VALUES ('Probe', '${adminId}', 'Slate', '#4a5d78', 'A beer', 'p.stl', 1, 'model/stl', 'probe', now())`],
    ["the audit trail has a line", `INSERT INTO "auditEvent" ("id", "action") VALUES ('setup-probe', 'auth.signed_in')`],
    ["the owner saved a setting",
     `INSERT INTO "instanceSettings" ("id", "mailFromName", "updatedAt") VALUES (1, 'Office printer', now())`],
  ];
  for (const [what, statement] of conditions) {
    const used = await backfillIn(async (tx) => {
      await seededOnly(tx);
      await tx.$executeRawUnsafe(statement);
    });
    check(`${what}: marked as past its setup`, used.row && used.completed !== null, JSON.stringify(used));
  }
  const kept = await backfillIn(async (tx) => {
    await tx.$executeRawUnsafe('DELETE FROM "instanceSettings"');
    await tx.$executeRawUnsafe(
      `INSERT INTO "instanceSettings" ("id", "updatedAt", "setupCompletedAt") VALUES (1, now(), '2026-01-02T03:04:05Z')`,
    );
  });
  check("a date already there is kept",
        kept.completed?.toISOString() === "2026-01-02T03:04:05.000Z", JSON.stringify(kept));
  check("and every one of those states was rolled back: the accounts are as they were",
        JSON.stringify(await accountsNow()) === JSON.stringify(accountsBefore));

  // ------------------------------------------------------------------
  section("setup: a fresh install");
  await db.$executeRawUnsafe('DELETE FROM "rateLimit"');
  await db.instanceSettings.deleteMany();
  await db.auditEvent.deleteMany({ where: { action: { in: ["setup.completed", "mail.test_sent"] } } });
  await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });
  // The owner reads the setup in the house's language: a choice another
  // suite left on their account would put every page below in French.
  await db.user.update({
    where: { id: admin.id },
    data: { preferredLocale: null, preferredTheme: null, preferredSlicer: null },
  });
  await db.user.deleteMany({ where: { email: "sam-setup@office.example" } });
  const sam = await db.user.create({
    data: { email: "sam-setup@office.example", name: "Sam Ortiz", initials: "SO", role: "client", emailVerified: true, invitedById: admin.id },
  });
  const ruben = await signIn(admin);
  const client = await signIn(sam);
  console.info(`  admin=${admin.email}  client=${sam.email}`);

  // ------------------------------------------------------------------
  section("the owner's landing sends them to the setup");
  const landing = await ruben.raw(`${APP}/`);
  check("signed in on a fresh instance, / sends the owner to /admin/setup",
        where(landing).endsWith("/admin/setup"), `status ${landing.status}, location "${where(landing)}"`);
  let page = await (await ruben.go(`${APP}/`)).text();
  check("which opens on the first step", stepOf(page) === "account", `step "${stepOf(page)}"`);

  const queue = await ruben.go(`${APP}/queue`);
  check("any other page is that page: the setup traps nobody", queue.status === 200 && !stepOf(await queue.text()));
  check("and the next landing still sends them back while it is not done",
        where(await ruben.raw(`${APP}/`)).endsWith("/admin/setup"));

  // ------------------------------------------------------------------
  section("clients get a 404, and cannot touch it");
  const clientHome = await client.raw(`${APP}/`);
  check("a client's landing is the rail, never the setup", where(clientHome).endsWith("/board"), where(clientHome));
  const denied = await client.go(`${APP}/admin/setup`);
  check("a client asking for /admin/setup gets 404", denied.status === 404, `status ${denied.status}`);
  const clientSteps = await Promise.all(
    SETUP_STEPS.map(async (s) => `${s}=${(await client.go(`${APP}/admin/setup?step=${s}`)).status}`),
  );
  check("and on every step", clientSteps.every((s) => s.endsWith("=404")), clientSteps.join(" "));

  page = await (await ruben.go(`${APP}/admin/setup?step=people`)).text();
  const finishIdx = findForm(page, ['name="how" value="finished"']);
  const skipIdx = findForm(page, ['name="how" value="skipped"']);
  const clientFinish = await client.submit(`${APP}/admin/setup`, page, finishIdx, { then: "queue" });
  const clientSkip = await client.submit(`${APP}/admin/setup`, page, skipIdx, {});
  check("a client posting the owner's finish or skip is answered 404",
        clientFinish.status === 404 && clientSkip.status === 404,
        `statuses ${clientFinish.status}, ${clientSkip.status}`);
  page = await (await ruben.go(`${APP}/admin/setup?step=look`)).text();
  const clientSave = await client.submit(`${APP}/admin/setup`, page, findForm(page, ['name="defaultTheme"']), {
    defaultTheme: "after-hours",
  });
  check("or a step's save", clientSave.status === 404, `status ${clientSave.status}`);
  page = await (await ruben.go(`${APP}/admin/setup?step=mail`)).text();
  const mailIdx = findForm(page, ["Send me a test message"]);
  const clientMail = await client.submit(`${APP}/admin/setup`, page, mailIdx, {});
  check("or the test message", clientMail.status === 404, `status ${clientMail.status}`);
  check("and none of it did anything: no row, no audit line, no message",
        !(await row()) && (await audits("mail.test_sent")).length === 0 &&
        (await audits("setup.completed")).length === 0 && (await mailbox()).length === 0);

  // ------------------------------------------------------------------
  section("every step, in English and in French");
  for (const s of SETUP_STEPS) {
    const r = await ruben.go(`${APP}/admin/setup?step=${s}`, { headers: { "accept-language": "en" } });
    const html = await r.text();
    check(`?step=${s} is that step, with the rail linking all six`,
          r.status === 200 && stepOf(html) === s &&
          SETUP_STEPS.every((x) => html.includes(`href="/admin/setup?step=${x}"`)),
          `status ${r.status}, step "${stepOf(html)}"`);
  }
  const en = rendered(await (await ruben.go(`${APP}/admin/setup`, { headers: { "accept-language": "en" } })).text());
  const fr = await (await ruben.go(`${APP}/admin/setup`, { headers: { "accept-language": "fr" } })).text();
  check("in English for a browser that asks for it", en.includes("Before the doors open") && en.includes("Your account"));
  check("in French, as a whole, for one that asks for French",
        /<html\b[^>]*lang="fr"/.test(fr) && rendered(fr).includes("La mise en place") &&
        rendered(fr).includes("Votre compte") && !rendered(fr).includes("Before the doors open"));

  // ------------------------------------------------------------------
  section("1 · your account");
  page = rendered(await (await ruben.go(`${APP}/admin/setup?step=account`)).text());
  const passkeys = await db.passkey.count({ where: { userId: admin.id } });
  check("it names the account the bootstrap made", page.includes(admin.email) && page.includes(usernameFor(admin.email)));
  check(passkeys > 0 ? "and says it has a passkey" : "and offers a passkey, saying what it needs",
        passkeys > 0 ? page.includes("This account has") : page.includes("save a passkey") && page.includes("JavaScript"));

  // ------------------------------------------------------------------
  section("2 · the address");
  page = await (await ruben.go(`${APP}/admin/setup?step=address`)).text();
  check("reached at APP_URL, the address is reported as matching",
        page.includes('data-address="match"'), (/data-address="\w+"/.exec(page) ?? ["none"])[0]);
  const elsewhere = await (await ruben.go(`${APP}/admin/setup?step=address`, {
    headers: { "x-forwarded-host": "print.wrong.example", "x-forwarded-proto": "https" },
  })).text();
  const elsewhereText = rendered(elsewhere);
  check("reached at another address, the difference is reported, naming both",
        elsewhere.includes('data-address="mismatch"') &&
        elsewhereText.includes("https://print.wrong.example") && elsewhereText.includes(new URL(APP).origin) &&
        elsewhereText.includes("They differ"),
        (/data-address="\w+"/.exec(elsewhere) ?? ["none"])[0]);
  check("and what it breaks", elsewhereText.includes("cookies") && elsewhereText.includes("passkeys"));
  check("the passkey domain is checked against APP_URL too",
        page.includes(`data-rp-id="${rpIdCovers(process.env.PASSKEY_RP_ID ?? "localhost", APP) ? "covers" : "misses"}"`));
  check("it is a check, not a form: nothing on this step saves",
        findForm(page, ["APP_URL"]) === -1 && !/name="(appUrl|APP_URL)"/.test(page));

  // ------------------------------------------------------------------
  section("3 · language and look: the same rules as /admin/settings");
  // A second browser for the same account, backdated. Not `signIn`: setting
  // the password again revokes every session the owner holds.
  const staleOwner = new Browser();
  await db.$executeRawUnsafe('DELETE FROM "rateLimit"');
  await signInWithPassword(staleOwner, APP, usernameFor(admin.email));
  await db.session.updateMany({
    where: { token: staleOwner.sessionToken() },
    data: { createdAt: new Date(Date.now() - 60 * 60 * 1000) },
  });
  const changedBefore = (await audits("settings.changed")).length;
  page = await (await staleOwner.go(`${APP}/admin/setup?step=look`)).text();
  const stale = await staleOwner.submit(`${APP}/admin/setup`, page, findForm(page, ['name="defaultTheme"']), {
    defaultLocale: "fr", defaultTheme: "after-hours",
  });
  check("a session an hour old is sent to /reauth, back to this step",
        where(stale).includes("/reauth") && where(stale).includes(encodeURIComponent("/admin/setup?step=look")),
        `landed at "${where(stale) || "no redirect"}" (status ${stale.status})`);
  check("and nothing is saved or recorded",
        !(await row()) && (await audits("settings.changed")).length === changedBefore);

  page = await (await ruben.go(`${APP}/admin/setup?step=look`)).text();
  check("the step offers the two defaults the settings page does, and only those",
        page.includes('name="defaultLocale"') && page.includes('name="defaultTheme"') &&
        !page.includes('name="defaultSlicer"') && !page.includes('name="mailFromName"'));
  const look = await ruben.submit(`${APP}/admin/setup`, page, findForm(page, ['name="defaultTheme"']), {
    defaultLocale: "fr", defaultTheme: "after-hours",
  });
  check("the owner's save goes on to the next step",
        look.status === 303 && where(look).includes("step=mail") && where(look).includes("saved=1"),
        `status ${look.status}, ${where(look)}`);
  const afterLook = await row();
  check("the row holds both", afterLook?.defaultLocale === "fr" && afterLook?.defaultTheme === "after-hours",
        JSON.stringify(afterLook));
  const lookAudit = (await audits("settings.changed")).at(-1);
  const lookDetail = lookAudit?.detail as Record<string, { from: unknown; to: unknown }> | undefined;
  check("settings.changed is recorded, as from the settings page, with the old and the new value",
        (await audits("settings.changed")).length === changedBefore + 1 && lookAudit?.actorEmail === admin.email &&
        lookDetail?.defaultTheme?.from === null && lookDetail?.defaultTheme?.to === "after-hours" &&
        lookDetail?.defaultLocale?.to === "fr",
        JSON.stringify(lookAudit?.detail));
  check("and the settings page shows what the setup saved",
        /<option value="after-hours" selected="">/.test(await (await ruben.go(`${APP}/admin/settings`)).text()));

  page = await (await ruben.go(`${APP}/admin/setup?step=look`)).text();
  const crafted = await ruben.submit(`${APP}/admin/setup`, page, findForm(page, ['name="defaultTheme"']), {
    importSources: "",
  });
  check("a crafted post that changes a setting the environment pins is refused by the same rule, naming the variable",
        new URL(where(crafted) || "/", APP).searchParams.get("error")?.includes("IMPORT_SOURCES") === true,
        where(crafted));
  const neon = await ruben.submit(`${APP}/admin/setup`, page, findForm(page, ['name="defaultTheme"']), {
    defaultTheme: "neon",
  });
  check("so is a theme this version does not have, by name",
        new URL(where(neon) || "/", APP).searchParams.get("error")?.includes('"neon"') === true, where(neon));
  check("and neither saved nor recorded anything",
        (await row())?.defaultTheme === "after-hours" && (await audits("settings.changed")).length === changedBefore + 1);
  // Back to the built-in defaults, so the pages below are in English.
  await ruben.submit(`${APP}/admin/setup`, page, findForm(page, ['name="defaultTheme"']), {
    defaultLocale: "", defaultTheme: "",
  });
  check("the built-in options put both back to null", (await row())?.defaultTheme === null && (await row())?.defaultLocale === null);

  // ------------------------------------------------------------------
  section("4 · mail: the test message");
  page = await (await ruben.go(`${APP}/admin/setup?step=mail`)).text();
  check("the step says a transport is configured, and which kind", page.includes('data-transport="smtp"'));
  check("and names the owner's own address as where the test goes", rendered(page).includes(admin.email));
  const secrets = [
    process.env.BETTER_AUTH_SECRET,
    new URL(process.env.DATABASE_URL!).password,
    process.env.SMTP_URL,
    "postgresql://",
    "smtp://localhost",
    "smtp://mailpit",
  ].filter((s): s is string => !!s && s.length > 3);
  const leaked = secrets.filter((s) => page.includes(s) || page.includes(encodeURIComponent(s)));
  check("no secret or connection string reaches the page", leaked.length === 0, `found ${leaked.length} in the HTML`);

  const sent = await ruben.submit(`${APP}/admin/setup`, page, findForm(page, ["Send me a test message"]), {
    // Whatever a crafted post says, the address is the account's.
    to: "someone-else@office.example",
    email: "someone-else@office.example",
  });
  check("pressing it comes back to the mail step, sent",
        sent.status === 303 && where(sent).includes("step=mail") && where(sent).includes("sent=1"),
        `status ${sent.status}, ${where(sent)}`);
  let inbox = await mailbox(1);
  check("exactly one message arrives", inbox.length === 1, `${inbox.length} message(s)`);
  check("addressed to the owner's own address, and to nobody else",
        inbox.length === 1 && recipients(inbox[0]!).join() === admin.email.toLowerCase(),
        JSON.stringify(inbox.map(recipients)));
  check("and it is the test message", inbox[0]?.Subject === "Test message from Pretty Please Print", inbox[0]?.Subject);
  const testAudits = await audits("mail.test_sent");
  check("mail.test_sent is recorded, delivered, with the transport's kind and never its address",
        testAudits.length === 1 && testAudits[0]!.actorEmail === admin.email &&
        sameJson(testAudits[0]!.detail, { transport: "smtp", delivered: true }),
        JSON.stringify(testAudits.map((a) => a.detail)));

  for (let i = 0; i < 2; i++) {
    page = await (await ruben.go(`${APP}/admin/setup?step=mail`)).text();
    await ruben.submit(`${APP}/admin/setup`, page, findForm(page, ["Send me a test message"]), {});
  }
  page = await (await ruben.go(`${APP}/admin/setup?step=mail`)).text();
  const fourth = await ruben.submit(`${APP}/admin/setup`, page, findForm(page, ["Send me a test message"]), {});
  check("a fourth inside fifteen minutes is refused, and says why",
        where(fourth).includes("problem=tooMany"), where(fourth));
  inbox = await mailbox(3);
  check("so three messages went, all to the owner, and no more",
        inbox.length === 3 && inbox.every((m) => recipients(m).join() === admin.email.toLowerCase()),
        `${inbox.length} message(s)`);
  check("and three attempts are in the trail", (await audits("mail.test_sent")).length === 3);
  const refusal = rendered(await (await ruben.go(new URL(where(fourth), APP).toString())).text());
  check("the page explains the refusal in words", refusal.includes("3 test messages in 15 minutes"));
  // What is drawn, not the RSC payload, which carries the URL it was asked for.
  const forged = visible(await (await ruben.go(
    `${APP}/admin/setup?step=mail&problem=refused&code=${encodeURIComponent("Call 555-0100 now")}`,
  )).text());
  check("a code in the URL is shown only if it looks like a transport's error code",
        forged.includes("The transport refused the message.") && !forged.includes("555-0100"));

  // ------------------------------------------------------------------
  section("5 · slicer: the installer for the browser's system");
  const slicerFor = async (headers: Record<string, string>) =>
    unescapeHtml(await (await ruben.go(`${APP}/admin/setup?step=slicer`, { headers })).text());
  const win = await slicerFor({ "user-agent": UA.windowsChrome, "sec-ch-ua-platform": '"Windows"' });
  check("Windows: the PowerShell line, and how to run it",
        win.includes('data-platform="windows"') && win.includes(INSTALLER.windows) &&
        !win.includes(INSTALLER.linux) && win.includes("Git for Windows") && win.includes("No administrator rights"));
  const linux = await slicerFor({ "user-agent": UA.linuxFirefox });
  check("Linux, from the User-Agent alone: the shell installer",
        linux.includes('data-platform="linux"') && linux.includes(INSTALLER.linux) && !linux.includes(".ps1"));
  const mac = await slicerFor({ "user-agent": UA.macSafari });
  check("macOS: no command, the manual section of the guide instead",
        mac.includes('data-platform="macos"') && mac.includes("docs/prusaslicer.md#macos") &&
        !mac.includes(INSTALLER.linux) && !mac.includes(".ps1"));
  const hinted = await slicerFor({ "user-agent": UA.windowsChrome, "sec-ch-ua-platform": '"Linux"' });
  check("the client hint wins over the User-Agent", hinted.includes('data-platform="linux"') && hinted.includes(INSTALLER.linux));
  const phone = await slicerFor({ "user-agent": UA.android, "sec-ch-ua-platform": '"Android"' });
  check("a phone gets no command, and is told where the helper goes",
        phone.includes('data-platform="other"') && !phone.includes(INSTALLER.linux) && !phone.includes(".ps1") &&
        phone.includes("docs/prusaslicer.md"));
  check("every system is told the instance's address for slicer.conf",
        [win, linux, mac, phone].every((p) => p.includes(`PPP_BASE="${APP.replace(/\/+$/, "")}"`)));

  page = await (await ruben.go(`${APP}/admin/setup?step=slicer`)).text();
  const staleSlicerPage = await (await staleOwner.go(`${APP}/admin/setup?step=slicer`)).text();
  const staleSlicer = await staleOwner.submit(`${APP}/admin/setup`, staleSlicerPage,
    findForm(staleSlicerPage, ['name="defaultSlicer"']), { defaultSlicer: "orca" });
  check("its save needs a fresh sign-in too",
        where(staleSlicer).includes("/reauth") && (await row())?.defaultSlicer === null, where(staleSlicer));
  const slicer = await ruben.submit(`${APP}/admin/setup`, page, findForm(page, ['name="defaultSlicer"']), {
    defaultSlicer: "elegoo",
  });
  check("the owner's save goes on to the last step",
        slicer.status === 303 && where(slicer).includes("step=people"), where(slicer));
  const slicerAudit = (await audits("settings.changed")).at(-1);
  check("the default slicer is saved and recorded, as from the settings page",
        (await row())?.defaultSlicer === "elegoo" &&
        (slicerAudit?.detail as Record<string, { to: unknown }>)?.defaultSlicer?.to === "elegoo");
  const profiled = await slicerFor({ "user-agent": UA.linuxFirefox });
  check("and the slicer.conf lines name its helper profile", profiled.includes("PPP_SLICER_PROFILE=elegoo"));

  // ------------------------------------------------------------------
  section("6 · people, and finishing");
  page = await (await ruben.go(`${APP}/admin/setup?step=people`)).text();
  check("the last step links to the guest list", page.includes('href="/admin/invites"'));
  check("until it is finished, the setup still opens on landing", where(await ruben.raw(`${APP}/`)).endsWith("/admin/setup"));
  const finished = await ruben.submit(`${APP}/admin/setup`, page, findForm(page, ['name="how" value="finished"']), {
    then: "invites",
  });
  check("'Finish and send the first invitation' lands on the guest list",
        finished.status === 303 && where(finished).endsWith("/admin/invites"), where(finished));
  const done = await row();
  check("the row records when", done?.setupCompletedAt instanceof Date, JSON.stringify(done));
  let completed = await audits("setup.completed");
  check("setup.completed is recorded, finished, from the last step",
        completed.length === 1 && completed[0]!.actorEmail === admin.email &&
        sameJson(completed[0]!.detail, { how: "finished", step: "people" }),
        JSON.stringify(completed.map((a) => a.detail)));
  const after = await ruben.raw(`${APP}/`);
  check("from now on the owner's landing is the pass", where(after).endsWith("/queue"), where(after));

  const elsewhereThen = await ruben.submit(`${APP}/admin/setup`, page, findForm(page, ['name="how" value="finished"']), {
    then: "https://evil.example/",
  });
  check("finishing again moves nothing, records nothing, and goes nowhere but the pass",
        where(elsewhereThen).endsWith("/queue") && (await audits("setup.completed")).length === 1 &&
        (await row())?.setupCompletedAt?.getTime() === done?.setupCompletedAt?.getTime(),
        where(elsewhereThen));

  const revisit = await ruben.go(`${APP}/admin/setup?step=address`);
  const revisitHtml = await revisit.text();
  check("it can still be gone through from the settings page",
        revisit.status === 200 && stepOf(revisitHtml) === "address" &&
        (await (await ruben.go(`${APP}/admin/settings`)).text()).includes('href="/admin/setup"'));
  check("without offering to skip what is already done", findForm(revisitHtml, ['name="how" value="skipped"']) === -1);

  // ------------------------------------------------------------------
  section("skipping, from any step");
  await db.instanceSettings.update({ where: { id: 1 }, data: { setupCompletedAt: null } });
  await db.auditEvent.deleteMany({ where: { action: "setup.completed" } });
  check("pending again, / sends the owner back", where(await ruben.raw(`${APP}/`)).endsWith("/admin/setup"));
  page = await (await ruben.go(`${APP}/admin/setup?step=address`)).text();
  const skipped = await ruben.submit(`${APP}/admin/setup`, page, findForm(page, ['name="how" value="skipped"']), {});
  check("skipping from the second step goes to the pass", skipped.status === 303 && where(skipped).endsWith("/queue"),
        where(skipped));
  completed = await audits("setup.completed");
  check("and is recorded as skipped, from that step",
        (await row())?.setupCompletedAt instanceof Date && completed.length === 1 &&
        sameJson(completed[0]!.detail, { how: "skipped", step: "address" }),
        JSON.stringify(completed.map((a) => a.detail)));
  check("and the setup does not open on landing again", where(await ruben.raw(`${APP}/`)).endsWith("/queue"));

  // ------------------------------------------------------------------
  section("an upgraded instance never sees it");
  // This database is now an instance in use: the owner has a password and
  // the trail has lines. Its row back to what an upgrade would find, then the
  // migration's own statement, as `prisma migrate deploy` runs it.
  await db.instanceSettings.deleteMany();
  check("with no row, it would open", where(await ruben.raw(`${APP}/`)).endsWith("/admin/setup"));
  const sql = /-- backfill:begin\n([\s\S]*?)-- backfill:end/.exec(readFileSync(MIGRATION, "utf8"))![1]!;
  await db.$executeRawUnsafe(sql);
  check("after the migration's backfill, the owner's landing is the pass",
        (await row())?.setupCompletedAt instanceof Date && where(await ruben.raw(`${APP}/`)).endsWith("/queue"));

  // ------------------------------------------------------------------
  section("teardown");
  await db.instanceSettings.deleteMany();
  await db.user.deleteMany({ where: { email: sam.email } });
  await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });
  check("no settings row is left behind", !(await row()));

  console.info(
    `\n${passed} checks passed, ${failures.length} failed` +
      (failures.length ? `:\n  - ${failures.join("\n  - ")}` : ""),
  );
  process.exitCode = failures.length ? 1 : 0;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
