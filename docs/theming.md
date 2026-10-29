# Themes

The app is drawn in a palette of colour tokens, and a theme is another value
for some of them. There are two: **the diner**, the default, and **diner after
hours** — the same diner at night, a dark counter with the neon still lit.
This fork adds a third, **[glass](#glass-fork-only)**, frosted panels over a
soft room, which upstream would not take. Nobody can choose one in the app
yet; this page is how they work and how to add one.

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
the value it replaces. Two fills are neither: `bg-ink`, which only draws lines
now and is a keyline like any other, and `bg-board`, the header's band (below).

The other tokens a dark counter needed, each the diner's value by default so
the diner renders as it did:

| token | what it is | why it is not an existing one |
| --- | --- | --- |
| `--color-sign-ink`, `-2`, `-3` | the ink a sign carries | `ink` is the counter's |
| `--color-counter-ink`, `-2`, `-3` | the counter's inks, captured at the root | a sign has redeclared `ink` by the time a card inside it looks |
| `--color-stamp` | the hard offset shadow | Tailwind writes the shadow into each utility, where `ink` would be a sign's |
| `--color-swatch-mark` | the `?` on a "whatever" swatch | it was `text-cream`, and cream is the counter |
| `--color-board`, `--color-board-ink` | the header's band, dark in every theme, and its links and wordmark | they were `bg-ink` and `text-cream`, which turn over with the counter and would light the band up |

On the band, the usual rule holds: the active pill is a sun sign and carries a
sign's ink, the Activity button and a hovered link are counter and carry the
counter's.

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

From `npm run check:contrast` (124 pairs in all; `-- --all` prints them;
glass's column is [in its section](#glass-fork-only)). "Any" rows are pairs
no class string writes but inherited ink could produce; they hold after hours
to AA and are not counted against the diner. Ratios to 4.5:1 unless marked;
✗ is below AA.

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
| `ink-3` on the page (cream) | the footer, notes under a form | **3.86 ✗** | 6.44 |
| `cherry-dk` on `cherry-wash` | Remove, Revoke, Withdraw | 5.14 | 6.07 |
| `cream` on `cherry-dk` | every primary button | 5.99 | 7.30 |
| `sun-dk` on `sun-wash` | "on the bed", member access | 4.91 | 7.63 |
| `ink` on `sun` | Kicker, chips, Notice "Hold on", the toast | 9.20 | 9.20 |
| `ink` on `porcelain` | cards and inputs | 17.13 | 12.88 |
| keyline (`ink`) on `cream-3`, 3:1 | `border-ink` | 12.51 | 11.86 |
| focus ring (`cherry-dk`) on `cream-3`, 3:1 | `:focus-visible` | 4.69 | 5.63 |
| `sun` sign's edge on the page, 3:1 | its fill or its keyline | 16.00 | 9.99 |
| `board-ink` on `board` | the header band's links and wordmark | 16.00 | 16.22 |
| active pill (`sun`) on `board`, 3:1 | the current page in the header | 9.20 | 10.54 |
| wordmark disc (`cherry`) on `board`, 3:1 | the header | 3.91 | 6.37 |
| focus ring (`cherry-dk`) on `board`, 3:1 | a focused link in the header | **2.67 ✗** | 7.71 |

`npm run shots` agrees: in the after-hours screenshots, the 33 distinct pairs
the sixteen pages render all clear AA, the lowest `ink-3` on porcelain at
5.40:1; in the diner's, four are below it — the same four as the bold rows
that are rendered on those pages.

**The diner's own seven** (bold above) predate this work and are reported, not
fixed: fixing them means changing how the default looks, which a theme must
not do. They are worth their own change: `ink-3` at `#6f6155` would clear
4.5:1 on every ground it is written on today (cream-2 is the tightest, at
4.90), and dark ink on cherry wants a slightly lighter cherry, as after hours
does. The focus ring on the header's band is the dark red on the dark band;
the ring wants a token of its own for the band.

## Glass (fork only)

**Never proposed upstream.** The upstream design refuses blur on purpose — "a
blurred shadow reads as glass or paper; an offset block reads as a die-cut
enamel sign" — so this theme lives only in this fork. It is chosen outright
or not at all: `auto` stays the diner by day and after hours by night.

The counter is frosted glass over a soft room, in the app's own faces,
keylines and accent colours.
[`themes/glass.css`](../src/app/themes/glass.css) says why each token
moves; the choices that are not tokens:

- **The room** is the root's background: a warm pale ground
  (`--color-backdrop`) and four glows in the accents (`--color-glow-1` …
  `-4`), each a radial gradient from its own corner of the page no more than
  half the page across, so no two ever stack at any size. The build plate's
  grid is still drawn over it. It scrolls with the page rather than being
  fixed to the window: a fixed background is repainted on every scroll.
- **Frost.** A counter fill (porcelain, the creams, the washes) and the
  header's band are painted at an alpha. Tailwind's `bg-*` utilities read
  `--background-color-<name>` before `--color-<name>`, and `globals.css`
  sets each to `var(--color-fill-<name>, var(--color-<name>))`: glass gives
  `--color-fill-*`, the colour itself stays opaque for `text-cream`, the 3D
  viewer and the fallback below, and every other theme paints exactly what
  it did. A piece of counter on a sign (a ticket on the queue's yellow panel)
  is drawn opaque.
- **Blur only where something sharp can pass behind**: the sticky header
  (one layer, on its `::before`, so the menus inside it can blur the page
  rather than only the header), the two menus that drop from it, and the
  toast — three layers at most on a page, and usually one. Panels in the
  page sit on the room, which has no detail for a blur to soften; blurring
  them would cost a compositing layer each and change nothing visible.
  `npm run shots` logs how many blurred layers each page has.
- **What floats has a veil** (`--color-veil`, white at 74%) under its frost.
  The veil, not the blur, keeps the header and the menus legible over a dark
  heading or a black model, and it is what the contrast check counts on.
- **Soft shadows instead of the stamp.** An offset block under a translucent
  panel shows through it as a dark slab. `--shadow-stamp` and
  `--shadow-stamp-lg` become a diffuse shadow (the large one with a lit top
  edge), and the `shadow-stamp` utilities are pointed back at them. The
  keylines stay: they are what makes an input or a button identifiable at
  3:1 on a ground that is partly see-through (WCAG 1.4.11).
- **The colour rule, with dark signs.** On a light counter, cherry is read
  as text (a hovered link) and carries text as a fill (the Delivery chip, a
  hovered button); no single red is dark enough for the first and light
  enough for dark ink — the diner sits at 3.9–4.1:1 on both. Glass makes
  cherry deep and lets it carry light ink (`--color-dark-sign-ink`), as
  cherry-dk always has; sun-dk, aqua-dk and mint-dk, the counter's dark
  text colours, do the same. A dark sign's keyline is that light ink too.
  Sun, aqua, mint and chrome are bright and carry dark ink.
- **The 3D viewer** reads opaque tokens, as before: its background is the
  glass cream-2, its lamps unchanged.

### Accessibility

- `prefers-reduced-transparency: reduce` and `prefers-contrast: more` set
  every `--color-fill-*` and the veil to `initial`, so each fill takes its
  opaque fallback, and remove every backdrop filter. The room stays: it is a
  background, nothing is read on it through a panel. More contrast also
  takes `ink-2` and `ink-3` most of the way to `ink`.
- `check:contrast` measures a translucent fill at its worst. Its grounds are
  the fill over every colour the room can be (one glow at a time at every
  strength, each with and without the grid's lines), over its veil on pure
  black and pure white (it may float over anything), under its veil on both
  (a menu's veil is painted over its frost), and the opaque colour (reduced
  transparency). Text straight on the page is measured on the room itself.
  The check fails a theme if a frost is darker than the room's floor in any
  channel, because the argument that a frost nested in a frost is only
  lighter would no longer hold — and if the glows stop being kept apart in
  the CSS, it falls back to every combination of them stacked at full
  strength.
- `npm run shots` measures glass the same way on the rendered page, with
  `SHOT_MEDIA` to emulate the settings:

  ```bash
  SHOT_THEME=glass SHOT_OVERLAYS=1 npm run shots   # + an open menu, a toast
  SHOT_THEME=glass SHOT_MEDIA=prefers-reduced-transparency=reduce npm run shots
  SHOT_THEME=glass SHOT_MEDIA=prefers-contrast=more npm run shots
  ```

### Glass's numbers

Glass clears AA on all 124 pairs, each at its worst ground. The room's
darkest point is `#aacfc9` (the aqua glow at full strength under two grid
lines), its lightest the bare ground `#f6f2ec`. The tightest:

| pair | where | glass | diner |
| --- | --- | --- | --- |
| `cherry` on the page | any text on the page (hover links outside a panel) | 4.61 | 4.09 |
| `ink-3` on the page | the footer, notes under a form | 4.70 | 3.86 |
| `sun-dk` on the page | any text on the page | 4.93 | 5.27 |
| `ink-3` on `mint` (a sign's ink-3) | any sign | 4.99 | 1.50 |
| `cherry` on `cream-3` | any counter ground | 5.21 | 3.20 |
| `ink-3` on `cream-2` | meta lines on counter panels | 5.46 | 3.39 |
| `ink-3` on `porcelain` | the typed meta line, placeholders | 6.34 | 4.13 |
| `sign-ink` on the toast | over black and white | 6.81 | 9.20 |
| focus ring (`cherry-dk`) on `board`, 3:1 | a focused header link | 6.74 | 2.67 |
| `ink` on `cherry` (a dark sign's light ink) | Delivery / Shipped / High chips | 7.47 | 3.91 |
| `cream` on `cherry-dk` | every primary button | 9.28 | 5.99 |
| `board-ink` on `board` | the header band, over black and white | 11.75 | 16.00 |

The diner's seven all clear in glass. `npm run shots` agrees, with the grid
counted as a texture as it is on the diner's cream: 63 distinct pairs over
eighteen screenshots (with `SHOT_OVERLAYS=1`, which adds the activity menu
open over a scrolled queue and a toast), the lowest `ink-3` on the aqua glow
at 5.56:1; with reduced transparency or more contrast, 37 pairs, none below
AA, and no blurred layer on any page. Without them every page has one
blurred layer, the header; two with a menu open or a toast up.

## Adding a theme

1. A file in `src/app/themes/<id>.css` with a `@custom-variant <id>` and a
   `:root { @variant <id> { … } }` block of token values — copy
   `after-hours.css`. Import it at the top of `globals.css`.
2. Its id, name and description in `THEMES`.
3. `npm run check:contrast` until it passes, then `SHOT_THEME=<id> npm run shots`
   and look at every page.
