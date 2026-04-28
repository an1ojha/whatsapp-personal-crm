import { useEffect, useMemo, useState } from 'react'
import PROFILE_PHOTOS from '../data/profilePhotos.js'

function watchlistButtonStyle(active) {
  return {
    minWidth: 58,
    padding: '6px 10px',
    borderRadius: '999px',
    border: active ? '1px solid rgba(16,185,129,0.35)' : '1px solid var(--border-subtle)',
    background: active ? 'rgba(16,185,129,0.12)' : 'var(--bg-elevated)',
    color: active ? '#059669' : 'var(--text-secondary)',
    fontSize: 12,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.02em',
  }
}

function sectionStyle() {
  return {
    borderRadius: 16,
    border: '1px solid var(--border-subtle)',
    background: 'var(--bg-card)',
    padding: '16px 18px',
    display: 'grid',
    gap: 10,
  }
}

function fieldStyle() {
  return {
    width: '100%',
    border: 'none',
    borderBottom: '1px solid var(--border-subtle)',
    background: 'transparent',
    color: 'var(--text-primary)',
    fontSize: 16,
    lineHeight: 1.4,
    padding: '8px 2px',
    outline: 'none',
  }
}

function initials(name) {
  return (name || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

function avatarStyle() {
  return {
    width: 28,
    height: 28,
    borderRadius: '50%',
    objectFit: 'cover',
    border: '1px solid var(--border-subtle)',
    flexShrink: 0,
  }
}

export default function WatchlistPeopleView() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState({})
  const [selected, setSelected] = useState(null)
  const [profileDraft, setProfileDraft] = useState(null)
  const [photoLoadFailed, setPhotoLoadFailed] = useState(false)

  useEffect(() => {
    let dead = false

    async function loadPeople() {
      setLoading(true)
      setError(null)
      try {
        const r = await fetch('/api/people', { cache: 'no-store' })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const data = await r.json()
        if (!dead) setRows(Array.isArray(data?.rows) ? data.rows : [])
      } catch (e) {
        if (!dead) {
          setRows([])
          setError(e?.message || 'Failed to load contacts')
        }
      } finally {
        if (!dead) setLoading(false)
      }
    }

    loadPeople()
    return () => { dead = true }
  }, [])

  async function toggleWatchlist(row) {
    const jid = row?.jid
    if (!jid) return

    const nextValue = !row.on_watchlist
    setSaving(prev => ({ ...prev, [jid]: true }))
    setError(null)
    setRows(prev => prev.map(item => (
      item.jid === jid ? { ...item, on_watchlist: nextValue } : item
    )))

    try {
      const r = await fetch('/api/people/watchlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jid, on_watchlist: nextValue }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`)
    } catch (e) {
      setRows(prev => prev.map(item => (
        item.jid === jid ? { ...item, on_watchlist: row.on_watchlist } : item
      )))
      setError(e?.message || 'Failed to update watchlist')
    } finally {
      setSaving(prev => {
        const next = { ...prev }
        delete next[jid]
        return next
      })
    }
  }

  function openProfile(row) {
    setSelected(row)
    setPhotoLoadFailed(false)
    setProfileDraft({
      name: row?.name || '',
      category: row?.category || 'personal',
      birthday: row?.birthday || '',
      on_watchlist: Boolean(row?.on_watchlist),
      context: {
        relation: row?.context?.relation || row?.relation || '',
        home_location: row?.context?.home_location || '',
        age: row?.context?.age ?? '',
        other: row?.context?.other || '',
        context_last_updated: row?.context?.context_last_updated || '',
      },
    })
  }

  async function saveProfile() {
    if (!selected?.jid || !profileDraft) return
    setSaving(prev => ({ ...prev, [selected.jid]: true }))
    setError(null)
    try {
      const r = await fetch('/api/people/profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jid: selected.jid,
          patch: {
            name: profileDraft.name,
            category: profileDraft.category,
            birthday: profileDraft.birthday || '',
            on_watchlist: Boolean(profileDraft.on_watchlist),
            context: {
              relation: profileDraft.context.relation,
              home_location: profileDraft.context.home_location,
              age: profileDraft.context.age === '' ? null : Number(profileDraft.context.age),
              other: profileDraft.context.other,
            },
          },
        }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`)
      const contact = data?.contact || null
      setRows(prev => prev.map(item => (item.jid === selected.jid ? { ...item, ...contact } : item)))
      if (contact) openProfile({ ...selected, ...contact })
    } catch (e) {
      setError(e?.message || 'Failed to save profile')
    } finally {
      setSaving(prev => {
        const next = { ...prev }
        delete next[selected.jid]
        return next
      })
    }
  }

  const sorted = useMemo(
    () => [...rows].sort((a, b) => {
      const recentDiff = (b?.recent_messages_30d || 0) - (a?.recent_messages_30d || 0)
      if (recentDiff !== 0) return recentDiff

      const watchlistDiff = Number(Boolean(b?.on_watchlist)) - Number(Boolean(a?.on_watchlist))
      if (watchlistDiff !== 0) return watchlistDiff

      return (a?.name || '').localeCompare(b?.name || '')
    }),
    [rows],
  )

  if (selected && profileDraft) {
    const photo = PROFILE_PHOTOS[selected.name]
    const whatsappPhoto = selected.photo_url || `/api/people/photo?jid=${encodeURIComponent(selected.jid || '')}`
    const photoSrc = !photoLoadFailed ? (whatsappPhoto || photo) : (photo || '')
    const home = (profileDraft.context.home_location || '').trim() || 'Unknown'
    const relation = (profileDraft.context.relation || '').trim() || 'Unknown'
    const ageLabel = profileDraft.context.age === '' || profileDraft.context.age == null ? 'Unknown' : String(profileDraft.context.age)
    const call90dMinutes = Number(selected?.context?.call_90d_minutes || 0)
    const call90dCount = Number(selected?.context?.call_90d_count || 0)
    const lastCallAt = selected?.context?.last_call_at || '—'
    const callSources = Array.isArray(selected?.context?.call_sources) ? selected.context.call_sources : []
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            setSelected(null)
            setProfileDraft(null)
          }}
          style={{ marginBottom: 12 }}
        >
          ← Back to people
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
          {photoSrc ? (
            <img
              src={photoSrc}
              alt={selected.name}
              onError={() => setPhotoLoadFailed(true)}
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                objectFit: 'cover',
                border: '1px solid var(--border-subtle)',
              }}
            />
          ) : (
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
                fontWeight: 700,
                color: 'var(--text-secondary)',
                background: 'var(--bg-elevated)',
              }}
            >
              {initials(selected.name)}
            </div>
          )}
          <div>
            <h2 style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1, marginBottom: 4 }}>Profile</h2>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
              <span style={{ fontSize: 15, color: 'var(--text-secondary)' }}>🏠 {home}</span>
              <span style={{ fontSize: 15, color: 'var(--text-secondary)' }}>•</span>
              <span style={{ fontSize: 15, color: 'var(--text-secondary)' }}>{relation}</span>
              <span style={{ fontSize: 15, color: 'var(--text-secondary)' }}>•</span>
              <span style={{ fontSize: 15, color: 'var(--text-secondary)' }}>Age {ageLabel}</span>
            </div>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
              Edit profile context and relationship details.
            </p>
          </div>
        </div>
        {error && <p style={{ color: 'var(--accent-danger)', fontSize: 13 }}>{error}</p>}
        <div style={{ display: 'grid', gap: 12, maxWidth: 860 }}>
          <section style={sectionStyle()}>
            <h3 style={{ fontSize: 18, fontWeight: 700 }}>Identity</h3>
            <label>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Name</div>
              <input
                value={profileDraft.name}
                onChange={e => setProfileDraft(prev => ({ ...prev, name: e.target.value }))}
                style={fieldStyle()}
              />
            </label>
            <label>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Category</div>
              <select
                value={profileDraft.category}
                onChange={e => setProfileDraft(prev => ({ ...prev, category: e.target.value }))}
                style={fieldStyle()}
              >
                <option value="personal">personal</option>
                <option value="family">family</option>
                <option value="startup">startup</option>
                <option value="logistics">logistics</option>
              </select>
            </label>
            <label>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Birthday</div>
              <input
                value={profileDraft.birthday || ''}
                onChange={e => setProfileDraft(prev => ({ ...prev, birthday: e.target.value }))}
                placeholder="DD-MMM"
                style={fieldStyle()}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="checkbox"
                checked={Boolean(profileDraft.on_watchlist)}
                onChange={e => setProfileDraft(prev => ({ ...prev, on_watchlist: e.target.checked }))}
                disabled={String(selected.jid || '').endsWith('@g.us')}
              />
              <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>On watchlist</span>
            </label>
          </section>

          <section style={sectionStyle()}>
            <h3 style={{ fontSize: 18, fontWeight: 700 }}>Context</h3>
            <label>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Relation</div>
              <input
                value={profileDraft.context.relation}
                onChange={e => setProfileDraft(prev => ({ ...prev, context: { ...prev.context, relation: e.target.value } }))}
                style={fieldStyle()}
              />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Home location</div>
                <input
                  value={profileDraft.context.home_location}
                  onChange={e => setProfileDraft(prev => ({ ...prev, context: { ...prev.context, home_location: e.target.value } }))}
                  style={fieldStyle()}
                />
              </label>
              <label>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Age</div>
                <input
                  type="number"
                  value={profileDraft.context.age}
                  onChange={e => setProfileDraft(prev => ({ ...prev, context: { ...prev.context, age: e.target.value } }))}
                  style={fieldStyle()}
                />
              </label>
            </div>
            <label>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Other (max 10 words)</div>
              <textarea
                value={profileDraft.context.other}
                onChange={e => setProfileDraft(prev => ({ ...prev, context: { ...prev.context, other: e.target.value } }))}
                rows={3}
                style={{ ...fieldStyle(), resize: 'vertical' }}
              />
            </label>
            <label>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Context last updated</div>
              <input value={selected?.context?.context_last_updated || '—'} readOnly style={fieldStyle()} />
            </label>
          </section>

          <section style={sectionStyle()}>
            <h3 style={{ fontSize: 18, fontWeight: 700 }}>Calls (Last 90 Days)</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Minutes</div>
                <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.1 }}>{call90dMinutes}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Calls</div>
                <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.1 }}>{call90dCount}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Source</div>
                <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.3 }}>
                  {callSources.length ? callSources.join(', ') : '—'}
                </div>
              </div>
            </div>
            <label>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Last call</div>
              <input value={lastCallAt} readOnly style={fieldStyle()} />
            </label>
          </section>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={saveProfile}
              disabled={Boolean(saving[selected.jid])}
              style={{
                borderRadius: 999,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-elevated)',
                padding: '10px 16px',
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              {saving[selected.jid] ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>People</h2>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
        Sorted by messages in the last 30 days, then watchlist. Birthday is auto-filled from extraction and can be edited in profile.
      </p>
      {loading && <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Loading contacts…</p>}
      {error && <p style={{ color: 'var(--accent-danger)', fontSize: 13 }}>{error}</p>}

      {!loading && !error && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Relation</th>
                <th>Birthday</th>
                <th style={{ textAlign: 'right' }}>Messages (30d)</th>
                <th style={{ textAlign: 'center' }}>Watchlist</th>
                <th style={{ textAlign: 'right' }}>Followups</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(row => (
                <tr
                  key={row.jid || row.name}
                  onClick={() => openProfile(row)}
                  style={{ cursor: 'pointer' }}
                >
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {row.photo_url ? (
                        <img
                          src={row.photo_url}
                          alt={row.name || 'contact'}
                          style={avatarStyle()}
                        />
                      ) : (
                        <div
                          style={{
                            ...avatarStyle(),
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 10,
                            fontWeight: 700,
                            color: 'var(--text-secondary)',
                            background: 'var(--bg-elevated)',
                          }}
                        >
                          {initials(row.name)}
                        </div>
                      )}
                      <span>{row.name || '—'}</span>
                    </div>
                  </td>
                  <td>{row.context?.relation || row.relation || '—'}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{row.birthday || '—'}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {row.recent_messages_30d || 0}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      type="button"
                      onClick={() => toggleWatchlist(row)}
                      onClickCapture={e => e.stopPropagation()}
                      disabled={Boolean(saving[row.jid])}
                      aria-pressed={Boolean(row.on_watchlist)}
                      style={{
                        ...watchlistButtonStyle(Boolean(row.on_watchlist)),
                        opacity: saving[row.jid] ? 0.65 : 1,
                        cursor: saving[row.jid] ? 'progress' : 'pointer',
                      }}
                    >
                      {row.on_watchlist ? 'Yes' : 'No'}
                    </button>
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {row.open_followups || 0}
                  </td>
                </tr>
              ))}
              {!sorted.length && (
                <tr>
                  <td colSpan={6} style={{ color: 'var(--text-secondary)' }}>
                    Contacts are empty. Run `npm run sync`.
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
