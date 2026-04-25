import { useRef } from 'react'
import { useSwipe } from '../../hooks/useSwipe.js'

export default function TutorialCard({ stackIndex, dragProgress, onDragProgress, onDismiss }) {
  const cardRef = useRef(null)
  const isTop = stackIndex === 0

  useSwipe(cardRef, {
    onSwipeLeft: onDismiss,
    onSwipeRight: onDismiss,
    onDrag: onDragProgress,
    enabled: isTop,
  })

  const prog = Math.abs(dragProgress || 0)
  let scaleVal = 1
  let translateYVal = 0
  if (stackIndex === 1) {
    scaleVal = 0.95 + 0.03 * prog
    translateYVal = -(8 - 4 * prog)
  } else if (stackIndex === 2) {
    scaleVal = 0.90 + 0.03 * prog
    translateYVal = -(16 - 4 * prog)
  }

  return (
    <div
      ref={cardRef}
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: 'var(--radius-xl)',
        overflow: 'hidden',
        boxShadow: 'var(--shadow-card)',
        background: 'linear-gradient(145deg, #1a1230 0%, #0f0a20 100%)',
        border: '1.5px solid rgba(167, 139, 250, 0.3)',
        transform: stackIndex === 0
          ? undefined
          : `scale(${scaleVal}) translateY(${translateYVal}px)`,
        transition: stackIndex === 0 ? undefined : 'transform 0.15s ease',
        cursor: isTop ? 'grab' : 'default',
        willChange: 'transform',
        touchAction: 'none',
        zIndex: 10 - stackIndex,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-8)',
        textAlign: 'center',
        gap: 'var(--space-6)',
      }}
    >
      {/* Glow effect */}
      <div style={{
        position: 'absolute',
        top: '20%',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '60%',
        height: '30%',
        background: 'radial-gradient(ellipse, rgba(167,139,250,0.15) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      <div>
        <div style={{
          fontSize: 13,
          fontWeight: 700,
          color: 'var(--accent-primary)',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          marginBottom: 12,
          opacity: 0.8,
        }}>
          How it works
        </div>
        <h2 style={{ fontSize: 28, fontWeight: 800, color: '#fff', lineHeight: 1.15, marginBottom: 8 }}>
          Stay in the loop
        </h2>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>
          Swipe to manage your catch-ups
        </p>
      </div>

      {/* Instructions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', width: '100%' }}>
        <InstructionRow
          emoji="👈"
          direction="Swipe left"
          description="Snooze — they'll resurface after your set frequency"
          color="#A78BFA"
        />
        <InstructionRow
          emoji="👉"
          direction="Swipe right"
          description="Skip — they'll reappear at the end of today's stack"
          color="#FBBF24"
        />
        <InstructionRow
          emoji="👆"
          direction="Tap card"
          description="View full profile, notes, and contact details"
          color="#A78BFA"
        />
      </div>

      <div style={{
        marginTop: 'var(--space-4)',
        fontSize: 13,
        color: 'rgba(167, 139, 250, 0.6)',
        fontWeight: 500,
      }}>
        Swipe this card to get started ↓
      </div>
    </div>
  )
}

function InstructionRow({ emoji, direction, description, color }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 'var(--space-3)',
      padding: 'var(--space-3) var(--space-4)',
      background: 'rgba(255,255,255,0.04)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid rgba(255,255,255,0.06)',
      textAlign: 'left',
    }}>
      <span style={{ fontSize: 22, flexShrink: 0 }}>{emoji}</span>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color, marginBottom: 2 }}>{direction}</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 1.45 }}>{description}</div>
      </div>
    </div>
  )
}
