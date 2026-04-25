import { useEffect, useMemo, useState } from 'react'

function StatusRow({ label, ok, detail }) {
  return (
    <div className="setup-status-row">
      <span className={`setup-dot ${ok ? 'ok' : 'missing'}`} />
      <div>
        <div style={{ fontWeight: 700 }}>{label}</div>
        {detail && <div style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{detail}</div>}
      </div>
    </div>
  )
}

export default function SetupView() {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('claude-sonnet-4-6')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [logs, setLogs] = useState('')

  async function loadStatus() {
    setLoading(true)
    setError('')
    try {
      const r = await fetch('/api/setup/status', { cache: 'no-store' })
      const data = await r.json()
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`)
      setStatus(data)
      setModel(data?.anthropic_model || 'claude-sonnet-4-6')
    } catch (err) {
      setError(err?.message || 'Failed to load setup status')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStatus()
  }, [])

  const readyToSync = useMemo(() => {
    return Boolean(status?.anthropic_key && status?.whatsapp_db_found && status?.python_ready && status?.node_modules_found)
  }, [status])

  async function onSaveKey(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const r = await fetch('/api/setup/env', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey.trim(), model: model.trim() }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`)
      setApiKey('')
      setStatus(data?.status || null)
      setMessage('API key saved locally to .env.')
    } catch (err) {
      setError(err?.message || 'Failed to save API key')
    } finally {
      setSaving(false)
    }
  }

  async function onSync(full = false) {
    setSyncing(true)
    setError('')
    setMessage('')
    setLogs('')
    try {
      const r = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ full }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`)
      setStatus(data?.status || null)
      setLogs(data?.logs || '')
      setMessage('Sync complete. Your local dashboard is ready.')
    } catch (err) {
      setError(err?.message || 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="setup-page">
      <div className="setup-hero">
        <p className="eyebrow">Local-first WhatsApp CRM</p>
        <h1>Set up once, then run it on your Mac.</h1>
        <p>
          This app reads WhatsApp Desktop's local database in read-only mode. Your generated data stays on this Mac.
          AI summaries use your own Anthropic API key.
        </p>
      </div>

      {loading && <p style={{ color: 'var(--text-secondary)' }}>Checking setup...</p>}
      {error && <div className="setup-alert error">{error}</div>}
      {message && <div className="setup-alert success">{message}</div>}

      <div className="setup-grid">
        <section className="setup-card">
          <h2>1. Status</h2>
          <StatusRow label="WhatsApp database" ok={Boolean(status?.whatsapp_db_found)} detail={status?.whatsapp_db_path} />
          <StatusRow label="Anthropic API key" ok={Boolean(status?.anthropic_key)} detail={status?.anthropic_key ? 'Saved in .env' : 'Paste your key below'} />
          <StatusRow label="Python environment" ok={Boolean(status?.python_ready)} detail=".venv/bin/python" />
          <StatusRow label="Node dependencies" ok={Boolean(status?.node_modules_found)} detail="node_modules" />
          <StatusRow label="sqlite3" ok={Boolean(status?.sqlite_found)} detail="Required to read WhatsApp locally" />
          <button type="button" className="secondary-btn" onClick={loadStatus}>Refresh checks</button>
        </section>

        <section className="setup-card">
          <h2>2. API key</h2>
          <p className="muted">Paste an Anthropic key. It is written only to your local <code>.env</code> file.</p>
          <form onSubmit={onSaveKey} className="setup-form">
            <input
              className="input-base"
              type="password"
              placeholder="sk-ant-api03-..."
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
            />
            <input
              className="input-base"
              value={model}
              onChange={e => setModel(e.target.value)}
              placeholder="claude-sonnet-4-6"
            />
            <button type="submit" className="primary-btn" disabled={saving || !apiKey.trim()}>
              {saving ? 'Saving...' : 'Save key'}
            </button>
          </form>
        </section>

        <section className="setup-card wide">
          <h2>3. Sync WhatsApp</h2>
          <p className="muted">
            Sync exports chats locally, builds contacts and groups, asks Anthropic for summaries, and publishes local dashboard data.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="primary-btn" disabled={!readyToSync || syncing} onClick={() => onSync(false)}>
              {syncing ? 'Syncing...' : 'Sync now'}
            </button>
            <button type="button" className="secondary-btn" disabled={!readyToSync || syncing} onClick={() => onSync(true)}>
              Full resync
            </button>
          </div>
          {!readyToSync && (
            <p className="muted" style={{ marginTop: 10 }}>
              Missing a requirement above. Run <code>npm run setup</code>, open WhatsApp Desktop once, then refresh checks.
            </p>
          )}
          {status?.last_sync_at && (
            <p className="muted" style={{ marginTop: 10 }}>
              Last sync: {new Date(status.last_sync_at).toLocaleString()} · {status.chat_count || 0} chats
            </p>
          )}
          {logs && <pre className="setup-logs">{logs}</pre>}
        </section>
      </div>
    </div>
  )
}
