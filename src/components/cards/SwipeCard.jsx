import { useRef } from 'react'
import { useSwipe } from '../../hooks/useSwipe.js'
import { getInitials, getAvatarColor, getAvatarTextColor } from '../../utils/imageUtils.js'
import { getStatusInfo } from '../../utils/urgency.js'
import StatusBadge from './StatusBadge.jsx'

export default function SwipeCard({
  contact,
  stackIndex,
  onSwipeLeft,
  onSwipeRight,
  onTap,
  dragProgress,
  onDragProgress,
}) {
  const cardRef = useRef(null)
  const isTop = stackIndex === 0

  useSwipe(cardRef, {
    onSwipeLeft,
    onSwipeRight,
    onTap,
    onDrag: onDragProgress,
    enabled: isTop,
  })

  const status = getStatusInfo(contact)

  // Behind-card scale + translate based on drag progress from parent
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

  const leftOpacity = dragProgress < 0 ? Math.min((-dragProgress - 0.1) / 0.6, 1) : 0
  const rightOpacity = dragProgress > 0 ? Math.min((dragProgress - 0.1) / 0.6, 1) : 0

  return (
    <div
      ref={cardRef}
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: 'var(--radius-xl)',
        overflow: 'hidden',
        background: 'var(--bg-card)',
        boxShadow: 'var(--shadow-card)',
        transform: stackIndex === 0
          ? undefined
          : `scale(${scaleVal}) translateY(${translateYVal}px)`,
        transition: stackIndex === 0 ? undefined : 'transform 0.15s ease',
        cursor: isTop ? 'grab' : 'default',
        willChange: 'transform',
        touchAction: 'none',
        zIndex: 10 - stackIndex,
      }}
    >
      {/* Photo or Avatar */}
      <div style={{ position: 'absolute', inset: 0 }}>
        {contact.photo ? (
          <img
            src={contact.photo}
            alt={contact.name}
            draggable={false}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              pointerEvents: 'none',
            }}
          />
        ) : (
          <div style={{
            width: '100%',
            height: '100%',
            background: getAvatarColor(contact.name),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <span style={{
              fontSize: 'min(22vw, 120px)',
              fontWeight: 800,
              color: getAvatarTextColor(contact.name),
              opacity: 0.6,
              lineHeight: 1,
            }}>
              {getInitials(contact.name)}
            </span>
          </div>
        )}
      </div>

      {/* Bottom gradient overlay */}
      <div
        style={{
          position: 'absolute',
          left: 0, right: 0, bottom: 0,
          height: '55%',
          background: 'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.6) 50%, transparent 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* Status badge top-right */}
      <div style={{ position: 'absolute', top: 16, right: 16 }}>
        <StatusBadge label={status.label} color={status.color} />
      </div>

      {/* Name + Purpose */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: 'var(--space-6)',
          pointerEvents: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <h2 style={{
            fontSize: 26,
            fontWeight: 800,
            color: '#fff',
            lineHeight: 1.1,
            textShadow: '0 2px 8px rgba(0,0,0,0.5)',
          }}>
            {contact.name || 'Unknown'}
          </h2>
        </div>
        {contact.urgentPurpose && (
          <p style={{
            marginTop: 4,
            fontSize: 14,
            color: 'rgba(255,255,255,0.75)',
            fontWeight: 500,
            textShadow: '0 1px 4px rgba(0,0,0,0.5)',
          }}>
            ⚡ {contact.urgentPurpose}
          </p>
        )}
        {contact.company && (
          <p style={{
            marginTop: contact.urgentPurpose ? 2 : 4,
            fontSize: 13,
            color: 'rgba(255,255,255,0.55)',
            textShadow: '0 1px 4px rgba(0,0,0,0.5)',
          }}>
            {contact.company}
          </p>
        )}
      </div>

      {/* Swipe indicators */}
      {isTop && (
        <>
          {/* Left: Snooze */}
          <div style={{
            position: 'absolute',
            top: '50%',
            left: 24,
            transform: 'translateY(-50%) rotate(-20deg)',
            opacity: leftOpacity,
            pointerEvents: 'none',
          }}>
            <div style={{
              padding: '8px 16px',
              borderRadius: 'var(--radius-md)',
              border: '3px solid #A78BFA',
              color: '#A78BFA',
              fontSize: 18,
              fontWeight: 800,
              letterSpacing: '0.05em',
            }}>
              SNOOZE
            </div>
          </div>

          {/* Right: Skip */}
          <div style={{
            position: 'absolute',
            top: '50%',
            right: 24,
            transform: 'translateY(-50%) rotate(20deg)',
            opacity: rightOpacity,
            pointerEvents: 'none',
          }}>
            <div style={{
              padding: '8px 16px',
              borderRadius: 'var(--radius-md)',
              border: '3px solid #FBBF24',
              color: '#FBBF24',
              fontSize: 18,
              fontWeight: 800,
              letterSpacing: '0.05em',
            }}>
              SKIP
            </div>
          </div>
        </>
      )}
    </div>
  )
}
