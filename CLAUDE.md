# WB Brands Finance OS

Multi-entity financial dashboard for WB Brands and subsidiaries.

## Stack
- Pure HTML/CSS/JS — no build step, no backend
- `index.html` — UI and structure
- `styles.css` — styling (DM Sans + DM Mono fonts)
- `app.js` — all application logic and hardcoded data

## How to run
Open `index.html` directly in a browser.

## Entities
- WB Promo LLC
- Lanyard Promo LLC (LP)
- Koolers Promo LLC (KP)
- Band Promo LLC (BP)
- One Operations Mgmt (ONEOPS)

## Features
- Dashboard, Transactions, Journals views
- Entity filter (consolidated or per-entity)
- Transactions have statuses: confirmed, review, unclassified

## Notes
- All data is hardcoded in `app.js` — no real database connection
- Transactions flagged as `review` need manual classification
