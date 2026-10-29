"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";

import { setPassword, type SetPasswordState } from "./actions";
import { PASSWORD_MIN, USERNAME_MAX, USERNAME_MIN } from "@/lib/auth-rules";
import { Button, Input, Label, Notice } from "@/components/ui";

function Submit() {
  const t = useTranslations("auth.setPassword.form");
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? t("working") : t("submit")}
    </Button>
  );
}

export function SetPasswordForm({
  token,
  needsUsername = false,
}: {
  token: string;
  /** True only for an account that has never had one — the seeded admin. */
  needsUsername?: boolean;
}) {
  const t = useTranslations("auth.setPassword.form");
  const fields = useTranslations("auth.fields");
  const notice = useTranslations("auth.notice");
  const [state, formAction] = useActionState<SetPasswordState, FormData>(
    setPassword,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-[17.6px]">
      <input type="hidden" name="token" value={token} />

      {needsUsername && (
        <div>
          <Label htmlFor="username">{fields("pickUsername")}</Label>
          <Input
            id="username"
            name="username"
            required
            minLength={USERNAME_MIN}
            maxLength={USERNAME_MAX}
            pattern="[A-Za-z0-9_\-]+"
            placeholder="ruben"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            aria-describedby="username-hint"
            aria-invalid={state.field === "username" || undefined}
          />
          <p
            id="username-hint"
            className={`mt-[6px] text-[12.5px] leading-[1.4] ${
              state.field === "username"
                ? "font-bold text-cherry-dk"
                : "font-mono uppercase tracking-[0.04em] text-ink-3"
            }`}
          >
            {state.field === "username" ? state.error : fields("usernameHelp")}
          </p>
        </div>
      )}

      <div>
        <Label htmlFor="password">{t("newPassword")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={PASSWORD_MIN}
          autoComplete="new-password"
          autoFocus={!needsUsername}
          aria-describedby="password-hint"
          aria-invalid={state.field === "password" || undefined}
        />
        <p
          id="password-hint"
          className={`mt-[6px] text-[12.5px] leading-[1.4] ${
            state.field === "password"
              ? "font-bold text-cherry-dk"
              : "font-mono uppercase tracking-[0.04em] text-ink-3"
          }`}
        >
          {state.field === "password" ? state.error : t("passwordHelp", { min: PASSWORD_MIN })}
        </p>
      </div>

      {state.error && !state.field && (
        <Notice tone="warn" label={notice("holdOn")}>{state.error}</Notice>
      )}

      <Submit />
    </form>
  );
}
