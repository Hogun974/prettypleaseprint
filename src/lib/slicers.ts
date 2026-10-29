/**
 * Slicers: the ones the ticket button can name, and which one it names for a
 * request.
 *
 * The same profiles, under the same ids and display names, as
 * `PPP_SLICER_PROFILE` in scripts/prusa-open.sh — the helper that actually
 * opens the slicer on the person's machine. The app never launches anything;
 * this only decides what the button *says*, so that someone who set their
 * helper up for ElegooSlicer is not told it opens PrusaSlicer. The link, and
 * the credential in it, are the same whichever is chosen.
 *
 * `other` is a slicer the helper has no profile for — PPP_SLICER pointed at
 * anything else — and the button then says "your slicer" rather than guess a
 * name. It is not a helper profile: the helper keeps refusing an unknown one.
 *
 * Pure, like `theme.ts` and `src/i18n/locales.ts`, so the verification suites
 * can import the list and the rule without the request machinery. The request
 * side is `slicerForRequest()`, at the bottom.
 */

export const SLICERS = [
  { id: "prusa", name: "PrusaSlicer" },
  { id: "orca", name: "OrcaSlicer" },
  { id: "elegoo", name: "ElegooSlicer" },
  { id: "bambu", name: "Bambu Studio" },
  { id: "cura", name: "UltiMaker Cura" },
  // No name: the button says "your slicer" (messages: slicer.openInYours).
  { id: "other", name: null },
] as const;

export type SlicerId = (typeof SLICERS)[number]["id"];

export const SLICER_IDS: readonly SlicerId[] = SLICERS.map((s) => s.id);

/** What the button named before there was a choice, and still does by default. */
export const DEFAULT_SLICER: SlicerId = "prusa";

export function isSlicer(value: unknown): value is SlicerId {
  return typeof value === "string" && (SLICER_IDS as readonly string[]).includes(value);
}

/** The display name, or null for `other`. */
export function slicerName(id: SlicerId): string | null {
  return SLICERS.find((s) => s.id === id)!.name;
}

/**
 * Which slicer the button names: the person's own choice, then the instance's
 * default, then PrusaSlicer. Both inputs have already been checked on the way
 * out of the database (`src/lib/preferences.ts`), so an id a later version
 * drops arrives here as null and falls through, never as a name with no
 * profile behind it.
 *
 * The order is the same as the theme's and for the same reason: the person
 * chose in this app, the instance chose for everyone who did not.
 */
export function resolveSlicer(sources: {
  preference: SlicerId | null;
  instanceDefault: SlicerId | null;
}): SlicerId {
  return sources.preference ?? sources.instanceDefault ?? DEFAULT_SLICER;
}

/**
 * The slicer for this request's viewer.
 *
 * The request side is imported when called rather than at the top: it reads
 * the session, which is `server-only`, and the suites that import this file
 * run outside Next, where `server-only` throws on import.
 */
export async function slicerForRequest(): Promise<SlicerId> {
  const { viewerPreferences } = await import("@/lib/viewer-preferences");
  const { person, instance } = await viewerPreferences();
  return resolveSlicer({ preference: person?.slicer ?? null, instanceDefault: instance.slicer });
}
