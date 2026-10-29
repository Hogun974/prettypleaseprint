/**
 * The groups of messages that client components ask for with
 * `useTranslations`. Only these are sent to the browser (`getClientMessages`
 * in ./server.ts).
 *
 * Not the whole catalogue, and the reason is not size. Every page would
 * otherwise carry every string in its RSC payload — the admin's navigation
 * included, on a client's page — and the suites assert on the raw HTML that
 * an admin-only label is *absent* (verify:auth's "scoped to a client, not the
 * admin"). With the whole catalogue in the payload that assertion can never
 * pass again, and a page would ship words for screens it does not show.
 *
 * A client component that asks for a group not listed here would render the
 * key's name. `npm run check:messages` reads every `useTranslations("…")` in a
 * "use client" file and fails when one is not covered, so add the group here
 * in the same change. Pure, so that script can import it.
 */
export const CLIENT_GROUPS = [
  "signin.form",
  "header.activity",
  "header.account",
  "header.nudge",
  "setup.passkey",
  // The owner's catalogue editors and guest-list controls. Owner-only words
  // in every page's payload, like setup.passkey: none names a page or a link,
  // so a client's page still carries nothing the suites look for.
  "admin.catalogEdit",
  "admin.guests",
] as const;
