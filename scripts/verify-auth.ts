/**
 * End-to-end check of invite-only registration and username/password sign-in.
 *
 *   docker compose up -d db mailpit
 *   npm run build && npm start          # or npm run dev
 *   npm run verify:auth
 *
 * It drives the real HTTP surface — including submitting the server-action
 * forms exactly the way a browser with JavaScript disabled does — and reads
 * delivered mail out of Mailpit. Nothing is stubbed, so a pass means the
 * whole path works, not that the units agree with each other.
 *
 * DESTRUCTIVE: it wipes users, invites, tokens and the audit trail first.
 * Point it at a development database only.
 */
import "./_env";
import { PrismaClient } from "@prisma/client";
import { db } from "../src/lib/db";
import { createInvite, mailConfigured } from "../src/lib/invites";
import { issuePasswordSetupUrl } from "../src/lib/password-reset";
import { TEST_PASSWORD, ensureCredentials, signInWithPassword } from "./_accounts";

const APP = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

const failures: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  console.info(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `   [${detail}]`}`);
  if (!ok) failures.push(name);
}
const section = (t: string) => console.info(`\n== ${t} ==`);

/** Counters are per IP and every suite shares one; clear before each burst. */
const clearRateLimit = () => db.$executeRawUnsafe('DELETE FROM "rateLimit"');

// --- a cookie jar over fetch, so a "browser" persists between requests -----

class Browser {
  private jar = new Map<string, string>();

  get cookieNames(): string[] {
    return [...this.jar.keys()];
  }

  private store(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const eq = pair!.indexOf("=");
      if (eq < 0) continue;
      const name = pair!.slice(0, eq).trim();
      const value = pair!.slice(eq + 1).trim();
      // A real browser drops Secure cookies on plain HTTP; over loopback we
      // keep them so a production build can still be smoke-tested locally.
      if (value === "" || line.includes("Max-Age=0")) this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  private header(): Record<string, string> {
    // Better Auth rejects same-site-looking requests that carry no Origin
    // (MISSING_OR_NULL_ORIGIN) — its CSRF defence. A real browser always sends
    // one, so this client does too, otherwise we would be testing the error
    // path instead of the flow.
    const h: Record<string, string> = { origin: APP };
    if (this.jar.size > 0) {
      h.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    }
    return h;
  }

  /** Single request, redirects NOT followed. */
  async raw(url: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(url, {
      ...init,
      redirect: "manual",
      headers: { ...(init.headers ?? {}), ...this.header() },
    });
    this.store(res);
    return res;
  }

  /** Follows redirects, carrying cookies, like a browser address bar. */
  async go(url: string, init: RequestInit = {}): Promise<Response> {
    let res = await this.raw(url, init);
    for (let hop = 0; hop < 8; hop++) {
      const loc = res.headers.get("location");
      if (!loc || res.status < 300 || res.status >= 400) break;
      res = await this.raw(new URL(loc, url).toString());
    }
    return res;
  }

  /**
   * Submit a server-action form the way a browser without JavaScript does:
   * replay every hidden input React rendered, plus the visible values.
   * `headers` is for the language a check asks in.
   */
  async submit(url: string, html: string, values: Record<string, string>, headers: Record<string, string> = {}) {
    const form = /<form\b[\s\S]*?<\/form>/.exec(html)?.[0] ?? "";
    const body = new FormData();
    for (const tag of form.match(/<input\b[^>]*>/g) ?? []) {
      if (!tag.includes('type="hidden"')) continue;
      const name = /name="([^"]*)"/.exec(tag)?.[1];
      const value = /value="([^"]*)"/.exec(tag)?.[1] ?? "";
      if (name) body.append(unescapeHtml(name), unescapeHtml(value));
    }
    for (const [k, v] of Object.entries(values)) body.set(k, v);
    return this.raw(url, { method: "POST", body, headers });
  }

  /** The session row's token, from the signed cookie. */
  sessionToken(): string {
    const raw = this.jar.get("ppp.session_token") ?? this.jar.get("__Secure-ppp.session_token") ?? "";
    return decodeURIComponent(raw).split(".")[0]!;
  }
}

const FRENCH = { "accept-language": "fr-FR,fr;q=0.9,en;q=0.8" };

const unescapeHtml = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
   .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

const signedIn = (b: Browser) => b.cookieNames.some((c) => c.includes("session_token"));

// --- mailpit ---------------------------------------------------------------

async function mailLink(to: string, pattern: RegExp): Promise<string | null> {
  const list = await (await fetch(`${MAILPIT}/api/v1/messages?limit=100`)).json();
  for (const m of list.messages ?? []) {
    const addressed = (m.To ?? []).some(
      (a: { Address?: string }) => a.Address?.toLowerCase() === to,
    );
    if (!addressed) continue;
    const body = await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json();
    const hit = pattern.exec(`${body.Text ?? ""} ${body.HTML ?? ""}`);
    if (hit) return hit[0].replace(/[.,]$/, "").replace(/&amp;/g, "&");
  }
  return null;
}

const CLAIM_LINK = /http:\/\/[^\s"'<]+\/invite\/[^\s"'<]+/;
const SET_PASSWORD_LINK = /http:\/\/[^\s"'<]+\/set-password\?token=[^\s"'<]+/;

/** Registration, as the sign-up endpoint sees it. */
function signUp(browser: Browser, body: Record<string, unknown>) {
  return browser.raw(`${APP}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// --- the run ---------------------------------------------------------------

