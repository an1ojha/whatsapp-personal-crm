import { getDaysSince } from './dateUtils.js'

export function computeUrgencyScore(contact) {
  const baseline = contact.lastCaughtUp ?? contact.addedAt
  const daysSince = getDaysSince(baseline)
  const freq = contact.frequency || 14

  const overdueRatio = daysSince / freq
  const urgentMultiplier = contact.urgentPurpose ? 1.25 : 1.0
  const newBoost = contact.status === 'new' ? 0.15 : 0

  return overdueRatio * urgentMultiplier + newBoost
}

export function getStatusInfo(contact) {
  if (contact.status === 'new') {
    return { label: 'New', color: '#A78BFA' }
  }

  const daysSince = getDaysSince(contact.lastCaughtUp ?? contact.addedAt)
  const daysOverdue = Math.floor(daysSince - contact.frequency)

  if (daysOverdue <= 0) {
    return { label: 'Due today', color: '#34D399' }
  }
  if (daysOverdue === 1) {
    return { label: '1 day overdue', color: '#FBBF24' }
  }
  return { label: `${daysOverdue} days overdue`, color: '#F87171' }
}

export function getTodayStack(contacts, sessionSkipped = []) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayMs = today.getTime()

  const due = contacts.filter(c => {
    // If deferred to a future date, skip
    if (c.deferredUntil) {
      const deferDate = new Date(c.deferredUntil)
      deferDate.setHours(0, 0, 0, 0)
      if (deferDate.getTime() > todayMs) return false
    }
    // Force-include if explicitly added back to loop today
    if (c.loopAddedAt) {
      const addedToday = new Date(c.loopAddedAt).toDateString() === new Date().toDateString()
      if (addedToday) return true
    }
    const score = computeUrgencyScore(c)
    return score >= 1.0 || c.status === 'new'
  })

  // Sort by urgency desc, but session-skipped go to end
  const normal = due
    .filter(c => !sessionSkipped.includes(c.id))
    .sort((a, b) => computeUrgencyScore(b) - computeUrgencyScore(a))

  const skipped = due
    .filter(c => sessionSkipped.includes(c.id))
    .sort((a, b) => computeUrgencyScore(b) - computeUrgencyScore(a))

  return [...normal, ...skipped]
}
