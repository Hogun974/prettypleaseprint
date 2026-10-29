# Themes

The app is drawn in a palette of colour tokens, and a theme is another value
for some of them. There are two: **the diner**, the default, and **diner after
hours** — the same diner at night, a dark counter with the neon still lit.
Nobody can choose one in the app yet; this page is how they work and how to
add one.

## What a theme is

- **The diner** is the `@theme` and `@theme static` blocks in
  [`src/app/globals.css`](../src/app/globals.css). Every colour the app draws
  with is one of those tokens (emails aside: a mail client has no CSS
  variables).
- **Any other theme** is one file in [`src/app/themes/`](../src/app/themes/),
  imported at the top of `globals.css`, that redefines tokens under its own
  `data-theme` value and does nothing else.
  [`after-hours.css`](../src/app/themes/after-hours.css) is the example, and
  its header says why each group of tokens moves the way it does.
- **The list** is `THEMES` in [`src/lib/theme.ts`](../src/lib/theme.ts). A
  choice is a theme's id or `auto`.
- **Which theme a request gets** is decided by `themeForRequest()` in the same
  file, and the root layout writes it into `<html data-theme="…">`, so the
  first paint is already in it. Today it returns the default for everyone;
  a person's preference and an instance default, when they exist, are read
  there and nowhere else.
- **`auto`** follows the system's light or dark setting: the diner by day,
  after hours by night. It is a media query in `after-hours.css`, not server
  code — the server never learns the setting, and the page follows it if it
  changes while open, with no script.

Not themed: e-mails, the Swagger console at `/docs` (a route that writes its
own page and keeps the diner's colours), and the favicon.

## The colour rule at night

The diner's rule is *bright fills carry dark ink* — enamel signs worked that
way because they had to be read from a moving car. Components lean on it
without saying so: `text-ink` is written on a cream card and on a sun-yellow
chip alike, because by day the ink is the same. A dark theme makes `ink`
light, and on the yellow chip that is light text on yellow.

So a fill says which ink it carries, for itself and everything inside it, and
components do not change:

- **Signs** — `bg-sun`, `bg-aqua`, `bg-mint`, `bg-cherry`, `bg-chrome` and the
  `-dk` fills — swap `ink`, `ink-2` and `ink-3` for `--color-sign-ink`,
  `-2`, `-3`.
- **The counter** — `bg-cream`, `-2`, `-3`, `bg-porcelain` and the four
  washes — put the counter's ink back (`--color-counter-ink*`), for a card
  that sits on a sign: the porcelain tickets on the queue's yellow "Waiting on
  you" panel.

Each swap is declared on the fill's utility (`@utility bg-sun { @apply on-sign; }`,
at the end of `globals.css`), so variants come with it: `hover:bg-sun` swaps
the ink exactly while the yellow is there. In the diner every swap puts back
the value it replaces. `bg-ink` is neither: it is the header's bar, dark by day
and lit at night, and what it carries is `text-cream`, which turns over with
it.

The other tokens a dark counter needed, each the diner's value by default so
the diner renders as it did:

| token | what it is | why it is not an existing one |
| --- | --- | --- |
| `--color-sign-ink`, `-2`, `-3` | the ink a sign carries | `ink` is the counter's |
| `--color-counter-ink`, `-2`, `-3` | the counter's inks, captured at the root | a sign has redeclared `ink` by the time a card inside it looks |
| `--color-stamp` | the hard offset shadow | Tailwind writes the shadow into each utility, where `ink` would be a sign's |
| `--color-swatch-mark` | the `?` on a "whatever" swatch | it was `text-cream`, and cream is the counter |

The 3D viewer draws the model's edges in `--color-sign-ink`: the model is lit
by the same lamps (`--color-scene-*`, light rather than paint) in every theme,
so it is drawn as it is by day, on a dark bed. The selection is a sun fill, so
it carries a sign's ink too.

## Measuring it

```bash
npm run check:contrast            # every theme's pairs against WCAG AA; in CI
npm run check:contrast -- --all   # every row
SHOT_THEME=after-hours npm run shots
SHOT_THEME=auto SHOT_SCHEME=dark npm run shots
```