async function main() {
  section("reset");
  await clearRateLimit();
  await db.verification.deleteMany();
  // The trail is append-only in the app, so a suite that asserts "exactly one
  // of these happened" has to start from an empty one.
  await db.auditEvent.deleteMany();
  await db.invite.deleteMany();
  await db.user.deleteMany({ where: { role: "client" } });
  await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });

  const admin = await db.user.findFirst({ where: { role: "admin" } });
  if (!admin) throw new Error("No admin. Run `npm run db:seed` first.");
  console.info(`  admin: ${admin.name} <${admin.email}>`);

  // ------------------------------------------------------------------------
  section("1. an uninvited stranger cannot register");
  const STRANGER = "stranger@nowhere.test";
  const anon = new Browser();

  const uninvited = await signUp(anon, {
    email: STRANGER,
    name: "A Stranger",
    username: "stranger",
    password: TEST_PASSWORD,
  });
  check("sign-up with no pending invite is refused", uninvited.status === 403,
        `status ${uninvited.status}`);
  check("and it says why, without hinting at a way round it",
        (await uninvited.clone().text()).includes("invite"), "");
  check("no account was created",
        (await db.user.count({ where: { email: STRANGER } })) === 0);
  check("no session came back", !signedIn(anon));
  check("the refusal is in the audit trail",
        (await db.auditEvent.count({
          where: { action: "invite.rejected", subject: STRANGER },
        })) > 0);

  // ------------------------------------------------------------------------
  section("2. the admin invites someone through the UI");
  await ensureCredentials(APP, admin.id, "ruben");
  const ruben = new Browser();
  await clearRateLimit();
  await signInWithPassword(ruben, APP, "ruben");
  check("the admin has a session", signedIn(ruben));

  const AYLA = "ayla@office.example";
  const invitePage = await (await ruben.go(`${APP}/admin/invites`)).text();
  check("the admin can open the guest list", invitePage.includes("The guest list"));

  const sent = await ruben.submit(`${APP}/admin/invites`, invitePage, {
    email: AYLA,
    name: "Ayla B",
  });
  check("submitting the invite form is accepted", sent.status < 400, `status ${sent.status}`);
  check("an invite row exists", (await db.invite.count({ where: { email: AYLA } })) === 1);

  // ------------------------------------------------------------------------
  section("2b. an invited address is not the invitation");
  // The sign-up endpoint answers anybody. Before this was closed, posting an
  // invited address here with a password of your own choosing opened the
  // account and signed you in — no link, no mailbox. Knowing who had been
  // invited was enough.
  const thief = new Browser();
  const noLink = await signUp(thief, {
    email: AYLA,
    name: "Not Ayla",
    username: "notayla",
    password: TEST_PASSWORD,
  });
  check("signing up with an invited address but no link is refused", noLink.status === 403,
        `status ${noLink.status}`);
  check("no account was opened for it",
        (await db.user.count({ where: { email: AYLA } })) === 0);
  check("and no session came back", !signedIn(thief));
  check("the answer is the same one a stranger gets, so it does not say who is invited",
        (await noLink.clone().text()) === (await uninvited.clone().text()),
        (await noLink.clone().text()).slice(0, 120));
  check("the invitation is still there for the person it was sent to",
        (await db.invite.findFirst({ where: { email: AYLA } }))?.acceptedAt === null);
  const noLinkTrail = await db.auditEvent.findFirst({
    where: { action: "invite.rejected", subject: AYLA },
    orderBy: { at: "desc" },
  });
  check("the trail records it as an attempt without the link",
        (noLinkTrail?.detail as { reason?: string } | null)?.reason === "no_link",
        JSON.stringify(noLinkTrail?.detail));

  // ------------------------------------------------------------------------
  section("3. the invitation link registers the account");
  const claimUrl = await mailLink(AYLA, CLAIM_LINK);
  check("an invitation email with a claim link arrived", claimUrl !== null, `${claimUrl}`);
  if (!claimUrl) throw new Error("no claim link; cannot continue");

  const ayla = new Browser();
  const claimPage = await (await ayla.go(claimUrl)).text();
  check("the claim page renders", claimPage.includes("will print things for you"));
  check("it shows the address the invite is bound to", claimPage.includes(AYLA));
  check("it asks for a username and a password",
        claimPage.includes('name="username"') && claimPage.includes('name="password"'));

  // Typed with a capital, on purpose: it should be accepted, folded for the
  // identifier and kept as typed for display.
  const claimed = await ayla.submit(claimUrl, claimPage, {
    name: "Ayla Berg",
    username: "Ayla",
    password: TEST_PASSWORD,
  });
  check("registering redirects onward", claimed.status >= 300 && claimed.status < 400,
        `status ${claimed.status}`);
  check("and signs her in there and then", signedIn(ayla),
        "registration did not establish a session");

  // `/` redirects to the board, which is the client's home per the handoff.
  const home = await (await ayla.go(`${APP}/`)).text();
  check("she lands on an authenticated page", home.includes("The backlog"));
  // The client kicker names the printer owner directly, the admin one does
  // not — and the admin-only nav must be absent entirely.
  check("the page is scoped to a client, not the admin",
        home.includes(`Private to you and ${admin.name.split(" ")[0]}`) &&
        !home.includes("Admin view") &&
        !home.includes("Guest list") &&
        !home.includes("/admin/audit"));

  const account = await db.user.findUnique({ where: { email: AYLA } });
  check("the account is stamped from the invite, not the request",
        account?.role === "client" &&
        account.initials === "AY" &&
        account.invitedById === admin.id &&
        account.emailVerified === true,
        JSON.stringify({ role: account?.role, initials: account?.initials }));
  check("the username she chose is stored, folded to lower case",
        account?.username === "ayla" && account.displayUsername === "Ayla",
        JSON.stringify({ username: account?.username,
                         displayUsername: account?.displayUsername }));
  check("the name she chose beat the one the admin guessed",
        account?.name === "Ayla Berg", account?.name);
  check("the invite is marked accepted",
        (await db.invite.findFirst({ where: { email: AYLA } }))?.acceptedAt !== null);
  check("a password was actually stored, and not in the clear",
        await passwordIsHashed(account!.id), "the account has no usable credential");

  // ------------------------------------------------------------------------
  section("4. the invitation link is single-use");
  const replay = await (await new Browser().go(claimUrl)).text();
  check("a second visit is refused", replay.includes("has been used"));

  // ------------------------------------------------------------------------
  section("5. signing in with a username and a password");
  await clearRateLimit();
  const returning = new Browser();
  const good = await signInWithPassword(returning, APP, "ayla");
  check("the right password is accepted", good.status === 200, `status ${good.status}`);
  check("and a session cookie is set", signedIn(returning));

  const mixedCase = new Browser();
  await signInWithPassword(mixedCase, APP, "AyLa");
  check("the username is matched case-insensitively", signedIn(mixedCase));

  const wrongPassword = new Browser();
  const bad = await signInWithPassword(wrongPassword, APP, "ayla", "not-the-password-x9");
  check("a wrong password is refused", bad.status === 401, `status ${bad.status}`);
  check("and no session is handed out", !signedIn(wrongPassword));

  const noSuchUser = await signInWithPassword(new Browser(), APP, "nobody-here", "not-the-password-x9");
  const badBody = await bad.clone().text();
  const missingBody = await noSuchUser.clone().text();
  check("an unknown username is answered exactly like a wrong password",
        noSuchUser.status === bad.status && missingBody === badBody,
        `${noSuchUser.status} ${missingBody} vs ${bad.status} ${badBody}`);

  // ------------------------------------------------------------------------
  section("6. a username is claimed once");
  const DUP = "dup@office.example";
  await createInvite({ email: DUP, invitedById: admin.id });
  await clearRateLimit();
  const dup = await signUp(new Browser(), {
    email: DUP, name: "Dup Licate", username: "AYLA", password: TEST_PASSWORD,
  });
  check("a username somebody already has is refused", dup.status === 400,
        `status ${dup.status}`);
  check("even spelled differently — the comparison is case-insensitive",
        (await dup.clone().text()).toUpperCase().includes("ALREADY"),
        (await dup.clone().text()).slice(0, 120));
  check("and no account was created",
        (await db.user.count({ where: { email: DUP } })) === 0);

  // ------------------------------------------------------------------------
  section("7. a breached password is refused");
  await clearRateLimit();
  const breached = await signUp(new Browser(), {
    email: DUP, name: "Dup Licate", username: "duplicate", password: "Password123!",
  });
  const breachedBody = await breached.clone().text();
  check("a password from a known breach corpus does not get through",
        breached.status === 400 && /breach|compromis/i.test(breachedBody),
        `status ${breached.status} ${breachedBody.slice(0, 120)}`);
  check("and still no account",
        (await db.user.count({ where: { email: DUP } })) === 0);

  // The same invite still works with a password that is not in the corpus,
  // which is what makes the refusal a refusal rather than a broken flow.
  // Through the link, because that is the only way an account opens: the two
  // refusals above are the endpoint's own validation and fire before the gate,
  // but a sign-up that would succeed has to be the redemption of an invite.
  const survivor = new Browser();
  const dupLink = await mailLink(DUP, CLAIM_LINK);
  if (!dupLink) throw new Error("no claim link for the duplicate invite");
  const dupPage = await (await survivor.go(dupLink)).text();
  const ok = await survivor.submit(dupLink, dupPage, {
    name: "Dup Licate", username: "duplicate", password: TEST_PASSWORD,
  });
  check("a password that is not breached goes straight through",
        ok.status >= 300 && ok.status < 400 && signedIn(survivor) &&
        (await db.user.count({ where: { email: DUP } })) === 1,
        `status ${ok.status}`);
  await db.user.deleteMany({ where: { email: DUP } });

  // ------------------------------------------------------------------------
  section("8. guessing is rate limited");
  await clearRateLimit();
  let limited = false;
  for (let i = 0; i < 25 && !limited; i++) {
    const r = await signInWithPassword(new Browser(), APP, "ayla", `guess-${i}-nope`);
    if (r.status === 429) limited = true;
  }
  check("repeated wrong passwords hit the limiter", limited,
        "25 attempts in a row were all answered normally");
  await clearRateLimit();

  // ------------------------------------------------------------------------
  section("9. a client cannot reach the admin surface");
  const denied = await ayla.go(`${APP}/admin/invites`);
  check("the guest list answers 404, not 403", denied.status === 404, `status ${denied.status}`);

  await ayla.submit(`${APP}/admin/invites`, invitePage, {
    email: "gatecrasher@nowhere.test",
  });
  check("posting the invite action as a client creates nothing",
        (await db.invite.count({ where: { email: "gatecrasher@nowhere.test" } })) === 0);

  // ------------------------------------------------------------------------
  section("10. privileged fields cannot be set over the wire");
  const BOB = "bob@office.example";
  await createInvite({ email: BOB, invitedById: admin.id });

  // `input: false` is not "quietly stripped": Better Auth refuses the whole
  // request. Loud is the right failure — a sign-up that half-worked would be
  // harder to notice than one that did not.
  for (const field of ["role", "initials", "invitedById"] as const) {
    await clearRateLimit();
    const spoof = await signUp(new Browser(), {
      email: BOB,
      name: "Bob Ross",
      username: "bob",
      password: TEST_PASSWORD,
      [field]: field === "role" ? "admin" : field === "initials" ? "XX" : admin.id,
    });
    check(`posting ${field} at sign-up is refused outright`, spoof.status === 400,
          `status ${spoof.status} ${(await spoof.clone().text()).slice(0, 90)}`);
  }
  check("and none of those attempts left an account behind",
        (await db.user.count({ where: { email: BOB } })) === 0);

  // The undeclared ones — `id`, `emailVerified` — used to reach the endpoint
  // and be overruled, and this check registered Bob to prove it. That it could
  // register him at all, with an invitation and no link, was the hole. The
  // stamping itself is asserted in section 3, on the account the link opened.
  await clearRateLimit();
  const bare = await signUp(new Browser(), {
    email: BOB,
    name: "Bob Ross",
    username: "bob",
    password: TEST_PASSWORD,
    id: "chosen-by-attacker",
    emailVerified: false,
  });
  check("a sign-up with no privileged fields, and no link, is refused too", bare.status === 403,
        `status ${bare.status}`);
  check("so Bob has no account until he uses his link",
        (await db.user.count({ where: { email: BOB } })) === 0);

  // ------------------------------------------------------------------------
  section("11. the admin can reset a forgotten password");
  await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });
  const guestList = await (await ruben.go(`${APP}/admin/invites`)).text();
  check("members are listed with a recovery control",
        guestList.includes("Ayla Berg") && guestList.includes("Forgotten password?"));

  const resetForm = formContaining(guestList, `value="${account!.id}"`);
  check("the control targets the right member", resetForm !== null);
  const reset = await ruben.submit(`${APP}/admin/invites`, resetForm ?? "", {
    userId: account!.id,
  });
  check("triggering it is accepted", reset.status < 400, `status ${reset.status}`);
  check("it is audited as a request, by the admin who made it",
        (await db.auditEvent.count({
          where: { action: "password.reset_requested", actorId: admin.id },
        })) === 1);

  // Mail is configured in this run, so the link goes to her and NOT back to
  // the admin — the same rule invitations follow.
  const resetBody = await reset.clone().text();
  check("with mail working, the link is not handed back to the admin",
        !SET_PASSWORD_LINK.test(resetBody),
        "the admin was shown a link that had already been emailed");

  const setUrl = await mailLink(AYLA, SET_PASSWORD_LINK);
  check("a set-password email arrived", setUrl !== null, String(setUrl));
  if (!setUrl) throw new Error("no set-password link; cannot continue");

  const recovering = new Browser();
  const setPage = await (await recovering.go(setUrl)).text();
  check("the link opens a set-password form", setPage.includes('name="password"'));
  check("and it does NOT sign anybody in", !signedIn(recovering),
        "following a reset link established a session");

  // The same page in both languages; opening it does not spend the link.
  const ENGLISH_SET = [
    "New key, cut fresh",
    "Pick a password, Ayla",
    "New password",
    "At least 10 characters, and not a breached one.",
    "Save this password",
    "Did not ask for this? Have a word with whoever runs the printer before you use it.",
  ];
  const setEnglish = visibleText(setPage);
  const setMissing = ENGLISH_SET.filter((s) => !setEnglish.includes(s));
  check("the set-password page is English by default, word for word",
        setMissing.length === 0, `missing: ${setMissing.join(" | ")}`);
  const setFrenchHtml = await (await new Browser().go(setUrl, { headers: FRENCH })).text();
  const setFrench = visibleText(setFrenchHtml);
  check("and French to a French reader",
        htmlLang(setFrenchHtml) === "fr" &&
          ["Une clé toute neuve", "Choisissez un mot de passe, Ayla", "Nouveau mot de passe",
           "Enregistrer ce mot de passe", "Vous n’avez rien demandé"].every((s) => setFrench.includes(s)),
        setFrench.slice(0, 300));
  const setLeft = ENGLISH_SET.filter((s) => setFrench.includes(s));
  check("with none of its English left", setLeft.length === 0, setLeft.join(" | "));
  // Refused by the schema, before the link is even looked up.
  const tooShort = unescapeHtml(await (await recovering.submit(setUrl, setPage, { password: "short" }, FRENCH)).text());
  check("a password that is too short is refused in French to a French reader",
        tooShort.includes("Un mot de passe compte au moins 10 caractères."));

  // A breached password is refused here too — and, crucially, does not burn
  // the link on the way out.
  const refused = await recovering.submit(setUrl, setPage, { password: "Password123!" });
  check("a breached password is refused at the set-password form",
        /breach|compromis/i.test(await refused.clone().text()),
        "a corpus password was accepted");
  // Better Auth's refusal, by its code: the library's English above, the
  // catalogue's French here. The link survives this one too (checked next).
  const refusedFr = unescapeHtml(await (await recovering.submit(
    setUrl, await (await recovering.go(setUrl)).text(), { password: "Password123!" }, FRENCH)).text());
  check("and refused in French to a French reader",
        refusedFr.includes("Ce mot de passe figure dans une fuite connue.") &&
          !refusedFr.includes("appears in a known breach"));

  const NEW_PASSWORD = "ppp-suite-second-key-parked-outside";
  const stillGood = await (await recovering.go(setUrl)).text();
  check("the link survives a refused password", stillGood.includes('name="password"'),
        "being told to pick another password spent the link");

  const done = await recovering.submit(setUrl, stillGood, { password: NEW_PASSWORD });
  check("a good password is accepted", done.status >= 300 && done.status < 400,
        `status ${done.status}`);
  check("and it is audited as completed",
        (await db.auditEvent.count({
          where: { action: "password.reset_completed", subject: AYLA },
        })) === 1);

  await clearRateLimit();
  const oldTry = await signInWithPassword(new Browser(), APP, "ayla", TEST_PASSWORD);
  check("the old password stops working", oldTry.status === 401, `status ${oldTry.status}`);

  const newBrowser = new Browser();
  const newTry = await signInWithPassword(newBrowser, APP, "ayla", NEW_PASSWORD);
  check("the new one works", newTry.status === 200 && signedIn(newBrowser),
        `status ${newTry.status}`);

  const spent = await (await new Browser().go(setUrl)).text();
  check("and the link is spent once it has been used", spent.includes("spent"),
        "a used set-password link still opened the form");

  check("her earlier session was revoked with the password",
        (await (await ayla.raw(`${APP}/api/auth/get-session`)).text()).length < 5,
        "a session opened with the old password outlived it");

  // ------------------------------------------------------------------------
  section("12. reset tokens are not stored in a form anyone can replay");
  const rawToken = new URL(setUrl).searchParams.get("token")!;
  const rows = await db.verification.findMany();
  check("no verification row holds the raw token",
        rows.every((v) => v.identifier !== rawToken && !v.identifier.includes(rawToken)),
        "a raw set-password token was found in the verification table");

  // ------------------------------------------------------------------------
  section("mail is optional, not required");

  // With a transport configured the raw token stays inside the message: the
  // caller gets no handover URL, so the admin cannot replay the link.
  const withMail = await createInvite({
    email: "mailed@office.example",
    invitedById: admin.id,
  });
  check("with mail configured, the link is emailed and withheld from the caller",
        withMail.handoverUrl === undefined,
        "the raw token was handed back even though it was delivered");
  check("and it really was delivered",
        (await mailLink("mailed@office.example", CLAIM_LINK)) !== null);

  // With none, the same call hands the link back so it can be passed on.
  // Restored afterwards so the rest of the run is unaffected.
  const savedSmtp = process.env.SMTP_URL;
  const savedResend = process.env.RESEND_API_KEY;
  delete process.env.SMTP_URL;
  delete process.env.RESEND_API_KEY;
  check("mailConfigured() reflects the environment", mailConfigured() === false);

  const noMail = await createInvite({
    email: "handover@office.example",
    invitedById: admin.id,
  });
  check("with no transport, the admin gets a link to hand over",
        typeof noMail.handoverUrl === "string" &&
        noMail.handoverUrl.includes("/invite/"),
        String(noMail.handoverUrl));
  check("and nothing was sent",
        (await mailLink("handover@office.example", CLAIM_LINK)) === null,
        "a message went out with no transport configured");

  if (savedSmtp) process.env.SMTP_URL = savedSmtp;
  if (savedResend) process.env.RESEND_API_KEY = savedResend;
  check("the transport comes back when the environment does", mailConfigured() === true);

  // The handed-over link has to actually work, or the mode is theatre.
  const handoverBrowser = new Browser();
  const handoverPage = await (await handoverBrowser.go(noMail.handoverUrl!)).text();
  check("a handed-over invite link opens the claim page",
        handoverPage.includes("will print things for you"));

  // The claim page in both languages, while this invitation is still open.
  // A GET does not spend it, and a refused form does not either.
  const ENGLISH_CLAIM = [
    "Your table is ready",
    "will print things for you",
    "Your email",
    "What should we call you?",
    "Pick a username",
    "And a password",
    "At least 10 characters. Length beats punctuation.",
    "Create your account",
    "This link registers the account — there is no second email.",
  ];
  const claimEnglish = visibleText(handoverPage);
  const claimMissing = ENGLISH_CLAIM.filter((s) => !claimEnglish.includes(s));
  check("the claim page is English by default, word for word",
        claimMissing.length === 0, `missing: ${claimMissing.join(" | ")}`);
  const claimFrenchHtml = await (await new Browser().go(noMail.handoverUrl!, { headers: FRENCH })).text();
  const claimFrench = visibleText(claimFrenchHtml);
  check("and French to a French reader, the form included",
        htmlLang(claimFrenchHtml) === "fr" &&
          ["Votre table est prête", "imprimera des choses pour vous", "Comment doit-on vous appeler",
           "Choisissez un nom d’utilisateur", "Créer votre compte", "Ouvert · entrez donc"]
            .every((s) => claimFrench.includes(s)),
        claimFrench.slice(0, 300));
  const claimLeft = ENGLISH_CLAIM.filter((s) => claimFrench.includes(s));
  check("with none of its English left", claimLeft.length === 0, claimLeft.join(" | "));
  const shortName = { name: "Handover", username: "ab", password: TEST_PASSWORD };
  // Read raw rather than as visible text: what matters is what the action
  // answered, wherever in the response it lands.
  const refusedEnglish = unescapeHtml(await (await handoverBrowser.submit(
    noMail.handoverUrl!, handoverPage, shortName)).text());
  check("a refused username is explained in English by default",
        refusedEnglish.includes("A username needs at least 3 characters."));
  const refusedFrench = unescapeHtml(await (await handoverBrowser.submit(
    noMail.handoverUrl!, handoverPage, shortName, FRENCH)).text());
  check("and in French to a French reader",
        refusedFrench.includes("Un nom d’utilisateur compte au moins 3 caractères.") &&
          !refusedFrench.includes("A username needs at least 3 characters."));
  check("neither refusal opened the account",
        (await db.user.count({ where: { email: "handover@office.example" } })) === 0);

  await db.invite.deleteMany({
    where: { email: { in: ["mailed@office.example", "handover@office.example"] } },
  });

  // ------------------------------------------------------------------------
  section("14. the printer owner bootstraps from a printed link");

  // Exactly the state a fresh deploy is in: an admin row that nobody invited,
  // with no username and no password. The seed prints a link for this; here
  // the link is minted directly so the check does not depend on scraping
  // container logs.
  await db.account.deleteMany({ where: { userId: admin.id, providerId: "credential" } });
  await db.user.update({
    where: { id: admin.id },
    data: { username: null, displayUsername: null },
  });

  const bootstrapUrl = await issuePasswordSetupUrl(admin.id);
  const owner = new Browser();
  const bootstrapPage = await (await owner.go(bootstrapUrl)).text();
  check("an account with no username is asked for one",
        bootstrapPage.includes('name="username"') && bootstrapPage.includes('name="password"'),
        "the bootstrap link did not offer a username field");

  const OWNER_PASSWORD = "ppp-suite-owner-key-parked-outside";
  const bootstrapped = await owner.submit(bootstrapUrl, bootstrapPage, {
    username: "Ruben",
    password: OWNER_PASSWORD,
  });
  check("submitting it is accepted",
        bootstrapped.status >= 300 && bootstrapped.status < 400,
        `status ${bootstrapped.status}`);

  const ownerRow = await db.user.findUnique({ where: { id: admin.id } });
  check("the username is stored folded, with what was typed kept alongside",
        ownerRow?.username === "ruben" && ownerRow.displayUsername === "Ruben",
        JSON.stringify({ username: ownerRow?.username,
                         displayUsername: ownerRow?.displayUsername }));

  await clearRateLimit();
  const ownerIn = new Browser();
  const ownerSignIn = await signInWithPassword(ownerIn, APP, "ruben", OWNER_PASSWORD);
  check("and the printer owner can sign in with it",
        ownerSignIn.status === 200 && signedIn(ownerIn), `status ${ownerSignIn.status}`);

  const ownerHome = await (await ownerIn.go(`${APP}/admin/invites`)).text();
  check("as the admin, not as a client", ownerHome.includes("The guest list"));

  // --------------------------------------------------------------------------
  section("13. the database itself permits only one admin");
  check("exactly one admin exists",
        (await db.user.count({ where: { role: "admin" } })) === 1);
  // A client with logging off: the constraint violation below is the expected
  // result, and the shared client would print it as though something broke.
  const quiet = new PrismaClient({ log: [] });
  let rejected = false;
  try {
    await quiet.user.create({
      data: {
        email: "usurper@nowhere.test",
        name: "Usurper",
        initials: "US",
        role: "admin",
      },
    });
  } catch {
    rejected = true;
  } finally {
    await quiet.$disconnect();
  }
  check("a second admin row is rejected by the partial unique index", rejected);

  // ------------------------------------------------------------------------
  section("15. the sign-in page and the header speak the reader's language");
  // English is what every other check in every suite reads, so the first job
  // here is to pin it: the same words as before translation existed, whatever
  // a browser that is not asking for French sends. Then French, for the two
  // screens that have it.
  const signinIn = async (acceptLanguage?: string, query = "") => {
    const headers: Record<string, string> = acceptLanguage ? { "accept-language": acceptLanguage } : {};
    return (await new Browser().go(`${APP}/signin${query}`, { headers })).text();
  };
  const ENGLISH_SIGNIN = [
    "Open · come on in",
    "Members only · ask at the counter",
    "What’ll it be?",
    "Use the passkey on this device, or your username and password.",
    "Username",
    "Password",
    "Sign in",
    "Pretty Please Print is invite-only — there is no sign-up. If you have not " +
      "been invited yet, or you have forgotten your password, ask whoever owns the printer.",
  ];

  const plain = await signinIn();
  const plainText = visibleText(plain);
  const missingEnglish = ENGLISH_SIGNIN.filter((s) => !plainText.includes(s));
  check("with no Accept-Language the page is English, word for word",
        missingEnglish.length === 0, `missing: ${missingEnglish.join(" | ")}`);
  check("and says so: <html lang=\"en\">", htmlLang(plain) === "en", `lang=${htmlLang(plain)}`);
  for (const header of ["en-GB,en;q=0.9", "de-DE,de;q=0.9", "*", "fr;q=0, en"]) {
    const text = visibleText(await signinIn(header));
    check(`Accept-Language "${header}" renders exactly the same English text`,
          text === plainText, firstDifference(plainText, text));
  }

  const french = await signinIn("fr-FR,fr;q=0.9,en;q=0.8");
  const frenchText = visibleText(french);
  check("Accept-Language fr renders <html lang=\"fr\">", htmlLang(french) === "fr", `lang=${htmlLang(french)}`);
  check("and the sign-in page in French",
        frenchText.includes("Qu’est-ce que je vous sers") && frenchText.includes("Nom d’utilisateur"),
        frenchText.slice(0, 200));
  const leftInEnglish = ENGLISH_SIGNIN.filter((s) => frenchText.includes(s));
  check("with none of the English copy left in it", leftInEnglish.length === 0, leftInEnglish.join(" | "));
  check("a language this app lacks, ranked above French, still gets French",
        htmlLang(await signinIn("de, fr;q=0.5")) === "fr");

  check("an error code is explained in English by default",
        visibleText(await signinIn(undefined, "?error=INVALID_TOKEN"))
          .includes("That link is no longer valid. Ask the printer owner for a fresh one."));
  check("and in French to a French reader",
        visibleText(await signinIn("fr", "?error=INVALID_TOKEN")).includes("Ce lien n’est plus valable."));
  check("an unknown code gets the generic sentence, even one that names a property",
        visibleText(await signinIn(undefined, "?error=toString"))
          .includes("That sign-in attempt did not go through."));

  // The header, as the printer owner: it carries most of the diner's words.
  const queueIn = async (acceptLanguage?: string) =>
    (await ownerIn.go(`${APP}/queue`, {
      headers: acceptLanguage ? { "accept-language": acceptLanguage } : {},
    })).text();
  const ownerEnglish = visibleText(await queueIn());
  check("the header's navigation is English by default",
        ["The pass", "The rail", "The books", "Guest list", "Activity"].every((s) => ownerEnglish.includes(s)),
        ownerEnglish.slice(0, 300));
  const ownerFrenchHtml = await queueIn("fr");
  const ownerFrench = visibleText(ownerFrenchHtml);
  check("and French to a French reader",
        htmlLang(ownerFrenchHtml) === "fr" &&
          ["Le passe", "Le rail", "La caisse", "Liste des invités", "Activité"].every((s) => ownerFrench.includes(s)),
        ownerFrench.slice(0, 300));
  check("with none of the English navigation left in it",
        !["The pass", "The rail", "The books", "Guest list"].some((s) => ownerFrench.includes(s)));

  // ------------------------------------------------------------------------
  section("16. the entry screens speak the reader's language");
  // Each one the same way as the sign-in page above: the English pinned word
  // for word, the same English whatever a browser not asking for French
  // sends, then French with none of that English left.
  const inBoth = async (
    name: string,
    open: (headers: Record<string, string>) => Promise<string>,
    english: string[],
    french: string[],
  ) => {
    const plainHtml = await open({});
    const plainText = visibleText(plainHtml);
    const missing = english.filter((s) => !plainText.includes(s));
    check(`${name}: English by default, word for word`, missing.length === 0,
          `missing: ${missing.join(" | ")}`);
    for (const header of ["en-GB,en;q=0.9", "de-DE,de;q=0.9", "*"]) {
      const text = visibleText(await open({ "accept-language": header }));
      check(`${name}: Accept-Language "${header}" renders the same English`,
            text === plainText, firstDifference(plainText, text));
    }
    const frenchHtml = await open(FRENCH);
    const frenchText = visibleText(frenchHtml);
    const absent = french.filter((s) => !frenchText.includes(s));
    check(`${name}: French to a French reader`,
          htmlLang(frenchHtml) === "fr" && absent.length === 0,
          `missing: ${absent.join(" | ")} — ${frenchText.slice(0, 200)}`);
    const left = english.filter((s) => frenchText.includes(s));
    check(`${name}: with none of the English left`, left.length === 0, left.join(" | "));
  };
  const anonymous = (path: string) => async (headers: Record<string, string>) =>
    (await new Browser().go(`${APP}${path}`, { headers })).text();

  await inBoth("an invitation link that means nothing", anonymous("/invite/no-such-token"),
    ["Open · come on in", "Your table is ready", "That link means nothing to us",
     "Ask whoever owns the printer to send a fresh one.", "Go to sign in →"],
    ["Ouvert · entrez donc", "Votre table est prête", "Ce lien ne nous dit rien", "Aller à la connexion →"]);
  await inBoth("a spent set-password link", anonymous("/set-password"),
    ["New key, cut fresh", "That link is spent", "Set-password links work once and expire quickly.",
     "Go to sign in →"],
    ["Une clé toute neuve", "Ce lien a déjà servi", "Aller à la connexion →"]);

  // /welcome, as the member who registered above. Rendered on the server, the
  // passkey prompt has not looked for passkey support yet, so it offers the
  // way in without one.
  await clearRateLimit();
  const member = new Browser();
  await signInWithPassword(member, APP, "ayla", NEW_PASSWORD);
  const asMember = (path: string) => async (headers: Record<string, string>) =>
    (await member.go(`${APP}${path}`, { headers })).text();
  await inBoth("the welcome page", asMember("/welcome"),
    ["You’re in", "Welcome, Ayla", "One last thing worth thirty seconds: save a passkey.",
     "This browser does not do passkeys.", "Take me in"],
    ["Vous êtes des nôtres", "Bienvenue, Ayla", "Une dernière chose qui vaut trente secondes",
     "Ce navigateur ne gère pas les clés d’accès.", "Entrer"]);

  // /reauth only shows to a sign-in older than the sudo window: age this one.
  await db.session.updateMany({
    where: { token: member.sessionToken() },
    data: { createdAt: new Date(Date.now() - 60 * 60 * 1000) },
  });
  await inBoth("the re-authentication page", asMember("/reauth?next=%2Fme"),
    ["One more time, please", "Is that still you?",
     "A password or a passkey confirms it is you at the keyboard and not a browser somebody left open.",
     "Password for Ayla"],
    ["Encore une fois, s’il vous plaît", "C’est toujours vous", "Mot de passe du compte Ayla", "Confirmer"]);

  check("the sign-in page's notice says its tone in French too",
        visibleText(await signinIn("fr", "?reset=1")).includes("C’est bon Mot de passe enregistré."));

  // ------------------------------------------------------------------------
  console.info(
    "\n" + (failures.length === 0
      ? "ALL CHECKS PASSED"
      : `${failures.length} FAILED:\n  - ${failures.join("\n  - ")}`),
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}

