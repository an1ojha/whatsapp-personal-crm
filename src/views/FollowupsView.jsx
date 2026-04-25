import { useState, useEffect, useMemo, useRef } from 'react'
import PROFILE_PHOTOS from '../data/profilePhotos.js'

const URGENCY_CONFIG = {
  today:    { label: 'Today',     color: '#F87171', bg: 'rgba(248,113,113,0.12)',  dot: '#EF4444' },
  tomorrow: { label: 'Tomorrow',  color: '#FBBF24', bg: 'rgba(251,191,36,0.12)',   dot: '#F59E0B' },
  week:     { label: 'This week', color: '#34D399', bg: 'rgba(52,211,153,0.12)',   dot: '#10B981' },
  next:     { label: 'Next week', color: '#A78BFA', bg: 'rgba(167,139,250,0.12)',  dot: '#8B5CF6' },
}

const CATEGORY_EMOJI = {
  startup: '🚀',
  personal: '👤',
  family: '🏠',
  logistics: '🔑',
}

const FILTERS = [
  { id: 'all',      label: 'All' },
  { id: 'today',    label: 'Today' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'week',     label: 'This week' },
  { id: 'next',     label: 'Next week' },
]

const STALE_HOURS = 24

function formatGeneratedAt(iso) {
  if (!iso) return 'Not synced yet'
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return String(iso)
  }
}

function hoursSinceGenerated(iso) {
  if (!iso) return Infinity
  try {
    return (Date.now() - new Date(iso).getTime()) / 3600000
  } catch {
    return Infinity
  }
}

