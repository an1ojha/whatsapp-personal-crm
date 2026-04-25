import { useState, useEffect, useCallback } from 'react'
import { useContacts } from '../hooks/useContacts.jsx'
import { useLinkedInEnrichments } from '../hooks/useLinkedInEnrichments.jsx'
import { getInitials, getAvatarColor, getAvatarTextColor } from '../utils/imageUtils.js'
import { getStatusInfo } from '../utils/urgency.js'
import ContactProfile from '../components/contact/ContactProfile.jsx'

export default function PeopleView({ onEnrichTap }) {
  const { state: { contacts }, dispatch } = useContacts()
  const { reviewedCount, totalCount, isLoading: enrichLoading } = useLinkedInEnrichments()

  const [search, setSearch] = useState('')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [selected, setSelected] = useState(null)

  const filtered = search.trim()
    ? contacts.filter(c =>
        c.name?.toLowerCase().includes(search.toLowerCase()) ||
        c.company?.toLowerCase().includes(search.toLowerCase()) ||
        c.category?.toLowerCase().includes(search.toLowerCase())
      )
    : contacts

  const sorted = [...filtered].sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  // Reset index when search changes or contacts list changes
  useEffect(() => {
    setCurrentIndex(i => Math.min(i, Math.max(0, sorted.length - 1)))
  }, [sorted.length])

  const prev = useCallback(() => setCurrentIndex(i => Math.max(0, i - 1)), [])
  const next = useCallback(() => setCurrentIndex(i => Math.min(sorted.length - 1, i + 1)), [sorted.length])

  // Keyboard navigation
  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prev, next])

  const contact = sorted[currentIndex] || null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: 'var(--space-5) var(--space-4) var(--space-3)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
          <h1 style={{ fontSize: 28, fontWeight: 700 }}>
            People
            {contacts.length > 0 && (
              <span style={{
                marginLeft: 'var(--space-2)', fontSize: 14, fontWeight: 500,
                color: 'var(--text-tertiary)', background: 'var(--bg-elevated)',
                padding: '2px 8px', borderRadius: 'var(--radius-full)', verticalAlign: 'middle',
              }}>{contacts.length}</span>
            )}
          </h1>
        </div>

        {/* LinkedIn enrichment banner */}
        {!enrichLoading && totalCount > 0 && reviewedCount < totalCount && (
          <button
            onClick={onEnrichTap}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              width: '100%', padding: '10px 16px', marginBottom: 'var(--space-3)',
              borderRadius: 'var(--radius-md)',
              background: 'linear-gradient(135deg, rgba(167,139,250,0.18), rgba(124,58,237,0.12))',
              border: '1px solid rgba(167,139,250,0.3)',
              color: 'var(--accent-primary)', fontSize: 14, fontWeight: 600,
            }}
          >
            <span>✦ Enrich LinkedIn network</span>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>
              {reviewedCount}/{totalCount} →
            </span>
          </button>
        )}

        {/* Search */}
        <div style={{ position: 'relative' }}>
          <span style={{
            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--text-tertiary)', fontSize: 16, pointerEvents: 'none',
          }}>🔍</span>
          <input
            className="input-base"
            value={search}
            onChange={e => { setSearch(e.target.value); setCurrentIndex(0) }}
            placeholder="Search by name, company..."
            style={{ paddingLeft: 36 }}
          />
        </div>
      </div>

      {/* Card area */}
      <div style={{ flex: 1, overflow: 'hidden', padding: '0 var(--space-4) var(--space-4)', display: 'flex', flexDirection: 'column' }}>
        {sorted.length === 0 ? (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 'var(--space-3)', color: 'var(--text-secondary)', textAlign: 'center',
          }}>
            {contacts.length === 0 ? (
              <>
                <span style={{ fontSize: 48 }}>👥</span>
                <p style={{ fontSize: 16, fontWeight: 600 }}>No contacts yet</p>
                <p style={{ fontSize: 14 }}>Tap + to add or enrich from LinkedIn</p>
              </>
            ) : (
              <>
                <span style={{ fontSize: 36 }}>🔍</span>
                <p style={{ fontSize: 15 }}>No results for "{search}"</p>
              </>
            )}
          </div>
        ) : (
          <ContactCard
            contact={contact}
            index={currentIndex}
            total={sorted.length}
            onPrev={prev}
            onNext={next}
            onTap={() => setSelected(contact)}
          />
        )}
      </div>

      {selected && (
        <ContactProfile contact={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}

function ContactCard({ contact, index, total, onPrev, onNext, onTap }) {
  const status = getStatusInfo(contact)
  const bg = getAvatarColor(contact.name)
  const fg = getAvatarTextColor(contact.name)
  const initials = getInitials(contact.name)

  const modes = Array.isArray(contact.catchupModes)
    ? contact.catchupModes
    : contact.catchupMode
      ? contact.catchupMode.split(',').map(s => s.trim()).filter(Boolean)
      : []

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      background: 'var(--bg-card)',
      borderRadius: 'var(--radius-xl)',
      border: '1px solid var(--border-subtle)',
      boxShadow: 'var(--shadow-card)',
      overflow: 'hidden',
    }}>
      {/* Tappable profile area */}
      <button
        onClick={onTap}
        style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', padding: 'var(--space-8) var(--space-5) var(--space-5)',
          overflow: 'hidden', background: 'transparent', textAlign: 'center',
        }}
      >
        {/* Avatar */}
        <div style={{
          width: 110, height: 110, borderRadius: 'var(--radius-full)',
          background: bg, flexShrink: 0, overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 'var(--space-4)',
          boxShadow: `0 0 0 4px ${bg}44, 0 8px 24px rgba(0,0,0,0.4)`,
        }}>
          {contact.photo ? (
            <img src={contact.photo} alt={contact.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span style={{ fontSize: 38, fontWeight: 700, color: fg }}>{initials}</span>
          )}
        </div>

        {/* Name + status */}
        <p style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>{contact.name}</p>
        <span style={{
          display: 'inline-block', fontSize: 11, fontWeight: 600, marginBottom: 'var(--space-3)',
          color: status.color, background: status.color + '22',
          padding: '3px 10px', borderRadius: 'var(--radius-full)',
        }}>{status.label}</span>

        {/* Company */}
        {contact.company && (
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' }}>
            {contact.company}
          </p>
        )}

        {/* Category + mode chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginBottom: 'var(--space-4)' }}>
          {contact.category && (
            <span style={tagStyle('var(--accent-primary-dim)', 'var(--accent-primary)')}>
              {contact.category}
            </span>
          )}
          {modes.map(m => (
            <span key={m} style={tagStyle('var(--bg-elevated)', 'var(--text-secondary)')}>
              {modeEmoji(m)} {m}
            </span>
          ))}
        </div>

        {/* Urgent purpose */}
        {contact.urgentPurpose && (
          <div style={{
            width: '100%', padding: '10px 14px',
            background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)',
            borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-3)',
          }}>
            <p style={{ fontSize: 13, color: 'var(--accent-warning)', lineHeight: 1.5 }}>
              ⚡ {contact.urgentPurpose}
            </p>
          </div>
        )}

        {/* Notes (truncated) */}
        {contact.notes && (
          <p style={{
            fontSize: 13, color: 'var(--text-tertiary)', lineHeight: 1.6,
            maxHeight: 60, overflow: 'hidden', textAlign: 'left', width: '100%',
            display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
          }}>
            {contact.notes}
          </p>
        )}
      </button>

      {/* Footer: frequency + navigation */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: 'var(--space-3) var(--space-4)',
        borderTop: '1px solid var(--border-subtle)',
        flexShrink: 0,
      }}>
        {/* Frequency */}
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          {contact.frequency ? `🔁 every ${contact.frequency}d` : ''}
        </p>

        {/* Nav arrows + counter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <button
            onClick={onPrev}
            disabled={index === 0}
            style={{
              width: 40, height: 40, borderRadius: 'var(--radius-full)',
              background: index === 0 ? 'transparent' : 'var(--bg-elevated)',
              border: index === 0 ? '1px solid var(--border-subtle)' : '1px solid var(--border-default)',
              fontSize: 18, color: index === 0 ? 'var(--text-tertiary)' : 'var(--text-primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s ease',
            }}
          >
            ←
          </button>

          <span style={{ fontSize: 13, color: 'var(--text-tertiary)', minWidth: 40, textAlign: 'center' }}>
            {index + 1}/{total}
          </span>

          <button
            onClick={onNext}
            disabled={index === total - 1}
            style={{
              width: 40, height: 40, borderRadius: 'var(--radius-full)',
              background: index === total - 1 ? 'transparent' : 'var(--bg-elevated)',
              border: index === total - 1 ? '1px solid var(--border-subtle)' : '1px solid var(--border-default)',
              fontSize: 18, color: index === total - 1 ? 'var(--text-tertiary)' : 'var(--text-primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s ease',
            }}
          >
            →
          </button>
        </div>
      </div>
    </div>
  )
}

function tagStyle(bg, color) {
  return {
    padding: '3px 10px', borderRadius: 'var(--radius-full)',
    fontSize: 12, fontWeight: 500,
    background: bg, color,
  }
}

function modeEmoji(mode) {
  const map = { 'in-person': '🤝', virtual: '💻', coffee: '☕', video: '📹', phone: '📞', text: '💬', email: '✉️', linkedin: '🔗' }
  return map[mode] || ''
}
