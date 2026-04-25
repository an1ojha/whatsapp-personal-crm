import { useMemo, useState } from 'react'
import FollowupsView from './views/FollowupsView.jsx'
import BirthdayView from './views/BirthdayView.jsx'
import ChatsTableView from './views/ChatsTableView.jsx'
import WatchlistPeopleView from './views/WatchlistPeopleView.jsx'
import ReviewsView from './views/ReviewsView.jsx'
import CallsView from './views/CallsView.jsx'
import SetupView from './views/SetupView.jsx'

const NAV_ITEMS = [
  { id: 'setup', label: 'Setup' },
  { id: 'assistant', label: 'Q&A' },
  { id: 'chats', label: 'Chats' },
  { id: 'followups', label: 'Follow-ups' },
  { id: 'calls', label: 'Calls' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'birthdays', label: 'Birthdays' },
  { id: 'people', label: 'People' },
]

export default function App() {
  const [activeTab, setActiveTab] = useState('setup')
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Ask me anything. I am connected to Anthropic via your local /api/chat endpoint.' },
  ])

  const canSend = input.trim().length > 0 && !sending

  async function onSend(e) {
    e?.preventDefault()
    if (!canSend) return
    const content = input.trim()
    const next = [...messages, { role: 'user', content }]
    setMessages(next)
    setInput('')
    setSending(true)
    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`)
      setMessages(prev => [...prev, { role: 'assistant', content: data?.message || '(empty response)' }])
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err?.message || 'Request failed'}` }])
    } finally {
      setSending(false)
    }
  }

  const body = useMemo(() => {
    if (activeTab === 'setup') return <SetupView />
    if (activeTab === 'assistant') {
      return (
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'assistant' ? 'msg-assistant' : 'msg-user'}>
              {m.content}
            </div>
          ))}
        </div>
      )
    }
    if (activeTab === 'chats') return <ChatsTableView />
    if (activeTab === 'followups') return <FollowupsView />
    if (activeTab === 'calls') return <CallsView />
    if (activeTab === 'reviews') return <ReviewsView />
    if (activeTab === 'birthdays') return <BirthdayView />
    if (activeTab === 'people') return <WatchlistPeopleView />
    return null
  }, [activeTab, messages])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div style={{ padding: '6px 8px 10px', fontWeight: 800, color: 'var(--text-primary)' }}>
          Personal CRM
        </div>
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            type="button"
            className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
            onClick={() => setActiveTab(item.id)}
          >
            {item.label}
          </button>
        ))}
        <div style={{ marginTop: 'auto', padding: '6px 8px', fontSize: 12, color: 'var(--text-tertiary)' }}>
          Light mode · ChatGPT-style layout
        </div>
      </aside>

      <main className="main-pane">
        <div className="main-scroll">
          <div style={{ maxWidth: 980, margin: '0 auto' }}>
            {body}
          </div>
        </div>
        {activeTab === 'assistant' && (
          <div className="chatbar-wrap">
            <form className="chatbar" onSubmit={onSend}>
              <textarea
                className="input-base"
                placeholder="Message assistant..."
                value={input}
                onChange={e => setInput(e.target.value)}
              />
              <button type="submit" className="primary-btn" disabled={!canSend}>
                {sending ? 'Sending...' : 'Send'}
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  )
}
