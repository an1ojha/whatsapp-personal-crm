import { getInitials, getAvatarColor, getAvatarTextColor } from '../../utils/imageUtils.js'
import { getStatusInfo } from '../../utils/urgency.js'

export default function ContactListItem({ contact, onTap }) {
  const status = getStatusInfo(contact)

  return (
    <button
      onClick={() => onTap(contact)}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-4)',
        background: 'none',
        textAlign: 'left',
        borderBottom: '1px solid var(--border-subtle)',
        transition: 'background 0.1s ease',
      }}
      onPointerDown={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
      onPointerUp={e => e.currentTarget.style.background = 'none'}
      onPointerLeave={e => e.currentTarget.style.background = 'none'}
    >
      {/* Avatar */}
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: '50%',
          overflow: 'hidden',
          flexShrink: 0,
          background: getAvatarColor(contact.name),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {contact.photo ? (
          <img
            src={contact.photo}
            alt={contact.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <span style={{
            fontSize: 18,
            fontWeight: 700,
            color: getAvatarTextColor(contact.name),
          }}>
            {getInitials(contact.name)}
          </span>
        )}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 2 }}>
          <span style={{ fontSize: 15, fontWeight: 600, truncate: true }}>
            {contact.name || 'Unknown'}
          </span>
          {contact.urgentPurpose && (
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: 'var(--accent-warning)',
              flexShrink: 0,
            }} />
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {[contact.company, contact.category].filter(Boolean).join(' · ') || ''}
        </div>
        {contact.urgentPurpose && (
          <div style={{ fontSize: 12, color: 'var(--accent-warning)', marginTop: 2 }}>
            ⚡ {contact.urgentPurpose}
          </div>
        )}
      </div>

      {/* Status badge */}
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: status.color,
          background: status.color + '22',
          padding: '3px 8px',
          borderRadius: 'var(--radius-full)',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        {status.label}
      </div>
    </button>
  )
}
