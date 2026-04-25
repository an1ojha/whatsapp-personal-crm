import { useState } from 'react'
import { useSettings } from '../hooks/useSettings.jsx'

export default function SettingsView() {
  const { settings, updateApiKey } = useSettings()
  const [key, setKey] = useState(settings.openaiApiKey || '')
  const [saved, setSaved] = useState(false)

  function handleSave(e) {
    e.preventDefault()
    updateApiKey(key.trim())
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div
      className="scroll-container"
      style={{
        height: '100%',
        padding: 'var(--space-6) var(--space-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-8)',
      }}
    >
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 6 }}>Settings</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
          Configure your Personal CRM experience
        </p>
      </div>

      {/* API Key Section */}
      <section
        style={{
          background: 'var(--bg-surface)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-6)',
          border: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-4)',
        }}
      >
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
            Anthropic API Key
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5 }}>
            Required for summaries and Q&A. Your key is stored locally and used only from this Mac.
          </p>
        </div>

        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <input
            className="input-base"
            type="password"
            value={key}
            onChange={e => setKey(e.target.value)}
            placeholder="sk-..."
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <button
            type="submit"
            style={{
              padding: '12px',
              borderRadius: 'var(--radius-md)',
              background: saved
                ? 'var(--accent-success-dim)'
                : 'linear-gradient(135deg, #A78BFA, #7C3AED)',
              color: saved ? 'var(--accent-success)' : '#fff',
              fontSize: 15,
              fontWeight: 600,
              transition: 'all 0.2s ease',
              border: saved ? '1px solid var(--accent-success)' : 'none',
            }}
          >
            {saved ? '✓ Saved' : 'Save API Key'}
          </button>
        </form>

        {settings.openaiApiKey && (
          <p style={{ fontSize: 12, color: 'var(--accent-success)' }}>
            ✓ API key is set
          </p>
        )}
      </section>

      {/* About */}
      <section
        style={{
          background: 'var(--bg-surface)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-6)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 'var(--space-3)' }}>
          About
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <Row label="App" value="WhatsApp Personal CRM" />
          <Row label="Version" value="1.0.0" />
          <Row label="Storage" value="Local only — no cloud" />
          <Row label="Data" value="All stored on this device" />
        </div>
      </section>

      {/* Data Management */}
      <section
        style={{
          background: 'var(--bg-surface)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-6)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Data</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 'var(--space-4)' }}>
          All your contacts are stored in your browser's local storage.
        </p>
        <button
          onClick={() => {
            if (window.confirm('Delete all contacts? This cannot be undone.')) {
              localStorage.removeItem('whatsapp_crm_contacts')
              localStorage.removeItem('whatsapp_crm_tutorial_dismissed')
              window.location.reload()
            }
          }}
          style={{
            padding: '10px 16px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--accent-danger-dim)',
            color: 'var(--accent-danger)',
            fontSize: 14,
            fontWeight: 500,
            border: '1px solid rgba(248,113,113,0.2)',
          }}
        >
          Clear all data
        </button>
      </section>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 500 }}>{value}</span>
    </div>
  )
}
