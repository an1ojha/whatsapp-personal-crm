import { useState, useCallback } from 'react'
import { useContacts } from '../hooks/useContacts.jsx'
import { getTodayStack } from '../utils/urgency.js'
import { getWeeklyCatchupCount } from '../utils/dateUtils.js'
import CardStack from '../components/cards/CardStack.jsx'
import EmptyState from '../components/shared/EmptyState.jsx'
import SuccessAnimation from '../components/shared/SuccessAnimation.jsx'
import TutorialModal from '../components/shared/TutorialModal.jsx'
import ContactProfile from '../components/contact/ContactProfile.jsx'

export default function TodayView() {
  const { state, dispatch } = useContacts()
  const [sessionSkipped, setSessionSkipped] = useState([])
  const [showSuccess, setShowSuccess] = useState(false)
  const [profileContact, setProfileContact] = useState(null)

  const stack = getTodayStack(state.contacts, sessionSkipped)
  const weeklyCount = getWeeklyCatchupCount(state.contacts)

  // Tutorial shows as an overlay modal the first time the user has contacts
  const showTutorial = !state.tutorialDismissed && state.contacts.length > 0

  const handleSwipeLeft = useCallback((contact) => {
    dispatch({ type: 'SNOOZE_CONTACT', payload: contact.id })
    setShowSuccess(true)
  }, [dispatch])

  const handleSwipeRight = useCallback((contact) => {
    dispatch({ type: 'SKIP_CONTACT', payload: contact.id })
    setSessionSkipped(prev => [...prev, contact.id])
  }, [dispatch])

  const handleTap = useCallback((contact) => {
    setProfileContact(contact)
  }, [])

  const handleDismissTutorial = useCallback(() => {
    dispatch({ type: 'DISMISS_TUTORIAL' })
  }, [dispatch])

  const isEmpty = state.contacts.length === 0
  const allCaughtUp = !isEmpty && stack.length === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 'var(--space-5) var(--space-4) var(--space-3)',
        flexShrink: 0,
      }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800 }}>Today</h1>
          {stack.length > 0 && (
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
              {stack.length} {stack.length === 1 ? 'person' : 'people'} to catch up with
            </p>
          )}
        </div>
        {weeklyCount > 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            background: 'var(--accent-success-dim)',
            borderRadius: 'var(--radius-full)',
            border: '1px solid rgba(52,211,153,0.2)',
          }}>
            <span style={{ fontSize: 14 }}>✓</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-success)' }}>
              {weeklyCount} this week
            </span>
          </div>
        )}
      </div>

      {/* Card area */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {isEmpty ? (
          <FirstRunState />
        ) : allCaughtUp ? (
          <EmptyState weeklyCount={weeklyCount} />
        ) : (
          <div style={{ position: 'absolute', inset: '12px 16px 16px' }}>
            <CardStack
              contacts={stack}
              onSwipeLeft={handleSwipeLeft}
              onSwipeRight={handleSwipeRight}
              onTap={handleTap}
            />
          </div>
        )}
      </div>

      {/* Tutorial modal — shown on top, doesn't block card view */}
      {showTutorial && (
        <TutorialModal onDismiss={handleDismissTutorial} />
      )}

      {showSuccess && (
        <SuccessAnimation onDone={() => setShowSuccess(false)} />
      )}

      {profileContact && (
        <ContactProfile
          contact={profileContact}
          onClose={() => setProfileContact(null)}
        />
      )}
    </div>
  )
}

function FirstRunState() {
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
    }}>
      <div style={{ fontSize: 64, lineHeight: 1, marginBottom: 'var(--space-2)' }}>🔗</div>
      <h2 style={{ fontSize: 26, fontWeight: 800 }}>Your loop awaits</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: 15, maxWidth: 280, lineHeight: 1.6 }}>
        Tap + to add your first contact. Upload a WhatsApp screenshot and GPT-4o will extract their details.
      </p>
    </div>
  )
}
