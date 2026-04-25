import { useEffect, useMemo, useState } from 'react'

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return iso
  }
}

function fmtDuration(seconds) {
  const value = Number(seconds || 0)
  if (!Number.isFinite(value) || value <= 0) return '—'
  if (value < 60) return `${Math.round(value)}s`
  return `${Math.round((value / 60) * 10) / 10}m`
}

function getStatusStyle(status) {
  if (status === 'missed') return { color: 'var(--accent-danger)' }
  return {}
}

export default function CallsView() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let dead = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const r = await fetch('/api/calls', { cache: 'no-store' })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const data = await r.json()
        if (!dead) setRows(Array.isArray(data?.calls) ? data.calls : [])
      } catch (e) {
        if (!dead) {
          setRows([])
          setError(e?.message || 'Failed to load calls')
        }
      } finally {
        if (!dead) setLoading(false)
      }
    })()
    return () => { dead = true }
  }, [])

  const sorted = useMemo(
    () => [...rows].sort((a, b) => Date.parse(b?.at || '') - Date.parse(a?.at || '')),
    [rows],
  )

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Calls</h2>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
        WhatsApp call history visible on this Mac.
      </p>
      {loading && <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Loading calls…</p>}
      {error && <p style={{ color: 'var(--accent-danger)', fontSize: 13 }}>{error}</p>}

      {!loading && !error && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Contact</th>
                <th>Status</th>
                <th>Media</th>
                <th style={{ textAlign: 'right' }}>Duration</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(row => (
                <tr key={row.id}>
                  <td>{fmtDate(row.at)}</td>
                  <td>
                    {(row.peer_name || row.peer_jid || 'Unknown') + (row.is_group ? ' (group)' : '')}
                  </td>
                  <td style={getStatusStyle(row.status)}>{row.status_label || row.status || 'Unknown'}</td>
                  <td>{row.media_label || (row.is_group ? 'Group' : 'Audio')}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtDuration(row.duration_seconds)}
                  </td>
                </tr>
              ))}
              {!sorted.length && (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--text-secondary)' }}>
                    No calls found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
