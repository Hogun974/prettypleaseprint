"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { safeRedirectPath } from "@/lib/safe-redirect";

import { requireAdmin, requireUser } from "@/lib/authz";
import { say } from "@/i18n/spoken";
import { getTicketWords } from "@/i18n/tickets";
import {
  StoryProblem,
  advanceStory as advance,
  clearFlag as clear,
  declineStory as decline,
  flagStory as flag,
  changeStoryPriority as reprioritise,
  storyIdOr400,
  withdrawStory as withdraw,
} from "@/lib/stories";

/**
 * The printer owner's panel, as plain forms.
 *
 * What each of these *does* lives in `src/lib/stories.ts`, which the JSON API
 * calls too — the rules about who may move a ticket, from which state, who
 * gets told and what goes in the trail are enforced there so both front doors
 * cannot drift apart. This file is the adapter: read a `FormData`, call the
 * operation, turn the outcome into a redirect.
 *
 * `requireAdmin()` still runs first, and is not redundant with the role check
 * inside the service. It is the one that answers 404 rather than 403, which is
 * what a page owes a client poking at a control that was never drawn for
 * them — the API answers differently, and deliberately. See `src/lib/api.ts`.
 *
 * The toasts are said in the reader's language, and so is a refusal (`say`):
 * the sentence travels in the query string already written, so the page that
 * shows it has nothing left to translate.
 */

/**
 * Where to send the browser afterwards, with a message.
 *
 * These are plain forms, so there is no client state to hand a result back
 * to — the outcome travels in the query string and the page renders it as a
 * toast. That also means the whole panel works with JavaScript off.
 *
 * `from` arrives in the form body, so it is validated like any other
 * redirect target: same-origin absolute paths only. An open redirect is how
 * a phishing page borrows your domain's credibility.
 */
function back(from: FormDataEntryValue | null, params: Record<string, string>): never {
  const safe = safeRedirectPath(from, "/queue");
  const q = new URLSearchParams(params).toString();
  redirect(`${safe}?${q}`);
}

/**
 * Run one operation and land the browser somewhere sensible either way.
 *
 * A `StoryProblem` is the expected shape of "no": it already carries a
 * sentence written for a person, so it goes straight into the toast. Anything
 * else is a bug and is left to throw — an error page is the honest answer to
 * something we did not anticipate, and swallowing it into a toast would make
 * the failure quiet, which is exactly what this repo tries not to do.
 */
async function run(
  formData: FormData,
  operation: (id: number) => Promise<{ toast: string }>,
): Promise<never> {
  let outcome: Record<string, string>;
  try {
    const id = storyIdOr400(formData.get("id") ?? formData.get("storyId"));
    outcome = await operation(id);
  } catch (error) {
    if (error instanceof StoryProblem) back(formData.get("from"), { error: await say(error) });
    throw error;
  }
  back(formData.get("from"), outcome);
}

const toasts = () => getTranslations("story.toast");

export async function advanceStory(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  await run(formData, async (id) => {
    const done = await advance(admin, id);
    const [t, words] = await Promise.all([toasts(), getTicketWords()]);
    return {
      toast: t("advanced", { title: done.title, status: words.status(done.to), name: done.uploaderName }),
    };
  });
}

export async function declineStory(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  await run(formData, async (id) => {
    const done = await decline(admin, id);
    return { toast: (await toasts())("declined", { name: done.uploaderName }) };
  });
}

export async function flagStory(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  await run(formData, async (id) => {
    const done = await flag(admin, id, formData.get("reason") ?? "");
    return { toast: (await toasts())("flagged", { name: done.uploaderName }) };
  });
}

export async function clearFlag(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  await run(formData, async (id) => {
    const done = await clear(admin, id);
    return { toast: (await toasts())("flagCleared", { name: done.uploaderName }) };
  });
}

/**
 * The requester takes their own back. The only action here that is not the
 * printer owner's, which is why it takes `requireUser` — the ownership check
 * itself is the service's, and applies to the API call just the same.
 *
 * It lands on the board rather than `from`: the ticket it came from no longer
 * exists, and redirecting to a page that is now a 404 is a poor way to say
 * "that worked".
 */
export async function withdrawStory(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = storyIdOr400(formData.get("storyId"));
  let ref: string;
  try {
    ref = (await withdraw(user, id)).ref;
  } catch (error) {
    if (error instanceof StoryProblem) back(`/story/${id}`, { toast: await say(error) });
    throw error;
  }
  back("/board", { toast: (await toasts())("withdrawn", { ref }) });
}

/**
 * Change a ticket's priority. The requester's on their own ticket and the
 * owner's on any — which is why this takes `requireUser`, like withdraw; who
 * may is the service's decision. Lands back on the ticket.
 */
export async function changeStoryPriority(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = storyIdOr400(formData.get("storyId"));
  let done: Awaited<ReturnType<typeof reprioritise>>;
  try {
    done = await reprioritise(user, id, formData.get("priority") ?? "");
  } catch (error) {
    if (error instanceof StoryProblem) back(`/story/${id}`, { toast: await say(error) });
    throw error;
  }
  const t = await toasts();
  back(`/story/${id}`, {
    toast: done.unchanged ? t("priorityAlready", { to: done.to }) : t("priorityChanged", { to: done.to }),
  });
}
