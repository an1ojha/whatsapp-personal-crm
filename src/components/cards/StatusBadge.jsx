export default function StatusBadge({ label, color }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '4px 10px',
        borderRadius: 'var(--radius-full)',
        fontSize: 11,
        fontWeight: 700,
        color: color,
        background: color + '33',
        border: `1px solid ${color}55`,
        letterSpacing: '0.02em',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
    >
      {label}
    </div>
  )
}
