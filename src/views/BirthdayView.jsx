const WISHES = []

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmtDate(iso) {
  const d = new Date(iso)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

export default function BirthdayView() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Header */}
      <div style={{ padding: 'var(--space-5) var(--space-4) var(--space-3)', flexShrink: 0 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 2 }}>Birthday Wishes</h1>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Birthday reminders are generated locally after you sync WhatsApp.
        </p>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 var(--space-4)', paddingBottom: 80 }}>

        {/* Column headers */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '160px 100px 1fr',
          gap: '0 16px',
          padding: '6px 12px',
          marginBottom: 4,
        }}>
          {['Name', 'Date', 'Message'].map(h => (
            <span key={h} style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
              textTransform: 'uppercase', color: 'var(--text-tertiary)',
            }}>{h}</span>
          ))}
        </div>

        {!WISHES.length && (
          <div style={{ padding: 16, color: 'var(--text-secondary)', borderTop: '1px solid var(--border-subtle)' }}>
            No birthday data yet. Run setup and sync to generate local data.
          </div>
        )}
        {WISHES.map((w, i) => (
          <div
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: '160px 100px 1fr',
              gap: '0 16px',
              padding: '10px 12px',
              borderTop: i === 0 ? '1px solid var(--border-subtle)' : 'none',
              borderBottom: '1px solid var(--border-subtle)',
              alignItems: 'start',
            }}
          >
            {/* Name */}
            <div>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                {w.name}
              </span>
              {w.chat && (
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>
                  {w.chat}
                </div>
              )}
            </div>

            {/* Date */}
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', paddingTop: 1 }}>
              {fmtDate(w.date)}
            </span>

            {/* Message */}
            <span style={{
              fontSize: 13, color: 'var(--text-primary)',
              lineHeight: 1.5, paddingTop: 1,
            }}>
              {w.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
