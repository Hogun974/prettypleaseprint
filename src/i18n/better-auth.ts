import type en from "../../messages/en.json";

/**
 * Better Auth's refusals, in the reader's language.
 *
 * The library answers with an English sentence and a stable `code` (a refused
 * passkey, a breached password, a cancelled device prompt…). The sentence is
 * the library's, not this app's, so the code is what gets translated: each
 * code this app has words for has a key under `problems.auth.betterAuth`.
 *
 * An English reader is shown the library's own message, exactly as before —
 * the catalogue's English copies of those sentences are for translators, not
 * for display, so a library upgrade that rewords one never makes the English
 * page disagree with the API. A code with no key, in any language, falls back
 * to the library's English text too; a refusal with no message at all, to the
 * screen's own (translated) sentence.
 *
 * Pure, so client components (the passkey buttons) and server actions (the
 * registration and set-password forms) share it: each passes its own locale
 * and `t`.
 */
export type BetterAuthCode = keyof typeof en.problems.auth.betterAuth;

const CODES = [
  "PASSWORD_COMPROMISED",
  "AUTH_CANCELLED",
  "ERROR_CEREMONY_ABORTED",
  "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED",
  "CHALLENGE_NOT_FOUND",
  "YOU_ARE_NOT_ALLOWED_TO_REGISTER_THIS_PASSKEY",
  "FAILED_TO_VERIFY_REGISTRATION",
  "PASSKEY_NOT_FOUND",
  "AUTHENTICATION_FAILED",
  "UNABLE_TO_CREATE_SESSION",
  "USER_NOT_FOUND",
  "SESSION_REQUIRED",
  "UNKNOWN_ERROR",
] as const satisfies readonly BetterAuthCode[];

// Every key in the catalogue is listed above, and nothing else: a code added
// to en.json without being added here fails the typecheck on this line.
type Missing = Exclude<BetterAuthCode, (typeof CODES)[number]>;
const _complete: [Missing] extends [never] ? true : Missing = true;
void _complete;

const isKnown = (code: string): code is BetterAuthCode =>
  (CODES as readonly string[]).includes(code);

export type BetterAuthError = { code?: string | null; message?: string | null } | null | undefined;

export function betterAuthMessage(
  error: BetterAuthError,
  { locale, t, fallback }: { locale: string; t: (code: BetterAuthCode) => string; fallback: string },
): string {
  if (locale !== "en" && error?.code && isKnown(error.code)) return t(error.code);
  return error?.message ?? fallback;
}
