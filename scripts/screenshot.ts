/**
 * Renders the main screens to PNG so a design change can be looked at rather
 * than assumed.
 *
 *   npm run shots            # writes to ./shots (gitignored)
 *   SHOT_DIR=/tmp/x npm run shots
 *   SHOT_THEME=after-hours npm run shots   # in another theme (src/lib/theme.ts)
 *   SHOT_THEME=auto SHOT_SCHEME=dark npm run shots   # as a system set to dark
 *
 * Seeds a handful of tickets first, because an empty rail says nothing about
 * whether the rail works.
 *
 * Every page is also measured: each piece of text against the colour it
 * actually sits on, against WCAG AA. The worst pairs go to the log and all of
 * them to contrast.json beside the PNGs. It reports and does not fail — the
 * diner has pairs below AA that predate the measurement (docs/theming.md).
 *
 * DESTRUCTIVE: replaces stories and the demo client. Development only.
 */
import "./_env";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import puppeteer, { type Page } from "puppeteer-core";
import { db } from "../src/lib/db";
import { THEME_CHOICES } from "../src/lib/theme";
import { TEST_PASSWORD, ensureCredentials, usernameFor } from "./_accounts";

const APP = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const OUT = process.env.SHOT_DIR ?? "shots";

/**
 * A theme for the screenshots, which nobody can choose in the app yet.
 *
 * Written onto <html> as the document is parsed, before any stylesheet
 * applies or the 3D viewer reads its colours, so the page is drawn in it from
 * the first frame — the same as the server writing it. Test-only: the server
 * still says `data-theme="diner"`, and this overrides it in this browser.
 */
const THEME = process.env.SHOT_THEME;
if (THEME !== undefined && !(THEME_CHOICES as readonly string[]).includes(THEME)) {
  throw new Error(`SHOT_THEME=${THEME} is not a theme. Known: ${THEME_CHOICES.join(", ")}.`);
}
/** prefers-color-scheme for the browser — what `auto` follows. */
const SCHEME = process.env.SHOT_SCHEME;
if (SCHEME !== undefined && SCHEME !== "light" && SCHEME !== "dark") {
  throw new Error(`SHOT_SCHEME=${SCHEME}: light or dark.`);
}

/**
 * Any other media features to emulate, as `name=value,…` — the settings a
 * theme has to honour that the system, not the app, decides:
 *
 *   SHOT_THEME=glass SHOT_MEDIA=prefers-reduced-transparency=reduce npm run shots
 *   SHOT_THEME=glass SHOT_MEDIA=prefers-contrast=more npm run shots
 *
 * Sent to Chrome directly: puppeteer's emulateMediaFeatures accepts only the
 * colour scheme, reduced motion and the colour gamut.
 */
const MEDIA = (process.env.SHOT_MEDIA ?? "").split(",").filter(Boolean).map((pair) => {
  const [name, value] = pair.split("=");
  if (!name || !value || !/^[a-z-]+$/.test(name)) throw new Error(`SHOT_MEDIA: "${pair}" is not name=value.`);
  return { name, value };
});

/** SHOT_OVERLAYS=1 adds an open menu and a toast (see main). */
const OVERLAYS = process.env.SHOT_OVERLAYS === "1";

/** Set up a page the way every screenshot expects it. */
async function prepare(page: Page): Promise<void> {
  await page.setViewport({ width: 1280, height: 980, deviceScaleFactor: 1 });
  const features = [...(SCHEME ? [{ name: "prefers-color-scheme", value: SCHEME }] : []), ...MEDIA];
  if (features.length) {
    const cdp = await page.createCDPSession();
    await cdp.send("Emulation.setEmulatedMedia", { features });
  }
  if (THEME) {
    // A string, not a function: tsx rewrites named functions with a helper
    // the page does not have. The observer catches <html> as the parser
    // inserts it, attributes and all, and overwrites the server's value.
    await page.evaluateOnNewDocument(`(() => {
      const theme = ${JSON.stringify(THEME)};
      const set = () => document.documentElement?.setAttribute("data-theme", theme);
      set();
      new MutationObserver(set).observe(document, { childList: true });
    })()`);
  }
}

