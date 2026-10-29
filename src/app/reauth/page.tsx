import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { db } from "@/lib/db";
import { requireUser } from "@/lib/authz";
import { isFreshAuth } from "@/lib/reauth";
import { AuthShell, H1, Kicker, Lead } from "@/components/ui";
import { ReauthForm } from "./reauth-form";
import { safeRedirect } from "@/lib/safe-redirect";

/**
 * "Confirm it's you" before the actions that move access around, and before
 * saving the instance settings, which change what the server does for
 * everybody.
 *
 * Reached only by being sent here from one of those actions — see
 * `requireFreshAuth` in `src/lib/reauth.ts`. Anyone whose sign-in is already
 * recent enough is bounced straight back, so landing here by hand does not
 * make you do anything twice.
 */
export default async function ReauthPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const target = safeRedirect(next);

  // You have to be somebody before you can prove you are still them.
  const user = await requireUser(`/reauth?next=${encodeURIComponent(target)}`);
  if (await isFreshAuth()) redirect(target);

  const row = await db.user.findUnique({
    where: { id: user.id },
    select: { username: true, displayUsername: true },
  });

  const [t, shell] = await Promise.all([
    getTranslations("auth.reauth"),
    getTranslations("authShell"),
  ]);

  return (
    <AuthShell sign={shell("sign")}>
      <Kicker>{t("kicker")}</Kicker>
      <H1>{t("title")}</H1>
      <Lead>{t("lead")}</Lead>

      <ReauthForm
        next={target}
        username={row?.username ?? ""}
        displayUsername={row?.displayUsername ?? row?.username ?? ""}
      />
    </AuthShell>
  );
}