function initials(name) {
  return (name || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

const AVATAR_COLORS = [
  ['#7C3AED','#A78BFA'], ['#0369A1','#38BDF8'], ['#065F46','#34D399'],
  ['#92400E','#FCD34D'], ['#9D174D','#F472B6'], ['#1E3A5F','#60A5FA'],
]
function avatarColor(name) {
  const s = name || 'x'
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffff
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

export default function FollowupsView() {
  const [filter, setFilter] = useState('all')
  const [expanded, setExpanded] = useState(null)
  const [items, setItems] = useState([])
  const [generatedAt, setGeneratedAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [regenerating, setRegenerating] = useState(false)
  const [regenMessage, setRegenMessage] = useState('')
  const [feedbackDrafts, setFeedbackDrafts] = useState({})
  const [acting, setActing] = useState({})
  const [photoMap, setPhotoMap] = useState({})
  const unmountedRef = useRef(false)

  async function loadFollowups() {
    setLoading(true)
    try {
      const r = await fetch('/api/followups', { cache: 'no-store' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      if (unmountedRef.current) return
      setItems(Array.isArray(data?.items) ? data.items : [])
      setGeneratedAt(data?.generated_at ?? null)
      setError(null)
    } catch (e) {
      if (unmountedRef.current) return
      setError(e?.message || 'Failed to load follow-ups')
      setItems([])
      setGeneratedAt(null)
    } finally {
      if (!unmountedRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    unmountedRef.current = false
    loadFollowups()
    ;(async () => {
      try {
        const r = await fetch('/api/people', { cache: 'no-store' })
        if (!r.ok) return
        const data = await r.json()
        const rows = Array.isArray(data?.rows) ? data.rows : []
        if (unmountedRef.current) return
        const next = {}
        for (const row of rows) {
          const jid = row?.jid || ''
          const name = row?.name || ''
          const photoUrl = row?.photo_url || ''
          if (jid && photoUrl) next[jid] = photoUrl
          if (name && photoUrl) next[name] = photoUrl
        }
        setPhotoMap(next)
      } catch {
        // ignore non-critical avatar load failures
      }
    })()
    return () => { unmountedRef.current = true }
  }, [])

  async function onRegenerateFollowups() {
    setRegenerating(true)
    setRegenMessage('')
    setError(null)
    try {
      const r = await fetch('/api/sync-followups', { method: 'POST' })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`)
      setRegenMessage('Follow-ups regenerated successfully.')
      await loadFollowups()
    } catch (e) {
      setError(e?.message || 'Failed to regenerate follow-ups')
    } finally {
      setRegenerating(false)
    }
  }

  async function onEngage(item, actionType) {
    const feedbackText = String(feedbackDrafts[item.id] || '').trim()
    if (actionType === 'feedback' && !feedbackText) {
      setError('Please add feedback text before submitting feedback.')
      return
    }
    const previousItems = items
    setActing(prev => ({ ...prev, [item.id]: true }))
    setError(null)
    setItems(prev => prev.filter(row => row.id !== item.id))
    try {
      const r = await fetch('/api/followups/engage', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          followup_id: item.id,
          action_type: actionType,
          feedback_text: feedbackText,
          jid: item.jid,
          topic: item.topic,
        }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`)
      setFeedbackDrafts(prev => {
        const next = { ...prev }
        delete next[item.id]
        return next
      })
    } catch (e) {
      setItems(previousItems)
      setError(e?.message || 'Failed to submit follow-up action')
    } finally {
      setActing(prev => {
        const next = { ...prev }
        delete next[item.id]
        return next
      })
    }
  }

  const isStale = Boolean(generatedAt) && hoursSinceGenerated(generatedAt) > STALE_HOURS
  const noData = !loading && !error && items.length === 0

  const counts = useMemo(() => ({
    all: items.length,
    today: items.filter(f => f.urgency === 'today').length,
    tomorrow: items.filter(f => f.urgency === 'tomorrow').length,
    week: items.filter(f => f.urgency === 'week').length,
    next: items.filter(f => f.urgency === 'next').length,
  }), [items])

  const visible = filter === 'all' ? items : items.filter(f => f.urgency === filter)

  const ORDER = ['today', 'tomorrow', 'week', 'next']
  const grouped = useMemo(() => ORDER.reduce((acc, u) => {
    const block = visible.filter(f => f.urgency === u)
    if (block.length) acc.push({ urgency: u, items: block })
    return acc
  }, []), [visible])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      <div style={{
        padding: 'var(--space-5) var(--space-4) var(--space-3)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800 }}>Follow-ups</h1>
          <span style={{ fontSize: 13, color: 'var(--text-tertiary)', fontWeight: 500 }}>
            {loading ? '…' : `${counts.today} today`}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <button
            type="button"
            onClick={onRegenerateFollowups}
            disabled={regenerating}
            style={{
              border: '1px solid var(--border-subtle)',
              background: regenerating ? 'var(--bg-card)' : 'var(--bg-elevated)',
              color: regenerating ? 'var(--text-tertiary)' : 'var(--text-primary)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 12,
              fontWeight: 600,
              padding: '6px 10px',
            }}
          >
            {regenerating ? 'Regenerating…' : 'Regenerate follow-ups'}
          </button>
          {regenMessage && (
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
              {regenMessage}
            </span>
          )}
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {loading ? 'Loading…' : `Data: ${formatGeneratedAt(generatedAt)}`}
        </p>
        {isStale && !loading && !error && (
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 6 }}>
            Data is older than {STALE_HOURS}h — run <code style={{ fontSize: 12 }}>npm run sync:followups</code> to refresh follow-ups only.
          </p>
        )}
      </div>

      {error && (
        <div style={{
          margin: '0 var(--space-4) var(--space-3)',
          padding: '12px 14px',
          borderRadius: 'var(--radius-md)',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          fontSize: 13, color: 'var(--text-secondary)',
        }}>
          {error}. Run <code style={{ fontSize: 12 }}>npm run sync:followups</code> after API setup.
        </div>
      )}

      {noData && !error && (
        <div style={{
          margin: '0 var(--space-4) var(--space-3)',
          padding: '12px 14px',
          borderRadius: 'var(--radius-md)',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5,
        }}>
          No follow-ups yet. Mark contacts with <code style={{ fontSize: 12 }}>on_watchlist: true</code> in{' '}
          <code style={{ fontSize: 12 }}>output/contacts.json</code>, set{' '}
          <code style={{ fontSize: 12 }}>ANTHROPIC_API_KEY</code> in <code style={{ fontSize: 12 }}>.env</code>, then run{' '}
          <code style={{ fontSize: 12 }}>npm run sync:followups</code>.
        </div>
      )}

      <div style={{
        display: 'flex',
        gap: 8,
        padding: '0 var(--space-4) var(--space-3)',
        overflowX: 'auto',
        flexShrink: 0,
        scrollbarWidth: 'none',
      }}>
        {FILTERS.map(f => {
          const active = filter === f.id
          const cfg = f.id !== 'all' ? URGENCY_CONFIG[f.id] : null
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              style={{
                flexShrink: 0,
                padding: '6px 14px',
                borderRadius: 'var(--radius-full)',
                fontSize: 13,
                fontWeight: 600,
                background: active
                  ? (cfg ? cfg.bg : 'var(--accent-primary-dim)')
                  : 'var(--bg-elevated)',
                color: active
                  ? (cfg ? cfg.color : 'var(--accent-primary)')
                  : 'var(--text-secondary)',
                border: active
                  ? `1px solid ${cfg ? cfg.color + '44' : 'var(--accent-primary)'}`
                  : '1px solid var(--border-subtle)',
                transition: 'all 0.15s ease',
              }}
            >
              {f.label}
              {counts[f.id] > 0 && (
                <span style={{ marginLeft: 6, opacity: 0.7 }}>{counts[f.id]}</span>
              )}
            </button>
          )
        })}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 var(--space-4)', paddingBottom: 80 }}>
        {grouped.map(({ urgency, items: blockItems }) => {
          const cfg = URGENCY_CONFIG[urgency]
          return (
            <div key={urgency}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '16px 0 8px',
              }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: cfg.dot, flexShrink: 0,
                }} />
                <span style={{
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: cfg.color,
                }}>
                  {cfg.label}
                </span>
                <span style={{
                  fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 500,
                }}>
                  · {blockItems.length}
                </span>
              </div>

              {blockItems.map(item => {
                const isOpen = expanded === item.id
                const [bg, fg] = avatarColor(item.name)
                const em = CATEGORY_EMOJI[item.category] || '👤'
                const quote = (item.evidence_quote || '').trim()
                const whatsappPhoto = photoMap[item.jid] || photoMap[item.name] || ''
                const photoSrc = whatsappPhoto || PROFILE_PHOTOS[item.name] || ''
                return (
                  <div
                    key={item.id}
                    onClick={() => setExpanded(isOpen ? null : item.id)}
                    onKeyDown={e => {
                      if (e.target !== e.currentTarget) return
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setExpanded(isOpen ? null : item.id)
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    style={{
                      display: 'flex',
                      width: '100%',
                      gap: 12,
                      padding: '12px 14px',
                      marginBottom: 8,
                      background: isOpen ? 'var(--bg-elevated)' : 'var(--bg-card)',
                      borderRadius: 'var(--radius-md)',
                      border: isOpen
                        ? `1px solid ${cfg.color}44`
                        : '1px solid var(--border-subtle)',
                      textAlign: 'left',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {photoSrc ? (
                      <img
                        src={photoSrc}
                        alt={item.name}
                        style={{
                          width: 40, height: 40, borderRadius: '50%',
                          objectFit: 'cover', flexShrink: 0,
                          border: '1px solid var(--border-subtle)',
                        }}
                      />
                    ) : (
                      <div style={{
                        width: 40, height: 40, borderRadius: '50%',
                        background: `linear-gradient(135deg, ${bg}, ${fg})`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 14, fontWeight: 700, color: '#fff',
                        flexShrink: 0,
                      }}>
                        {initials(item.name)}
                      </div>
                    )}

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        display: 'flex', alignItems: 'center',
                        justifyContent: 'space-between', marginBottom: 4,
                      }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                          {item.name}
                        </span>
                        <span style={{
                          fontSize: 11, color: 'var(--text-tertiary)',
                          fontWeight: 500, flexShrink: 0, marginLeft: 8,
                        }}>
                          {item.lastActive || '—'}
                        </span>
                      </div>

                      <div style={{
                        display: 'flex', alignItems: 'flex-start', gap: 6,
                      }}>
                        <span style={{ fontSize: 13, flexShrink: 0 }}>{em}</span>
                        <p style={{
                          fontSize: 13,
                          color: isOpen ? 'var(--text-primary)' : 'var(--text-secondary)',
                          lineHeight: 1.5,
                          display: isOpen ? 'block' : '-webkit-box',
                          WebkitLineClamp: isOpen ? undefined : 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: isOpen ? 'visible' : 'hidden',
                        }}>
                          {item.topic}
                        </p>
                      </div>

                      {isOpen && quote && (
                        <p style={{
                          marginTop: 10,
                          padding: '8px 10px',
                          fontSize: 12,
                          lineHeight: 1.5,
                          color: 'var(--text-secondary)',
                          background: 'var(--bg-elevated)',
                          borderRadius: 6,
                          border: '1px solid var(--border-subtle)',
                        }}>
                          {item.evidence_pk != null && (
                            <span style={{ display: 'block', fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 4 }}>
                              Evidence (pk: {String(item.evidence_pk)})
                            </span>
                          )}
                          “{quote}”
                        </p>
                      )}

                      {isOpen && (
                        <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              disabled={Boolean(acting[item.id])}
                              onClick={e => {
                                e.stopPropagation()
                                onEngage(item, 'done')
                              }}
                              style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
                            >
                              Mark done
                            </button>
                            <button
                              type="button"
                              disabled={Boolean(acting[item.id])}
                              onClick={e => {
                                e.stopPropagation()
                                onEngage(item, 'useless')
                              }}
                              style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
                            >
                              Mark useless
                            </button>
                          </div>
                          <textarea
                            value={feedbackDrafts[item.id] || ''}
                            placeholder="Give feedback to improve future follow-ups…"
                            onClick={e => e.stopPropagation()}
                            onChange={e => setFeedbackDrafts(prev => ({ ...prev, [item.id]: e.target.value }))}
                            style={{
                              width: '100%',
                              minHeight: 72,
                              borderRadius: 8,
                              border: '1px solid var(--border-subtle)',
                              padding: '8px 10px',
                              fontSize: 12,
                              resize: 'vertical',
                              background: 'var(--bg-card)',
                              color: 'var(--text-primary)',
                            }}
                          />
                          <button
                            type="button"
                            disabled={Boolean(acting[item.id])}
                            onClick={e => {
                              e.stopPropagation()
                              onEngage(item, 'feedback')
                            }}
                            style={{ width: 'fit-content', padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
                          >
                            Submit feedback
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
