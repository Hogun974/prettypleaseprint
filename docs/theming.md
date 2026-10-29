# Themes

The app is drawn in a palette of colour tokens, and a theme is another value
for some of them. There are two: **the diner**, the default, and **diner after
hours** — the same diner at night, a dark counter with the neon still lit.
This fork adds a third, **[glass](#glass-fork-only)**, liquid glass over a
bright, colourful room, which upstream would not take. Nobody can choose one
in the app yet; this page is how they work and how to add one.

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

Liquid glass, in the spirit of Apple's iOS 26: see-through panels over a
bright, colourful room, blurred and saturated, with lit rims and glossy
bubbles. The app's faces and accent families stay; the diner's trim — the
checkerboard, the chrome strip, the ribbed layer lines, the ticket punches,
the hard stamps — recedes. [`themes/glass.css`](../src/app/themes/glass.css)
says why each token moves; the choices that are not tokens:

- **The room** is the root's background: a cool pale ground
  (`--color-backdrop`), four large glows in luminous accents
  (`--color-glow-1` … `-4`: aqua, sun, a cherry pink, mint) that overlap,
  and a white wash over them (`--color-wash`). The wash is the legibility
  scrim for what is written straight on the page — headings, notes, the
  footer — and the glass takes the colour back by saturating what it blurs.
  It scrolls with the page rather than being fixed: a fixed background is
  repainted on every scroll, under glass that is blurring it.
- **Glass.** A counter fill (porcelain, the creams, the washes) and the
  header's band are painted at an alpha. Tailwind's `bg-*` utilities read
  `--background-color-<name>` before `--color-<name>`, and `globals.css`
  sets each to `var(--color-fill-<name>, var(--color-<name>))`: glass gives
  `--color-fill-*`, the colour itself stays opaque for `text-cream`, the 3D
  viewer and the fallback below, and every other theme paints exactly what
  it did. The two reds have the same hook, so glass can light the fill
  behind white text and keep the text red deep.
- **One blur per surface, the outermost.** Glass that is not inside other
  glass blurs and saturates the room behind it (`blur(22px) saturate(1.7)`);
  a card, a chip or an input inside a panel is tinted glass over the panel's
  already blurred ground, with no blur of its own — a blur inside a blur
  would see only its parent and cost a layer for nothing. Pills (buttons and
  chips) do not blur either: there are dozens, and over the room's soft glows
  their blur would show nothing. The sticky header is one layer, on its
  `::before`, so its menus can blur the page rather than only the header.
  `npm run shots` logs the count: 1 to 11 a page, typically 3 to 6 (the
  header plus the page's top-level panels and cards); the story page, with
  its viewer, form and field, has 10.
- **Light.** Every piece of glass has a specular rim — a bright inset line
  along the top, a fainter one down the left, a thin luminous border — and a
  soft depth shadow; radii grow to 20 and 28 px. Form fields keep a dark
  keyline, 2 px: a field has to be found at 3:1 (WCAG 1.4.11) on a ground
  that is now see-through. The Activity button in the header keeps a
  softened one too, as the clear band would swallow a white rim.
- **Bubbles.** Signs (the bright fills, and the reds) stay opaque and get a
  gloss along the top, a lit rim and a soft shadow; their keyline is softened
  to 70% of the ink they carry. Buttons swell (`scale(1.04)`) under the
  pointer and give (`0.96`) under a press — a transform, so nothing around
  them moves, and none under `prefers-reduced-motion`.
- **The colour rule, with dark signs.** Bright fills — sun, aqua, mint,
  chrome — carry dark ink. On a light counter, cherry is read as text (a
  hovered link) and carries text as a fill (the Delivery chip, a hovered
  button); no single red is dark enough for the first and light enough for
  dark ink. Glass makes cherry deep as text, lights it as a fill, and lets the
  fill carry light ink (`--color-dark-sign-ink`), as cherry-dk always has;
  sun-dk, aqua-dk and mint-dk do the same.
- **What floats has a veil** (`--color-veil`, white at 70%) under its glass:
  the header, its menus and the toast can have anything under them, a black
  model included, and the veil is what keeps them legible there.
- **The 3D viewer** reads opaque tokens, as before: its bed is the glass
  cream-2, an opaque screen inside a glass panel. Making it see-through
  would mean a transparent WebGL canvas, a change to the component for every
  theme.

### Accessibility

- `prefers-reduced-transparency: reduce` and `prefers-contrast: more` set
  every translucent `--color-fill-*` and the veil to `initial`, so each fill
  takes its opaque fallback, and remove every backdrop filter. The room stays
  with reduced transparency (text on it is held to AA anyway) and goes with
  more contrast, which also takes `ink-2` and `ink-3` most of the way to
  `ink`.
- `check:contrast` measures glass at its worst:
  - **The room**, for text straight on the page: every glow absent or at full
    alpha, in every combination, under the wash, reduced to the darkest and
    lightest in each channel — a bound no mixture of them crosses.
  - **Outermost glass**: the fill over the room blurred and saturated. Each
    channel of `saturate()` is linear in the colours it is given, and a blur
    only mixes them, so the bounds of the room's saturated corners hold for
    every blur of it. Saturation is taken as browsers apply it, on sRGB
    values. Also the fill over the room unblurred (a pill), over its veil on
    pure black and white (it may float), under its veil (a menu's veil is
    its background image), and opaque.
  - **Glass inside glass**: the fill over the darkest any outermost glass can
    be. The check fails a theme where a fill is darker than that in any
    channel, since then deeper nesting could be darker still.
  - **Signs**: their fill and the gloss over it; their edge, fill or softened
    keyline over the fill, at 3:1 on the room and on the header.
- `npm run shots` measures the rendered page the same way, with `SHOT_MEDIA`
  to emulate the settings and `SHOT_OVERLAYS` to add an open menu over a
  scrolled page and a toast:

  ```bash
  SHOT_THEME=glass SHOT_OVERLAYS=1 npm run shots
  SHOT_THEME=glass SHOT_MEDIA=prefers-reduced-transparency=reduce npm run shots
  SHOT_THEME=glass SHOT_MEDIA=prefers-contrast=more npm run shots
  ```

### Glass's numbers

Glass clears AA on all 124 pairs, each at its worst ground. The room is
between `#87b88b` and `#fef7fd`, channel by channel; blurred and saturated
behind glass, no darker than `#54b159`. The tightest, and some landmarks:

| pair | where | glass | diner |
| --- | --- | --- | --- |
| `cherry` on the page | any text on the page (hover links outside a panel) | 4.51 | 4.09 |
| `ink-3` on the page | the footer, notes under a form | 4.74 | 3.86 |
| `sun-dk` on the page | any text on the page | 4.76 | 5.27 |
| cherry sign's edge on the page, 3:1 | the Delivery chip | 3.22 | 16.00 |
| sun pill's edge on the band, 3:1 | the current page in the header | 3.87 | 9.20 |
| `ink-3` on `cherry` (a dark sign's light ink, under gloss) | any sign | 5.12 | 1.06 |
| `ink-3` on `cream-2` | meta lines on glass panels | 5.69 | 3.39 |
| `ink` on `cherry` | Delivery / Shipped / High chips | 5.66 | 3.91 |
| `ink-3` on `porcelain` | the typed meta line, placeholders | 6.34 | 4.13 |
| `cream` on `cherry-dk` | every primary button | 6.46 | 5.99 |
| `sign-ink` on the toast | over black and white | 8.01 | 9.20 |
| `board-ink` on `board` | the header band, over black and white | 8.36 | 16.00 |

Where real Liquid-Glass transparency could not clear AA, a tint does the
work rather than the bar dropping: the wash over the room, for text written
straight on it; the veil under what floats; and the deep reds, which are text
on glass, lit only as fills behind white.

`npm run shots` agrees on the rendered pages, with the overlays: 67 distinct
pairs over eighteen screenshots, none below AA, the lowest `ink-3` on the
room's floor at 4.74:1 (the sign-in page's footer link). With reduced
transparency 36 pairs and with more contrast 36, none below AA and no blurred
layer on any page.

## Adding a theme

1. A file in `src/app/themes/<id>.css` with a `@custom-variant <id>` and a
   `:root { @variant <id> { … } }` block of token values — copy
   `after-hours.css`. Import it at the top of `globals.css`.
2. Its id, name and description in `THEMES`.
3. `npm run check:contrast` until it passes, then `SHOT_THEME=<id> npm run shots`
   and look at every page.
