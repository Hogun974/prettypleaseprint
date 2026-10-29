import { NextResponse } from "next/server";

import { fail } from "@/lib/api";
import { currentUser } from "@/lib/authz";
import type { Actor } from "@/lib/scope";
import { checkWish, openRequest } from "@/lib/intake";
import { MAX_BYTES, REJECTION_COPY, rejectionSpoken } from "@/lib/models";
import { StoryProblem } from "@/lib/stories";
import { MAX_REQUEST_BYTES } from "@/lib/upload-limits";
import { BUSY_COPY, acquireSlot, releaseSlot } from "@/lib/upload-slots";

/**
 * Model upload.
 *
 * A route handler rather than a server action, for one reason: the browser
 * can watch a real XHR upload progress bar against this, and a large model
 * over office wifi is long enough that a spinner is not good enough.
 *
 * This handler is the multipart door and nothing more: it takes the body
 * apart and hands a name and some bytes to `src/lib/intake.ts`, which decides
 * whether they become a ticket. Importing from a link is the other door onto
 * the same code.
 */

export const runtime = "nodejs";
/** The whole file is buffered to measure its bounding box; do not cache. See
 *  the slot gate below for what keeps that buffering bounded. */
export const dynamic = "force-dynamic";

/**
 * A refusal: the English sentence, and the key the upload form says it with
 * in its reader's language (`fail` in src/lib/api.ts has the envelope).
 */
const bad = (status: number, error: string, name: string) =>
  fail(status, error, { key: `problems.upload.${name}` });
const tooLarge = () => fail(413, REJECTION_COPY.too_large, rejectionSpoken("too_large"));

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return bad(401, "Sign in first.", "signIn");

  // Cheap rejection before reading a single byte of the body. The allowance
  // over the file cap is multipart's own overhead, and it matches the
  // transport limit in next.config.ts so that a file just over the cap is
  // answered "too large" rather than truncated into a parse failure.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_REQUEST_BYTES) {
    return tooLarge();
  }

  // Taken *before* the body is read, because reading it is the expensive part.
  // See `src/lib/upload-slots.ts` for what the gate is protecting.
  if (!(await acquireSlot())) return bad(503, BUSY_COPY, "busy");
  try {
    return await handleUpload(request, user);
  } catch (error) {
    if (error instanceof StoryProblem) return fail(error.status, error.message, error.spoken);
    console.error("[upload] unexpected failure", error);
    return bad(500, "The request could not be saved. Try again.", "notSaved");
  } finally {
    releaseSlot();
  }
}

async function handleUpload(request: Request, user: Actor) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad(400, "That upload did not arrive intact. Try again.", "notIntact");
  }

  const file = form.get("file");
  if (!(file instanceof File)) return bad(400, "No file was attached.", "noFile");
  if (file.size > MAX_BYTES) return tooLarge();

  const checked = await checkWish({
    title: form.get("title") ?? "",
    material: form.get("material"),
    colorName: form.get("colorName"),
    quantity: form.get("quantity"),
    priority: form.get("priority") ?? undefined,
    tip: form.get("tip"),
    note: form.get("note") ?? "",
    printSettings: form.get("printSettings") ?? "",
  });

  const bytes = new Uint8Array(await file.arrayBuffer());
  return NextResponse.json(await openRequest(user, checked, file.name, bytes));
}
