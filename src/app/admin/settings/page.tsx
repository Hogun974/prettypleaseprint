import type { ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { DEFAULT_LOCALE, LOCALES, LOCALE_NAMES } from "@/i18n/locales";
import { requireAdmin } from "@/lib/authz";
import { PASSKEY_RP_NAME } from "@/lib/auth";
import { ipSource } from "@/lib/client-ip";
import { mailTransport } from "@/lib/email";
import { IMPORT_SOURCES, SOURCE_LABEL } from "@/lib/import-source";
import { sourceUrl } from "@/lib/runtime";
import { currentSettings, mailFromLine, type Resolved } from "@/lib/settings";
import { DEFAULT_SLICER, SLICERS, slicerName } from "@/lib/slicers";
import { DEFAULT_THEME, THEME_CHOICES, THEME_KEY } from "@/lib/theme";
import { AppHeader } from "@/components/app-header";
import { Kicker, Notice } from "@/components/ui";
import { Toast } from "@/components/toast";
import { saveSettingsAction } from "./actions";
import { DefaultChoice } from "./default-choice";

export const dynamic = "force-dynamic";

/**
 * Instance-wide settings, and a plain account of what stays in the
 * environment. Admin-only: `requireAdmin` answers 404, so a client learns
 * nothing about this route.
 *
 * One plain server-rendered form, so it works with JavaScript off, like the
 * other admin screens. A field the environment sets is not an input at all —
 * it is shown with the variable that sets it, because the environment wins
 * and a field that accepted a value it would then ignore would be lying.
 *
 * The lower panel never shows a secret or a connection string: it says
 * *whether* mail is configured and by which kind of transport, never where.
 *
 * The whole page speaks the reader's language. What stays as written: the
 * names of environment variables and files, the import sources' names, and a
 * stored value's own refusal (`setting.problem`), which is for whoever runs
 * the host and names the variable to fix.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ toast?: string; error?: string }>;
}) {
  const [{ toast, error }, admin, t, themes, setup, page, notice] = await Promise.all([
    searchParams,
    requireAdmin(),
    getTranslations("settingsDefaults"),
    getTranslations("themes"),
    getTranslations("setup.revisit"),
    getTranslations("admin.settings"),
    getTranslations("setup.notice"),
  ]);
  const settings = await currentSettings();
  const { importSources, mailFromName, defaultLocale, defaultTheme, defaultSlicer } = settings;

  const editable = Object.values(settings).some((s) => s.source !== "env");
  const transport = mailTransport();
  const sender = mailFromLine(
    process.env,
    mailFromName.source === "saved" && !mailFromName.problem ? mailFromName.value : null,
  );
  const proxy = ipSource();

  return (
    <>
      <AppHeader user={admin} active="/admin/settings" />

      <main className="mx-auto w-full max-w-[880px] px-[26.4px] pb-[80px] pt-[35.2px]">
        <Kicker>{page("kicker")}</Kicker>
        <h1 className="m-0 mt-[6px] mb-[8px] font-display text-[30px] leading-[1.05] text-ink">
          {page("title")}
        </h1>
        <p className="m-0 mb-[22px] max-w-[62ch] text-[15px] text-ink-2">{page("lead")}</p>

        {/* The way back into the first-run setup once it is done: it only
            opens by itself while it is ahead of the instance (src/lib/setup.ts). */}
        <div className="mb-[22px] flex flex-wrap items-center gap-x-[13.2px] gap-y-[6px] rounded-card border-[3px] border-dashed border-ink-3 bg-cream-2 px-[17.6px] py-[11px]">
          <p className="m-0 flex-1 text-[14px] text-ink-2">
            <strong className="font-mono text-[12px] uppercase tracking-[0.1em] text-ink">{setup("title")}</strong>{" "}
            {setup("body")}
          </p>
          <Link
            href="/admin/setup"
            className="text-[14px] font-bold text-ink underline decoration-2 underline-offset-2 hover:text-cherry-dk"
          >
            {setup("link")}
          </Link>
        </div>

        {error && (
          <div className="mb-[17.6px]">
            <Notice tone="warn" label={notice("holdOn")}>{error}</Notice>
          </div>
        )}

        <form
          action={saveSettingsAction}
          className="mb-[35.2px] rounded-panel border-[3px] border-ink bg-porcelain p-[17.6px] shadow-stamp sm:p-[22px]"
        >
          {/* Import from a link */}
          <Field
            title={page("importSources")}
            setting={importSources}
            setBy={page}
            help={page("importSourcesHelp")}
          >
            {importSources.source === "env" ? (
              <Locked>
                {importSources.value.length > 0
                  ? importSources.value.map((s) => SOURCE_LABEL[s]).join(", ")
                  : page("off")}
              </Locked>
            ) : (
              <div className="flex flex-wrap gap-[8.8px]">
                {/* Unticked boxes send nothing; this says the list was on the
                    form, so all boxes clear means "off". */}
                <input type="hidden" name="importSources" value="" />
                {IMPORT_SOURCES.map((source) => (
                  <label
                    key={source}
                    className="flex cursor-pointer items-center gap-[8px] rounded-chip border-[3px] border-ink bg-cream-2 px-[14px] py-[8px] text-[15px] font-bold text-ink has-[:checked]:bg-mint-wash"
                  >
                    <input
                      type="checkbox"
                      name="importSources"
                      value={source}
                      defaultChecked={importSources.value.includes(source)}
                      className="h-[18px] w-[18px] accent-ink"
                    />
                    {SOURCE_LABEL[source]}
                  </label>
                ))}
              </div>
            )}
          </Field>

          {/* Sender name */}
          <Field
            title={page("senderName")}
            setting={mailFromName}
            setBy={page}
            help={page.rich("senderNameHelp", {
              code: (chunks) => <code className="font-mono text-[13px]">{chunks}</code>,
            })}
          >
            {mailFromName.source === "env" ? (
              <Locked>{mailFromName.value}</Locked>
            ) : (
              <input
                id="mailFromName"
                name="mailFromName"
                aria-label={page("senderName")}
                defaultValue={mailFromName.source === "saved" ? (mailFromName.stored ?? "") : ""}
                placeholder={mailFromName.value ?? page("noName")}
                maxLength={80}
                autoComplete="off"
                className="w-full rounded-card border-[3px] border-ink bg-cream-2 px-[15px] py-[11px] text-[16px] text-ink placeholder:text-ink-3"
              />
            )}
            <p className="m-0 mt-[8.8px] font-mono text-[12px] text-ink-2">
              {page.rich("goesOutAs", {
                sender,
                b: (chunks) => <span className="font-bold text-ink">{chunks}</span>,
              })}
              {transport === "none" && page("noTransportYet")}
            </p>
          </Field>

          {/* For everyone who has not chosen on /me */}
          <div className="mb-[17.6px] border-b-[3px] border-dashed border-ink-3 pb-[17.6px]">
            <h2 className="m-0 mb-[4px] font-display text-[20px] text-ink">{t("title")}</h2>
            <p className="m-0 max-w-[62ch] text-[14px] text-ink-2">{t("lead")}</p>
          </div>

          <Field title={t("language")} setting={defaultLocale} setBy={page} help={t("languageHelp")}>
            <DefaultChoice
              name="defaultLocale"
              label={t("language")}
              setting={defaultLocale}
              builtIn={DEFAULT_LOCALE}
              options={LOCALES.map((l) => [l, LOCALE_NAMES[l]])}
            />
          </Field>

          <Field title={t("theme")} setting={defaultTheme} setBy={page} help={null}>
            <DefaultChoice
              name="defaultTheme"
              label={t("theme")}
              setting={defaultTheme}
              builtIn={DEFAULT_THEME}
              options={THEME_CHOICES.map((c) => [c, themes(THEME_KEY[c])])}
            />
          </Field>

          <Field title={t("slicer")} setting={defaultSlicer} setBy={page} help={t("slicerHelp")} last>
            <DefaultChoice
              name="defaultSlicer"
              label={t("slicer")}
              setting={defaultSlicer}
              builtIn={DEFAULT_SLICER}
              options={SLICERS.map((s) => [s.id, slicerName(s.id) ?? t("otherSlicer")])}
            />
          </Field>

          {editable ? (
            <div className="mt-[17.6px] flex flex-wrap items-center gap-[13.2px]">
              <button
                type="submit"
                className="stamp cursor-pointer rounded-chip border-[3px] border-ink bg-cherry-dk px-[24px] py-[11px] text-[15px] font-bold text-cream hover:bg-cherry"
              >
                {page("save")}
              </button>
              <span className="max-w-[48ch] text-[13px] text-ink-3">{page("reauth")}</span>
            </div>
          ) : (
            <p className="m-0 mt-[17.6px] font-mono text-[12px] uppercase tracking-[0.05em] text-ink-3">
              {page("allFromEnv")}
            </p>
          )}
        </form>

        {/* What stays in the environment */}
        <section>
          <h2 className="m-0 mb-[6px] font-display text-[20px] text-ink">{page("env.title")}</h2>
          <p className="m-0 mb-[13.2px] max-w-[62ch] text-[14px] text-ink-2">
            {page.rich("env.lead", {
              code: (chunks) => <code className="font-mono text-[13px]">{chunks}</code>,
            })}
          </p>
          <dl className="m-0 grid grid-cols-1 gap-x-[22px] gap-y-[13.2px] rounded-card border-[3px] border-ink bg-cream-2 p-[17.6px] sm:grid-cols-[minmax(0,200px)_1fr]">
            <Row term={page("env.signIn")}>{page("env.signInHow")}</Row>
            <Row term={page("env.breach")} env="HIBP_DISABLED">
              {process.env.HIBP_DISABLED === "true" ? page("env.breachOff") : page("env.breachOn")}
            </Row>
            <Row term={page("env.passkeyName")} env="PASSKEY_RP_NAME">
              {PASSKEY_RP_NAME}
              <Aside>{page("env.passkeyNameWhy")}</Aside>
            </Row>
            <Row term={page("env.mail")} env={transport === "resend" ? "RESEND_API_KEY" : "SMTP_URL"}>
              {page(`env.mailKind.${transport}`)}
            </Row>
            <Row term={page("env.clientAddress")} env="TRUST_PROXY_HEADERS">
              {page(`env.proxy.${proxy}`)}
            </Row>
            <Row term={page("env.source")} env="SOURCE_URL">
              <a href={sourceUrl()} className="break-all text-ink underline decoration-2 underline-offset-2">
                {sourceUrl()}
              </a>
            </Row>
            <Row term={page("env.running")} env="PPP_TAG">
              {process.env.PPP_TAG ? (
                <span className="font-mono">{process.env.PPP_TAG}</span>
              ) : (
                page("env.notSet")
              )}
            </Row>
          </dl>
        </section>
      </main>

      {toast && <Toast>{toast}</Toast>}
    </>
  );
}

