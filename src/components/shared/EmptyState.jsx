export default function EmptyState({ weeklyCount }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      gap: 'var(--space-4)',
      padding: 'var(--space-8)',
      textAlign: 'center',
      animation: 'scaleIn 0.4s cubic-bezier(0.32, 0.72, 0, 1)',
    }}>
      <div style={{ fontSize: 72, lineHeight: 1, marginBottom: 'var(--space-2)' }}>🎉</div>
      <h2 style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.2 }}>
        You're all caught up!
      </h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: 16, maxWidth: 260, lineHeight: 1.6 }}>
        No one needs attention right now. Check back later.
      </p>

      {weeklyCount > 0 && (
        <div style={{
          marginTop: 'var(--space-4)',
          padding: 'var(--space-4) var(--space-6)',
          background: 'var(--accent-success-dim)',
          border: '1px solid rgba(52, 211, 153, 0.2)',
          borderRadius: 'var(--radius-lg)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'var(--space-1)',
        }}>
          <span style={{ fontSize: 32, fontWeight: 800, color: 'var(--accent-success)' }}>
            {weeklyCount}
          </span>
          <span style={{ fontSize: 13, color: 'var(--accent-success)', fontWeight: 500, opacity: 0.8 }}>
            {weeklyCount === 1 ? 'person' : 'people'} connected this week
          </span>
        </div>
      )}
    </div>
  )
}