/**
 * Measure the text on the page against what it sits on.
 *
 * For every element with text of its own, its colour and the first opaque
 * background up the tree, blending any translucent one on the way — which is
 * what the eye gets, inherited ink and nested fills included, and what a
 * reading of the class names cannot know. Text on a background image (the
 * "whatever" swatch's rainbow) is left out: it has no single colour to be
 * measured against. AA is 4.5:1, or 3:1 for large text (24px, or 18.66px bold).
 *
 * Glass (a fork-only theme) has grounds with no single colour, and each is
 * measured at its worst, as `check:contrast` does:
 *
 *   - a chain of translucent fills that reaches the room — the root's
 *     backdrop, its --color-glow-* layers and its --color-wash — is laid
 *     over the room's per-channel bounds: every glow absent or full, in
 *     every combination, as check:contrast has them;
 *   - one that reaches glass in the page — an element with a backdrop
 *     filter, not in anything fixed or sticky — is laid over those bounds
 *     saturated as the glass saturates what it blurs (--glass-saturate);
 *   - one that reaches something floating — a backdrop filter on or inside
 *     something fixed or sticky, or a ::before with one (the header) — is
 *     laid over that layer's tint over pure black and over pure white,
 *     because the page scrolls anything under it;
 *   - a flat `linear-gradient(c, c)` background image (a menu's veil) is a
 *     layer of colour c over the element's own.
 *
 * The pair recorded is the worst of those, with the ground it was measured on.
 */
const MEASURE = `(() => {
  const rgb = (s) => {
    let m = /^rgba?\\(([^)]+)\\)/.exec(s);
    if (m) { const v = m[1].split(/[\\s,/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v[3] ?? 1]; }
    m = /^color\\(srgb ([^)]+)\\)/.exec(s);
    if (m) { const v = m[1].split(/[\\s/]+/).filter(Boolean).map(Number); return [v[0] * 255, v[1] * 255, v[2] * 255, v[3] ?? 1]; }
    return null;
  };
  const over = (top, under) => {
    const a = top[3];
    return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1);
  };
  const lum = (c) => {
    const [r, g, b] = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const hex = (c) => "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  const BLACK = [0, 0, 0, 1], WHITE = [255, 255, 255, 1];
  // The room, if the root draws one: the per-channel bounds of its corners
  // (every glow absent or full, the wash over them), as check:contrast has
  // them; and what glass in the page shows of it, blurred and saturated.
  const box = (cs) => [0, 1, 2].reduce((b, i) => {
    b[0][i] = Math.min(...cs.map((c) => c[i])); b[1][i] = Math.max(...cs.map((c) => c[i])); return b;
  }, [[0, 0, 0, 1], [0, 0, 0, 1]]);
  const saturate = ([r, g, b], s) => [
    (0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b,
    (0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b,
    (0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b,
  ].map((v) => Math.min(255, Math.max(0, v))).concat(1);
  const [room, behind] = (() => {
    const root = getComputedStyle(document.documentElement);
    if (root.backgroundImage === "none") return [null, null];
    const probe = document.createElement("i");
    document.body.append(probe);
    const colour = (name) => {
      const v = root.getPropertyValue(name).trim();
      if (!v) return null;
      probe.style.color = v;
      return rgb(getComputedStyle(probe).color);
    };
    const glows = [];
    for (let i = 1; colour("--color-glow-" + i); i++) glows.unshift(colour("--color-glow-" + i));
    const wash = colour("--color-wash");
    probe.remove();
    const corners = [];
    for (let mask = 0; mask < 1 << glows.length; mask++) {
      const lit = glows.reduce((u, g, i) => (mask & (1 << i) ? over(g, u) : u), rgb(root.backgroundColor));
      corners.push(wash ? over(wash, lit) : lit);
    }
    const s = Number(root.getPropertyValue("--glass-saturate")) || 1;
    return [box(corners), box(corners.map((c) => saturate(c, s)))];
  })();
  // Floating: fixed, or inside something sticky (the header) or fixed.
  const floats = (n) => {
    for (let m = n; m; m = m.parentElement) if (/^(fixed|sticky)$/.test(getComputedStyle(m).position)) return true;
    return false;
  };
  const flat = (image) => {
    const m = /^linear-gradient\\((rgba?\\([^)]*\\)|color\\([^)]*\\)), (rgba?\\([^)]*\\)|color\\([^)]*\\))\\)$/.exec(image);
    return m && m[1] === m[2] ? rgb(m[1]) : null;
  };
  const grounds = (el) => {
    const layers = [];
    const under = (bottoms) => bottoms.map((b) => layers.reduceRight((u, top) => over(top, u), b));
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const veil = flat(cs.backgroundImage);
      if (veil && veil[3] > 0) layers.push(veil);
      const c = rgb(cs.backgroundColor);
      if (room && n === document.documentElement) return under(room);
      if (c && c[3] > 0) layers.push(c);
      if (c && c[3] >= 1) return under([WHITE]);
      const before = getComputedStyle(n, "::before");
      if (before.backdropFilter !== "none") {
        const tint = rgb(before.backgroundColor);
        if (tint && tint[3] > 0) layers.push(tint);
      }
      if (cs.backdropFilter !== "none" || before.backdropFilter !== "none") {
        return under(floats(n) || !behind ? [BLACK, WHITE] : behind);
      }
      if (cs.backgroundImage !== "none" && !veil && !(room && n === document.body)) return null;
    }
    return under([WHITE]);
  };
  const pairs = {};
  for (const el of document.querySelectorAll("body *")) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width <= 1 || r.height <= 1 || cs.visibility === "hidden") continue;
    const all = grounds(el);
    if (!all) continue;
    let fg, bg, ratio = Infinity;
    for (const g of all) {
      const f = over(rgb(cs.color), g);
      const [hi, lo] = [lum(f), lum(g)].sort((a, b) => b - a);
      const r = Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
      if (r < ratio) [fg, bg, ratio] = [f, g, r];
    }
    const size = parseFloat(cs.fontSize);
    const need = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700) ? 3 : 4.5;
    const key = hex(fg) + " on " + hex(bg) + " @" + need;
    const p = (pairs[key] ??= { fg: hex(fg), bg: hex(bg), ratio, need, count: 0, sample: "" });
    p.count++;
    if (!p.sample) p.sample = el.tagName.toLowerCase() + "." + [...el.classList].slice(0, 4).join(".") + " " + JSON.stringify(el.textContent.trim().slice(0, 40));
  }
  return Object.values(pairs).sort((a, b) => a.ratio / a.need - b.ratio / b.need);
})()`;

