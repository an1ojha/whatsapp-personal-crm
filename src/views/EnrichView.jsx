import { useState, useEffect, useRef, useCallback } from 'react'
import { useLinkedInEnrichments } from '../hooks/useLinkedInEnrichments.jsx'
import { useContacts } from '../hooks/useContacts.jsx'
import { createContactFromLinkedIn } from '../utils/linkedinContact.js'
import { getContacts } from '../utils/storage.js'
import EnrichListView from '../components/enrich/EnrichListView.jsx'
import EnrichDetailView from '../components/enrich/EnrichDetailView.jsx'

export default function EnrichView({ onClose }) {
  const {
    profiles, isLoading, fetchError,
    totalCount, reviewedCount,
    isReviewed, getEnrichment,
    submitEnrichment, skipProfile,
    getAllEnrichments,
  } = useLinkedInEnrichments()

  const { state: { contacts }, dispatch } = useContacts()

  // view: 'list' | 'detail'
  const [view, setView] = useState('list')
  const [selectedProfile, setSelectedProfile] = useState(null)
  const [selectedList, setSelectedList] = useState([])
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Sheet animation — delay backdrop pointer-events to prevent tap-through
  const [visible, setVisible] = useState(false)
  const [backdropActive, setBackdropActive] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setVisible(true)
      setTimeout(() => setBackdropActive(true), 400)
    })
    return () => cancelAnimationFrame(raf)
  }, [])

  // One-time migration (StrictMode-safe via ref guard):
  // 1. Remove duplicate contacts with the same linkedinUrl (keep first occurrence)
  // 2. Create contacts for any existing enrichments that don't have a matching contact
  const migrationDone = useRef(false)
  useEffect(() => {
    if (isLoading || profiles.length === 0) return
    if (migrationDone.current) return
    migrationDone.current = true

    // Read contacts fresh from localStorage to avoid stale closure
    const freshContacts = getContacts()

    // Step 1: dedup — remove contacts with duplicate linkedinUrl (keep first)
    const urlSeen = new Set()
    for (const c of freshContacts) {
      if (!c.linkedinUrl) continue
      if (urlSeen.has(c.linkedinUrl)) {
        dispatch({ type: 'DELETE_CONTACT', payload: c.id })
      } else {
        urlSeen.add(c.linkedinUrl)
      }
    }

    // Step 2: add missing enriched profiles as contacts
    const { enrichments } = getAllEnrichments()
    for (const [url, enrichment] of Object.entries(enrichments)) {
      if (enrichment.skipped) continue
      if (urlSeen.has(url)) continue // already a contact
      const profile = profiles.find(p => p.url === url)
      if (!profile) continue
      const contact = createContactFromLinkedIn(profile, enrichment)
      dispatch({ type: 'ADD_CONTACT', payload: contact })
      urlSeen.add(url)
    }
  }, [isLoading, profiles.length])

  const handleClose = useCallback(() => {
    setVisible(false)
    setTimeout(onClose, 350)
  }, [onClose])

  const handleSelect = (profile, list, idx) => {
    setSelectedProfile(profile)
    setSelectedList(list)
    setSelectedIndex(idx)
    setView('detail')
  }

  const handleNavigate = (profile, list, idx) => {
    setSelectedProfile(profile)
    setSelectedList(list)
    setSelectedIndex(idx)
  }

  const handleBack = () => setView('list')

  const handleSave = (url, data) => {
    submitEnrichment(url, data)

    // Add to People if not already a contact
    const profile = profiles.find(p => p.url === url)
    const alreadyAdded = contacts.some(c => c.linkedinUrl === url)
    if (profile && !alreadyAdded) {
      const contact = createContactFromLinkedIn(profile, { ...data, skipped: false, reviewedAt: new Date().toISOString() })
      dispatch({ type: 'ADD_CONTACT', payload: contact })
    }

    advanceToNext()
  }

  const handleSkip = (url) => {
    skipProfile(url)
    advanceToNext()
  }

  const advanceToNext = () => {
    const nextIdx = selectedIndex + 1
    if (nextIdx < selectedList.length) {
      setSelectedProfile(selectedList[nextIdx])
      setSelectedIndex(nextIdx)
    } else {
      setView('list')
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
    }}>
      {/* Backdrop */}
      <div
        onClick={backdropActive ? handleClose : undefined}
        style={{
          position: 'absolute', inset: 0,
          background: 'rgba(0,0,0,0.6)',
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.35s ease',
          pointerEvents: backdropActive ? 'auto' : 'none',
        }}
      />

      {/* Sheet */}
      <div style={{
        position: 'relative', zIndex: 1,
        background: 'var(--bg-surface)',
        borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0',
        boxShadow: 'var(--shadow-sheet)',
        height: '94vh',
        display: 'flex', flexDirection: 'column',
        transform: visible ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)',
        overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', justifyContent: 'center', padding: 'var(--space-3) 0 var(--space-1)',
          flexShrink: 0,
        }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border-default)' }} />
        </div>

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {isLoading ? (
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 'var(--space-3)',
              color: 'var(--text-secondary)',
            }}>
              <div style={{
                width: 32, height: 32, border: '3px solid var(--border-default)',
                borderTopColor: 'var(--accent-primary)', borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }} />
              <p style={{ fontSize: 15 }}>Loading connections…</p>
            </div>
          ) : fetchError ? (
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 'var(--space-3)',
              padding: 'var(--space-6)', textAlign: 'center',
            }}>
              <span style={{ fontSize: 36 }}>⚠️</span>
              <p style={{ fontSize: 16, fontWeight: 600 }}>Couldn't load data</p>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{fetchError}</p>
              <button onClick={handleClose} style={{
                marginTop: 'var(--space-3)', padding: 'var(--space-3) var(--space-5)',
                borderRadius: 'var(--radius-md)', background: 'var(--bg-elevated)',
                color: 'var(--text-primary)', fontSize: 15, fontWeight: 600,
              }}>
                Close
              </button>
            </div>
          ) : view === 'list' ? (
            <EnrichListView
              profiles={profiles}
              isReviewed={isReviewed}
              reviewedCount={reviewedCount}
              totalCount={totalCount}
              onSelect={handleSelect}
              onClose={handleClose}
            />
          ) : (
            <EnrichDetailView
              profile={selectedProfile}
              listIndex={selectedIndex}
              list={selectedList}
              getEnrichment={getEnrichment}
              onSave={handleSave}
              onSkip={handleSkip}
              onBack={handleBack}
              onNavigate={handleNavigate}
            />
          )}
        </div>
      </div>
    </div>
  )
}
