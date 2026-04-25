// NAV_HEIGHT must match --nav-height in index.css (64px) + safe-area-inset-bottom
const NAV_HEIGHT = 'calc(var(--nav-height) + env(safe-area-inset-bottom))'

export default function AppShell({ children }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        paddingTop: 'env(safe-area-inset-top)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
        // Reserve space at bottom for the fixed nav bar
        paddingBottom: NAV_HEIGHT,
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  )
}
