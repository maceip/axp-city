# Shader Lab UI adaptation

The Town workshop uses a small **vanilla DOM/CSS adaptation** of Shader Lab by
[basement.studio](https://github.com/basementstudio/shader-lab). The original React
components are not imported unchanged. Their source-mode design tokens, geometry,
variant states, fonts, and transition values are translated into
[`game/src/ui/shader-lab.css`](../game/src/ui/shader-lab.css). The city owns layout,
native button events, and popover behavior. No React, Tailwind, Base UI, or other
runtime dependency was added for this adaptation.

## Source and attribution

The source inspected on 2026-09-20 is the existing Stems extraction at
`/Users/mac/stems/src/stems/shader-lab/app/upstream`. Its provenance is recorded in
`/Users/mac/stems/src/stems/shader-lab/README.md` and
`/Users/mac/stems/docs/reviews/shader-lab-extraction.md`. Those files identify the
supplied `/Users/mac/Downloads/shader-lab-main` archive and document the Stems
extraction separately from this city adaptation.

Paths below are relative to that `upstream` directory:

| Source                                      | Lines inspected          | Reused contract                                                                   |
| ------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------- |
| `src/components/ui/glass-panel/index.tsx`   | 5–22                     | Panel/pill surface, border, radii, blur, shadows, interactive border              |
| `src/components/ui/button/variants.ts`      | 3–28                     | Compact button sizing and primary/secondary/ghost states                          |
| `src/components/ui/icon-button/variants.ts` | 3–31                     | 28px controls, 14px SVG, default/ghost/outline/selected states, labelled controls |
| `src/components/ui/menu/index.tsx`          | 43–96                    | Menu surface composition, 32px rows, separator                                    |
| `src/components/ui/tooltip/index.tsx`       | 22–64                    | Tooltip surface, typography, transition states                                    |
| `src/app/globals.css`                       | 93–140, 225–228, 280–336 | Original dark tokens, focus outline, body and monospace typography                |
| `src/components/editor/editor-topbar.tsx`   | 443–468, 604–640         | Actual 44px desktop toolbar composition; mobile 44px action targets               |

Original code: **Copyright © 2026 basement.studio LLC**, Apache License 2.0.
The complete original license is retained unchanged in
[`assets/licenses/shader-lab-APACHE-2.0.txt`](../assets/licenses/shader-lab-APACHE-2.0.txt).
The stylesheet carries an attribution and explicit modification notice. No
separate upstream NOTICE file was found in the supplied Shader Lab subtree.

## Class API

Import the stylesheet once. Source tokens use their original `--ds-*` and
`--ease-out-cubic` names on `:root`, so city layout can use them. The stylesheet
does **not** copy the source application's global reset or change the map/body
background. Use native `<button type="button">` elements for controls.

| Class                | Attributes                                                         | Geometry and default                                                                                         |
| -------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `.sl-panel`          | Optional `data-interactive="true"`                                 | 12px radius, 1px border, 24px blur, panel shadow; no imposed padding/layout                                  |
| `.sl-pill`           | Optional `data-interactive="true"`                                 | Inline flex, minimum height 36px, gap 8px, horizontal padding 12px, 10px radius                              |
| `.sl-button`         | `data-variant="primary\|secondary\|ghost"`                         | Secondary by default; 12px/16px medium type, 6px × 14px padding, 1px border, natural height 30px, 8px radius |
| `.sl-icon-button`    | `data-variant="default\|ghost\|outline"`                           | Default by default; 28 × 28px, 14 × 14px SVG, 6px radius                                                     |
| `.sl-icon-button`    | `aria-pressed="true"` or `data-selected="true"`                    | Selected surface white at 16%; hover white at 20%                                                            |
| `.sl-icon-button`    | `data-labelled="true"`                                             | Automatic width, 6px gap, horizontal padding 10px                                                            |
| `.sl-menu-item`      | Native `disabled` supported                                        | Full width, minimum height 32px, horizontal padding 8px, 13px/16px body type                                 |
| `.sl-menu-separator` | Use `aria-hidden="true"`                                           | 1px height, 4px block margins                                                                                |
| `.sl-tooltip`        | Optional `data-closed`, `data-starting-style`, `data-ending-style` | Maximum width 220px, 6px × 10px padding, 10px/1.35 monospace, 20px blur                                      |

`data-state="active"` preserves the text-button pressed state. Native `disabled`
and `aria-disabled="true"` both style disabled controls; code must still prevent
activation when it chooses `aria-disabled` instead of native `disabled`.

Examples:

```html
<div class="sl-panel" role="group" aria-label="Town tools">
  <button
    type="button"
    class="sl-icon-button"
    data-variant="ghost"
    aria-label="Place road"
    aria-pressed="true"
    title="Place road (2)"
  >
    <!-- 14px SVG supplied by the city -->
  </button>
  <button type="button" class="sl-button" data-variant="primary">
    Save town
  </button>
</div>
```

The source desktop topbar composes `GlassPanel` with minimum height 44px,
horizontal padding 10px, vertical padding 3px, and a 16px group gap. Its inner
capsule has a white-at-8% 1px border, black-at-25% background, 10px radius,
3px padding, and 2px gap. Its divider is 1 × 16px. These are composition rules,
not extra padding built into `.sl-panel`.

The source dropdown wraps its rows in a 168px-wide panel with 4px padding and
positions it 6px from the trigger. Positioning, open/close, focus, and dismissal
remain responsibilities of the city's native popover integration. Base UI's
React popup/portal code is not bundled.

## Deliberate adaptations

- Source Tailwind/CVA variants become ordinary CSS selectors. Text buttons use
  the source **compact** size by default; the source React component defaults to
  its larger 34px size.
- Hover and pressed styling are suppressed for disabled controls. Disabled icon
  text uses the existing source disabled token. `aria-disabled` matches native
  disabled styling consistently.
- On coarse-pointer devices, all buttons/menu items have minimum 44px targets;
  icon buttons become 44 × 44px while their SVG remains 14px. This carries the
  source mobile action sizing into the city's layout without importing its
  desktop/mobile editor shell.
- Reduced-motion preference removes transitions and press scaling. Normal
  controls retain 160ms `cubic-bezier(0.215, 0.61, 0.355, 1)` transitions; tooltip
  transitions remain 140ms.
- The reusable stylesheet retains the source 1px focus outline and 2px offset.
  City layout overrides this to a bright 2px inset outline, avoiding clipping
  by the compact glass panels. Native semantic controls provide keyboard
  activation. Selection uses `aria-pressed` for both visual and toggle state.
- Because the city map is much brighter than Shader Lab's dark canvas, city
  layout raises glass opacity to 80%, secondary text to 70% white and tertiary
  text/icons to 65% white. These overrides keep small labels and controls
  legible over terrain while preserving the source component geometry.
- `.sl-tooltip` provides the source visual surface only. Native `title` is an
  acceptable city fallback and uses browser styling; the source's Base UI
  tooltip delay (320ms), positioning, portal, and lifecycle are not reproduced.
- The original optional UI sound helper, editor drag/store logic, React
  wrappers, `class-variance-authority`, `tailwind-merge`, Base UI, and Radix icons
  are not copied. The city supplies its SVGs and behavior.

## Fonts

The exact existing Stems source font bytes are copied without modification from
`/Users/mac/stems/src/stems/shader-lab/app/public/fonts/geist/` into
[`assets/fonts/geist/`](../assets/fonts/geist/). CSS registers Geist Sans as
weight 100–900 and Geist Mono as regular 400, matching Stems `app/fonts.css`.
Fallbacks are Arial/sans-serif and monospace. Vite resolves the font URLs from
the stylesheet and emits the font files in the client build.

The Geist Sans metadata identifies the Geist Project Authors and SIL Open Font
License 1.1. The project's [official font license](https://github.com/vercel/geist-font/blob/main/OFL.txt)
was retrieved on 2026-09-20 and is preserved in
[`assets/fonts/geist/OFL.txt`](../assets/fonts/geist/OFL.txt): Copyright 2024 The
Geist Project Authors. Both font files retain their original bytes. Distribute
the font and UI licenses with any copied/built release of these assets. The
city entrypoint imports both as Vite URL assets and adds `rel="license"` links,
so production builds include the complete license files.

SHA-256 checksums:

```text
Geist-Sans-VF.woff2  9ceed04f6edb0334ec20ad3ddd75754516d4da63dde8f01b25a961a5ea71e2f6
Geist-Mono.woff2     5bc6413e82be410dc057feccee55160495b999d0fe212b7b6c6499b29b8b1e4a
OFL.txt              c683bfbcc7e087f5d37a54ef628f10387c451a83ddc459b151403a164ac46c90
Shader Lab license   85cd95ad1c02fc96d2c3be6aeb97b80bf6d9b4f03b7b4de78c99cf7153e744f4
```

Source snapshot SHA-256 checksums (paths relative to `upstream/src`):

```text
components/ui/glass-panel/index.tsx    3e5fbd0823c991b440085c9311578a31a68e394e2d875f1505968fb54e0000d9
components/ui/button/variants.ts      b0bc275558260e703dd6187f7e14bc7d8b68322891eaff6a33dae8991f0c36a5
components/ui/icon-button/variants.ts a89c5bdc9d9603b7023544899cffda5b8dd363d66ac8531e156ea33caa8fb03a
components/ui/menu/index.tsx          2a2c80d4752bf6db2f8be24a28c593011eb7551f6f3327155f625f1b3642610f
components/ui/tooltip/index.tsx       9fc1fd34004b8cf9b06af533d5240f62e661bec694d6fc4c8dd544172e4ecac9
app/globals.css                      062fd4dd5e163ca7fcbce60e60d80552aed639a794825a5bfe8e81ddf791d849
```

These source and asset checks establish what was adapted. Integrated visual,
responsive, and interaction checks are separate from that source provenance.
