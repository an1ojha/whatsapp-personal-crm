const KEYS = {
  CONTACTS: 'whatsapp_crm_contacts',
  TUTORIAL_DISMISSED: 'whatsapp_crm_tutorial_dismissed',
  SETTINGS: 'whatsapp_crm_settings',
  WEEKLY_COUNT: 'whatsapp_crm_weekly_count',
  LINKEDIN_ENRICHMENTS: 'whatsapp_crm_linkedin_enrichments',
}

export function getContacts() {
  try {
    const raw = localStorage.getItem(KEYS.CONTACTS)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function setContacts(contacts) {
  try {
    localStorage.setItem(KEYS.CONTACTS, JSON.stringify(contacts))
  } catch (e) {
    if (e.name === 'QuotaExceededError' || e.code === 22) {
      throw new Error('Storage full. Try removing a contact with a large photo.')
    }
    throw e
  }
}

export function getTutorialDismissed() {
  return localStorage.getItem(KEYS.TUTORIAL_DISMISSED) === 'true'
}

export function setTutorialDismissed(value) {
  localStorage.setItem(KEYS.TUTORIAL_DISMISSED, String(value))
}

export function getSettings() {
  try {
    const raw = localStorage.getItem(KEYS.SETTINGS)
    return raw ? JSON.parse(raw) : { openaiApiKey: '' }
  } catch {
    return { openaiApiKey: '' }
  }
}

export function setSettings(settings) {
  localStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings))
}

export function getLinkedInEnrichments() {
  try {
    const raw = localStorage.getItem(KEYS.LINKEDIN_ENRICHMENTS)
    return raw ? JSON.parse(raw) : { reviewedUrls: [], enrichments: {} }
  } catch {
    return { reviewedUrls: [], enrichments: {} }
  }
}

export function setLinkedInEnrichments(data) {
  try {
    localStorage.setItem(KEYS.LINKEDIN_ENRICHMENTS, JSON.stringify(data))
  } catch (e) {
    if (e.name === 'QuotaExceededError' || e.code === 22) {
      throw new Error('Storage full. Try clearing some enrichment data.')
    }
    throw e
  }
}
