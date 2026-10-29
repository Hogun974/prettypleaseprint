import { redirect } from "next/navigation";
import { requireUser } from "@/lib/authz";
import { setupPending } from "@/lib/setup";

export const dynamic = "force-dynamic";

/**
 * Home differs by role, exactly as the handoff specifies: the printer owner
 * starts at the queue, because their job is deciding; everyone else starts at
 * the rail, because theirs is watching.
 *
 * Except on a new instance: until the first-run setup has been finished or
 * skipped, the owner starts there instead (src/lib/setup.ts). This is the
 * page every sign-in lands on, and the only one that redirects to the setup —
 * so it opens by itself after signing in, and any other page the owner goes
 * to meanwhile is simply that page.
 */
export default async function Index() {
  const user = await requireUser("/");
  if (user.role !== "admin") redirect("/board");
  redirect((await setupPending()) ? "/admin/setup" : "/queue");
}
