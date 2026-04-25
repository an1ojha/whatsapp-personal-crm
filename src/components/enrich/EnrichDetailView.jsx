import { useState, useEffect } from 'react'
import { getInitials, getAvatarColor, getAvatarTextColor } from '../../utils/imageUtils.js'

const INTERACTION_MODES = [
  { id: 'coffee', label: 'Coffee / Lunch' },
  { id: 'video', label: 'Video Call' },
  { id: 'phone', label: 'Phone' },
  { id: 'text', label: 'Text / WhatsApp' },
  { id: 'email', label: 'Email' },
  { id: 'linkedin', label: 'LinkedIn' },
]

const TIMINGS = [
  { id: 'asap', label: 'ASAP' },
  { id: 'month', label: 'This month' },
  { id: 'quarter', label: 'This quarter' },
  { id: 'year', label: 'This year' },
]

function FieldLabel({ children }) {
  return (
    <p style={{
      fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)',
      letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 'var(--space-2)',
    }}>
      {children}
    </p>
  )
}

function Chip({ label, active, onToggle, single }) {
  return (
    <button
      onClick={onToggle}
      style={{
        padding: '6px 14px', borderRadius: 'var(--radius-full)',
        fontSize: 13, fontWeight: 500,
        background: active ? 'var(--accent-primary-dim)' : 'var(--bg-elevated)',
        border: active ? '1px solid var(--accent-primary)' : '1px solid var(--border-default)',
        color: active ? 'var(--accent-primary)' : 'var(--text-secondary)',
        transition: 'all 0.15s ease', flexShrink: 0,
      }}
    >
      {label}
    </button>
  )
}

