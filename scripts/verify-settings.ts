import "./_env";
/**
 * End-to-end check of the instance settings at /admin/settings.
 *
 *   npm run verify:settings
 *
 * Two halves. The rules — what the environment pins, what a missing row
 * means, what the form may send — are pure functions in `src/lib/settings.ts`
 * and are called directly with environments the running stack does not have,
 * because the alternative is restarting the container once per case. Then the
 * page and its form are driven over HTTP the way a JavaScript-off browser
 * does, against the stack, asserting what a person observes: a status code,
 * the row, the audit trail, and the `From` line of a real message in Mailpit.
 *
 * The test overlay sets `IMPORT_SOURCES=printables` and a bare
 * `MAIL_FROM=printer@example.org`, so on the stack import is a setting the
 * environment pins and the sender name is one the owner may set — one of each.
 * The defaults for language, theme and slicer have no variable at all; what a
 * person who chose gets instead is verify:preferences'.
 *
 * DESTRUCTIVE: removes the settings row, its audit rows and the invitations it
 * sends. Development database only.
 */
import { db } from "../src/lib/db";
import { mailFromLine, parseSettingsForm, resolveSettings } from "../src/lib/settings";
import { ensureCredentials, signInWithPassword, usernameFor } from "./_accounts";

const APP = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

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
      r = await this.raw(new URL(loc, url).toString());
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
  /** The session row's token, for backdating it. */
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

/** The refusal a redirect carries, decoded, or "" if it carries none. */
function refusal(r: Response): string {
  const loc = r.headers.get("location") ?? "";
  return new URL(loc || "/", APP).searchParams.get("error") ?? "";
}

const row = () => db.instanceSettings.findUnique({ where: { id: 1 } });
const settingsAudits = () =>
  db.auditEvent.findMany({ where: { action: "settings.changed" }, orderBy: { at: "asc" } });

