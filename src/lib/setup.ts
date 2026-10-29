import { readSettingsRow } from "@/lib/settings";

/**
 * The first-run setup at /admin/setup (#106): a short walk through what a new
 * instance needs, for its owner, starting where the bootstrap ends.
 *
 * The bootstrap is the seed's set-password link (docs/authentication.md); it
 * stays the only way to make the owner's account, and there is still no
 * public "create the admin" screen. The setup is for someone who is already
 * signed in as the owner, and it adds no power of its own: every step that
 * saves goes through the same function, the same re-auth and the same audit
 * line as /admin/settings, and everything else on it is a check or a link.
 *
 * Whether it is behind the instance is one column on the settings row,
 * `setupCompletedAt`, which its migration fills in on every instance that
 * was already in use — the comment there says what counts. While it is null
 * the owner's landing page (`/`) sends them here; that is the only place that
 * redirects, so leaving the setup half-way never traps anybody, and it is
 * still there from /admin/settings once it is done.
 *
 * Pure apart from `setupPending`, and without `server-only`, so
 * `verify:setup` can call the rules with requests the stack would never see.
 * The writes are in `setup-admin.ts`, which is guarded.
 */

export const SETUP_STEPS = ["account", "address", "look", "mail", "slicer", "people"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

/** `?step=`, or the first step for anything that is not one. */
export function stepFrom(raw: unknown): SetupStep {
  return (SETUP_STEPS as readonly unknown[]).includes(raw) ? (raw as SetupStep) : SETUP_STEPS[0];
}

export function nextStep(step: SetupStep): SetupStep | null {
  return SETUP_STEPS[SETUP_STEPS.indexOf(step) + 1] ?? null;
}

export function previousStep(step: SetupStep): SetupStep | null {
  const i = SETUP_STEPS.indexOf(step);
  return i > 0 ? SETUP_STEPS[i - 1]! : null;
}

/** Is the setup still ahead of this instance? A missing row is a fresh install. */
export async function setupPending(): Promise<boolean> {
  const row = await readSettingsRow();
  return !row?.setupCompletedAt;
}

// ---------------------------------------------------------------------------
// The address
// ---------------------------------------------------------------------------

/** Anything with a case-insensitive `get`, as `Headers` and `headers()` are. */
type HeaderBag = { get(name: string): string | null };

/** The first value of a header a proxy may have appended to. */
const first = (value: string | null) => value?.split(",")[0]?.trim() || null;

/** An origin, normalised the way a browser compares them, or null. */
function originOf(url: string): string | null {
  try {
    const { origin } = new URL(url);
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

/**
 * The origin this request was sent to, as the server can tell.
 *
 * `X-Forwarded-Host` and `X-Forwarded-Proto` when a proxy set them, `Host`
 * and plain HTTP when nothing did — and Next sets both forwarded headers
 * itself from the connection when a request reaches it directly, so the
 * plain case is covered too. A browser cannot be asked over HTTP which
 * origin it is using without JavaScript, and this page works without it.
 *
 * Read whatever `TRUST_PROXY_HEADERS` says, unlike the client address in the
 * audit trail: these headers decide nothing here. A request that lies about
 * them only changes what its own sender is told.
 */
export function requestOrigin(h: HeaderBag): string | null {
  const host = first(h.get("x-forwarded-host")) ?? first(h.get("host"));
  if (!host) return null;
  const proto = (first(h.get("x-forwarded-proto")) ?? "http").toLowerCase();
  if (proto !== "http" && proto !== "https") return null;
  return originOf(`${proto}://${host}`);
}

export type AddressCheck = {
  /** `APP_URL` (BETTER_AUTH_URL in the container), as an origin. */
  configured: string | null;
  /** Where this request went, or null if it did not say. */
  seen: string | null;
  matches: boolean;
};

/**
 * `APP_URL` against the origin a request arrived at. A path in `APP_URL` is
 * not a difference: cookies, passkeys and Better Auth's origin check all
 * compare origins, and a link in an e-mail is built from the whole URL.
 */
export function checkAddress(appUrl: string, seen: string | null): AddressCheck {
  const configured = originOf(appUrl);
  return { configured, seen, matches: configured !== null && configured === seen };
}

/**
 * Does `PASSKEY_RP_ID` cover the host in `APP_URL`?
 *
 * WebAuthn lets a page use a relying-party id that is its own host or a
 * registrable domain above it, and refuses anything else outright — so a
 * mismatch here means no passkey can be made or used at all, and the
 * setting is permanent once one has been (docs/deployment.md).
 */
export function rpIdCovers(rpId: string, appUrl: string): boolean {
  let host: string;
  try {
    host = new URL(appUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  const id = rpId.trim().toLowerCase();
  return id !== "" && (host === id || host.endsWith(`.${id}`));
}

// ---------------------------------------------------------------------------
// The slicer helper's installer
// ---------------------------------------------------------------------------

/** The systems the helper has an installer — or a written-out procedure — for. */
export type Platform = "windows" | "macos" | "linux" | "other";

/**
 * Which system the browser says it runs on.
 *
 * `Sec-CH-UA-Platform` first: Chromium browsers send it with every request
 * in a secure context, unasked, and it is the browser's own answer rather
 * than a pattern match. The User-Agent string otherwise, which is what
 * Firefox and Safari leave us — with Android and ChromeOS tested before
 * Linux, because both say "Linux" too and neither can run the helper, and
 * iPhones and iPads before macOS for the same reason ("like Mac OS X").
 *
 * It only picks which instructions are shown first; the guide has all of
 * them, and the page links to it whatever this says.
 */
export function platformOf(h: HeaderBag): Platform {
  const hint = h.get("sec-ch-ua-platform")?.replace(/"/g, "").trim().toLowerCase();
  if (hint) {
    if (hint === "windows") return "windows";
    if (hint === "macos") return "macos";
    if (hint === "linux") return "linux";
    return "other";
  }
  const ua = h.get("user-agent") ?? "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "other";
  if (/Android|CrOS/i.test(ua)) return "other";
  if (/Windows/i.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "macos";
  if (/Linux|X11/i.test(ua)) return "linux";
  return "other";
}

/**
 * The line to run, from a checkout of the source, on the machine with the
 * slicer — the same lines docs/prusaslicer.md gives. macOS has none: the
 * scheme is registered by an app made once in Script Editor, and the page
 * links to that section of the guide instead.
 */
export const INSTALLER: Record<"linux" | "windows", string> = {
  linux: "./scripts/install-slicer-handler.sh",
  windows: "powershell -ExecutionPolicy Bypass -File scripts\\install-slicer-handler.ps1",
};
