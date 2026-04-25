export function getDaysSince(isoDate) {
  if (!isoDate) return Infinity
  const then = new Date(isoDate).getTime()
  const now = Date.now()
  return (now - then) / (1000 * 60 * 60 * 24)
}

export function getMostRecentMonday() {
  const now = new Date()
  const day = now.getDay() // 0=Sun, 1=Mon ...
  const diff = day === 0 ? 6 : day - 1
  const monday = new Date(now)
  monday.setDate(now.getDate() - diff)
  monday.setHours(0, 0, 0, 0)
  return monday
}

export function getWeeklyCatchupCount(contacts) {
  const monday = getMostRecentMonday()
  return contacts.filter(c => {
    if (!c.lastCaughtUp) return false
    return new Date(c.lastCaughtUp) >= monday
  }).length
}

export function formatLastCaughtUp(isoDate) {
  if (!isoDate) return 'Never'
  const days = Math.floor(getDaysSince(isoDate))
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 14) return '1 week ago'
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`
  return `${Math.floor(days / 30)} months ago`
}