/** The newest message to `to`, as Mailpit's list has it, waiting briefly for delivery. */
async function lastMailTo(to: string): Promise<{ From?: { Name?: string; Address?: string } } | null> {
  for (let i = 0; i < 20; i++) {
    const list = await (await fetch(`${MAILPIT}/api/v1/messages?limit=50`)).json();
    const hit = (list.messages ?? []).find((m: { To?: Array<{ Address?: string }> }) =>
      (m.To ?? []).some((a) => a.Address?.toLowerCase() === to),
    );
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

async function invite(owner: Browser, email: string) {
  const page = await (await owner.go(`${APP}/admin/invites`)).text();
  return owner.submit(`${APP}/admin/invites`, page, findForm(page, ['name="email"']), {
    email,
    name: "Settings Probe",
  });
}

async function main() {
  // ------------------------------------------------------------------
  section("the rules, with environments the stack does not have");

  const none = resolveSettings(null, {});
  check("no row, no environment: importing is off, as before",
        none.importSources.source === "default" && none.importSources.value.length === 0);
  check("no row, no MAIL_FROM: mail goes out exactly as it did",
        mailFromLine({}, null) === "Pretty Please Print <printer@example.org>",
        mailFromLine({}, null));
  check("a bare MAIL_FROM with nothing saved is sent as written",
        mailFromLine({ MAIL_FROM: "desk@office.example" }, null) === "desk@office.example");
  check("a saved name is put in front of a bare MAIL_FROM",
        mailFromLine({ MAIL_FROM: "desk@office.example" }, "Front desk") === '"Front desk" <desk@office.example>');
  check("a MAIL_FROM with its own name wins over a saved one",
        mailFromLine({ MAIL_FROM: "Ops <ops@office.example>" }, "Front desk") === "Ops <ops@office.example>");

  const pinned = resolveSettings({ importSources: "", mailFromName: "Front desk" }, {
    IMPORT_SOURCES: "printables",
    MAIL_FROM: "Ops <ops@office.example>",
  });
  check("an environment variable wins over the saved value, and says so",
        pinned.importSources.source === "env" && pinned.importSources.value.join() === "printables" &&
        pinned.importSources.envName === "IMPORT_SOURCES",
        JSON.stringify(pinned.importSources));
  check("a MAIL_FROM name locks the sender name",
        pinned.mailFromName.source === "env" && pinned.mailFromName.value === "Ops",
        JSON.stringify(pinned.mailFromName));
  check("the saved value is kept and shown even while it is overridden",
        pinned.importSources.stored === "" && pinned.mailFromName.stored === "Front desk");

  const blank = resolveSettings({ importSources: "printables" }, { IMPORT_SOURCES: "  " });
  check("a variable set to nothing says nothing: the saved value is used",
        blank.importSources.source === "saved" && blank.importSources.value.join() === "printables");

  const stale = resolveSettings({ importSources: "thingiverse" }, {});
  check("a saved name this version does not know is a problem, by name, not 'off'",
        !!stale.importSources.problem?.includes('"thingiverse"') &&
        stale.importSources.problem.includes("/admin/settings"),
        stale.importSources.problem ?? "no problem reported");

  const typo = new FormData();
  typo.set("importSources", "printable");
  const typoResult = parseSettingsForm(typo, {});
  check("the form refuses an unknown source by name",
        "problem" in typoResult && typoResult.problem.includes('"printable"'),
        JSON.stringify(typoResult));

  const locked = new FormData();
  locked.set("importSources", "");
  const lockedResult = parseSettingsForm(locked, { IMPORT_SOURCES: "printables" });
  check("the form refuses a setting the environment pins, naming the variable",
        "problem" in lockedResult && lockedResult.problem.includes("IMPORT_SOURCES"),
        JSON.stringify(lockedResult));

  const header = new FormData();
  header.set("mailFromName", "Printer\r\nBcc: everyone@office.example");
  check("a sender name cannot carry a second header",
        "problem" in parseSettingsForm(header, {}));
  const quote = new FormData();
  quote.set("mailFromName", 'Printer" <evil@example.test>');
  check("nor close its quotes to add an address", "problem" in parseSettingsForm(quote, {}));

  check("no row: English, the diner and PrusaSlicer, as before there was a choice",
        none.defaultLocale.value === "en" && none.defaultTheme.value === "diner" &&
        none.defaultSlicer.value === "prusa" && none.defaultTheme.source === "default");
  check("no variable pins a default", !none.defaultLocale.envName && !none.defaultTheme.envName && !none.defaultSlicer.envName);
  const removed = resolveSettings({ defaultTheme: "neon" }, {});
  check("a saved theme this version does not have falls back to the diner, and says so",
        removed.defaultTheme.value === "diner" && !!removed.defaultTheme.problem?.includes('"neon"'),
        JSON.stringify(removed.defaultTheme));
  const neon = new FormData();
  neon.set("defaultTheme", "neon");
  const neonResult = parseSettingsForm(neon, {});
  check("the form refuses a theme it does not have, by name, with the list",
        "problem" in neonResult && neonResult.problem.includes('"neon"') && neonResult.problem.includes("after-hours"),
        JSON.stringify(neonResult));
  const picks = new FormData();
  picks.set("defaultLocale", "fr");
  picks.set("defaultTheme", "");
  picks.set("defaultSlicer", "elegoo");
  const picksResult = parseSettingsForm(picks, {});
  check("a default chosen is stored as its id; the built-in option sends '' and is stored as null",
        "changes" in picksResult && picksResult.changes.defaultLocale === "fr" &&
        picksResult.changes.defaultTheme === null && picksResult.changes.defaultSlicer === "elegoo",
        JSON.stringify(picksResult));

  const cleared = new FormData();
  cleared.set("mailFromName", "  ");
  cleared.append("importSources", "");
  const clearedResult = parseSettingsForm(cleared, {});
  check("an empty field means 'back to the default', stored as null",
        "changes" in clearedResult && clearedResult.changes.mailFromName === null &&
        clearedResult.changes.importSources === null,
        JSON.stringify(clearedResult));

  // ------------------------------------------------------------------
  section("setup");
  await db.$executeRawUnsafe('DELETE FROM "rateLimit"');
  await db.instanceSettings.deleteMany();
  await db.auditEvent.deleteMany({ where: { action: "settings.changed" } });
  const probes = ["settings-one@office.example", "settings-two@office.example"];
  await db.invite.deleteMany({ where: { email: { in: probes } } });
  await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });

  const admin = await db.user.findFirst({ where: { role: "admin" } });
  if (!admin) throw new Error("No admin — run npm run db:seed");
  await db.user.deleteMany({ where: { email: "sam-settings@office.example" } });
  const sam = await db.user.create({
    data: { email: "sam-settings@office.example", name: "Sam Ortiz", initials: "SO", role: "client", emailVerified: true, invitedById: admin.id },
  });

  const ruben = await signIn(admin);
  const client = await signIn(sam);
  console.info(`  admin=${admin.email}  client=${sam.email}`);

  // ------------------------------------------------------------------
  section("the settings screen is owner-only");
  const denied = await client.go(`${APP}/admin/settings`);
  check("a client gets 404, not 403", denied.status === 404, `status ${denied.status}`);

  let page = await (await ruben.go(`${APP}/admin/settings`)).text();
  const formIdx = findForm(page, ['name="mailFromName"']);
  check("the owner sees the form", formIdx >= 0);

  const clientTry = await client.submit(`${APP}/admin/settings`, page, formIdx, { mailFromName: "Sam was here" });
  check("a client posting the owner's form is answered 404", clientTry.status === 404, `status ${clientTry.status}`);
  check("and nothing is saved or recorded", !(await row()) && (await settingsAudits()).length === 0);

  // ------------------------------------------------------------------
  section("what the page shows, and what it never shows");
  check("a value the environment sets is locked and names its variable",
        page.includes("set by <code>IMPORT_SOURCES</code>"));
  check("and is not offered as an input", !/<input[^>]*type="checkbox"[^>]*name="importSources"/.test(page) &&
        !/<input[^>]*name="importSources"[^>]*type="checkbox"/.test(page));
  check("the sender name, which it does not set, is editable", page.includes('name="mailFromName"'));
  check("the read-only panel says how mail and proxy headers are set",
        page.includes("Set in the environment") && page.includes("Configured — SMTP") &&
        page.includes("TRUST_PROXY_HEADERS"));
  check("PASSKEY_RP_NAME is shown read-only, with why", page.includes("PASSKEY_RP_NAME") && page.includes("reads it once"));
  const secrets = [
    process.env.BETTER_AUTH_SECRET,
    new URL(process.env.DATABASE_URL!).password,
    process.env.SMTP_URL,
    "postgresql://",
  ].filter((s): s is string => !!s && s.length > 3);
  const leaked = secrets.filter((s) => page.includes(s) || page.includes(encodeURIComponent(s)));
  check("no secret or connection string reaches the page", leaked.length === 0,
        `found ${leaked.length} of them in the HTML`);

  // ------------------------------------------------------------------
  section("saving needs a fresh sign-in");
  // A second browser for the same account. Not `signIn`: setting the password
  // again revokes every session the owner holds, the first browser's too, and
  // the rest of the run would be signed out.
  const staleOwner = new Browser();
  await db.$executeRawUnsafe('DELETE FROM "rateLimit"');
  await signInWithPassword(staleOwner, APP, usernameFor(admin.email));
  const stalePage = await (await staleOwner.go(`${APP}/admin/settings`)).text();
  await db.session.updateMany({
    where: { token: staleOwner.sessionToken() },
    data: { createdAt: new Date(Date.now() - 60 * 60 * 1000) },
  });
  const staleTry = await staleOwner.submit(`${APP}/admin/settings`, stalePage, findForm(stalePage, ['name="mailFromName"']), {
    mailFromName: "Stale Session",
  });
  const staleLanded = staleTry.headers.get("location") ?? "";
  check("a session an hour old is sent to /reauth, back to this page",
        staleLanded.includes("/reauth") && staleLanded.includes(encodeURIComponent("/admin/settings")),
        `landed at "${staleLanded || "no redirect"}" (status ${staleTry.status})`);
  check("and nothing is saved or recorded", !(await row()) && (await settingsAudits()).length === 0);

  // ------------------------------------------------------------------
  section("a save is in effect on the next request");
  page = await (await ruben.go(`${APP}/admin/settings`)).text();
  const saved = await ruben.submit(`${APP}/admin/settings`, page, findForm(page, ['name="mailFromName"']), {
    mailFromName: "Office printer",
  });
  check("the owner's save is accepted", saved.status === 303 && !refusal(saved),
        `status ${saved.status}, ${saved.headers.get("location")}`);
  check("the row holds it", (await row())?.mailFromName === "Office printer");

  const [first] = await settingsAudits();
  const firstDetail = first?.detail as Record<string, { from: unknown; to: unknown }> | undefined;
  check("settings.changed is recorded, with the old and the new value",
        !!first && first.actorEmail === admin.email &&
        firstDetail?.mailFromName?.from === null && firstDetail?.mailFromName?.to === "Office printer",
        JSON.stringify(first?.detail));
  check("and only what changed", !!firstDetail && Object.keys(firstDetail).join() === "mailFromName",
        Object.keys(firstDetail ?? {}).join());

  const sent = await invite(ruben, probes[0]!);
  check("an invitation goes out", sent.status < 400, `status ${sent.status}`);
  const one = await lastMailTo(probes[0]!);
  check("and arrives from the saved name, at MAIL_FROM's address",
        one?.From?.Name === "Office printer" && one?.From?.Address === "printer@example.org",
        JSON.stringify(one?.From ?? "no message"));

  page = await (await ruben.go(`${APP}/admin/settings`)).text();
  check("the page shows the line mail now goes out as",
        unescapeHtml(page).includes('"Office printer" <printer@example.org>'));
  await ruben.submit(`${APP}/admin/settings`, page, findForm(page, ['name="mailFromName"']), { mailFromName: "" });
  check("emptying the field puts it back to the default (null)", (await row())?.mailFromName === null);
  await invite(ruben, probes[1]!);
  const two = await lastMailTo(probes[1]!);
  check("and the next message is sent as MAIL_FROM says, with no name",
        !two?.From?.Name && two?.From?.Address === "printer@example.org",
        JSON.stringify(two?.From ?? "no message"));
  const audits = await settingsAudits();
  check("that was recorded too, from the old name to null",
        audits.length === 2 &&
        (audits[1]!.detail as Record<string, { from: unknown; to: unknown }>).mailFromName?.from === "Office printer");

  page = await (await ruben.go(`${APP}/admin/settings`)).text();
  const noop = await ruben.submit(`${APP}/admin/settings`, page, findForm(page, ['name="mailFromName"']), { mailFromName: "" });
  check("saving an unchanged form records nothing",
        !refusal(noop) && (await settingsAudits()).length === 2);

  // ------------------------------------------------------------------
  section("the environment wins");
  // A saved value the environment contradicts: off here, printables there.
  await db.instanceSettings.update({ where: { id: 1 }, data: { importSources: "" } });
  const catalog = await (await client.go(`${APP}/api/catalog`)).json();
  check("the API reports the environment's sources, not the saved 'off'",
        Array.isArray(catalog.importSources) && catalog.importSources.join() === "printables",
        JSON.stringify(catalog.importSources));
  const upload = await (await client.go(`${APP}/upload`)).text();
  check("and the request form still offers the import", upload.includes("id=\"import-link\""));

  page = await (await ruben.go(`${APP}/admin/settings`)).text();
  const forced = await ruben.submit(`${APP}/admin/settings`, page, findForm(page, ['name="mailFromName"']), {
    importSources: "",
  });
  check("a crafted post that changes a locked setting is refused, naming the variable",
        refusal(forced).includes("IMPORT_SOURCES"), refusal(forced) || `${forced.headers.get("location")}`);
  check("and the saved value is untouched, with nothing recorded",
        (await row())?.importSources === "" && (await settingsAudits()).length === 2);

  // ------------------------------------------------------------------
  section("an unknown import source is refused by name");
  const misspelt = await ruben.submit(`${APP}/admin/settings`, page, findForm(page, ['name="mailFromName"']), {
    importSources: "printable",
  });
  check("the refusal quotes the name it did not know",
        refusal(misspelt).includes('"printable"'), refusal(misspelt) || `${misspelt.headers.get("location")}`);
  check("and nothing is saved", (await row())?.importSources === "" && (await settingsAudits()).length === 2);

  // ------------------------------------------------------------------
  section("the defaults for everyone who has not chosen");
  page = await (await ruben.go(`${APP}/admin/settings`)).text();
  check("the page offers the three, none locked",
        ["defaultLocale", "defaultTheme", "defaultSlicer"].every((n) => page.includes(`name="${n}"`)) &&
        !page.includes("set by <code>undefined</code>"));
  check("each opens on the built-in default, whose option sends an empty value",
        /<select[^>]*name="defaultTheme"[^>]*>\s*<option value="" selected="">Diner<\/option>/.test(page),
        (/<select[^>]*name="defaultTheme"[\s\S]*?<\/select>/.exec(page) ?? ["no select"])[0]);
  const auditsBefore = (await settingsAudits()).length;
  const defaults = await ruben.submit(`${APP}/admin/settings`, page, findForm(page, ['name="defaultTheme"']), {
    defaultLocale: "fr", defaultTheme: "after-hours", defaultSlicer: "elegoo",
  });
  check("the owner's save is accepted", defaults.status === 303 && !refusal(defaults),
        refusal(defaults) || `status ${defaults.status}`);
  const withDefaults = await row();
  check("the row holds the three",
        withDefaults?.defaultLocale === "fr" && withDefaults?.defaultTheme === "after-hours" &&
        withDefaults?.defaultSlicer === "elegoo", JSON.stringify(withDefaults));
  const lastAudit = (await settingsAudits()).at(-1);
  check("and the trail records them, from null",
        (await settingsAudits()).length === auditsBefore + 1 &&
        (lastAudit?.detail as Record<string, { from: unknown }>)?.defaultTheme?.from === null,
        JSON.stringify(lastAudit?.detail));

  const stranger = await fetch(`${APP}/signin`);
  const strangerPage = await stranger.text();
  check("the next request is drawn in them: a stranger's sign-in page is after hours, in French",
        /<html\b[^>]*data-theme="after-hours"/.test(strangerPage) && /<html\b[^>]*lang="fr"/.test(strangerPage),
        (/<html\b[^>]*>/.exec(strangerPage) ?? ["no <html>"])[0]);
  const samMe = await (await client.go(`${APP}/me`)).text();
  check("and a member who has not chosen is offered the house's slicer by name",
        samMe.includes("ElegooSlicer") && /<html\b[^>]*data-theme="after-hours"/.test(samMe));

  page = await (await ruben.go(`${APP}/admin/settings`)).text();
  check("the page opens on what was saved",
        /<option value="after-hours" selected="">/.test(page) && /<option value="elegoo" selected="">/.test(page));
  const unknownTheme = await ruben.submit(`${APP}/admin/settings`, page, findForm(page, ['name="defaultTheme"']), {
    defaultTheme: "neon",
  });
  check("a crafted theme is refused by name, and nothing is saved",
        refusal(unknownTheme).includes('"neon"') && (await row())?.defaultTheme === "after-hours",
        refusal(unknownTheme) || `${unknownTheme.headers.get("location")}`);
  await ruben.submit(`${APP}/admin/settings`, page, findForm(page, ['name="defaultTheme"']), {
    defaultLocale: "", defaultTheme: "", defaultSlicer: "",
  });
  const backToBuiltIn = await row();
  const plainSignin = await (await fetch(`${APP}/signin`)).text();
  check("the built-in options put all three back to null, and the diner in English",
        backToBuiltIn?.defaultLocale === null && backToBuiltIn?.defaultTheme === null &&
        backToBuiltIn?.defaultSlicer === null &&
        /<html\b[^>]*lang="en"[^>]*data-theme="diner"/.test(plainSignin),
        `${JSON.stringify(backToBuiltIn)} ${(/<html\b[^>]*>/.exec(plainSignin) ?? [""])[0]}`);

  // ------------------------------------------------------------------
  section("teardown");
  await db.instanceSettings.deleteMany();
  await db.invite.deleteMany({ where: { email: { in: probes } } });
  await db.user.deleteMany({ where: { email: sam.email } });
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
