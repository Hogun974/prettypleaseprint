"use client";

import { removeColorAction } from "./actions";

/** Said by the catalogue page (admin.catalogEdit) and handed down: see client-groups.ts. */
export type RemoveColorLabels = { confirm: string; label: string; button: string };

export function RemoveColorButton({ id, labels }: { id: string; labels: RemoveColorLabels }) {
  return (
    <form
      action={removeColorAction}
      onSubmit={(event) => {
        if (!window.confirm(labels.confirm)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        aria-label={labels.label}
        className="cursor-pointer rounded-chip border-2 border-ink bg-cherry-wash px-[10px] py-[4px] font-mono text-[10.5px] font-bold uppercase text-cherry-dk hover:bg-cherry hover:text-cream"
      >
        {labels.button}
      </button>
    </form>
  );
}