/** One setting on the form: its name, whether it is locked, and the control. */
function Field({
  title,
  setting,
  setBy,
  help,
  children,
  last = false,
}: {
  title: string;
  setting: Resolved<unknown>;
  /** The page's translations, for the "set by VARIABLE" badge. */
  setBy: Awaited<ReturnType<typeof getTranslations<"admin.settings">>>;
  help: ReactNode;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <fieldset
      className={`m-0 min-w-0 border-0 p-0 ${last ? "" : "mb-[17.6px] border-b-[3px] border-dashed border-ink-3 pb-[17.6px]"}`}
    >
      <legend className="contents">
        <span className="mb-[6px] flex flex-wrap items-center gap-[8.8px]">
          <span className="font-mono text-[12px] font-bold uppercase tracking-[0.1em] text-ink-2">{title}</span>
          {setting.source === "env" && (
            <span className="rounded-chip border-2 border-ink bg-sun px-[10px] py-[2px] font-mono text-[11px] font-bold text-ink">
              {setBy.rich("setBy", { env: setting.envName ?? "", code: (chunks) => <code>{chunks}</code> })}
            </span>
          )}
        </span>
      </legend>
      {help && <p className="m-0 mb-[11px] max-w-[62ch] text-[14px] text-ink-2">{help}</p>}
      {setting.problem && (
        <div className="mb-[11px]">
          <Notice tone="warn">{setting.problem}</Notice>
        </div>
      )}
      {children}
    </fieldset>
  );
}

/** The value an environment variable fixes, shown rather than offered. */
function Locked({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 inline-block rounded-card border-[3px] border-dashed border-ink-3 bg-cream-2 px-[15px] py-[9px] text-[15px] font-bold text-ink">
      {children}
    </p>
  );
}

function Row({ term, env, children }: { term: string; env?: string; children: ReactNode }) {
  return (
    <>
      <dt className="font-mono text-[12px] font-bold uppercase tracking-[0.1em] text-ink-2">
        {term}
        {env && <span className="mt-[2px] block font-normal normal-case tracking-normal text-ink-3">{env}</span>}
      </dt>
      <dd className="m-0 text-[15px] text-ink">{children}</dd>
    </>
  );
}

function Aside({ children }: { children: ReactNode }) {
  return <span className="mt-[4px] block text-[13px] text-ink-3">{children}</span>;
}
