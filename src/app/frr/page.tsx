import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { requireUser, printerName } from "@/lib/authz";
import { FEATURE_BOARD } from "@/lib/scope";
import { coerceFeatureFilter, hasFeatureFilter, listFeatures } from "@/lib/features";
import { AppHeader } from "@/components/app-header";
import { FeatureCard } from "@/components/feature-card";
import { FeatureFilterBar } from "@/components/feature-filter";
import { Kicker } from "@/components/ui";
import { Toast } from "@/components/toast";
import type { FeatureStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

/**
 * The feature-request rail — the 'frr' track's board, the print `/board`'s
 * sibling. One rail per stage in flow order; `Done` and `Declined` leave the
 * rail and gather in a "Closed" strip below, so a requester still sees their
 * own history without a separate page.
 *
 * Scoped by `featureScope` in the query: a client's own requests never leave
 * the database, the owner sees everyone's.
 */
const RAIL = {
  Requested: "bg-chrome",
  Accepted: "bg-aqua",
  InProgress: "bg-sun",
  Shipped: "bg-cherry",
} as const;
type RailStatus = keyof typeof RAIL;

export default async function FeatureBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ toast?: string; priority?: string; status?: string; category?: string }>;
}) {
  const [params, user] = await Promise.all([searchParams, requireUser("/frr")]);
  const { toast } = params;
  const owner = await printerName();
  const t = await getTranslations("frr");

  const filter = coerceFeatureFilter(params);
  const features = await listFeatures(user, filter);
  const filtered = hasFeatureFilter(filter);
  const isAdmin = user.role === "admin";

  const closed = features.filter((f) => f.status === "Done" || f.status === "Declined");
  const byStatus = (status: FeatureStatus) => features.filter((f) => f.status === status);

  return (
    <>
      <AppHeader user={user} active="/frr" />

      <main className="mx-auto w-full max-w-[1180px] px-[26.4px] pb-[80px] pt-[35.2px]">
        <div className="mb-[26.4px] flex flex-wrap items-end justify-between gap-[13.2px]">
          <div>
            <Kicker>{t("kicker")}</Kicker>
            <h1 className="m-0 mt-[6px] font-display text-[30px] leading-[1.05] text-ink">
              {isAdmin ? t("board.titleOwner") : t("board.titleMember")}
            </h1>
            <p className="m-0 mt-[8px] max-w-[60ch] text-[15px] text-ink-2">
              {t("board.lead", { owner })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-[8.8px]">
            {/* The owner's triage view. The nav points at this board rather
                than at the queue, so without this the queue would be reachable
                only by typing the URL. */}
            {isAdmin && (
              <Link
                href="/frr/queue"
                className="stamp cursor-pointer rounded-chip border-[3px] border-ink bg-porcelain px-[18px] py-[11px] text-[15px] font-bold text-ink hover:bg-sun"
              >
                {t("board.triage")}
              </Link>
            )}
            <Link
              href="/frr/new"
              className="stamp cursor-pointer rounded-chip border-[3px] border-ink bg-cherry-dk px-[22px] py-[11px] text-[15px] font-bold text-cream hover:bg-cherry"
            >
              {t("board.newRequest")}
            </Link>
          </div>
        </div>

        <FeatureFilterBar action="/frr" filter={filter} />

        {features.length === 0 ? (
          <div className="rounded-panel border-[3px] border-dashed border-ink-3 bg-cream-2 px-[26.4px] py-[35.2px] text-center">
            {filtered ? (
              <>
                <p className="m-0 font-display text-[19px] text-ink">{t("board.noMatch")}</p>
                <p className="m-0 mt-[6px] text-[15px] text-ink-2">
                  {t.rich("board.clearFilters", {
                    clear: (chunks) => (
                      <Link href="/frr" className="underline underline-offset-2 hover:text-cherry-dk">
                        {chunks}
                      </Link>
                    ),
                  })}
                </p>
              </>
            ) : (
              <>
                <p className="m-0 font-display text-[19px] text-ink">{t("board.empty")}</p>
                <p className="m-0 mt-[6px] text-[15px] text-ink-2">
                  {t("board.emptyHelp")}
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-[17.6px]">
            {FEATURE_BOARD.map((status) => {
              const rail = status as RailStatus;
              const items = byStatus(status);
              return (
                <section key={status} className="flex flex-col gap-[11px]">
                  <div className="rounded-card border-[3px] border-ink bg-porcelain">
                    <div className={`h-[8px] rounded-t-[5px] border-b-[3px] border-ink ${RAIL[rail]}`} />
                    <div className="px-[13.2px] py-[8.8px]">
                      <div className="flex items-baseline justify-between gap-[8px]">
                        <span className="font-display text-[16px] text-ink">
                          {t(`status.${status}`)}
                        </span>
                        <span className="font-mono text-[12px] font-bold text-ink-3">
                          {items.length}
                        </span>
                      </div>
                      <p className="m-0 font-mono text-[11px] uppercase tracking-[0.05em] text-ink-3">
                        {t(`board.rail.${rail}`)}
                      </p>
                    </div>
                  </div>
                  {items.map((f) => (
                    <FeatureCard key={f.id} feature={f} showRequester={isAdmin} />
                  ))}
                </section>
              );
            })}
          </div>
        )}

        {closed.length > 0 && (
          <section className="mt-[35.2px]">
            <h2 className="m-0 mb-[13.2px] font-display text-[20px] text-ink">{t("board.closed")}</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-[17.6px] opacity-80">
              {closed.map((f) => (
                <FeatureCard key={f.id} feature={f} showRequester={isAdmin} />
              ))}
            </div>
          </section>
        )}
      </main>

      {toast && <Toast>{toast}</Toast>}
    </>
  );
}