type Pair = { fg: string; bg: string; ratio: number; need: number; count: number; sample: string };
const measured: Record<string, Pair[]> = {};

/** Screenshot a page, then measure it. */
async function shoot(page: Page, name: string, fullPage: boolean): Promise<void> {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  const pairs = (await page.evaluate(MEASURE)) as Pair[];
  measured[name] = pairs;
  const below = pairs.filter((p) => p.ratio < p.need);
  // Blur is the expensive part of glass: how many layers this page asks for.
  const blurred = (await page.evaluate(`[...document.querySelectorAll("*")].filter((e) =>
    getComputedStyle(e).backdropFilter !== "none" || getComputedStyle(e, "::before").backdropFilter !== "none").length`)) as number;
  console.info(
    `${name}: ${pairs.length} pairs, ${below.length} below AA` +
      (blurred ? `, ${blurred} blurred layer${blurred === 1 ? "" : "s"}` : "") +
      below.map((p) => `\n  ${p.ratio}:1 (needs ${p.need}) ${p.fg} on ${p.bg} ×${p.count} — ${p.sample}`).join(""),
  );
}

const CHROME =
  process.env.CHROME_PATH ??
  [
    "/snap/chromium/current/usr/lib/chromium-browser/chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
  ].find((p) => existsSync(p));

/**
 * Sign a page in through the real form. The screenshots are of the app a
 * person uses, so the way into it should be too.
 */
async function signIn(page: Page, user: { id: string; email: string }): Promise<void> {
  await db.$executeRawUnsafe('DELETE FROM "rateLimit"');
  await ensureCredentials(APP, user.id, usernameFor(user.email));
  await page.goto(`${APP}/signin`, { waitUntil: "networkidle2" });
  await page.type("#username", usernameFor(user.email));
  await page.type("#password", TEST_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => location.pathname !== "/signin", { timeout: 15_000 });
}

/** A cookie jar for the one thing that is not driven through the browser. */
async function sessionCookie(user: { id: string; email: string }): Promise<string> {
  await db.$executeRawUnsafe('DELETE FROM "rateLimit"');
  await ensureCredentials(APP, user.id, usernameFor(user.email));
  const res = await fetch(`${APP}/api/auth/sign-in/username`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: APP },
    body: JSON.stringify({
      username: usernameFor(user.email),
      password: TEST_PASSWORD,
    }),
  });
  const jar = new Map<string, string>();
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const eq = pair!.indexOf("=");
    jar.set(pair!.slice(0, eq), pair!.slice(eq + 1));
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

