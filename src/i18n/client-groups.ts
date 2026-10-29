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
  // PriorityChip lives in src/components/ui.tsx, which client components
  // import; its words are here so that it reads right wherever it is drawn.
  "common.priority",
  "invite.form",
  "auth.fields",
  "auth.notice",
  "auth.setPassword.form",
  "auth.reauth.form",
  "auth.welcome.prompt",
  "problems.auth.betterAuth",
] as const;
// Not here, on purpose: the owner's catalogue editors (admin.catalogEdit) and
// guest-list controls (admin.guests). Their server pages say those words and
// hand them down as props, so no client's page carries them — verify:auth
// checks a client's page source for them.
// Also not here: the request form's words and the refusals it can show,
// and the 3D viewer's. The pages that draw those components hand them their
// words as a prop (getPageMessages in ./page-messages.ts), so the rail, a
// ticket and the sign-in page do not carry them.
