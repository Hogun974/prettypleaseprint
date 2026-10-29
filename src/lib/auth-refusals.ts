import "server-only";
import { getLocale, getTranslations } from "next-intl/server";

import { PASSWORD_MAX, PASSWORD_MIN, USERNAME_MAX, USERNAME_MIN } from "@/lib/auth-rules";
import { say, type Spoken } from "@/i18n/spoken";
import { betterAuthMessage, type BetterAuthError } from "@/i18n/better-auth";

/**
 * The refusals of the two forms that set credentials — registration at
 * `/invite/[token]` and `/set-password` — in the reader's language.
 *
 * Their schemas keep their English messages (the same sentences as before),
 * and each sentence has a key under `problems.auth` whose English is that
 * sentence, word for word. A schema issue is matched to its key by field and
 * kind, never by its words; one with no key stays as Zod wrote it.
 */

const said = (key: string, values?: Spoken["values"]): Spoken => ({
  key: `problems.auth.${key}`,
  values,
});

/** The sentences the two actions use, each as English and as a key. */
export const REFUSAL = {
  usernameTaken: {
    message: "Somebody already has that username. Try another.",
    spoken: said("usernameTaken"),
  },
  usernameNeeded: {
    message: "Pick a username to sign in with.",
    spoken: said("usernameNeeded"),
  },
  passwordShort: {
    message: `A password needs at least ${PASSWORD_MIN} characters.`,
    spoken: said("passwordShort", { min: PASSWORD_MIN }),
  },
  passwordLong: {
    message: `That password is longer than ${PASSWORD_MAX} characters.`,
    spoken: said("passwordLong", { max: PASSWORD_MAX }),
  },
  pickDifferent: { message: "Pick a different password.", spoken: said("pickDifferent") },
  linkSpent: {
    message: "That link has already been used, or it expired. Ask the printer owner for another.",
    spoken: said("linkSpent"),
  },
  failed: { message: "That did not go through. Try again.", spoken: said("failed") },
  failedMoment: {
    message: "That did not go through. Try again in a moment.",
    spoken: said("failedMoment"),
  },
  checkForm: { message: "Check the form.", spoken: said("checkForm") },
} as const;

/** `USERNAME_RULE`, as a key: the English is the same sentence. */
export const USERNAME_RULE_SPOKEN = said("usernameRule", { min: USERNAME_MIN, max: USERNAME_MAX });

function issueSpoken(field: PropertyKey | undefined, code: string): Spoken | undefined {
  switch (`${String(field)}:${code}`) {
    case "name:too_small":
      return said("nameMissing");
    case "username:too_small":
      return said("usernameShort", { min: USERNAME_MIN });
    case "username:too_big":
      return said("usernameLong", { max: USERNAME_MAX });
    case "username:invalid_format":
      return USERNAME_RULE_SPOKEN;
    case "password:too_small":
      return REFUSAL.passwordShort.spoken;
    case "password:too_big":
      return REFUSAL.passwordLong.spoken;
    default:
      return undefined;
  }
}

/** A schema's first refusal, in the reader's language. */
export function sayIssue(
  issue: { message: string; path: PropertyKey[]; code: string } | undefined,
): Promise<string> {
  if (!issue) return say(REFUSAL.checkForm);
  return say({ message: issue.message, spoken: issueSpoken(issue.path[0], issue.code) });
}

/**
 * Better Auth's refusal, in the reader's language: its own English for an
 * English reader, the catalogue's words for its code otherwise, and
 * `fallback` (one of ours, said in the reader's language) when it gave no
 * message at all. See src/i18n/better-auth.ts.
 */
export async function sayBetterAuth(
  error: BetterAuthError,
  fallback: { message: string; spoken?: Spoken },
): Promise<string> {
  const [locale, t, otherwise] = await Promise.all([
    getLocale(),
    getTranslations("problems.auth.betterAuth"),
    say(fallback),
  ]);
  return betterAuthMessage(error, { locale, t, fallback: otherwise });
}