export default function EnrichDetailView({ profile, listIndex, list, getEnrichment, onSave, onSkip, onBack, onNavigate }) {
  const existing = getEnrichment(profile.url)

  const [relationshipNote, setRelationshipNote] = useState(existing?.relationshipNote || '')
  const [interactionModes, setInteractionModes] = useState(existing?.interactionModes || [])
  const [nextTalkReason, setNextTalkReason] = useState(existing?.nextTalkReason || '')
  const [nextTalkTiming, setNextTalkTiming] = useState(existing?.nextTalkTiming || null)

  // Reset form when profile changes
  useEffect(() => {
    const e = getEnrichment(profile.url)
    setRelationshipNote(e?.relationshipNote || '')
    setInteractionModes(e?.interactionModes || [])
    setNextTalkReason(e?.nextTalkReason || '')
    setNextTalkTiming(e?.nextTalkTiming || null)
  }, [profile.url])

  const toggleMode = id => {
    setInteractionModes(prev =>
      prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
    )
  }

  const toggleTiming = id => {
    setNextTalkTiming(prev => prev === id ? null : id)
  }

  const handleSave = () => {
    onSave(profile.url, { relationshipNote, interactionModes, nextTalkReason, nextTalkTiming })
  }

  const bg = getAvatarColor(profile.name)
  const fg = getAvatarTextColor(profile.name)
  const initials = getInitials(profile.name)

  const prevProfile = listIndex > 0 ? list[listIndex - 1] : null
  const nextProfile = listIndex < list.length - 1 ? list[listIndex + 1] : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header nav */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: 'var(--space-4)', flexShrink: 0,
        borderBottom: '1px solid var(--border-subtle)',
      }}>
        <button
          onClick={onBack}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 14, color: 'var(--text-secondary)',
            padding: '6px 10px', borderRadius: 'var(--radius-md)',
            background: 'var(--bg-elevated)',
          }}
        >
          ← Back
        </button>

        <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
          {listIndex + 1} / {list.length}
        </span>

        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button
            onClick={() => prevProfile && onNavigate(prevProfile, list, listIndex - 1)}
            disabled={!prevProfile}
            style={{
              width: 36, height: 36, borderRadius: 'var(--radius-full)',
              background: 'var(--bg-elevated)', fontSize: 16,
              color: prevProfile ? 'var(--text-primary)' : 'var(--text-tertiary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ←
          </button>
          <button
            onClick={() => nextProfile && onNavigate(nextProfile, list, listIndex + 1)}
            disabled={!nextProfile}
            style={{
              width: 36, height: 36, borderRadius: 'var(--radius-full)',
              background: 'var(--bg-elevated)', fontSize: 16,
              color: nextProfile ? 'var(--text-primary)' : 'var(--text-tertiary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            →
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="scroll-container" style={{ flex: 1, padding: 'var(--space-4)' }}>
        {/* Profile card */}
        <div style={{
          background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-4)', marginBottom: 'var(--space-4)',
          border: '1px solid var(--border-subtle)',
        }}>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start', marginBottom: 'var(--space-3)' }}>
            {/* Avatar */}
            <div style={{
              width: 64, height: 64, borderRadius: 'var(--radius-full)',
              background: bg, color: fg,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, fontWeight: 700, flexShrink: 0,
            }}>
              {initials}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>{profile.name}</p>
              {profile.position && <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{profile.position}</p>}
              {profile.company && <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{profile.company}</p>}
            </div>
          </div>

          {/* Chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
            {profile.role_tag && (
              <span style={chipStyle('var(--accent-primary-dim)', 'var(--accent-primary)')}>{profile.role_tag}</span>
            )}
            {profile.is_vc && (
              <span style={chipStyle('rgba(52,211,153,0.12)', 'var(--accent-success)')}>VC</span>
            )}
            {profile.is_decision_maker && (
              <span style={chipStyle('rgba(251,191,36,0.12)', 'var(--accent-warning)')}>Decision Maker</span>
            )}
            {profile.is_us && (
              <span style={chipStyle('var(--bg-card)', 'var(--text-secondary)')}>US</span>
            )}
            {profile.they_initiated && (
              <span style={chipStyle('var(--bg-card)', 'var(--text-secondary)')}>They reached out</span>
            )}
          </div>

          {/* Score row */}
          <div style={{ display: 'flex', gap: 'var(--space-4)', marginBottom: 'var(--space-3)' }}>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent-primary)' }}>{profile.total_score}</p>
              <p style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Score</p>
            </div>
            {profile.total_messages > 0 && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: 18, fontWeight: 700 }}>{profile.total_messages}</p>
                <p style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Messages</p>
              </div>
            )}
            {profile.last_message && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: 14, fontWeight: 600 }}>{profile.last_message}</p>
                <p style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Last msg</p>
              </div>
            )}
          </div>

          {/* Reason */}
          {profile.reason && (
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', fontStyle: 'italic', lineHeight: 1.5 }}>
              {profile.reason}
            </p>
          )}

          {/* LinkedIn link */}
          <a
            href={profile.url}
            target="_blank"
            rel="noreferrer"
            onClick={e => e.stopPropagation()}
            style={{
              display: 'inline-block', marginTop: 'var(--space-3)',
              fontSize: 13, color: 'var(--accent-primary)', textDecoration: 'none',
            }}
          >
            View on LinkedIn →
          </a>
        </div>

        {/* Enrichment form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', paddingBottom: 100 }}>
          {/* Relationship note */}
          <div>
            <FieldLabel>How you know them</FieldLabel>
            <textarea
              className="input-base"
              value={relationshipNote}
              onChange={e => setRelationshipNote(e.target.value)}
              placeholder="e.g. Met at YC Demo Day, worked together at Stripe..."
              rows={3}
              style={{ resize: 'none' }}
            />
          </div>

          {/* Interaction modes */}
          <div>
            <FieldLabel>Ideal interaction</FieldLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              {INTERACTION_MODES.map(m => (
                <Chip
                  key={m.id}
                  label={m.label}
                  active={interactionModes.includes(m.id)}
                  onToggle={() => toggleMode(m.id)}
                />
              ))}
            </div>
          </div>

          {/* Why reconnect */}
          <div>
            <FieldLabel>Why reconnect</FieldLabel>
            <input
              className="input-base"
              value={nextTalkReason}
              onChange={e => setNextTalkReason(e.target.value)}
              placeholder="e.g. Share fundraise news, explore an intro..."
            />
          </div>

          {/* When to talk */}
          <div>
            <FieldLabel>When to talk</FieldLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              {TIMINGS.map(t => (
                <Chip
                  key={t.id}
                  label={t.label}
                  active={nextTalkTiming === t.id}
                  onToggle={() => toggleTiming(t.id)}
                  single
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Sticky footer */}
      <div style={{
        position: 'sticky', bottom: 0,
        padding: 'var(--space-3) var(--space-4)',
        paddingBottom: 'calc(var(--space-3) + env(safe-area-inset-bottom))',
        background: 'var(--bg-surface)',
        borderTop: '1px solid var(--border-subtle)',
        display: 'flex', gap: 'var(--space-3)',
      }}>
        <button
          onClick={() => onSkip(profile.url)}
          style={{
            flex: 1, padding: 'var(--space-3)',
            borderRadius: 'var(--radius-md)', fontSize: 15, fontWeight: 600,
            background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
            border: '1px solid var(--border-default)',
          }}
        >
          Skip
        </button>
        <button
          onClick={handleSave}
          style={{
            flex: 2, padding: 'var(--space-3)',
            borderRadius: 'var(--radius-md)', fontSize: 15, fontWeight: 600,
            background: 'linear-gradient(135deg, #A78BFA, #7C3AED)',
            color: '#fff', border: 'none',
          }}
        >
          Save & Next →
        </button>
      </div>
    </div>
  )
}

function chipStyle(bg, color) {
  return {
    padding: '3px 10px', borderRadius: 'var(--radius-full)',
    fontSize: 12, fontWeight: 500,
    background: bg, color,
    border: `1px solid ${color}30`,
    display: 'inline-block',
  }
}
