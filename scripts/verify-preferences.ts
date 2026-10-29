import "./_env";
/**
 * End-to-end check of a person's preferences on /me — language, theme, slicer
 * — and how they meet the instance's defaults.
 *
 *   npm run verify:preferences
 *
 * Two halves, like verify:settings. The order of precedence is three pure
 * functions (`resolveLocale`, `resolveTheme`, `resolveSlicer`) and is called
 * directly with every combination. Then the stack, driven over HTTP the way a
 * JavaScript-off browser does, asserting what a person sees: `<html lang>`,
 * `<html data-theme>`, the slicer button's label, and the row behind them.
 *
 * Saving the defaults through /admin/settings is verify:settings' job; here
 * they are written to the row directly, so this suite is about what a person
 * gets from them.
 *
 * DESTRUCTIVE: sets the instance's defaults (and puts them back), creates and
 * removes two members and their tickets. Development database only.
 */
import { db } from "../src/lib/db";
import { resolveLocale } from "../src/i18n/locales";
import { parsePreferencesForm, readPreferences } from "../src/lib/preferences";
import { resolveSlicer } from "../src/lib/slicers";
import { resolveTheme } from "../src/lib/theme";
import { VIEWER_MAX_BYTES } from "../src/lib/upload-limits";
import { ensureCredentials, signInWithPassword, usernameFor } from "./_accounts";

const APP = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

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

/**
 * A cookie jar that sends one `Accept-Language` on every request, redirects
 * included — what a browser does, and what "a French preference beats an
 * English browser" has to be tested against.
 */
