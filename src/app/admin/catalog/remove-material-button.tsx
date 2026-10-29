"use client";

import { useTranslations } from "next-intl";

import { removeMaterialAction } from "./actions";

export function RemoveMaterialButton({ id, name }: { id: string; name: string }) {
  const t = useTranslations("admin.catalogEdit");
  return (
    <form
      action={removeMaterialAction}
      onSubmit={(event) => {
        if (!window.confirm(t("removeMaterialConfirm", { name }))) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className="stamp cursor-pointer rounded-chip border-[3px] border-ink bg-cherry-wash px-[13px] py-[5px] font-mono text-[11px] font-bold uppercase text-cherry-dk hover:bg-cherry hover:text-cream"
      >
        {t("remove")}
      </button>
    </form>
  );
}
