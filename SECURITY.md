# Security

This project is local-first, but it handles very sensitive data: your WhatsApp history.

## Sensitive Files

Never commit these files or folders:

- `.env`
- `output/`
- `summaries/`
- `public/data/*.json`
- `watchlist.json`
- `.venv/`

The `.gitignore` is configured to exclude them.

## API Keys

Put your Anthropic key in `.env` or paste it into the local Setup tab. The key is stored only on your machine.

If you ever accidentally commit or paste a real key, revoke it in the Anthropic Console and create a new one.

## WhatsApp Data

The exporter reads this local macOS path by default:

```text
~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite
```

It opens the database read-only. It does not ask for your WhatsApp password, phone OTP, QR login, or WhatsApp Cloud API credentials.

## Network Calls

The local dashboard and scripts can send selected chat text to Anthropic for summarization and Q&A. This uses your API key.

No WhatsApp data should be sent to GitHub or committed to the repository.

## Reporting Issues

Please open a GitHub issue for security-sensitive behavior that could leak local data, expose API keys, or write to WhatsApp's database.
