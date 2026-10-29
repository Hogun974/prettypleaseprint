"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { betterAuthMessage } from "@/i18n/better-auth";
import { Button, Input, Label, Notice } from "@/components/ui";

/**
 * The re-authentication ceremony.
 *
 * Both paths sign in again — Better Auth has no way to assert an identity
 * without minting a session — and the gate reads the age of the session that
 * comes back. See `src/lib/reauth.ts`.
 *
 * The password is offered as well as the passkey, deliberately. Every account
 * has a password by construction and only some have a passkey, so gating these
 * actions on a passkey alone would leave an admin without one unable to revoke
 * access — a lockout on the most safety-critical control in the app.
 */
export function ReauthForm({
  next,
  username,
  displayUsername,
}: {
  next: string;
  username: string;
  displayUsername: string;
}) {
  const t = useTranslations("auth.reauth.form");
  const library = useTranslations("problems.auth.betterAuth");
  const notice = useTranslations("auth.notice");
  const locale = useLocale();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passkeySupported, setPasskeySupported] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && window.PublicKeyCredential) {
      setPasskeySupported(true);
    }
  }, []);

  async function withPasskey() {
    setError(null);
    const res = await authClient.signIn.passkey();
    if (res?.error) {
      // Better Auth's own sentence for an English reader, as before; its code
      // in the reader's language otherwise (src/i18n/better-auth.ts).
      setError(betterAuthMessage(res.error, { locale, t: library, fallback: t("passkeyRefused") }));
      return;
    }
    window.location.assign(next);
  }

  async function withPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const { error } = await authClient.signIn.username({ username, password });
    if (error) {
      setBusy(false);
      setError(error.status === 429 ? t("tooManyAttempts") : t("refused"));
      return;
    }
    window.location.assign(next);
  }

  return (
    <div className="flex flex-col gap-[22px]">
      {passkeySupported && (
        <>
          <Button type="button" onClick={withPasskey} className="w-full">
            {t("withPasskey")}
          </Button>
          <div className="flex items-center gap-[13.2px]">
            <span className="h-[3px] flex-1 rounded-full bg-ink" />
            <span className="font-mono text-[11.5px] font-bold uppercase tracking-[0.14em] text-ink-3">{t("or")}</span>
            <span className="h-[3px] flex-1 rounded-full bg-ink" />
          </div>
        </>
      )}

      <form onSubmit={withPassword} className="flex flex-col gap-[13.2px]">
        {/* Named and readable, so a password manager fills the right entry —
            and so it is obvious which account is being confirmed. */}
        <input type="hidden" name="username" value={username} autoComplete="username" />
        <div>
          <Label htmlFor="password">{t("passwordFor", { name: displayUsername })}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Button type="submit" variant="secondary" disabled={busy} className="w-full">
          {busy ? t("checking") : t("confirm")}
        </Button>
      </form>

      {error && <Notice tone="warn" label={notice("holdOn")}>{error}</Notice>}
    </div>
  );
}
