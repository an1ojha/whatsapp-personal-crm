import { useEffect, useMemo, useRef, useState } from 'react'

const MASKED_API_KEY = '••••••••••••••••••••••••'

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

function formatDuration(seconds) {
  if (seconds == null || Number.isNaN(Number(seconds))) return '0s'
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`
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
  const [syncProgress, setSyncProgress] = useState(null)
  const wasSyncRunningRef = useRef(false)

  const [composioStatus, setComposioStatus] = useState(null)
  const [composioKey, setComposioKey] = useState('')
  const [composioSavingKey, setComposioSavingKey] = useState(false)
  const [composioConnecting, setComposioConnecting] = useState(false)
  const [composioMessage, setComposioMessage] = useState('')
  const [composioError, setComposioError] = useState('')
  const composioPollRef = useRef(null)

  async function loadStatus() {
    setLoading(true)
    setError('')
    try {
      const r = await fetch('/api/setup/status', { cache: 'no-store' })
      const data = await r.json()
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`)
      setStatus(data)
      setModel(data?.anthropic_model || 'claude-sonnet-4-6')
      setApiKey(prev => (data?.anthropic_key && !prev ? MASKED_API_KEY : prev))
    } catch (err) {
      setError(err?.message || 'Failed to load setup status')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStatus()
    refreshSyncStatus({ announceCompletion: false }).catch(() => {})
    loadComposioStatus().catch(() => {})
    return () => {
      if (composioPollRef.current) {
        clearInterval(composioPollRef.current)
        composioPollRef.current = null
      }
    }
  }, [])

  async function loadComposioStatus() {
    try {
      const r = await fetch('/api/composio/status', { cache: 'no-store' })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`)
      setComposioStatus(data)
      return data
    } catch (err) {
      setComposioError(err?.message || 'Failed to load Google Calendar status')
      return null
    }
  }

  async function onSaveComposioKey(e) {
    e?.preventDefault()
    if (!composioKey.trim()) return
    setComposioSavingKey(true)
    setComposioError('')
    setComposioMessage('')
    try {
      const r = await fetch('/api/composio/env', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ api_key: composioKey.trim() }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`)
      setComposioStatus(data?.status || null)
      setComposioKey('')
      setComposioMessage('Composio API key saved.')
    } catch (err) {
      setComposioError(err?.message || 'Failed to save Composio key')
    } finally {
      setComposioSavingKey(false)
    }
  }

  async function onConnectGoogleCalendar() {
    setComposioConnecting(true)
    setComposioError('')
    setComposioMessage('')
    try {
      const r = await fetch('/api/composio/connect', { method: 'POST' })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`)
      if (data?.redirect_url) {
        window.open(data.redirect_url, '_blank', 'noopener,noreferrer')
        setComposioMessage('Authorize Google Calendar in the new tab. We\'ll detect it once you finish.')
      } else {
        setComposioMessage('Connection initiated. Polling for status...')
      }
      if (composioPollRef.current) clearInterval(composioPollRef.current)
      const startedAt = Date.now()
      composioPollRef.current = setInterval(async () => {
        const latest = await loadComposioStatus()
        const status = String(latest?.connection_status || '').toUpperCase()
        const terminal = ['ACTIVE', 'FAILED', 'EXPIRED', 'DELETED', 'INACTIVE']
        if (terminal.includes(status) || Date.now() - startedAt > 5 * 60 * 1000) {
          clearInterval(composioPollRef.current)
          composioPollRef.current = null
          setComposioConnecting(false)
          if (status === 'ACTIVE') setComposioMessage('Google Calendar connected.')
          else if (terminal.includes(status)) setComposioError(`Connection ${status.toLowerCase()}.`)
          else setComposioMessage('Stopped polling after 5 minutes. Click Connect again if needed.')
        }
      }, 2500)
    } catch (err) {
      setComposioError(err?.message || 'Failed to start connection')
      setComposioConnecting(false)
    }
  }

  async function onDisconnectGoogleCalendar() {
    setComposioError('')
    setComposioMessage('')
    try {
      const r = await fetch('/api/composio/disconnect', { method: 'POST' })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`)
      setComposioStatus(data?.status || null)
      setComposioMessage('Google Calendar disconnected.')
    } catch (err) {
      setComposioError(err?.message || 'Failed to disconnect')
    }
  }

  useEffect(() => {
    if (!syncProgress?.running) return undefined
    const timer = setInterval(() => {
      refreshSyncStatus().catch(err => {
        setError(err?.message || 'Failed to refresh sync status')
        setSyncing(false)
      })
    }, 1500)
    return () => clearInterval(timer)
  }, [syncProgress?.running])

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
      setApiKey(MASKED_API_KEY)
      setStatus(data?.status || null)
      setMessage('API key saved locally to .env.')
    } catch (err) {
      setError(err?.message || 'Failed to save API key')
    } finally {
      setSaving(false)
    }
  }

  async function applySyncProgress(next, { announceCompletion = true } = {}) {
    const wasRunning = wasSyncRunningRef.current
    const isRunning = Boolean(next?.running)
    wasSyncRunningRef.current = isRunning
    setSyncing(isRunning)
    setSyncProgress(next?.status === 'idle' ? null : next)
    setLogs(next?.logs || '')

    if (announceCompletion && wasRunning && !isRunning) {
      if (next?.status === 'error') {
        setError(next?.error || 'Sync failed')
        return
      }
      if (next?.status === 'complete') {
        await loadStatus()
        setMessage('Sync complete. Your local dashboard is ready.')
      }
    }
  }

  async function refreshSyncStatus(options = {}) {
    const statusResp = await fetch('/api/sync/status', { cache: 'no-store' })
    const latest = await statusResp.json()
    if (!statusResp.ok) throw new Error(latest?.error || `HTTP ${statusResp.status}`)
    await applySyncProgress(latest, options)
    return latest
  }

  async function onSync(full = false) {
    setSyncing(true)
    wasSyncRunningRef.current = false
    setError('')
    setMessage('')
    setLogs('')
    setSyncProgress(null)
    try {
      const r = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ full }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`)

      await applySyncProgress(data)
      if (data?.status === 'error') {
        throw new Error(data?.error || 'Sync failed')
      }
      if (data?.status === 'complete') {
        await loadStatus()
        setMessage('Sync complete. Your local dashboard is ready.')
      }
    } catch (err) {
      setError(err?.message || 'Sync failed')
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
              placeholder={status?.anthropic_key ? MASKED_API_KEY : 'sk-ant-api03-...'}
              value={apiKey}
              onFocus={() => {
                if (apiKey === MASKED_API_KEY) setApiKey('')
              }}
              onChange={e => setApiKey(e.target.value)}
            />
            <input
              className="input-base"
              value={model}
              onChange={e => setModel(e.target.value)}
              placeholder="claude-sonnet-4-6"
            />
            <button type="submit" className="primary-btn" disabled={saving || !apiKey.trim() || apiKey === MASKED_API_KEY}>
              {saving ? 'Saving...' : 'Save key'}
            </button>
          </form>
        </section>

        <section className="setup-card wide">
          <h2>3. Sync WhatsApp</h2>
          <p className="muted">
            Sync exports chats locally, builds contacts/groups, and publishes dashboard data.
            Generate follow-ups and birthdays later from their tabs.
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
            <>
              <p className="muted" style={{ marginTop: 10, marginBottom: 6 }}>
                Last sync: {new Date(status.last_sync_at).toLocaleString()} · {status.chat_count || 0} chats
              </p>
              <div style={{ marginTop: 8 }}>
                <p className="muted" style={{ marginBottom: 6, fontWeight: 700 }}>
                  Next steps after Sync now:
                </p>
                <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.55 }}>
                  <li>Go to People and edit who is on your watchlist.</li>
                  <li>Go to Follow-ups and click Generate/Regenerate follow-ups.</li>
                  <li>Go to Birthdays and click Generate birthdays (DM + group extraction; use the toggle there to list group results).</li>
                  <li>Use Chats to sanity-check ingested conversations.</li>
                </ul>
              </div>
            </>
          )}
          {syncProgress && (
            <div className="sync-progress">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                <strong>{syncProgress.current_step || 'Preparing sync'}</strong>
                <span>
                  Step {Math.min((syncProgress.step_index || 0) + 1, syncProgress.total_steps || 1)} of {syncProgress.total_steps || 1}
                </span>
              </div>
              <div className="sync-progress-bar">
                <div
                  className="sync-progress-fill"
                  style={{
                    width: `${syncProgress.status === 'complete'
                      ? 100
                      : Math.max(8, Math.round(((syncProgress.step_index || 0) / (syncProgress.total_steps || 1)) * 100))}%`,
                  }}
                />
              </div>
              <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
                Elapsed: {formatDuration(syncProgress.elapsed_seconds || 0)}
                {syncProgress.running && ` · Remaining: ${formatDuration(syncProgress.estimated_remaining_seconds)}`}
              </p>
            </div>
          )}
          {logs && <pre className="setup-logs">{logs}</pre>}
        </section>

        <section className="setup-card wide">
          <h2>4. Google Calendar (Composio)</h2>
          <p className="muted">
            Lets the Q&A assistant create events on your primary Google Calendar. Get an API key from{' '}
            <a href="https://platform.composio.dev/developers" target="_blank" rel="noreferrer">platform.composio.dev/developers</a>,
            paste it below, then click Connect.
          </p>
          <div style={{ marginTop: 10 }}>
            <p className="muted" style={{ marginBottom: 6, fontWeight: 700 }}>
              One-time setup:
            </p>
            <ol style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.55 }}>
              <li>Create/copy Composio API key from platform.composio.dev/developers.</li>
              <li>Paste key below and click <strong>Save key</strong>.</li>
              <li>Click <strong>Connect Google Calendar</strong> and complete OAuth in the new tab.</li>
              <li>Return here and click <strong>Refresh</strong> until status shows Connected (ACTIVE).</li>
              <li>After this, use <strong>Set reminder</strong> in Birthdays tab for one-click calendar reminders.</li>
            </ol>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span className={`setup-dot ${composioStatus?.has_api_key ? 'ok' : 'missing'}`} />
              <span style={{ fontWeight: 600 }}>API key</span>
              <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
                {composioStatus?.has_api_key ? 'Saved in .env' : 'Not set'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span className={`setup-dot ${composioStatus?.connection_status === 'ACTIVE' ? 'ok' : 'missing'}`} />
              <span style={{ fontWeight: 600 }}>Google Calendar</span>
              <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
                {composioStatus?.connection_status === 'ACTIVE'
                  ? `Connected${composioStatus?.connection_account ? ` (${composioStatus.connection_account})` : ''}`
                  : composioStatus?.has_connection
                    ? `Status: ${composioStatus?.connection_status || 'unknown'}`
                    : 'Not connected'}
              </span>
            </div>
          </div>

          {composioError && <div className="setup-alert error" style={{ marginTop: 10 }}>{composioError}</div>}
          {composioMessage && <div className="setup-alert success" style={{ marginTop: 10 }}>{composioMessage}</div>}

          <form onSubmit={onSaveComposioKey} className="setup-form" style={{ marginTop: 12 }}>
            <input
              className="input-base"
              type="password"
              placeholder={composioStatus?.has_api_key ? '••••••••••••••••••••••••' : 'composio_api_key_...'}
              value={composioKey}
              onChange={e => setComposioKey(e.target.value)}
              autoComplete="off"
            />
            <button type="submit" className="primary-btn" disabled={composioSavingKey || !composioKey.trim()}>
              {composioSavingKey ? 'Saving...' : 'Save key'}
            </button>
          </form>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
            <button
              type="button"
              className="primary-btn"
              disabled={!composioStatus?.has_api_key || composioConnecting}
              onClick={onConnectGoogleCalendar}
            >
              {composioConnecting
                ? 'Waiting for authorization...'
                : composioStatus?.connection_status === 'ACTIVE'
                  ? 'Reconnect Google Calendar'
                  : 'Connect Google Calendar'}
            </button>
            {composioStatus?.has_connection && (
              <button type="button" className="secondary-btn" onClick={onDisconnectGoogleCalendar}>
                Disconnect
              </button>
            )}
            <button type="button" className="secondary-btn" onClick={() => loadComposioStatus()}>
              Refresh
            </button>
          </div>

          {composioStatus?.connection_status === 'ACTIVE' && (
            <p className="muted" style={{ marginTop: 10 }}>
              Try it from the Q&A tab: "Add a Google Calendar event next Friday at 6pm called 'Coffee with Sarah'."
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
