# Design

Source of truth: this repo (`index.html` + `data.js` + `google.js`). Product context: [PRODUCT.md](PRODUCT.md).

## World: "struk"

A shared receipt between two people. The hero is a colored receipt slip with a scalloped tear edge; settled debt is a rubber "LUNAS" stamp. Faces and person colors carry meaning; words are a last resort.

## Color

- Page is warm paper (`--page #F5F1EA` light, `#12110F` dark); cards are white (`#1C1A17` dark).
- Text is warm ink: `--on`, plus `--on2` for secondary text (≥4.5:1 on page and card).
- Brand is the user-chosen accent. `applyTheme()` derives `--brand --acc --pri --brandsoft …` from `hl_accent`; the default is teal `#00695C`. Never hard-code the brand.
- Person colors: Dimbo `--dim` (indigo), Delpus `--del` (burnt orange), with `*soft` tints and `.bg-Dimbo` / `.bg-Delpus` / `.c-*` helpers. Use these tokens, not hex. Hex lives only in canvas drawings (`PCOL`) and the avatar ring.
- Category tiles (`.k-*`) keep their own pastel pairs in light and dark.

## Type

- Display: Bricolage Grotesque 700–800 for the hero amount, page titles, big money figures and the stamp. Tracking is negative (−.01 to −.03em).
- UI/body: Plus Jakarta Sans 400/600/700. Named after Jakarta, it fits an Indonesian product. Canvas share cards and Wrapped use it too.
- Sizes are whole pixels: 12 / 13 / 14 / 15 / 16 / 18 / 22 / 28 / 32 / 48. No fractional sizes.

## Shape & depth

- Cards: radius 20 with a soft warm shadow (`--shadow`); dark mode has no shadow.
- Pills: buttons and chips are fully rounded. Minimum tap height is 36px, 44–52px for primary actions.

## Signature moments

- The hero shows only the net debt: avatar ┄┄▸ avatar, then the amount. Gross figures live on the Bayar page.
- Rp0 is the `LUNAS` stamp. It animates in once (scale + rotate) and is static after that. `prefers-reduced-motion` is respected globally for view transitions.
- The money-flow "lane" (dashed line + arrowhead) is reused on the Bayar page.

## Interaction rules

- FAB tap opens Langsung, with focus on the amount. A long press opens the Langsung / Patungan / Scan sheet.
- The Save button and the live owe pill sit in a sticky bottom bar. Enter moves to the next empty field or saves.
- Form, sheets and Wrapped push one history layer, so Android back closes them. Sheets take focus, trap Tab and close on Esc.
- Destructive or money actions confirm on a second tap. The confirm state shows avatar→avatar + amount.
- Home renders from the cached `hl_info` first. A stale chip (`cloud_off` + age) shows until the server answers. Failed loads show "Coba lagi".
- Sign-in screens (`#setup`) reuse the receipt slip as a header, show at most two choices as large `.pick` cards, and put the primary action at the bottom within thumb reach.
- Avatars without a photo show the person's initial on their slot color. There are no illustrated faces.
