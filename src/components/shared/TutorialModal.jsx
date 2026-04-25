import { createPortal } from 'react-dom'

export default function TutorialModal({ onDismiss }) {
  return createPortal(
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 90,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-end',
    }}>
      {/* Backdrop */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
      }} />

      {/* Sheet */}
      <div style={{
        position: 'relative',
        background: 'linear-gradient(170deg, #1a1230 0%, #0f0a20 100%)',
        borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0',
        border: '1px solid rgba(167,139,250,0.2)',
        borderBottom: 'none',
        padding: 'var(--space-8) var(--space-6)',
        paddingBottom: 'max(var(--space-8), env(safe-area-inset-bottom))',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-5)',
        animation: 'slideUp 0.35s cubic-bezier(0.32,0.72,0,1)',
      }}>
        {/* Glow */}
        <div style={{
          position: 'absolute', top: 0, left: '50%',
          transform: 'translateX(-50%)',
          width: '80%', height: 100,
          background: 'radial-gradient(ellipse, rgba(167,139,250,0.12) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
            color: 'var(--accent-primary)', textTransform: 'uppercase',
            marginBottom: 10, opacity: 0.8,
          }}>
            How it works
          </div>
          <h2 style={{ fontSize: 26, fontWeight: 800, color: '#fff', lineHeight: 1.2 }}>
            Stay in the loop
          </h2>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Row emoji="👈" color="#A78BFA" direction="Swipe left" description="Snooze — contact resurfaces after your set frequency" />
          <Row emoji="👉" color="#FBBF24" direction="Swipe right" description="Skip — they reappear at the end of today's stack" />
          <Row emoji="👆" color="#60A5FA" direction="Tap card" description="View full profile, edit details, or re-add to loop" />
        </div>

        <button
          onClick={onDismiss}
          style={{
            marginTop: 'var(--space-2)',
            padding: '16px',
            borderRadius: 'var(--radius-md)',
            background: 'linear-gradient(135deg, #A78BFA, #7C3AED)',
            color: '#fff',
            fontSize: 16,
            fontWeight: 700,
            boxShadow: '0 4px 20px rgba(124,58,237,0.45)',
          }}
        >
          Got it — show my contacts
        </button>
      </div>
    </div>,
    document.body
  )
}

function Row({ emoji, color, direction, description }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)',
      padding: 'var(--space-3) var(--space-4)',
      background: 'rgba(255,255,255,0.04)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <span style={{ fontSize: 22, flexShrink: 0 }}>{emoji}</span>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color, marginBottom: 2 }}>{direction}</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>{description}</div>
      </div>
    </div>
  )
}
