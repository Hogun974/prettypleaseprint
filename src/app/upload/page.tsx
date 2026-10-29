import { getTranslations } from "next-intl/server";

import { printerName, requireUser } from "@/lib/authz";
import { listActiveBenefits } from "@/lib/benefits";
import { AppHeader } from "@/components/app-header";
import { Kicker } from "@/components/ui";
import { Notice } from "@/components/ui";
import { availableCatalog } from "@/lib/catalog-data";
import { importSources } from "@/lib/settings";
import { UploadForm } from "./upload-form";
import { UPLOAD_FORM_WORDS, getPageMessages } from "@/i18n/page-messages";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const user = await requireUser("/upload");
  const [owner, catalog, activeBenefits, sources, t, tTicket] = await Promise.all([
    printerName(),
    availableCatalog(),
    listActiveBenefits(),
    importSources(),
    getTranslations("upload"),
    getTranslations("ticket"),
  ]);
  const words = await getPageMessages(UPLOAD_FORM_WORDS);
  // The tip options are owner-managed now; the form renders from these.
  const benefits = activeBenefits.map((b) => ({
    label: b.label,
    preferred: b.preferred,
  }));

  return (
    <>
      <AppHeader user={user} active="/upload" />
      <main className="mx-auto w-full max-w-[1180px] px-[26.4px] pb-[80px] pt-[35.2px]">
        <div className="max-w-[780px]">
          <Kicker>{t("kicker")}</Kicker>
          {/* Still a sentence someone would say out loud — which was the
              point of the original H1, and survives the rename. */}
          {/* Still a sentence someone would say out loud, which was the point
              of the original H1 and survives both the rename and the redesign. */}
          <h1 className="m-0 mb-[13.2px] text-[46px] leading-[0.98] text-ink">
            Pretty please print
          </h1>
          <p className="m-0 mb-[26.4px] text-[16.5px] leading-[1.5] text-ink-2 text-pretty">
            {t.rich("lead", {
              owner,
              mono: (chunks) => <span className="font-mono">{chunks}</span>,
            })}
          </p>
        </div>
        {catalog.length > 0 ? (
          <UploadForm
            words={words}
            owner={owner}
            catalog={catalog}
            benefits={benefits}
            importSources={sources}
          />
        ) : (
          <div className="max-w-[780px]">
            <Notice tone="warn" label={tTicket("holdOn")}>
              {t("noCatalog")}
            </Notice>
          </div>
        )}
      </main>
    </>
  );
}