/**
 * A real 12-triangle STL. The seeded tickets point at storage keys that do
 * not exist, which is fine for the rail but useless for the viewer — it needs
 * bytes it can actually parse.
 */
function stlBox(x: number, y: number, z: number): Uint8Array {
  const p = [[0,0,0],[x,0,0],[x,y,0],[0,y,0],[0,0,z],[x,0,z],[x,y,z],[0,y,z]];
  const faces = [[0,1,2],[0,2,3],[4,6,5],[4,7,6],[0,4,5],[0,5,1],
                 [1,5,6],[1,6,2],[2,6,7],[2,7,3],[3,7,4],[3,4,0]];
  const tris = faces.map((f) => f.flatMap((i) => p[i]!));
  const buf = new Uint8Array(84 + tris.length * 50);
  const view = new DataView(buf.buffer);
  view.setUint32(80, tris.length, true);
  let off = 84;
  for (const t of tris) {
    for (let i = 0; i < 9; i++) view.setFloat32(off + 12 + i * 4, t[i]!, true);
    off += 50;
  }
  return buf;
}

/** One ticket per stage, so every rail colour and state is on screen at once. */
const SEED = [
  ["Hook for the monitor arm", "Requested", "PETG", "Slate", "#4a5d78", "A beer", 1, false],
  ["Cable comb, 6 slots", "Accepted", "PLA", "Graphite", "#1b2126", "A coffee", 4, true],
  ["Replacement knob, grinder", "Printing", "PETG", "Teal", "#12645f", "A spool of filament", 2, false],
  ["Desk sign, meeting room", "Done", "PLA", "Bone white", "#eaecee", "Nerd stuff", 1, false],
  ["Gridfinity bin, 2×1", "Delivery", "PLA", "Slate", "#4a5d78", "A beer", 6, false],
] as const;