/** A stored password must be a digest, never the password itself. */
async function passwordIsHashed(userId: string): Promise<boolean> {
  const account = await db.account.findFirst({
    where: { userId, providerId: "credential" },
    select: { password: true },
  });
  const stored = account?.password ?? "";
  return stored.length > 0 && !stored.includes(TEST_PASSWORD);
}

/**
 * What a reader sees: the markup without scripts, styles or tags, entities
 * decoded, whitespace collapsed. Scripts go first because the RSC payload in
 * them carries every message string, so a check on the raw HTML would find
 * English in a French page that shows none.
 */
function visibleText(html: string): string {
  return unescapeHtml(
    html
      .replace(/<script\b[\s\S]*?<\/script>/g, " ")
      .replace(/<style\b[\s\S]*?<\/style>/g, " ")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

const htmlLang = (html: string) => /<html\b[^>]*\blang="([^"]*)"/.exec(html)?.[1] ?? null;

/** Where two texts part, for a failure message that says what changed. */
function firstDifference(a: string, b: string): string {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `differs at ${i}: "${a.slice(Math.max(0, i - 30), i + 40)}" vs "${b.slice(Math.max(0, i - 30), i + 40)}"`;
}

/** The one `<form>` on the page whose markup contains a marker. */
function formContaining(html: string, marker: string): string | null {
  const forms = html.match(/<form\b[\s\S]*?<\/form>/g) ?? [];
  return forms.find((f) => f.includes(marker)) ?? null;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
