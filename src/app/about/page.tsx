import { getLocale, getTranslations } from "next-intl/server";

import { requireUser } from "@/lib/authz";
import { sourceUrl } from "@/lib/runtime";
import { CONTRIBUTORS, type Contributor } from "@/lib/contributors";
import { AppHeader } from "@/components/app-header";
import { Kicker } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * What this app is, and who made it.
 *
 * Behind sign-in like every other page: the unauthenticated surface is kept
 * deliberately small, and a list of names is not something a stranger needs.
 *
 * The names come from src/lib/contributors.ts, which `npm run contributors`
 * generates from main's history — not from git at render time, because the
 * container has no `.git` to read. Text links only, no avatars: the CSP's
 * `img-src` refuses github.com, and it should.
 *
 * A server component throughout, so its words are read here (`about` in
 * messages/) and none of them is sent to the browser as a client group.
 */

/**
 * "Nov 2026" / "nov. 2026": the month of a `YYYY-MM`, in the reader's
 * language. In UTC, because it is a calendar month and not an instant — the
 * server's own time zone must not move the first of November into October.
 */
function month(since: string, locale: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(since);
  if (!m) return since;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  return new Intl.DateTimeFormat(locale, { month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

function Person({ person, since }: { person: Contributor; since: string }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-[13.2px] gap-y-[4px] border-b-2 border-dashed border-rule p-[15px] last:border-b-0">
      <a
        href={`https://github.com/${encodeURIComponent(person.login)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="font-display text-[19px] leading-[1.2] text-ink underline decoration-2 underline-offset-[3px] hover:text-cherry-dk"
      >
        @{person.login}
      </a>
      {person.name && <span className="text-[15.5px] text-ink-2">{person.name}</span>}
      <span className="ml-auto font-mono text-[11px] uppercase tracking-[0.05em] text-ink-3">
        {since}
      </span>
    </li>
  );
}

export default async function AboutPage() {
  const user = await requireUser("/about");
  const source = sourceUrl();
  const [t, locale] = await Promise.all([getTranslations("about"), getLocale()]);

  const maintainers = CONTRIBUTORS.filter((c) => c.role === "maintainer");
  const contributors = CONTRIBUTORS.filter((c) => c.role === "contributor");
  const person = (p: Contributor) => (
    <Person key={p.login} person={p} since={t("since", { month: month(p.since, locale) })} />
  );

  return (
    <>
      <AppHeader user={user} active="/about" />

      <main className="mx-auto w-full max-w-[860px] px-[26.4px] pb-[80px] pt-[35.2px]">
        <Kicker>{t("kicker")}</Kicker>
        <h1 className="m-0 mb-[13.2px] text-[38px] leading-[1.05] text-ink">
          Pretty Please Print
        </h1>
        <p className="m-0 mb-[13.2px] text-[16.5px] leading-[1.55] text-ink-2 text-pretty">
          {t("lead")}
        </p>
        <p className="m-0 mb-[35.2px] text-[16.5px] leading-[1.55] text-ink-2 text-pretty">
          {t.rich("licence", {
            url: source,
            link: (chunks) => (
              <a
                href={source}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all font-mono text-[14.5px] text-ink underline underline-offset-2 hover:text-cherry-dk"
              >
                {chunks}
              </a>
            ),
          })}
        </p>

        <h2 className="m-0 mb-[13.2px] font-display text-[26px] text-ink">
          {t("whoTitle")}
        </h2>
        <p className="m-0 mb-[17.6px] text-[15.5px] leading-[1.5] text-ink-2 text-pretty">
          {t("whoLead")}
        </p>

        {maintainers.length > 0 && (
          <section className="mb-[26.4px]">
            <h3 className="m-0 mb-[8.8px] font-mono text-[12px] font-bold uppercase tracking-[0.12em] text-ink-3">
              {t("maintainers")}
            </h3>
            <ul className="m-0 list-none overflow-hidden rounded-panel border-[3px] border-ink bg-sun-wash p-0 shadow-stamp">
              {maintainers.map(person)}
            </ul>
          </section>
        )}

        <section>
          <h3 className="m-0 mb-[8.8px] font-mono text-[12px] font-bold uppercase tracking-[0.12em] text-ink-3">
            {t("contributors")}
          </h3>
          {contributors.length === 0 ? (
            <p className="m-0 rounded-panel border-[3px] border-ink bg-porcelain p-[22px] font-mono text-[12px] uppercase tracking-[0.06em] text-ink-3 shadow-stamp">
              {t("nobodyYet")}
            </p>
          ) : (
            <ul className="m-0 list-none overflow-hidden rounded-panel border-[3px] border-ink bg-porcelain p-0 shadow-stamp">
              {contributors.map(person)}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
