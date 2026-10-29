"use client";

import { removeMaterialAction } from "./actions";

/** Said by the catalogue page (admin.catalogEdit) and handed down: see client-groups.ts. */
export type RemoveMaterialLabels = { confirm: string; button: string };

export function RemoveMaterialButton({ id, labels }: { id: string; labels: RemoveMaterialLabels }) {
  return (
    <form
      action={removeMaterialAction}
      onSubmit={(event) => {
        if (!window.confirm(labels.confirm)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className="stamp cursor-pointer rounded-chip border-[3px] border-ink bg-cherry-wash px-[13px] py-[5px] font-mono text-[11px] font-bold uppercase text-cherry-dk hover:bg-cherry hover:text-cream"
      >
        {labels.button}
      </button>
    </form>
  );
}
