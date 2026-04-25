import { createContext, useContext, useState, useCallback } from 'react'
import { getSettings, setSettings } from '../utils/storage.js'

const SettingsContext = createContext(null)

export function SettingsProvider({ children }) {
  const [settings, setSettingsState] = useState(() => getSettings())

  const updateApiKey = useCallback((key) => {
    const next = { ...settings, openaiApiKey: key }
    setSettingsState(next)
    setSettings(next)
  }, [settings])

  return (
    <SettingsContext.Provider value={{ settings, updateApiKey }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}
