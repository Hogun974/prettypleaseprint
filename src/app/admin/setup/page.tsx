import type { ReactNode } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

import { DEFAULT_LOCALE, LOCALES, LOCALE_NAMES } from "@/i18n/locales";
import { requireAdmin, type Actor } from "@/lib/authz";
import { db } from "@/lib/db";
import { deviceLabel } from "@/lib/device-label";
import { mailTransport } from "@/lib/email";
import { sourceUrl } from "@/lib/runtime";
import { currentSettings, mailFromLine, type Resolved } from "@/lib/settings";
import { TEST_MAIL_LIMIT } from "@/lib/setup-admin";
import {
  INSTALLER,
  SETUP_STEPS,
  checkAddress,
  nextStep,
  platformOf,
  previousStep,
  requestOrigin,
  rpIdCovers,
  setupPending,
  stepFrom,
  type SetupStep,
} from "@/lib/setup";
import { DEFAULT_SLICER, SLICERS, slicerName } from "@/lib/slicers";
import { DEFAULT_THEME, THEME_CHOICES, THEME_KEY } from "@/lib/theme";
import { AppHeader } from "@/components/app-header";
import { Kicker, Notice } from "@/components/ui";
import { Toast } from "@/components/toast";
import { DefaultChoice } from "../settings/default-choice";
import { finishSetupAction, saveSetupStepAction, sendTestMailAction } from "./actions";
import { PasskeyButton } from "./passkey-button";

export const dynamic = "force-dynamic";

/**
 * The first-run setup (#106): six short steps for a new instance's owner,
 * one per visit, `?step=` saying which.
 *
 * Admin-only like every screen under /admin — `requireAdmin` answers a client
 * 404 — and it adds no power of its own (src/lib/setup.ts): the two steps
 * that save post to `saveSettings` through the same re-auth as
 * /admin/settings, the test message only ever goes to the owner, and the rest
 * are checks and links. Every form is a plain server-action form, so all of
 * it works with JavaScript off, except saving a passkey, which is a browser
 * ceremony and says so.
 *
 * Translated as a whole, since it is new. What it shows from the environment
 * — the address, the transport's kind — is shown, never a secret or a
 * connection string.
 */

/**
 * The `?problem=` codes the mail step explains. They come from the action,
 * but arrive in the URL, so they are looked up here and never used to build
 * a key — the signin page's rule for `?error=`.
 */
const MAIL_PROBLEMS = { noTransport: "noTransport", tooMany: "tooMany", refused: "refused" } as const;
/** A nodemailer error code, and nothing a link could make say anything else. */
const SAFE_CODE = /^[A-Z][A-Z0-9_]{1,31}$/;

type Search = {
  step?: string;
  saved?: string;
  sent?: string;
  error?: string;
  problem?: string;
  code?: string;
};

type T = Awaited<ReturnType<typeof getTranslations<"setup">>>;

