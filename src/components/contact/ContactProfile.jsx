import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useContacts } from '../../hooks/useContacts.jsx'
import { getInitials, getAvatarColor, getAvatarTextColor } from '../../utils/imageUtils.js'
import { getStatusInfo } from '../../utils/urgency.js'
import ContactForm from './ContactForm.jsx'

export default function ContactProfile({ contact, onClose }) {
  const { dispatch } = useContacts()
  const [editing, setEditing] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Animate in
    requestAnimationFrame(() => setVisible(true))
    // Prevent body scroll
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  function handleClose() {
    setVisible(false)
    setTimeout(onClose, 300)
  }

  function handleSave(formData) {
    dispatch({ type: 'UPDATE_CONTACT', payload: { id: contact.id, changes: formData } })
    setEditing(false)
  }

  function handleDelete() {
    if (window.confirm(`Remove ${contact.name} from your loop?`)) {
      dispatch({ type: 'DELETE_CONTACT', payload: contact.id })
      handleClose()
    }
  }

  function handleAddToLoop(note) {
    dispatch({ type: 'ADD_TO_LOOP', payload: { id: contact.id, note } })
    handleClose()
  }

  const status = getStatusInfo(contact)

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
      }}
    >
      {/* Backdrop */}
      <div
        onClick={handleClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.7)',
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.3s ease',
        }}
      />

      {/* Sheet */}
      <div
        style={{
          position: 'relative',
          background: 'var(--bg-surface)',
          borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          transform: visible ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
          boxShadow: 'var(--shadow-sheet)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {/* Drag handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border-default)' }} />
        </div>

        {/* Content */}
        <div className="scroll-container" style={{ flex: 1, overflow: 'auto', padding: 'var(--space-4) var(--space-6) var(--space-6)' }}>
          {editing ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-6)' }}>
                <h2 style={{ fontSize: 20, fontWeight: 700 }}>Edit Contact</h2>
                <button onClick={() => setEditing(false)} style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                  Cancel
                </button>
              </div>
              <ContactForm
                initialData={contact}
                onSave={handleSave}
                submitLabel="Save Changes"
              />
            </>
          ) : (
            <ProfileView
              contact={contact}
              status={status}
              onEdit={() => setEditing(true)}
              onDelete={handleDelete}
              onAddToLoop={handleAddToLoop}
              onClose={handleClose}
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

function ProfileView({ contact, status, onEdit, onDelete, onAddToLoop, onClose }) {
  const [showAddToLoop, setShowAddToLoop] = useState(false)
  const [loopNote, setLoopNote] = useState('')

  // Normalise catchupModes
  const modes = Array.isArray(contact.catchupModes)
    ? contact.catchupModes
    : contact.catchupMode
      ? contact.catchupMode.split(',').map(s => s.trim()).filter(Boolean)
      : []

  const modeLabel = modes.map(m => m === 'in-person' ? '🤝 In Person' : '💻 Virtual').join('  ·  ')

  function commitAddToLoop() {
    onAddToLoop(loopNote.trim() || undefined)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      {/* Photo + Name */}
      <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'flex-start' }}>
        <div style={{
          width: 80, height: 80,
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          flexShrink: 0,
          background: getAvatarColor(contact.name),
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {contact.photo ? (
            <img src={contact.photo} alt={contact.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span style={{ fontSize: 28, fontWeight: 700, color: getAvatarTextColor(contact.name) }}>
              {getInitials(contact.name)}
            </span>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0, paddingTop: 4 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>{contact.name}</h2>
          {contact.company && (
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 6 }}>{contact.company}</p>
          )}
          <span style={{
            display: 'inline-block', fontSize: 11, fontWeight: 600,
            color: status.color, background: status.color + '22',
            padding: '3px 8px', borderRadius: 'var(--radius-full)',
          }}>
            {status.label}
          </span>
        </div>

        <button onClick={onEdit} style={{ color: 'var(--accent-primary)', fontSize: 14, fontWeight: 600, flexShrink: 0 }}>
          Edit
        </button>
      </div>

      {/* Details */}
      <div style={{ background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        {contact.phone && <DetailRow icon="📞" label="Phone" value={contact.phone} />}
        {contact.category && <DetailRow icon="🏷️" label="Category" value={contact.category} />}
        {modeLabel && <DetailRow icon="🤝" label="Catchup mode" value={modeLabel} />}
        {contact.frequency && (
          <DetailRow icon="🔁" label="Frequency" value={`Every ${contact.frequency} days`} />
        )}
        {contact.urgentPurpose && (
          <DetailRow icon="⚡" label="Note" value={contact.urgentPurpose} highlight />
        )}
        {contact.notes && <DetailRow icon="📝" label="Notes" value={contact.notes} />}
      </div>

      {/* Add back to loop */}
      {!showAddToLoop ? (
        <button
          onClick={() => setShowAddToLoop(true)}
          style={{
            padding: '16px',
            borderRadius: 'var(--radius-md)',
            background: 'linear-gradient(135deg, #A78BFA, #7C3AED)',
            color: '#fff',
            fontSize: 15,
            fontWeight: 700,
            boxShadow: '0 4px 16px rgba(124,58,237,0.35)',
          }}
        >
          🔁 Add back to today's loop
        </button>
      ) : (
        <div style={{
          background: 'var(--bg-elevated)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
          border: '1px solid var(--accent-primary)',
        }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-primary)' }}>
            Add a note (optional — updates the ⚡ purpose field)
          </p>
          <input
            className="input-base"
            value={loopNote}
            onChange={e => setLoopNote(e.target.value)}
            placeholder="e.g. Follow up on intro they promised"
            autoFocus
          />
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <button
              onClick={() => setShowAddToLoop(false)}
              style={{
                flex: 1, padding: '12px', borderRadius: 'var(--radius-md)',
                background: 'var(--bg-card)', color: 'var(--text-secondary)',
                fontSize: 14, fontWeight: 600, border: '1px solid var(--border-default)',
              }}
            >
              Cancel
            </button>
            <button
              onClick={commitAddToLoop}
              style={{
                flex: 2, padding: '12px', borderRadius: 'var(--radius-md)',
                background: 'linear-gradient(135deg, #A78BFA, #7C3AED)',
                color: '#fff', fontSize: 14, fontWeight: 700,
              }}
            >
              Add to loop
            </button>
          </div>
        </div>
      )}

      {/* Delete */}
      <button
        onClick={onDelete}
        style={{
          padding: '14px', borderRadius: 'var(--radius-md)',
          background: 'var(--accent-danger-dim)', color: 'var(--accent-danger)',
          fontSize: 14, fontWeight: 600, border: '1px solid rgba(248,113,113,0.2)',
          marginBottom: 'var(--space-4)',
        }}
      >
        Remove from loop
      </button>
    </div>
  )
}

function DetailRow({ icon, label, value, highlight }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 'var(--space-3)',
      padding: 'var(--space-3) var(--space-4)',
      borderBottom: '1px solid var(--border-subtle)',
    }}>
      <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 2, fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          {label}
        </div>
        <div style={{
          fontSize: 14,
          fontWeight: highlight ? 600 : 400,
          color: highlight ? 'var(--accent-warning)' : 'var(--text-primary)',
          wordBreak: 'break-word',
        }}>
          {value}
        </div>
      </div>
    </div>
  )
}