class Browser {
  jar = new Map<string, string>();
  constructor(public acceptLanguage = "en") {}
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
    if (this.acceptLanguage) h["accept-language"] = this.acceptLanguage;
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
  async page(path: string) {
    return unescapeHtml(await (await this.go(`${APP}${path}`)).text());
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
}

const htmlAttr = (html: string, attr: string) =>
  new RegExp(`<html\\b[^>]*\\b${attr}="([^"]*)"`).exec(html)?.[1] ?? null;
const lang = (html: string) => htmlAttr(html, "lang");
const theme = (html: string) => htmlAttr(html, "data-theme");
/** The slicer button's label: the text after the wedge in its <summary>. */
const slicerButton = (html: string) =>
  /<summary\b[^>]*>[\s\S]*?▸<\/span>([^<]*)<\/summary>/.exec(html)?.[1]?.trim() ?? null;

/** Index of the first form whose markup contains every substring. */
function findForm(html: string, contains: string[]): number {
  const forms = html.match(/<form\b[\s\S]*?<\/form>/g) ?? [];
  return forms.findIndex((f) => contains.every((s) => f.includes(s)));
}

async function signIn(user: { id: string; email: string }, acceptLanguage = "en"): Promise<Browser> {
  const b = new Browser(acceptLanguage);
  await db.$executeRawUnsafe('DELETE FROM "rateLimit"');
  await ensureCredentials(APP, user.id, usernameFor(user.email));
  await signInWithPassword(b, APP, usernameFor(user.email));
  return b;
}

const prefsOf = (id: string) =>
  db.user.findUniqueOrThrow({
    where: { id },
    select: { preferredLocale: true, preferredTheme: true, preferredSlicer: true },
  });

async function setDefaults(d: { defaultLocale?: string | null; defaultTheme?: string | null; defaultSlicer?: string | null }) {
  await db.instanceSettings.upsert({ where: { id: 1 }, create: { id: 1, ...d }, update: d });
}

/**
 * A ticket row, no file behind it: the page only reads the row. `fileSize`
 * over the viewer's limit draws the "too big to preview" note, which names
 * the slicer button too.
 */
function ticket(title: string, uploaderId: string, fileSize = 1234) {
  return db.story.create({
    data: {
      title, status: "Requested", uploaderId,
      material: "PETG", colorName: "Slate", colorHex: "#4a5d78", tip: "A beer",
      quantity: 1, note: "", filename: "part.stl", fileSize,
      mimeType: "model/stl", storageKey: `k-${title}`, dims: "10 × 10 × 10 mm",
    },
  });
}

async function main() {
  // ------------------------------------------------------------------
  section("the order, with every combination");

  check("theme: a person's choice wins over the instance's",
        resolveTheme({ preference: "diner", instanceDefault: "after-hours" }) === "diner");
  check("theme: no choice follows the instance",
        resolveTheme({ preference: null, instanceDefault: "after-hours" }) === "after-hours");
  check("theme: neither is the diner", resolveTheme({ preference: null, instanceDefault: null }) === "diner");

  check("slicer: a person's choice wins over the instance's",
        resolveSlicer({ preference: "elegoo", instanceDefault: "orca" }) === "elegoo");
  check("slicer: no choice follows the instance",
        resolveSlicer({ preference: null, instanceDefault: "orca" }) === "orca");
  check("slicer: neither is PrusaSlicer", resolveSlicer({ preference: null, instanceDefault: null }) === "prusa");

  check("language: a French choice beats an English browser",
        resolveLocale({ preference: "fr", acceptLanguage: "en-GB,en;q=0.9", instanceDefault: "en" }) === "fr");
  check("language: an English choice beats a French browser and a French house",
        resolveLocale({ preference: "en", acceptLanguage: "fr", instanceDefault: "fr" }) === "en");
  check("language: with no choice, the browser beats the house",
        resolveLocale({ preference: null, acceptLanguage: "en", instanceDefault: "fr" }) === "en");
  check("language: a browser asking for nothing we speak gets the house's",
        resolveLocale({ preference: null, acceptLanguage: "de-DE,de;q=0.9", instanceDefault: "fr" }) === "fr");
  check("language: no header gets the house's",
        resolveLocale({ preference: null, acceptLanguage: null, instanceDefault: "fr" }) === "fr");
  check("language: nothing at all is English",
        resolveLocale({ preference: null, acceptLanguage: null, instanceDefault: null }) === "en");

  const stale = readPreferences({ preferredLocale: "de", preferredTheme: "neon", preferredSlicer: "simplify3d" });
  check("a stored value this version does not have reads as 'follow the house'",
        stale.locale === null && stale.theme === null && stale.slicer === null, JSON.stringify(stale));

  const form = new FormData();
  form.set("locale", "fr");
  form.set("theme", "");
  form.set("userId", "someone-else");
  const parsed = parsePreferencesForm(form);
  check("the form: a choice is stored, an empty one is null, an absent one untouched",
        "changes" in parsed && parsed.changes.preferredLocale === "fr" && parsed.changes.preferredTheme === null &&
        !("preferredSlicer" in parsed.changes), JSON.stringify(parsed));
  check("and nothing in it names whose row",
        "changes" in parsed && Object.keys(parsed.changes).every((k) => k.startsWith("preferred")));
  const neon = new FormData();
  neon.set("theme", "neon");
  check("a value that is not on the list is refused", "problem" in parsePreferencesForm(neon));

  // ------------------------------------------------------------------
  section("setup");
  await db.$executeRawUnsafe('DELETE FROM "rateLimit"');
  const before = await db.instanceSettings.findUnique({ where: { id: 1 } });
  await setDefaults({ defaultLocale: null, defaultTheme: "after-hours", defaultSlicer: "orca" });

  const admin = await db.user.findFirst({ where: { role: "admin" } });
  if (!admin) throw new Error("No admin — run npm run db:seed");
  const emails = ["sam-prefs@office.example", "kim-prefs@office.example"];
  await db.story.deleteMany({ where: { uploader: { email: { in: emails } } } });
  await db.user.deleteMany({ where: { email: { in: emails } } });
  const [sam, kim] = await Promise.all(
    [["Sam Ortiz", "SO"], ["Kim Laine", "KL"]].map(([name, initials], i) =>
      db.user.create({
        data: { email: emails[i]!, name: name!, initials: initials!, role: "client", emailVerified: true, invitedById: admin.id },
      }),
    ),
  );
  const samTicket = await ticket("prefs-sam-bracket", sam!.id, VIEWER_MAX_BYTES + 1);
  const kimTicket = await ticket("prefs-kim-hook", kim!.id);
  const adminPrefsBefore = await prefsOf(admin.id);
  await db.user.update({ where: { id: admin.id }, data: { preferredLocale: null, preferredTheme: null, preferredSlicer: null } });

  const samB = await signIn(sam!);
  const kimB = await signIn(kim!);
  const ruben = await signIn(admin);
  console.info(`  sam=${sam!.email}  kim=${kim!.email}  owner=${admin.email}`);

  try {
    // ----------------------------------------------------------------
    section("nobody has chosen: the instance's defaults");
    let me = await samB.page("/me");
    check("/me is drawn in the house's theme", theme(me) === "after-hours", `data-theme=${theme(me)}`);
    check("and in the browser's language", lang(me) === "en", `lang=${lang(me)}`);
    check("the preferences form is there, with the three choices",
          findForm(me, ['name="locale"', 'name="theme"', 'name="slicer"']) >= 0);
    check("each opens on the house's choice, named",
          me.includes('<option value="" selected="">Same as the house (Diner after hours)</option>') &&
          me.includes("Same as the house (OrcaSlicer)"),
          (/<select[^>]*name="theme"[\s\S]*?<\/select>/.exec(me) ?? ["no theme select"])[0]);
    let story = await samB.page(`/story/${samTicket.id}`);
    check("the ticket's button names the house's slicer", slicerButton(story) === "Open in OrcaSlicer",
          `button: ${slicerButton(story)}`);
    check("and so does its help text", story.includes("Opens OrcaSlicer on <strong>this</strong> machine"));
    check("and so does the too-big-to-preview note", story.includes("<strong>Open in OrcaSlicer</strong> both work on it"));
    check("PrusaSlicer is not named anywhere on the ticket", !story.includes("PrusaSlicer"));

    const signedOut = new Browser("");
    let signin = await signedOut.page("/signin");
    check("signed out, the sign-in page is in the house's theme", theme(signin) === "after-hours",
          `data-theme=${theme(signin)}`);
    check("and, with no language set anywhere, English", lang(signin) === "en", `lang=${lang(signin)}`);

    await setDefaults({ defaultLocale: "fr" });
    signin = await signedOut.page("/signin");
    check("a French house speaks French to a browser that asks for nothing",
          lang(signin) === "fr" && signin.includes("Qu’est-ce que je vous sers"), `lang=${lang(signin)}`);
    signin = await new Browser("en-US,en;q=0.9").page("/signin");
    check("but English to a browser that asks for English", lang(signin) === "en", `lang=${lang(signin)}`);
    signin = await new Browser("de").page("/signin");
    check("and French to one that asks for a language we do not speak", lang(signin) === "fr", `lang=${lang(signin)}`);
    await setDefaults({ defaultLocale: null });

    // ----------------------------------------------------------------
    section("a person's choice wins over the house's");
    me = await samB.page("/me");
    let saved = await samB.submit(`${APP}/me`, me, findForm(me, ['name="theme"']), {
      locale: "fr", theme: "diner", slicer: "elegoo",
    });
    check("saving answers with a redirect back to /me", saved.status === 303 &&
          (saved.headers.get("location") ?? "").includes("/me?preferences=saved"),
          `status ${saved.status}, ${saved.headers.get("location")}`);
    let row = await prefsOf(sam!.id);
    check("the row holds the three choices",
          row.preferredLocale === "fr" && row.preferredTheme === "diner" && row.preferredSlicer === "elegoo",
          JSON.stringify(row));

    me = await samB.page("/me");
    check("a French preference beats the browser's English: <html lang=\"fr\">", lang(me) === "fr",
          `lang=${lang(me)} with Accept-Language: ${samB.acceptLanguage}`);
    check("the form itself is in French", me.includes("À votre goût"));
    check("the diner, chosen, beats the house's after hours", theme(me) === "diner", `data-theme=${theme(me)}`);
    check("the form opens on what was chosen",
          /<option value="diner" selected="">/.test(me) && /<option value="elegoo" selected="">/.test(me));
    story = await samB.page(`/story/${samTicket.id}`);
    check("the ticket's button names the chosen slicer, in French",
          slicerButton(story) === "Ouvrir dans ElegooSlicer", `button: ${slicerButton(story)}`);
    check("the too-big-to-preview note names the button as it reads",
          story.includes("<strong>Ouvrir dans ElegooSlicer</strong>") && !story.includes("OrcaSlicer"));

    me = await samB.page("/me");
    await samB.submit(`${APP}/me`, me, findForm(me, ['name="theme"']), { locale: "", slicer: "other" });
    story = await samB.page(`/story/${samTicket.id}`);
    check("'another slicer' is named as yours, in the language of the page",
          slicerButton(story) === "Open in your slicer" && lang(story) === "en",
          `button: ${slicerButton(story)}, lang=${lang(story)}`);
    check("and a language left to the house is the browser's again", lang(story) === "en");

    me = await samB.page("/me");
    await samB.submit(`${APP}/me`, me, findForm(me, ['name="theme"']), { theme: "" });
    row = await prefsOf(sam!.id);
    me = await samB.page("/me");
    check("back to 'same as the house' stores null and follows the house again",
          row.preferredTheme === null && theme(me) === "after-hours", `${row.preferredTheme} / ${theme(me)}`);
    check("a choice not on this save is left as it was", row.preferredSlicer === "other");

    const kimStory = await kimB.page(`/story/${kimTicket.id}`);
    check("someone who never chose still gets the house's, unaffected by Sam",
          theme(kimStory) === "after-hours" && slicerButton(kimStory) === "Open in OrcaSlicer",
          `${theme(kimStory)} / ${slicerButton(kimStory)}`);

    await samB.submit(`${APP}/me`, me, findForm(me, ['name="theme"']), { theme: "auto" });
    me = await samB.page("/me");
    check("'follow the system' is written as auto, for the CSS to resolve", theme(me) === "auto", `data-theme=${theme(me)}`);

    // ----------------------------------------------------------------
    section("nobody changes anyone else's");
    const kimBefore = await prefsOf(kim!.id);
    me = await samB.page("/me");
    const forged = await samB.submit(`${APP}/me`, me, findForm(me, ['name="theme"']), {
      userId: kim!.id, id: kim!.id, email: kim!.email, theme: "after-hours", slicer: "bambu",
    });
    check("a form naming another person is still a save — of the sender's own row",
          forged.status === 303 && (await prefsOf(sam!.id)).preferredSlicer === "bambu");
    check("the other person's row has not moved",
          JSON.stringify(await prefsOf(kim!.id)) === JSON.stringify(kimBefore), JSON.stringify(await prefsOf(kim!.id)));

    const samNow = await prefsOf(sam!.id);
    const anonymous = new Browser("en");
    const anon = await anonymous.submit(`${APP}/me`, me, findForm(me, ['name="theme"']), {
      theme: "diner", slicer: "cura",
    });
    check("signed out, the form changes nobody's",
          anon.status < 400 && JSON.stringify(await prefsOf(sam!.id)) === JSON.stringify(samNow) &&
          JSON.stringify(await prefsOf(kim!.id)) === JSON.stringify(kimBefore),
          `status ${anon.status}, ${anon.headers.get("location")}`);
    check("and is sent to sign in", (anon.headers.get("location") ?? "").includes("/signin"),
          `location ${anon.headers.get("location")}`);

    // The middleware turns a request with no session cookie away before any
    // page or action runs, so the case above never reaches the action. A
    // cookie whose session has been revoked does: only the action's own
    // check stands between it and a write.
    const revoked = new Browser("en");
    await db.$executeRawUnsafe('DELETE FROM "rateLimit"');
    await signInWithPassword(revoked, APP, usernameFor(sam!.email));
    const revokedPage = await revoked.page("/me");
    await db.session.deleteMany({
      where: {
        token: decodeURIComponent(
          revoked.jar.get("ppp.session_token") ?? revoked.jar.get("__Secure-ppp.session_token") ?? "",
        ).split(".")[0],
      },
    });
    const late = await revoked.submit(`${APP}/me`, revokedPage, findForm(revokedPage, ['name="theme"']), {
      theme: "diner", slicer: "cura",
    });
    check("a revoked session that still holds its cookie changes nobody's either",
          JSON.stringify(await prefsOf(sam!.id)) === JSON.stringify(samNow) &&
          JSON.stringify(await prefsOf(kim!.id)) === JSON.stringify(kimBefore) &&
          (late.headers.get("location") ?? "").includes("/signin"),
          `status ${late.status}, ${late.headers.get("location")}`);

    const crafted = await samB.submit(`${APP}/me`, me, findForm(me, ['name="theme"']), { theme: "neon", slicer: "cura" });
    check("a value that is not on the list is refused, by redirect",
          (crafted.headers.get("location") ?? "").includes("preferences=refused"),
          `location ${crafted.headers.get("location")}`);
    check("and nothing in that save is kept, the valid part included",
          JSON.stringify(await prefsOf(sam!.id)) === JSON.stringify(samNow));

    me = await ruben.page("/me");
    check("the printer owner has the same form", findForm(me, ['name="theme"']) >= 0);
    await ruben.submit(`${APP}/me`, me, findForm(me, ['name="theme"']), { theme: "diner" });
    check("and it saves the owner's own row, nobody else's",
          (await prefsOf(admin.id)).preferredTheme === "diner" &&
          JSON.stringify(await prefsOf(sam!.id)) === JSON.stringify(samNow));
  } finally {
    // ----------------------------------------------------------------
    section("teardown");
    await db.story.deleteMany({ where: { id: { in: [samTicket.id, kimTicket.id] } } });
    await db.user.deleteMany({ where: { email: { in: emails } } });
    await db.user.update({ where: { id: admin.id }, data: adminPrefsBefore });
    if (before) {
      const { id: _id, updatedAt: _at, ...columns } = before;
      await db.instanceSettings.update({ where: { id: 1 }, data: columns });
    } else {
      await db.instanceSettings.deleteMany();
    }
    const after = await db.instanceSettings.findUnique({ where: { id: 1 } });
    check("the instance's settings are as they were",
          before ? after?.defaultTheme === before.defaultTheme && after?.defaultSlicer === before.defaultSlicer : !after);
  }

  console.info(
    `\n${passed} checks passed, ${failures.length} failed` +
      (failures.length ? `:\n  - ${failures.join("\n  - ")}` : ""),
  );
  process.exitCode = failures.length ? 1 : 0;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