export default async function SetupPage({ searchParams }: { searchParams: Promise<Search> }) {
  const [params, admin, t, h] = await Promise.all([
    searchParams,
    requireAdmin(),
    getTranslations("setup"),
    headers(),
  ]);
  const step = stepFrom(params.step);
  const pending = await setupPending();
  const label = { note: t("notice.note"), holdOn: t("notice.holdOn"), good: t("notice.good") };

  const toast =
    params.sent === "1" ? t("toast.sent") : params.saved === "1" ? t("toast.saved") : params.saved === "0" ? t("toast.unchanged") : null;

  let body: ReactNode;
  switch (step) {
    case "account":
      body = await AccountStep({ t, admin, userAgent: h.get("user-agent"), label });
      break;
    case "address":
      body = AddressStep({ t, seen: requestOrigin(h), label });
      break;
    case "look":
      body = await LookStep({ t, label });
      break;
    case "mail":
      body = await MailStep({ t, admin, params, label });
      break;
    case "slicer":
      body = await SlicerStep({ t, platform: platformOf(h), label });
      break;
    case "people":
      body = PeopleStep({ t });
      break;
  }

  return (
    <>
      <AppHeader user={admin} active="/admin/settings" />

      <main data-setup-step={step} className="mx-auto w-full max-w-[880px] px-[16px] pb-[80px] pt-[35.2px] sm:px-[26.4px]">
        <Kicker>{t("kicker")}</Kicker>
        <h1 className="m-0 mt-[6px] mb-[8px] font-display text-[30px] leading-[1.05] text-ink">{t("title")}</h1>
        <p className="m-0 mb-[22px] max-w-[62ch] text-[15px] text-ink-2">{pending ? t("lead") : t("leadAgain")}</p>

        <StepRail t={t} current={step} />

        {params.error && (
          <div className="mb-[17.6px]">
            <Notice tone="warn" label={label.holdOn}>{params.error}</Notice>
          </div>
        )}

        <section className="rounded-panel border-[3px] border-ink bg-porcelain p-[17.6px] shadow-stamp sm:p-[26.4px]">
          <p className="m-0 mb-[4px] font-mono text-[12px] font-bold uppercase tracking-[0.1em] text-ink-2">
            {t("stepOf", { n: SETUP_STEPS.indexOf(step) + 1, total: SETUP_STEPS.length })}
          </p>
          <h2 className="m-0 mb-[13.2px] font-display text-[24px] leading-[1.1] text-ink">{t(`steps.${step}`)}</h2>
          {body}
        </section>

        {pending ? (
          // Skipping is ending: from any step, the setup stops opening by
          // itself. Not a link, because it changes something.
          <form action={finishSetupAction} className="mt-[22px] flex flex-wrap items-center gap-x-[13.2px] gap-y-[6px]">
            <input type="hidden" name="how" value="skipped" />
            <input type="hidden" name="step" value={step} />
            <button
              type="submit"
              className="cursor-pointer rounded-chip border-[3px] border-ink bg-porcelain px-[17.6px] py-[8px] text-[14px] font-bold text-ink hover:bg-cream-2"
            >
              {t("skipAll")}
            </button>
            <span className="max-w-[52ch] text-[13px] text-ink-3">{t("skipAllHelp")}</span>
          </form>
        ) : (
          <p className="m-0 mt-[22px] text-[14px] text-ink-2">
            {t("doneAlready")}{" "}
            <Link href="/admin/settings" className="font-bold text-ink underline decoration-2 underline-offset-2 hover:text-cherry-dk">
              {t("backToSettings")}
            </Link>
          </p>
        )}
      </main>

      {toast && <Toast>{toast}</Toast>}
    </>
  );
}

// ---------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------

