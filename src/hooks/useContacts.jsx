import { createContext, useContext, useReducer, useEffect } from 'react'
import { getContacts, setContacts, getTutorialDismissed, setTutorialDismissed } from '../utils/storage.js'

const ContactsContext = createContext(null)

function reducer(state, action) {
  switch (action.type) {
    case 'ADD_CONTACT': {
      return { ...state, contacts: [...state.contacts, action.payload] }
    }
    case 'UPDATE_CONTACT': {
      return {
        ...state,
        contacts: state.contacts.map(c =>
          c.id === action.payload.id ? { ...c, ...action.payload.changes } : c
        ),
      }
    }
    case 'DELETE_CONTACT': {
      return {
        ...state,
        contacts: state.contacts.filter(c => c.id !== action.payload),
      }
    }
    case 'MARK_CAUGHT_UP':
    case 'SNOOZE_CONTACT': {
      return {
        ...state,
        contacts: state.contacts.map(c =>
          c.id === action.payload
            ? { ...c, lastCaughtUp: new Date().toISOString(), status: 'active', deferredUntil: null, loopAddedAt: null }
            : c
        ),
      }
    }
    case 'SKIP_CONTACT': {
      return {
        ...state,
        contacts: state.contacts.map(c =>
          c.id === action.payload
            ? { ...c, deferredUntil: new Date().toISOString(), loopAddedAt: null }
            : c
        ),
      }
    }
    case 'ADD_TO_LOOP': {
      // Force contact into today's stack via loopAddedAt timestamp
      return {
        ...state,
        contacts: state.contacts.map(c =>
          c.id === action.payload.id
            ? {
                ...c,
                deferredUntil: null,
                loopAddedAt: new Date().toISOString(),
                urgentPurpose: action.payload.note !== undefined
                  ? action.payload.note
                  : c.urgentPurpose,
              }
            : c
        ),
      }
    }
    case 'DISMISS_TUTORIAL': {
      return { ...state, tutorialDismissed: true }
    }
    default:
      return state
  }
}

export function ContactsProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, null, () => ({
    contacts: getContacts(),
    tutorialDismissed: getTutorialDismissed(),
  }))

  useEffect(() => {
    try {
      setContacts(state.contacts)
    } catch (e) {
      alert(e.message)
    }
  }, [state.contacts])

  useEffect(() => {
    setTutorialDismissed(state.tutorialDismissed)
  }, [state.tutorialDismissed])

  return (
    <ContactsContext.Provider value={{ state, dispatch }}>
      {children}
    </ContactsContext.Provider>
  )
}

export function useContacts() {
  const ctx = useContext(ContactsContext)
  if (!ctx) throw new Error('useContacts must be used within ContactsProvider')
  return ctx
}