async function main() {
  if (!CHROME) throw new Error("No Chrome or Chromium found. Set CHROME_PATH.");
  mkdirSync(OUT, { recursive: true });

  const admin = await db.user.findFirst({ where: { role: "admin" } });
  if (!admin) throw new Error("No admin — run npm run db:seed");

  await db.story.deleteMany();
  await db.user.deleteMany({ where: { email: "ayla@office.example" } });
  const ayla = await db.user.create({
    data: {
      email: "ayla@office.example", name: "Ayla Berg", initials: "AY",
      role: "client", emailVerified: true, invitedById: admin.id,
    },
  });

  for (const [title, status, material, colorName, colorHex, tip, qty, flagged] of SEED) {
    await db.story.create({
      data: {
        title, status: status as never, material: material as never,
        colorName, colorHex, tip, quantity: qty, flagged,
        note: "Clips onto the round arm tube and holds a headset. No rush.",
        uploaderId: ayla.id, filename: "monitor-hook-v3.stl", fileSize: 2_517_000,
        mimeType: "model/stl", storageKey: "demo", dims: "78 × 40 × 22 mm",
      },
    });
  }

  // A short exchange on the Printing ticket, so the thread is not empty in
  // the screenshot — an empty component says nothing about whether it works.
  const printingSeed = await db.story.findFirst({ where: { status: "Printing" } });
  if (printingSeed) {
    await db.comment.createMany({
      data: [
        { storyId: printingSeed.id, authorId: ayla.id,
          body: "Teal if you have it, otherwise anything dark." },
        { storyId: printingSeed.id, authorId: admin.id,
          body: "On the bed now, layer 84. Teal it is." },
      ],
    });
  }

  // Put real geometry behind the Printing ticket so the viewer has something
  // to draw. Uploading it through the API is also the honest path — it goes
  // through the same validation and storage every real file does.
  const printingForUpload = await db.story.findFirst({ where: { status: "Printing" } });
  if (printingForUpload) {
    const cookie = await sessionCookie(ayla);
    const form = new FormData();
    form.set("file", new File([stlBox(78, 40, 22) as BlobPart], "monitor-hook-v3.stl"));
    form.set("title", "Replacement knob, grinder");
    form.set("material", "PETG");
    form.set("colorName", "Teal");
    form.set("quantity", "2");
    form.set("tip", "A spool of filament");
    form.set("note", "Clips onto the round arm tube and holds a headset. No rush.");
    const up = await fetch(`${APP}/api/upload`, {
      method: "POST", body: form, headers: { origin: APP, cookie },
    });
    if (up.ok) {
      const created = await up.json();
      // Promote it into Printing and retire the placeholder.
      await db.story.delete({ where: { id: printingForUpload.id } });
      await db.story.update({
        where: { id: created.id },
        data: { status: "Printing", colorHex: "#12645f" },
      });
    }
  }

  // One declined ticket, so the profile shows what the rail deliberately
  // does not carry.
  await db.story.create({
    data: {
      title: "Bracket that was too thin", uploaderId: ayla.id, status: "Declined",
      material: "PLA", colorName: "Bone white", colorHex: "#eaecee",
      tip: "Nothing, sorry", quantity: 1, filename: "bracket-v1.stl",
      fileSize: 640_000, mimeType: "model/stl", storageKey: "declined-demo",
      dims: "60 × 20 × 3 mm",
    },
  });

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await prepare(page);

  // Signed out first, while there is no session.
  await page.goto(`${APP}/signin`, { waitUntil: "networkidle2" });
  await shoot(page, "signin", false);

  await signIn(page, ayla);

  const printing = await db.story.findFirst({ where: { status: "Printing" } });
  const pages: Array<[string, string]> = [
    ["board", `${APP}/board`],
    ["upload", `${APP}/upload`],
    ["profile", `${APP}/me`],
    ["story", `${APP}/story/${printing!.id}`],
  ];
  for (const [name, url] of pages) {
    await page.goto(url, { waitUntil: "networkidle2" });
    await shoot(page, name, true);
  }

  // The printer owner's side. A separate browser context rather than signing
  // out: /api/auth/sign-out is POST-only, so navigating to it just hangs.
  //
  // The owner's back-office screens are here too, though nobody looks at them
  // in a README: they carry most of the destructive buttons and pale washes,
  // and a theme has to be seen on every ground it repaints.
  const adminCtx = await browser.createBrowserContext();
  const adminPage = await adminCtx.newPage();
  await prepare(adminPage);
  await signIn(adminPage, admin);
  const adminPages: Array<[string, string]> = [
    ["queue", `${APP}/queue`],
    ["books", `${APP}/me`],
    ["story-admin", `${APP}/story/${printing!.id}`],
    ["history", `${APP}/history`],
    ["prints", `${APP}/admin/prints`],
    ["invites", `${APP}/admin/invites`],
    ["catalog", `${APP}/admin/catalog`],
    ["benefits", `${APP}/admin/benefits`],
    ["audit", `${APP}/admin/audit`],
    ["frr", `${APP}/frr`],
  ];
  for (const [name, url] of adminPages) {
    await adminPage.goto(url, { waitUntil: "networkidle2" });
    await shoot(adminPage, name, true);
  }

  // What floats over the page, which full-page shots never show: the
  // activity menu open over a queue scrolled under the header, and a toast.
  // Opt-in, so the usual set of screenshots stays the same set.
  if (OVERLAYS) {
    await adminPage.goto(`${APP}/queue`, { waitUntil: "networkidle2" });
    await adminPage.evaluate("window.scrollTo(0, 260)");
    await adminPage.click('header [aria-haspopup="true"]');
    await adminPage.waitForSelector("header .rounded-panel");
    await new Promise((r) => setTimeout(r, 400)); // past its 180 ms fade in
    await shoot(adminPage, "overlay-menu", false);
    await page.goto(`${APP}/story/${printing!.id}?toast=${encodeURIComponent("Saved · priority is High")}`, { waitUntil: "networkidle2" });
    await page.evaluate("window.scrollTo(0, 120)");
    await page.waitForSelector(".ppp-toast");
    await new Promise((r) => setTimeout(r, 400)); // past its 220 ms rise
    await shoot(page, "overlay-toast", false);
  }
  await adminCtx.close();

  // Narrow, because the rail has to collapse without a media query.
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.goto(`${APP}/board`, { waitUntil: "networkidle2" });
  await shoot(page, "board-mobile", true);

  await browser.close();
  writeFileSync(`${OUT}/contrast.json`, JSON.stringify({ theme: THEME ?? "(server's)", scheme: SCHEME ?? "light", pages: measured }, null, 2));
  console.info(`wrote ${pages.length + adminPages.length + 2 + (OVERLAYS ? 2 : 0)} screenshots to ${OUT}/`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
