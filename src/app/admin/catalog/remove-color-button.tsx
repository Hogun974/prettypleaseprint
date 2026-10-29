"use client";

import { useTranslations } from "next-intl";

import { removeColorAction } from "./actions";

export function RemoveColorButton({
  id,
  name,
  materialName,
}: {
  id: string;
  name: string;
  materialName: string;
}) {
  const t = useTranslations("admin.catalogEdit");
  return (
    <form
      action={removeColorAction}
      onSubmit={(event) => {
        if (!window.confirm(t("removeColorConfirm", { name, material: materialName }))) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        aria-label={t("removeColorLabel", { name, material: materialName })}
        className="cursor-pointer rounded-chip border-2 border-ink bg-cherry-wash px-[10px] py-[4px] font-mono text-[10.5px] font-bold uppercase text-cherry-dk hover:bg-cherry hover:text-cream"
      >
        {t("delete")}
      </button>
    </form>
  );
}
