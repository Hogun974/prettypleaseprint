# Keeping the catalogue in step with a spool inventory

The materials and colours a requester can pick are owner-managed at
`/admin/catalog`. An owner who already tracks their spools somewhere —
[Spoolman](https://github.com/Donkie/Spoolman), for one — can let that
inventory drive the catalogue instead, from a script on a timer.

This is optional and off by default. The application never reaches out to
the inventory: the script, next to the inventory, posts what it has, so the
instance needs no route into the owner's network and the inventory needs no
credentials for the instance.

## Turning it on

1. Make a token and keep it with the script:
   `TOKEN=$(openssl rand -base64 32)`.
2. Put its SHA-256 in `.env.docker` — never the token itself:
   `CATALOG_SYNC_TOKEN_HASH=` followed by the output of
   `printf %s "$TOKEN" | sha256sum`. Restart the app.
3. Have the script call the route below on a timer.

Without the variable, `POST /api/catalog/sync` answers 404.

## The route

```
POST /api/catalog/sync
Authorization: Bearer <token>
Content-Type: application/json

{ "materials": [
    { "name": "PLA",  "colors": [{ "name": "Red", "hex": "#ff0000" }, { "name": "White", "hex": "#ffffff" }] },
    { "name": "PETG", "colors": [{ "name": "Black", "hex": "#000000" }] }
  ],
  "dryRun": true }
```

It answers `{ "changes": [...], "applied": true|false }`, one entry per change
(`material_added`, `material_on`, `material_off`, `color_added`, `color_on`,
`color_off`, `color_recoloured`). With `"dryRun": true` nothing is written and
nothing is audited: that is how to see what a first run would do.

## What it changes, and what it never does

The list is the whole inventory, and the catalogue is brought to match it,
doing only what the owner could do by hand:

- a listed material or colour is added, or switched back on; names match
  without regard to case, and the owner's spelling is kept;
- a solid colour whose hex changed takes the new hex;
- an unlisted colour of a listed material is switched off;
- a listed material keeps, or gets, its "Whatever's on" choice — an inventory
  knows spools, not whether the requester minds which;
- an unlisted material is switched off, with its colours left as they were.

**Nothing is ever deleted.** A colour that comes back is the same row
switched back on, and tickets are untouched either way: each one copies its
material, colour and hex when it is filed.

**An empty list is refused** (400). An inventory that answers with nothing is
far more often a failing inventory than an empty shelf, and applying it
would switch the whole catalogue off.

Colours are `#rrggbb`. An inventory that stores transparency (`#rrggbbaa`)
must drop it before posting.

## The trail

Every change is recorded under the same audit actions as the admin forms
(`catalog.color_added`, `catalog.material_availability_changed`, …), as the
instance's first owner, with `"via": "catalog-sync"` in its detail. A run
that changes nothing records nothing, so a sync every few minutes does not
fill the audit log.

The token is a credential that can change the catalogue and nothing else. It
cannot sign in, read a ticket or reach any other route.
