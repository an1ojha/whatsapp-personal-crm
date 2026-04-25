// Bottom navigation with 3 tabs + center FAB

const TodayIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
)

const PeopleIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
)

const SettingsIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
)

const PlusIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19"/>
    <line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
)

const FollowupsIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
    <polyline points="22 4 12 14.01 9 11.01"/>
  </svg>
)

const BirthdayIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
    <path d="M12 2c0 0-2 1.5-2 3s2 3 2 3 2-1.5 2-3-2-3-2-3z" strokeWidth="1.5"/>
  </svg>
)

const tabs = [
  { id: 'today',     label: 'Today',     Icon: TodayIcon },
  { id: 'people',    label: 'People',    Icon: PeopleIcon },
  { id: 'followups', label: 'Follow-ups',Icon: FollowupsIcon },
  { id: 'birthdays', label: 'Birthdays', Icon: BirthdayIcon },
  { id: 'settings',  label: 'Settings',  Icon: SettingsIcon },
]

export default function BottomNav({ activeTab, onTabChange, onAddTap }) {
  return (
    <nav
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-around',
        height: 'var(--nav-height)',
        background: 'var(--bg-surface)',
        borderTop: '1px solid var(--border-subtle)',
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        paddingBottom: 'env(safe-area-inset-bottom)',
        zIndex: 40,
      }}
    >
      {/* Left tabs (Today, People) */}
      {tabs.slice(0, 2).map(({ id, label, Icon }) => (
        <NavTab
          key={id}
          id={id}
          label={label}
          Icon={Icon}
          active={activeTab === id}
          onTabChange={onTabChange}
        />
      ))}

      {/* Center FAB */}
      <button
        onClick={onAddTap}
        aria-label="Add contact"
        style={{
          width: 48,
          height: 48,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #A78BFA, #7C3AED)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 20px rgba(124, 58, 237, 0.5)',
          flexShrink: 0,
          transition: 'transform 0.15s ease, box-shadow 0.15s ease',
        }}
        onPointerDown={e => e.currentTarget.style.transform = 'scale(0.92)'}
        onPointerUp={e => e.currentTarget.style.transform = ''}
        onPointerLeave={e => e.currentTarget.style.transform = ''}
      >
        <PlusIcon />
      </button>

      {/* Right tabs (Follow-ups, Birthdays, Settings) */}
      {tabs.slice(2).map(({ id, label, Icon }) => (
        <NavTab
          key={id}
          id={id}
          label={label}
          Icon={Icon}
          active={activeTab === id}
          onTabChange={onTabChange}
        />
      ))}
    </nav>
  )
}

function NavTab({ id, label, Icon, active, onTabChange }) {
  return (
    <button
      onClick={() => onTabChange(id)}
      aria-label={label}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 3,
        padding: '8px 8px',
        color: active ? 'var(--accent-primary)' : 'var(--text-tertiary)',
        transition: 'color 0.15s ease',
        flex: 1,
      }}
    >
      <Icon />
      <span style={{ fontSize: 9, fontWeight: 500, letterSpacing: '0.01em' }}>
        {label}
      </span>
    </button>
  )
}
