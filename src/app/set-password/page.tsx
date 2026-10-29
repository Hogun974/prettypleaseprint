import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { readResetToken } from "@/lib/password-reset";
import { AuthShell, H1, Kicker, Lead, Notice } from "@/components/ui";
import { SetPasswordForm } from "./set-password-form";

export const dynamic = "force-dynamic";

/**
 * Where a set-password link lands.
 *
 * Reachable without a session on purpose — the whole point is that somebody
 * who cannot get in can get back in. It is not an authenticated surface and
 * grants nothing on its own: the token is checked here only to decide what to
 * render, and checked again for real when the form is submitted.
 */
export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const resolved = token ? await readResetToken(token) : null;
  const [t, auth, shell] = await Promise.all([
    getTranslations("auth.setPassword"),
    getTranslations("auth"),
    getTranslations("authShell"),
  ]);

  if (!resolved) {
    return (
      <AuthShell sign={shell("sign")}>
        <Kicker>{t("kicker")}</Kicker>
        <H1>{t("spentTitle")}</H1>
        <Lead>{t("spentBody")}</Lead>
        <Link
          href="/signin"
          className="font-bold text-[15px] text-cherry-dk underline underline-offset-2 hover:text-cherry"
        >
          {auth("goSignIn")}
        </Link>
      </AuthShell>
    );
  }

  const { user } = resolved;
  const needsUsername = !user.username;

  return (
    <AuthShell sign={shell("sign")}>
      <Kicker>{t("kicker")}</Kicker>
      <H1>
        {needsUsername ? t("titleSetUp") : t("titlePick", { name: user.name.split(" ")[0]! })}
      </H1>
      <Lead>{needsUsername ? t("leadSetUp") : t("leadPick")}</Lead>

      <SetPasswordForm token={token!} needsUsername={needsUsername} />

      <div className="mt-[22px]">
        <Notice label={auth("notice.note")}>{t("notice")}</Notice>
      </div>
    </AuthShell>
  );
}
