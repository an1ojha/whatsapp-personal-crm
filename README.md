# Personal CRM for WhatsApp Desktop

A local-first personal CRM for your WhatsApp Desktop history on macOS.

The app reads WhatsApp Desktop's local SQLite database in read-only mode, turns chats into local JSON files, uses your own Anthropic API key to generate summaries and follow-up ideas, and serves a private dashboard on `localhost`.

## What Users Need

- macOS
- WhatsApp Desktop installed from the Mac App Store and logged in
- Node.js with `npm`
- Python 3
- An Anthropic API key from <https://console.anthropic.com/>

You do not need WhatsApp Cloud API credentials, a WhatsApp password, or a QR-login bot.

## Quick Start

```bash
git clone https://github.com/an1ojha/whatsapp-personal-crm.git
cd personal_crm
npm run setup
npm run dev
```

Open the local URL printed by Vite, usually <http://localhost:5173>, then use the Setup tab:

1. Paste your Anthropic API key.
2. Confirm WhatsApp Desktop's database is found.
3. Click **Sync now**.
4. Use the dashboard.

## Daily Use

```bash
npm run sync
npm run dev
```

Or open the Setup tab and click **Sync now**.

Use `npm run sync:full` if you want to rebuild everything from WhatsApp's database.

## Privacy Model

- Your WhatsApp database stays on your Mac.
- The exporter opens WhatsApp's database read-only.
- Generated local data is written to ignored folders like `output/` and `summaries/`.
- Dashboard JSON under `public/data/*.json` is generated locally and ignored by git.
- AI summary prompts are sent to Anthropic using your own API key.

Do not commit `.env`, `output/`, `summaries/`, `public/data/*.json`, or `watchlist.json`.

## Troubleshooting

Run:

```bash
npm run doctor
```

Common fixes:

- **WhatsApp database missing:** install/open WhatsApp Desktop from the Mac App Store and log in once.
- **Anthropic key missing:** paste your key in the Setup tab or edit `.env`.
- **Python environment missing:** run `npm run setup`.
- **macOS permission error:** grant your terminal app Full Disk Access in System Settings, then retry.

## Commands

- `npm run setup` - install Node and Python dependencies, create `.env` if needed, run checks.
- `npm run doctor` - check local prerequisites.
- `npm run sync` - incremental WhatsApp export plus summaries and dashboard data.
- `npm run sync:full` - rebuild from scratch.
- `npm run dev` - start the local dashboard.
- `npm run build` - build the frontend.

## How It Works

```text
WhatsApp Desktop SQLite DB
  -> export.py
  -> output/chats + output/contacts + output/groups
  -> scripts/summarize.py
  -> summaries + followups
  -> public/data JSON
  -> local React dashboard
```

## License

MIT
