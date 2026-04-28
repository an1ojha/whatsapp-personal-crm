import { useEffect, useMemo, useState } from 'react'

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(`${iso}T00:00:00`)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return iso
  }
}

export default function ChatsTableView() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let dead = false
    setLoading(true)
    setError(null)
    fetch('/data/chats_table.json', { cache: 'no-store' })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(data => {
        if (dead) return
        setRows(Array.isArray(data?.chats) ? data.chats : [])
      })
      .catch(e => {
        if (dead) return
        setError(e?.message || 'Failed to load chats table')
      })
      .finally(() => {
        if (!dead) setLoading(false)
      })
    return () => { dead = true }
  }, [])

  const sorted = useMemo(
    () => [...rows].sort((a, b) => (b.latestMessageDate || '').localeCompare(a.latestMessageDate || '')),
    [rows]
  )

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Chats</h2>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
        Sanity table to confirm chat ingestion from WhatsApp.
      </p>

      {loading && <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Loading chats…</p>}
      {error && <p style={{ color: 'var(--accent-danger)', fontSize: 13 }}>{error}</p>}
      {!loading && !error && (
        <div className="table-wrap">
          <table className="table">
            <colgroup>
              <col style={{ width: '24%' }} />
              <col style={{ width: '46%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '15%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Name</th>
                <th>Last message</th>
                <th>Earliest chat</th>
                <th>Latest chat</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={`${r.jid || r.name}-${i}`}>
                  <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</td>
                  <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.lastMessage || '—'}</td>
                  <td>{fmtDate(r.earliestMessageDate)}</td>
                  <td>{fmtDate(r.latestMessageDate)}</td>
                </tr>
              ))}
              {!sorted.length && (
                <tr>
                  <td colSpan={4} style={{ color: 'var(--text-secondary)' }}>
                    No chat rows found. Run `npm run sync`.
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
