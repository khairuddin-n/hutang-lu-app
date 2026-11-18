# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two people only: Dimbo and Delpus, a couple. Each opens the app with a personal link (`?u=dimbo` / `?u=delpus`) and sees everything from their own point of view. The typical moment is right after eating out or shopping together: one of them paid, and they log it on the spot on a phone. Less often they check who owes whom, settle up, or look back at stats and the yearly Wrapped.

## Product Purpose

Keep a shared, trusted record of money one partner fronts for the other, so neither has to remember or argue about it. Success has three equal parts:

- Logging is fast: a transaction takes seconds, and the balance is always obvious.
- The balance is never disputed: both trust the number, and history and settlements are transparent.
- It is pleasant to use: personal (photos, person colors, Wrapped), not bookkeeping.

## Positioning

A private two-person ledger built for one couple, not a group expense splitter. Every screen assumes exactly two people and one running balance between them.

## Operating Context

- Installable PWA (GitHub Pages), portrait, used on phones. App icon shortcuts: Langsung, Patungan, Scan struk, Bayar.
- Data lives in a Google Sheet owned by the user, read and written through an Apps Script API (`doPost`, per-user token). The PWA is built from the `hutang-lu` Apps Script repo (`tools/build_pwa.py`) and pushed here.
- Offline queue with client IDs for dedupe; service worker is network-first for the page.

## Capabilities and Constraints

- Entry types: direct ("Langsung", one pays for the other), split ("Patungan", itemized bill with per-item assignment), receipt scan ("Scan struk", Gemini then Drive OCR), payment ("Bayar").
- Settlement pays oldest-first by any amount; over/under-payment becomes its own row, excluded from stats. Settlement log with undo.
- Views: home (balance + recent), Riwayat (history by month), Statistik (totals, per month, categories, most frequent), Wrapped (yearly story slides on canvas), share as image.
- Manual category per description, undo delete, profile photos, light/dark theme, client-side accent color.
- Never change the Google Sheet structure or add tabs; app state lives in Script Properties.
- Settings stay small: photo, theme, app color, data (Sheet/CSV/offline), app (reload/version).
- The shared savings ("Tabungan") feature was rejected and removed; do not re-propose it.

## Brand Commitments

- Name: Hutang Lu. All copy in Indonesian.
- Minimal text: avatars and consistent per-person colors instead of sentences like "kamu bayar" or "Delpus utang". No totals clutter in list rows.

## Evidence on Hand

- Real data in the user's Sheet; the app's own history and stats.
- Icons and shortcut icons in the repo root (`icon-*.png`, `sc-*.png`).

## Product Principles

1. Two people, one balance: every screen answers "who owes whom, how much" at a glance.
2. Seconds to log: the post-meal capture path beats every other flow in priority.
3. Trust through transparency: every number traces back to rows both can see and undo.
4. Personal over generic: faces and colors carry meaning; words are a last resort.
5. Fewer controls: add an option only when its absence hurts.
