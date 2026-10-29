import { getTranslations } from "next-intl/server";

/**
 * A refusal that can be said in the reader’s language.
 *
 * The services in `src/lib` throw errors (`StoryProblem`, `FeatureProblem`, …)
 * whose `message` is an English sentence, and that sentence is what the JSON
 * API returns: the API stays English on purpose (docs/i18n.md). A page shows
 * the same refusal to a person, so the error also carries the key of the same
 * sentence in the catalogue, and its values:
 *
 *   throw new StoryProblem(409, `“${title}” is already done.`, {
 *     key: "problems.story.alreadyDone",
 *     values: { title },
 *   });
 *
 * and the server action that turns it into a toast says it with `say`.
 * An error without a key — or one the catalogue does not have — is shown as
 * its English message, which is what every page did before translation.
 */
export type Spoken = { key: string; values?: Record<string, string | number> };

/** What an error looks like to `say`: anything with a message, maybe a key. */
type Sayable = { message: string; spoken?: Spoken };

/** The error’s sentence in this request’s language. Server only. */
export async function say(error: Sayable): Promise<string> {
  if (!error.spoken) return error.message;
  const t = await getTranslations();
  const { key, values } = error.spoken;
  // The key is checked at run time rather than typed: an error’s key is data
  // carried across a throw, and `t.has` is what keeps a missing one English.
  if (!t.has(key as never)) return error.message;
  return t(key as never, values as never);
}