`check:contrast` reads the palettes and the sign/counter lists out of the CSS
and measures, in every theme: each text-on-fill pair written on one element
in `src/` (and its `hover:`, `disabled:` … variants); every counter ink on
every counter ground and every sign ink on every sign, because inherited
text can land on any of them; and keylines, the focus ring and each sign's
edge at 3:1. It fails a theme below AA, a fill class it cannot place as sign
or counter, and a theme listed without CSS. The diner is reported and not
failed — see below.

`npm run shots` measures what each page actually renders — every element's
text against the colour it sits on, nested fills and inherited ink included —
and writes the pairs to `contrast.json` beside the screenshots. `SHOT_THEME`
draws the pages in a theme nobody can choose yet, test-only.

### The table

From `npm run check:contrast` (109 pairs in all; `-- --all` prints them).
"Any" rows are pairs no class string writes but inherited ink could produce;
they hold after hours to AA and are not counted against the diner. Ratios to
4.5:1 unless marked; ✗ is below AA.

| pair | where | diner | after hours |
| --- | --- | --- | --- |
| `cherry` on `sun-wash` | any counter ground | 3.81 | 4.53 |
| `cherry` on `aqua-wash` | any counter ground | 3.70 | 4.59 |
| `ink-3` on `cherry` (a sign's ink-3) | any sign | 1.06 | 4.66 |
| `ink-2` on `cherry` (a sign's ink-2) | any sign | 2.01 | 4.92 |
| `ink-3` on `porcelain` | the typed meta line on every card, placeholders | **4.13 ✗** | 5.40 |
| `ink` on `cherry` | Delivery / Shipped / High chips, "needs a look" | **3.91 ✗** | 5.56 |
| `ink-3` on `cream-2` | meta lines on counter panels, the rail's note | **3.39 ✗** | 5.95 |
| `cream` on `cherry` | `hover:bg-cherry hover:text-cream` on Remove / Delete | **4.09 ✗** | 6.04 |
| `cherry` on `cream` | `hover:text-cherry` on links | **4.09 ✗** | 6.04 |
| `ink-3` on `cream` | the footer, notes under a form | **3.86 ✗** | 6.44 |
| `cherry-dk` on `cherry-wash` | Remove, Revoke, Withdraw | 5.14 | 6.07 |
| `cream` on `cherry-dk` | every primary button | 5.99 | 7.30 |
| `sun-dk` on `sun-wash` | "on the bed", member access | 4.91 | 7.63 |
| `ink` on `sun` | Kicker, chips, Notice "Hold on", the toast | 9.20 | 9.20 |
| `ink` on `porcelain` | cards and inputs | 17.13 | 12.88 |
| keyline (`ink`) on `cream-3`, 3:1 | `border-ink` | 12.51 | 11.86 |
| focus ring (`cherry-dk`) on `cream-3`, 3:1 | `:focus-visible` | 4.69 | 5.63 |
| `sun` sign's edge on the page, 3:1 | its fill or its keyline | 16.00 | 9.99 |

`npm run shots` agrees: in the after-hours screenshots, the 33 distinct pairs
the sixteen pages render all clear AA, the lowest `ink-3` on porcelain at
5.40:1; in the diner's, four are below it — the same four as the bold rows
that are rendered on those pages.

**The diner's own six** (bold above) predate this work and are reported, not
fixed: fixing them means changing how the default looks, which a theme must
not do. They are worth their own change: `ink-3` at `#6f6155` would clear
4.5:1 on every ground it is written on today (cream-2 is the tightest, at
4.90), and dark ink on cherry wants a slightly lighter cherry, as after hours
does.

## Adding a theme

1. A file in `src/app/themes/<id>.css` with a `@custom-variant <id>` and a
   `:root { @variant <id> { … } }` block of token values — copy
   `after-hours.css`. Import it at the top of `globals.css`.
2. Its id, name and description in `THEMES`.
3. `npm run check:contrast` until it passes, then `SHOT_THEME=<id> npm run shots`
   and look at every page.
