// Converts a LinkedIn profile + enrichment record into a CRM contact object

const TIMING_TO_FREQUENCY = {
  asap: 7,
  month: 30,
  quarter: 90,
  year: 365,
}

// Map enrichment interaction modes to catchupModes values
const MODE_MAP = {
  coffee: 'in-person',
  video: 'virtual',
  phone: 'virtual',
  text: 'text',
  email: 'email',
  linkedin: 'linkedin',
}

export function createContactFromLinkedIn(profile, enrichment) {
  const frequency = TIMING_TO_FREQUENCY[enrichment.nextTalkTiming] || 90
  const rawModes = (enrichment.interactionModes || []).map(m => MODE_MAP[m] || m)
  const catchupModes = [...new Set(rawModes)]

  const noteParts = []
  if (enrichment.relationshipNote) noteParts.push(enrichment.relationshipNote)
  if (profile.reason) noteParts.push(`LinkedIn signal: ${profile.reason}`)

  return {
    id: crypto.randomUUID(),
    name: profile.name || '',
    phone: '',
    company: [profile.position, profile.company].filter(Boolean).join(' @ '),
    category: profile.role_tag || '',
    catchupModes,
    catchupMode: catchupModes.join(', '),
    frequency,
    urgentPurpose: enrichment.nextTalkReason || '',
    notes: noteParts.join('\n\n'),
    linkedinUrl: profile.url,
    photo: '',
    status: 'new',
    lastCaughtUp: null,
    addedAt: enrichment.reviewedAt || new Date().toISOString(),
    deferredUntil: null,
    loopAddedAt: null,
  }
}
