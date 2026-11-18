# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Couples. It started as Dimbo and Delpus's app, and since v2.0.0 anyone can use it from the public link. A person signs in with Google, creates (or picks) their sheet, and invites their partner by email. Each person sees everything from their own point of view. The typical moment is right after eating out or shopping together: one of them paid, and they log it on the spot on a phone. Less often they check who owes whom, settle up, or look back at stats and the yearly Wrapped.

## Product Purpose

Keep a shared, trusted record of money one partner fronts for the other, so neither has to remember or argue about it. Success has three equal parts:

- Logging is fast: a transaction takes seconds, and the balance is always obvious.
- The balance is never disputed: both trust the number, and history and settlements are transparent.
- It is pleasant to use: personal (photos, person colors, Wrapped), not bookkeeping.

## Positioning

A private two-person ledger built for one couple, not a group expense splitter. Every screen assumes exactly two people and one running balance between them.

## Operating Context

- Installable PWA (GitHub Pages), portrait, used on phones. App icon shortcuts: Langsung, Patungan, Scan struk, Bayar.
- No server. The browser signs in with Google Identity Services (scope `drive.file` only), then reads and writes a Google Sheet in the user's own Drive through the Sheets/Drive APIs. Google Cloud project "Hutang Lu" holds the OAuth client and a Picker-only API key (`config.js`).
- Onboarding:
  1. Sign in.
  2. The app auto-finds sheets it created (`appProperties app=hutanglu`).
  3. If none, the user can create a sheet (clean Debt Tracker + Summary), or pick an existing sheet with a "Debt Tracker" tab via Google Picker and use it directly.
  4. The user is matched to a member by email, or asked "Kamu yang mana?".
  5. The user invites their partner: the Drive share is restricted to the partner's email, and the link is `#join=<sheetId>`.
- The Google token lasts about 1 hour. When it expires, the app shows cached data and a "Sambungkan" chip. Writes go to the offline queue (client IDs dedupe them) until the user reconnects.
- Source lives directly in this repo (`index.html`, `data.js`, `google.js`, `config.js`). The Apps Script repo `hutang-lu` stays deployed as "API PWA" only as a relay (`Relay.js`): phones with the old private link (`#k=`) keep working without Google sign-in (Delpus).

## Capabilities and Constraints

- Entry types: direct ("Langsung", one pays for the other), split ("Patungan", itemized bill with per-item assignment), receipt scan ("Scan struk", Gemini with the user's own key), payment ("Bayar").
- Settlement pays oldest-first by any amount; over/under-payment becomes its own row, excluded from stats. Settlement log with undo.
- Views: home (balance + recent), Riwayat (history by month), Statistik (totals, per month, categories, most frequent), Wrapped (yearly story slides on canvas), share as image.
- Manual category per description, undo delete, profile photos, light/dark theme, client-side accent color.
- The sheet IS the product: one tab "Debt Tracker" (Date, Description, Paid By, <A> Items, <B> Items, Fee, Total, <A> Share, <B> Share, Status) plus "Summary". Never add tabs, columns or ID fields. Hidden app data (member emails, manual categories, settlement log, photos) lives in developer metadata. New users get the same clean format.
- Receipt scan uses the user's own Gemini API key, stored on the device only. The scan UI is hidden without a key.
- Settings stay small: photo, theme, app color, data (Sheet/CSV/offline/invite partner), app (scan key, reload, sign out, version).
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
