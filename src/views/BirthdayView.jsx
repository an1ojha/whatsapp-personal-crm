import { useEffect, useRef, useState } from 'react'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtDate(raw) {
  const value = String(raw || '').trim()
  if (/^\d{2}-\d{2}$/.test(value)) {
    const [mm, dd] = value.split('-').map(Number)
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) return `${MONTHS[mm - 1]} ${dd}`
    return value
  }
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value || 'Unknown'
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

function confidenceLabel(value) {
  if (value >= 0.8) return 'High'
  if (value >= 0.5) return 'Medium'
  return 'Low'
}

export default function BirthdayView() {
  const [items, setItems] = useState([])
  const [generatedAt, setGeneratedAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const unmountedRef = useRef(false)

  async function loadBirthdays() {
    setLoading(true)
    try {
      const r = await fetch('/api/birthdays', { cache: 'no-store' })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`)
      if (unmountedRef.current) return
      setItems(Array.isArray(data?.items) ? data.items : [])
      setGeneratedAt(data?.generated_at || null)
      setError('')
    } catch (e) {
      if (unmountedRef.current) return
      setItems([])
      setGeneratedAt(null)
      setError(e?.message || 'Failed to load birthdays')
    } finally {
      if (!unmountedRef.current) setLoading(false)
    }
  }

  async function waitForSyncDone() {
    while (!unmountedRef.current) {
      const r = await fetch('/api/sync/status', { cache: 'no-store' })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`)
      if (!data?.running) {
        if (data?.status === 'error') throw new Error(data?.error || 'Birthday generation failed')
        return
      }
      await new Promise(resolve => setTimeout(resolve, 1200))
    }
  }

  async function onGenerate() {
    setGenerating(true)
    setError('')
    setMessage('')
    try {
      const r = await fetch('/api/sync-birthdays', { method: 'POST' })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`)
      await waitForSyncDone()
      await loadBirthdays()
      setMessage('Birthdays generated.')
    } catch (e) {
      setError(e?.message || 'Failed to generate birthdays')
    } finally {
      if (!unmountedRef.current) setGenerating(false)
    }
  }

  useEffect(() => {
    unmountedRef.current = false
    loadBirthdays()
    return () => {
      unmountedRef.current = true
    }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: 'var(--space-5) var(--space-4) var(--space-3)', flexShrink: 0 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 2 }}>Birthday Wishes</h1>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Generate birthday reminders from watchlist chats.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating}
            style={{
              border: '1px solid var(--border-subtle)',
              background: generating ? 'var(--bg-card)' : 'var(--bg-elevated)',
              color: generating ? 'var(--text-tertiary)' : 'var(--text-primary)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 12,
              fontWeight: 600,
              padding: '6px 10px',
            }}
          >
            {generating ? 'Generating…' : 'Generate birthdays'}
          </button>
          {generatedAt && (
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
              Data: {new Date(generatedAt).toLocaleString()}
            </span>
          )}
        </div>
        {message && <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 8 }}>{message}</p>}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 var(--space-4)', paddingBottom: 80 }}>
        {error && (
          <div style={{ padding: 12, color: 'var(--text-secondary)', borderTop: '1px solid var(--border-subtle)' }}>
            {error}
          </div>
        )}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '160px 100px 100px 1fr',
          gap: '0 16px',
          padding: '6px 12px',
          marginBottom: 4,
        }}>
          {['Name', 'Date', 'Confidence', 'Evidence'].map(h => (
            <span key={h} style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
              textTransform: 'uppercase', color: 'var(--text-tertiary)',
            }}>{h}</span>
          ))}
        </div>

        {!loading && !error && !items.length && (
          <div style={{ padding: 16, color: 'var(--text-secondary)', borderTop: '1px solid var(--border-subtle)' }}>
            No birthday data yet. Click Generate birthdays.
          </div>
        )}
        {items.map((item, i) => (
          <div
            key={`${item.jid || item.name}-${i}`}
            style={{
              display: 'grid',
              gridTemplateColumns: '160px 100px 100px 1fr',
              gap: '0 16px',
              padding: '10px 12px',
              borderTop: i === 0 ? '1px solid var(--border-subtle)' : 'none',
              borderBottom: '1px solid var(--border-subtle)',
              alignItems: 'start',
            }}
          >
            <div>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                {item.name || 'Unknown'}
              </span>
              {item.jid && (
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>
                  {item.jid}
                </div>
              )}
            </div>

            <span style={{ fontSize: 13, color: 'var(--text-secondary)', paddingTop: 1 }}>
              {fmtDate(item.date)}
            </span>

            <span style={{ fontSize: 12, color: 'var(--text-secondary)', paddingTop: 2 }}>
              {confidenceLabel(Number(item.confidence || 0))}
            </span>

            <span style={{
              fontSize: 13, color: 'var(--text-primary)',
              lineHeight: 1.5, paddingTop: 1,
            }}>
              {item.evidence || 'No evidence snippet'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
