import { useState, useMemo } from 'react'
import { getInitials, getAvatarColor, getAvatarTextColor } from '../../utils/imageUtils.js'

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'vc', label: 'VC' },
  { id: 'decision_maker', label: 'Decision Maker' },
  { id: 'us', label: 'US-based' },
  { id: 'they_initiated', label: 'They reached out' },
  { id: 'has_messages', label: 'Messaged' },
]

export default function EnrichListView({ profiles, isReviewed, reviewedCount, totalCount, onSelect, onClose }) {
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState('all')

  const filtered = useMemo(() => {
    let list = profiles
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(p =>
        p.name?.toLowerCase().includes(q) ||
        p.company?.toLowerCase().includes(q) ||
        p.position?.toLowerCase().includes(q)
      )
    }
    if (activeFilter === 'vc') list = list.filter(p => p.is_vc)
    else if (activeFilter === 'decision_maker') list = list.filter(p => p.is_decision_maker)
    else if (activeFilter === 'us') list = list.filter(p => p.is_us)
    else if (activeFilter === 'they_initiated') list = list.filter(p => p.they_initiated)
    else if (activeFilter === 'has_messages') list = list.filter(p => p.total_messages > 0)
    return list
  }, [profiles, search, activeFilter])

  const pct = totalCount > 0 ? (reviewedCount / totalCount) * 100 : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: 'var(--space-5) var(--space-4) var(--space-3)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 700 }}>LinkedIn Network</h2>
            <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 2 }}>
              {reviewedCount} of {totalCount} reviewed
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 36, height: 36, borderRadius: 'var(--radius-full)',
              background: 'var(--bg-elevated)', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              fontSize: 18, color: 'var(--text-secondary)',
            }}
          >
            ×
          </button>
        </div>

        {/* Progress bar */}
        <div style={{
          height: 4, background: 'var(--bg-elevated)',
          borderRadius: 'var(--radius-full)', overflow: 'hidden', marginBottom: 'var(--space-4)',
        }}>
          <div style={{
            height: '100%', width: `${pct}%`,
            background: 'linear-gradient(90deg, #A78BFA, #7C3AED)',
            borderRadius: 'var(--radius-full)', transition: 'width 0.3s ease',
          }} />
        </div>

        {/* Search */}
        <div style={{ position: 'relative', marginBottom: 'var(--space-3)' }}>
          <span style={{
            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--text-tertiary)', fontSize: 16, pointerEvents: 'none',
          }}>🔍</span>
          <input
            className="input-base"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, company..."
            style={{ paddingLeft: 36 }}
          />
        </div>

        {/* Filter chips */}
        <div style={{ display: 'flex', gap: 'var(--space-2)', overflowX: 'auto', paddingBottom: 4 }}>
          {FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setActiveFilter(f.id)}
              style={{
                flexShrink: 0,
                padding: '6px 14px',
                borderRadius: 'var(--radius-full)',
                fontSize: 13, fontWeight: 500,
                background: activeFilter === f.id ? 'var(--accent-primary-dim)' : 'var(--bg-elevated)',
                border: activeFilter === f.id ? '1px solid var(--accent-primary)' : '1px solid var(--border-default)',
                color: activeFilter === f.id ? 'var(--accent-primary)' : 'var(--text-secondary)',
                transition: 'all 0.15s ease',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="scroll-container" style={{ flex: 1 }}>
        {filtered.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '60%', color: 'var(--text-secondary)',
            gap: 'var(--space-3)',
          }}>
            <span style={{ fontSize: 36 }}>🔍</span>
            <p style={{ fontSize: 15 }}>No results</p>
          </div>
        ) : (
          filtered.map((profile, idx) => {
            const reviewed = isReviewed(profile.url)
            const bg = getAvatarColor(profile.name)
            const fg = getAvatarTextColor(profile.name)
            const initials = getInitials(profile.name)
            return (
              <button
                key={profile.url}
                onClick={() => onSelect(profile, filtered, idx)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                  padding: 'var(--space-3) var(--space-4)', width: '100%', textAlign: 'left',
                  borderBottom: '1px solid var(--border-subtle)',
                  background: 'transparent',
                  opacity: reviewed ? 0.55 : 1,
                  transition: 'opacity 0.15s ease',
                }}
              >
                {/* Avatar */}
                <div style={{
                  width: 44, height: 44, borderRadius: 'var(--radius-full)',
                  background: bg, color: fg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 15, fontWeight: 600, flexShrink: 0,
                }}>
                  {initials}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {profile.name}
                    </span>
                    {reviewed && (
                      <span style={{ fontSize: 12, color: 'var(--accent-success)', flexShrink: 0 }}>✓</span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[profile.position, profile.company].filter(Boolean).join(' · ')}
                  </div>
                </div>

                {/* Score badge */}
                <div style={{
                  padding: '3px 10px', borderRadius: 'var(--radius-full)',
                  background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                  fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)',
                  flexShrink: 0,
                }}>
                  {profile.total_score}
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
