import { useEffect, useMemo, useState } from 'react'

export default function ReviewsView() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState({})

  async function loadQueue() {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/reviews', { cache: 'no-store' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      setItems(Array.isArray(data?.items) ? data.items : [])
    } catch (err) {
      setError(err?.message || 'Failed to load reviews')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadQueue()
  }, [])

  async function decide(id, decision) {
    setSaving(prev => ({ ...prev, [id]: true }))
    setError(null)
    try {
      const r = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, decision }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`)
      setItems(prev => prev.map(row => (
        row.id === id ? { ...row, status: decision === 'approve' ? 'approved' : 'rejected' } : row
      )))
    } catch (err) {
      setError(err?.message || 'Failed to apply decision')
    } finally {
      setSaving(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
  }

  const pending = useMemo(
    () => items.filter(row => row?.status === 'pending'),
    [items],
  )

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Reviews</h2>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
        Pending prompt/context updates proposed from follow-up feedback.
      </p>
      {loading && <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Loading review queue…</p>}
      {error && <p style={{ color: 'var(--accent-danger)', fontSize: 13 }}>{error}</p>}

      {!loading && !error && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Contact</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pending.map(row => (
                <tr key={row.id}>
                  <td>{row.target_type || '—'}</td>
                  <td>{row.jid || '—'}</td>
                  <td style={{ maxWidth: 420 }}>{row.reasoning_summary || '—'}</td>
                  <td>{row.status || 'pending'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        disabled={Boolean(saving[row.id])}
                        onClick={() => decide(row.id, 'approve')}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(saving[row.id])}
                        onClick={() => decide(row.id, 'reject')}
                      >
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!pending.length && (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--text-secondary)' }}>
                    No pending proposals.
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