/** All six, each a link: any step can be gone back to, or ahead to. */
function StepRail({ t, current }: { t: T; current: SetupStep }) {
  return (
    <nav aria-label={t("railLabel")} className="mb-[22px]">
      <ol className="m-0 flex list-none flex-wrap gap-[8px] p-0">
        {SETUP_STEPS.map((s, i) => {
          const here = s === current;
          return (
            <li key={s}>
              <Link
                href={`/admin/setup?step=${s}`}
                aria-current={here ? "step" : undefined}
                className={`flex items-center gap-[8px] rounded-chip border-[3px] border-ink px-[12px] py-[5px] text-[13.5px] font-bold text-ink ${
                  here ? "bg-sun" : "bg-porcelain hover:bg-cream-2"
                }`}
              >
                <span className="font-mono text-[12px]">{i + 1}</span>
                {t(`steps.${s}`)}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Back, the step's own action, and — on a step that saves — a way past it
 * that saves nothing. `primary` is a submit button inside the step's form, or
 * null for a step that only shows something, which gets a plain "Next".
 */
function StepNav({ t, step, primary }: { t: T; step: SetupStep; primary: ReactNode | null }) {
  const back = previousStep(step);
  const next = nextStep(step);
  const link = "text-[14px] font-bold text-ink-2 underline decoration-2 underline-offset-2 hover:text-cherry-dk";
  return (
    <div className="mt-[22px] flex flex-wrap items-center gap-[13.2px] border-t-[3px] border-dashed border-ink-3 pt-[17.6px]">
      {back && (
        <Link href={`/admin/setup?step=${back}`} className={link}>
          {t("back")}
        </Link>
      )}
      <span className="flex-1" />
      {primary && next && (
        <Link href={`/admin/setup?step=${next}`} className={link}>
          {t("skipStep")}
        </Link>
      )}
      {primary ??
        (next && (
          <Link
            href={`/admin/setup?step=${next}`}
            className="stamp rounded-chip border-[3px] border-ink bg-cherry-dk px-[24px] py-[11px] text-[15px] font-bold text-cream hover:bg-cherry"
          >
            {t("next")}
          </Link>
        ))}
    </div>
  );
}

function Primary({ children, name, value }: { children: ReactNode; name?: string; value?: string }) {
  return (
    <button
      type="submit"
      name={name}
      value={value}
      className="stamp cursor-pointer rounded-chip border-[3px] border-ink bg-cherry-dk px-[24px] py-[11px] text-[15px] font-bold text-cream hover:bg-cherry"
    >
      {children}
    </button>
  );
}

function Lead({ children }: { children: ReactNode }) {
  return <p className="m-0 mb-[17.6px] max-w-[64ch] text-[15px] leading-[1.55] text-ink-2">{children}</p>;
}

/** Facts, label over value on a phone and side by side from there. */
function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="m-0 mb-[17.6px] grid grid-cols-1 gap-x-[22px] gap-y-[8.8px] rounded-card border-[3px] border-ink bg-cream-2 p-[15px] sm:grid-cols-[minmax(0,190px)_1fr]">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="font-mono text-[12px] font-bold uppercase tracking-[0.1em] text-ink-2">{term}</dt>
          <dd className="m-0 min-w-0 break-words text-[15px] text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A line to copy. Wraps rather than scrolls: a phone is a fine place to read it. */
function Code({ children }: { children: ReactNode }) {
  return (
    <pre className="m-0 mb-[13.2px] whitespace-pre-wrap break-all rounded-card border-[3px] border-ink bg-cream-2 px-[15px] py-[11px] font-mono text-[13.5px] text-ink">
      {children}
    </pre>
  );
}

/** A default on one of the two steps that set them, as /admin/settings shows it. */
function Choice({
  title,
  help,
  setting,
  label,
  children,
}: {
  title: string;
  help?: string;
  setting: Resolved<unknown>;
  label: Labels;
  children: ReactNode;
}) {
  return (
    <div className="mb-[17.6px]">
      <p className="m-0 mb-[6px] font-mono text-[12px] font-bold uppercase tracking-[0.1em] text-ink-2">{title}</p>
      {help && <p className="m-0 mb-[8.8px] max-w-[62ch] text-[14px] text-ink-2">{help}</p>}
      {setting.problem && (
        <div className="mb-[8.8px]">
          <Notice tone="warn" label={label.holdOn}>{setting.problem}</Notice>
        </div>
      )}
      {children}
    </div>
  );
}

type Labels = { note: string; holdOn: string; good: string };

// ---------------------------------------------------------------------------
// The steps
// ---------------------------------------------------------------------------

/** 1. The account the bootstrap link made, and a passkey for it. */
async function AccountStep({
  t,
  admin,
  userAgent,
  label,
}: {
  t: T;
  admin: Actor;
  userAgent: string | null;
  label: Labels;
}) {
  const [row, passkeys] = await Promise.all([
    db.user.findUnique({ where: { id: admin.id }, select: { username: true, displayUsername: true } }),
    db.passkey.count({ where: { userId: admin.id } }),
  ]);
  return (
    <>
      <Lead>{t("account.lead")}</Lead>
      <Facts
        rows={[
          [t("account.name"), admin.name],
          [t("account.username"), row?.displayUsername ?? row?.username ?? "—"],
          [t("account.email"), admin.email],
        ]}
      />
      {passkeys > 0 ? (
        <Notice tone="good" label={label.good}>{t("account.hasPasskey", { count: passkeys })}</Notice>
      ) : (
        <>
          <p className="m-0 mb-[13.2px] max-w-[64ch] text-[15px] leading-[1.55] text-ink">{t("account.passkeyWhy")}</p>
          <PasskeyButton deviceHint={deviceLabel(userAgent)} />
          <p className="m-0 mt-[11px] max-w-[64ch] text-[13px] text-ink-3">{t("account.passkeyLater")}</p>
        </>
      )}
      <StepNav t={t} step="account" primary={null} />
    </>
  );
}

/** 2. APP_URL against the address the browser used. Checked, never changed. */
function AddressStep({ t, seen, label }: { t: T; seen: string | null; label: Labels }) {
  const appUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  const address = checkAddress(appUrl, seen);
  const app = address.configured ?? appUrl;
  const rpId = process.env.PASSKEY_RP_ID ?? "localhost";
  let host = app;
  try {
    host = new URL(appUrl).hostname;
  } catch {
    // An APP_URL that is not a URL does not get this far: auth.ts refuses it.
  }
  const covered = rpIdCovers(rpId, appUrl);

  return (
    <>
      <Lead>{t("address.lead")}</Lead>
      <Facts
        rows={[
          ["APP_URL", <span key="app" className="font-mono">{app}</span>],
          [t("address.seen"), <span key="seen" className="font-mono">{seen ?? t("address.unknown")}</span>],
          ["PASSKEY_RP_ID", <span key="rp" className="font-mono">{rpId}</span>],
        ]}
      />
      <div data-address={address.matches ? "match" : "mismatch"} className="mb-[13.2px]">
        {address.matches ? (
          <Notice tone="good" label={label.good}>{t("address.match")}</Notice>
        ) : (
          <Notice tone="warn" label={label.holdOn}>
            {t("address.mismatch", { app, seen: seen ?? t("address.unknown") })}
          </Notice>
        )}
      </div>
      <div data-rp-id={covered ? "covers" : "misses"}>
        {covered ? (
          <Notice tone="good" label={label.good}>{t("address.rpIdOk", { rpId, host })}</Notice>
        ) : (
          <Notice tone="warn" label={label.holdOn}>{t("address.rpIdBad", { rpId, host })}</Notice>
        )}
      </div>
      <StepNav t={t} step="address" primary={null} />
    </>
  );
}

/** 3. The default language and theme — the settings page's two fields. */
async function LookStep({ t, label }: { t: T; label: Labels }) {
  const [{ defaultLocale, defaultTheme }, defaults, themes] = await Promise.all([
    currentSettings(),
    getTranslations("settingsDefaults"),
    getTranslations("themes"),
  ]);
  return (
    <form action={saveSetupStepAction}>
      <input type="hidden" name="step" value="look" />
      <Lead>{t("look.lead")}</Lead>
      <Choice title={defaults("language")} help={defaults("languageHelp")} setting={defaultLocale} label={label}>
        <DefaultChoice
          name="defaultLocale"
          label={defaults("language")}
          setting={defaultLocale}
          builtIn={DEFAULT_LOCALE}
          options={LOCALES.map((l) => [l, LOCALE_NAMES[l]])}
        />
      </Choice>
      <Choice title={defaults("theme")} setting={defaultTheme} label={label}>
        <DefaultChoice
          name="defaultTheme"
          label={defaults("theme")}
          setting={defaultTheme}
          builtIn={DEFAULT_THEME}
          options={THEME_CHOICES.map((c) => [c, themes(THEME_KEY[c])])}
        />
      </Choice>
      <p className="m-0 max-w-[60ch] text-[13px] text-ink-3">{t("reauthNote")}</p>
      <StepNav t={t} step="look" primary={<Primary>{t("saveNext")}</Primary>} />
    </form>
  );
}

/** 4. Whether there is a transport, and a message to prove it. */
async function MailStep({ t, admin, params, label }: { t: T; admin: Actor; params: Search; label: Labels }) {
  const transport = mailTransport();
  const { mailFromName } = await currentSettings();
  const sender = mailFromLine(
    process.env,
    mailFromName.source === "saved" && !mailFromName.problem ? mailFromName.value : null,
  );
  const problem =
    params.problem && Object.hasOwn(MAIL_PROBLEMS, params.problem)
      ? MAIL_PROBLEMS[params.problem as keyof typeof MAIL_PROBLEMS]
      : null;
  const code = params.code && SAFE_CODE.test(params.code) ? params.code : null;

  return (
    <>
      <Lead>{t("mail.lead")}</Lead>
      <Facts
        rows={[
          [
            t("mail.transport"),
            <span key="transport" data-transport={transport}>
              {t(`mail.kind.${transport}`)}
              {transport !== "none" && (
                <span className="ml-[8px] font-mono text-[12px] text-ink-3">
                  {transport === "resend" ? "RESEND_API_KEY" : "SMTP_URL"}
                </span>
              )}
            </span>,
          ],
          [t("mail.from"), <span key="from" className="font-mono text-[14px]">{sender}</span>],
          [t("mail.to"), <span key="to" className="font-mono text-[14px]">{admin.email}</span>],
        ]}
      />

      {problem && (
        <div className="mb-[13.2px]">
          <Notice tone="warn" label={label.holdOn}>
            {problem === "tooMany"
              ? t("mail.problem.tooMany", { count: TEST_MAIL_LIMIT.count, minutes: TEST_MAIL_LIMIT.minutes })
              : problem === "noTransport"
                ? t("mail.problem.noTransport")
                : code
                  ? t("mail.problem.refusedCode", { code })
                  : t("mail.problem.refused")}
          </Notice>
        </div>
      )}

      {transport === "none" ? (
        <Notice tone="info" label={label.note}>
          <span className="mb-[8.8px] block">{t("mail.noneHow")}</span>
          <Code>{`SMTP_URL="smtp://user:pass@mail.example.org:587"\nMAIL_FROM="printer@example.org"`}</Code>
          <span className="block text-[14px]">{t("mail.noneFine")}</span>
        </Notice>
      ) : (
        <form action={sendTestMailAction} className="flex flex-wrap items-center gap-[13.2px]">
          <button
            type="submit"
            className="stamp cursor-pointer rounded-chip border-[3px] border-ink bg-aqua px-[22px] py-[10px] text-[15px] font-bold text-ink hover:bg-aqua-wash"
          >
            {t("mail.send")}
          </button>
          <span className="max-w-[48ch] text-[13px] text-ink-3">
            {t("mail.sendHelp", { count: TEST_MAIL_LIMIT.count, minutes: TEST_MAIL_LIMIT.minutes })}
          </span>
        </form>
      )}
      <StepNav t={t} step="mail" primary={null} />
    </>
  );
}

/** 5. The default slicer, and the helper's installer for this browser's system. */
async function SlicerStep({ t, platform, label }: { t: T; platform: ReturnType<typeof platformOf>; label: Labels }) {
  const [{ defaultSlicer }, defaults] = await Promise.all([currentSettings(), getTranslations("settingsDefaults")]);
  const appUrl = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const guide = `${sourceUrl()}/blob/main/docs/prusaslicer.md`;
  // The helper's own profile names are the app's slicer ids; PrusaSlicer is
  // its default and "other" is no profile at all, so neither needs a line.
  const profile =
    defaultSlicer.value !== DEFAULT_SLICER && defaultSlicer.value !== "other"
      ? `\nPPP_SLICER_PROFILE=${defaultSlicer.value}`
      : "";
  const external = "font-bold text-ink underline decoration-2 underline-offset-2 hover:text-cherry-dk";

  return (
    <form action={saveSetupStepAction}>
      <input type="hidden" name="step" value="slicer" />
      <Lead>{t("slicer.lead")}</Lead>
      <Choice title={defaults("slicer")} help={defaults("slicerHelp")} setting={defaultSlicer} label={label}>
        <DefaultChoice
          name="defaultSlicer"
          label={defaults("slicer")}
          setting={defaultSlicer}
          builtIn={DEFAULT_SLICER}
          options={SLICERS.map((s) => [s.id, slicerName(s.id) ?? defaults("otherSlicer")])}
        />
      </Choice>

      <div data-platform={platform} className="rounded-card border-[3px] border-dashed border-ink-3 p-[15px]">
        <p className="m-0 mb-[8.8px] font-mono text-[12px] font-bold uppercase tracking-[0.1em] text-ink-2">
          {t("slicer.helper")}
        </p>
        <p className="m-0 mb-[11px] text-[15px] text-ink">{t("slicer.platform", { os: t(`slicer.os.${platform}`) })}</p>

        {platform === "linux" && (
          <>
            <p className="m-0 mb-[8.8px] text-[14.5px] text-ink-2">{t("slicer.linux")}</p>
            <Code>{INSTALLER.linux}</Code>
          </>
        )}
        {platform === "windows" && (
          <>
            <p className="m-0 mb-[8.8px] text-[14.5px] text-ink-2">{t("slicer.windows")}</p>
            <Code>{INSTALLER.windows}</Code>
            <p className="m-0 mb-[13.2px] text-[13px] text-ink-3">{t("slicer.windowsNote")}</p>
          </>
        )}
        {platform === "macos" && (
          <p className="m-0 mb-[13.2px] text-[14.5px] text-ink-2">
            {t("slicer.macos")}{" "}
            <a href={`${guide}#macos`} className={external}>
              {t("slicer.macosLink")}
            </a>
          </p>
        )}
        {platform === "other" && <p className="m-0 mb-[13.2px] text-[14.5px] text-ink-2">{t("slicer.other")}</p>}

        <p className="m-0 mb-[8.8px] text-[14.5px] text-ink-2">{t("slicer.conf")}</p>
        <Code>{`PPP_BASE="${appUrl}"${profile}`}</Code>
        <p className="m-0 text-[13.5px] text-ink-2">
          <a href={guide} className={external}>
            {t("slicer.guide")}
          </a>
          {" · "}
          <a href={sourceUrl()} className={external}>
            {t("slicer.source")}
          </a>
        </p>
      </div>

      <p className="m-0 mt-[13.2px] max-w-[60ch] text-[13px] text-ink-3">{t("reauthNote")}</p>
      <StepNav t={t} step="slicer" primary={<Primary>{t("saveNext")}</Primary>} />
    </form>
  );
}

/** 6. The guest list, and the end. */
function PeopleStep({ t }: { t: T }) {
  return (
    <form action={finishSetupAction}>
      <input type="hidden" name="how" value="finished" />
      <input type="hidden" name="step" value="people" />
      <Lead>{t("people.lead")}</Lead>
      <p className="m-0 text-[15px]">
        <Link href="/admin/invites" className="font-bold text-ink underline decoration-2 underline-offset-2 hover:text-cherry-dk">
          {t("people.guestList")}
        </Link>
      </p>
      <StepNav
        t={t}
        step="people"
        primary={
          <span className="flex flex-wrap items-center gap-[13.2px]">
            <button
              type="submit"
              name="then"
              value="queue"
              className="cursor-pointer rounded-chip border-[3px] border-ink bg-porcelain px-[20px] py-[10px] text-[15px] font-bold text-ink hover:bg-cream-2"
            >
              {t("people.finish")}
            </button>
            <Primary name="then" value="invites">
              {t("people.finishInvite")}
            </Primary>
          </span>
        }
      />
    </form>
  );
}
