import { useEffect, useMemo, useRef, useState } from 'react'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtDate(raw) {
  const value = String(raw || '').trim()
  if (/^\d{2}-[A-Za-z]{3}$/.test(value)) {
    const dd = Number(value.slice(0, 2))
    const mon = `${value.slice(3, 4).toUpperCase()}${value.slice(4).toLowerCase()}`
    if (dd >= 1 && dd <= 31 && MONTHS.includes(mon)) return `${dd.toString().padStart(2, '0')}-${mon}`
    return value
  }
  if (/^\d{2}-\d{2}$/.test(value)) {
    const [mm, dd] = value.split('-').map(Number)
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) return `${dd.toString().padStart(2, '0')}-${MONTHS[mm - 1]}`
    return value
  }
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value || ''
  return `${String(d.getDate()).padStart(2, '0')}-${MONTHS[d.getMonth()]}`
}

function rowId(item) {
  const src = item?._source || 'dm'
  const jid = String(item?.chat_person_jid || item?.jid || '').trim()
  const pk = String(item?.reference_pk ?? '').trim()
  if (jid && pk) return `${src}::${jid}::${pk}`
  return `${src}::fallback::${JSON.stringify({ jid, pk, name: item?.chat_person_name })}`
}

function confidenceFor(item) {
  const parsed = Number(item?.confidence ?? 0)
  if (Number.isFinite(parsed) && parsed < 0) return -1
  const name = String(item?.birthday_person_name || '').trim().toLowerCase()
  if (!name || name === 'unknown') return 0
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.min(1, parsed))
}

function parseBirthdayMonthDay(raw) {
  const value = String(raw || '').trim()
  const m = value.match(/^(\d{2})-([A-Za-z]{3})$/)
  if (!m) return null
  const day = Number(m[1])
  const monthIndex = MONTHS.findIndex(mon => mon.toLowerCase() === m[2].toLowerCase())
  if (monthIndex < 0 || day < 1 || day > 31) return null
  return { day, monthIndex }
}

function birthdayDistanceFromToday(raw, now = new Date()) {
  const parsed = parseBirthdayMonthDay(raw)
  if (!parsed) return Number.POSITIVE_INFINITY
  const todayMonth = now.getMonth()
  const todayDay = now.getDate()
  const todayOrd = todayMonth * 31 + todayDay
  const bdayOrd = parsed.monthIndex * 31 + parsed.day
  const absDiff = Math.abs(bdayOrd - todayOrd)
  const cycle = 12 * 31
  return Math.min(absDiff, cycle - absDiff)
}

function buildDraftsFromItems(list, source) {
  return list.reduce((acc, item) => {
    const tagged = { ...item, _source: source }
    acc[rowId(tagged)] = {
      birthday_person_name: String(item?.birthday_person_name || 'Unknown'),
      date: fmtDate(item?.date),
    }
    return acc
  }, {})
}

export default function BirthdayView() {
  const [dmItems, setDmItems] = useState([])
  const [groupItems, setGroupItems] = useState([])
  const [dmGeneratedAt, setDmGeneratedAt] = useState(null)
  const [groupGeneratedAt, setGroupGeneratedAt] = useState(null)
  const [showGroupBirthdays, setShowGroupBirthdays] = useState(false)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [drafts, setDrafts] = useState({})
  const [savingIds, setSavingIds] = useState({})
  const [reminderIds, setReminderIds] = useState({})
  const unmountedRef = useRef(false)

  async function loadBirthdays() {
    setLoading(true)
    try {
      const [rDm, rGroup] = await Promise.all([
        fetch('/api/birthdays', { cache: 'no-store' }),
        fetch('/api/birthdays/groups', { cache: 'no-store' }),
      ])
      const dataDm = await rDm.json().catch(() => ({}))
      const dataGroup = await rGroup.json().catch(() => ({}))
      if (!rDm.ok) throw new Error(dataDm?.error || `HTTP ${rDm.status}`)
      if (!rGroup.ok) throw new Error(dataGroup?.error || `HTTP ${rGroup.status}`)
      if (unmountedRef.current) return

      const nextDm = Array.isArray(dataDm?.items) ? dataDm.items : []
      const nextGroup = Array.isArray(dataGroup?.items) ? dataGroup.items : []
      setDmItems(nextDm)
      setGroupItems(nextGroup)
      setDmGeneratedAt(dataDm?.generated_at || null)
      setGroupGeneratedAt(dataGroup?.generated_at || null)
      setDrafts({
        ...buildDraftsFromItems(nextDm, 'dm'),
        ...buildDraftsFromItems(nextGroup, 'group'),
      })
      setError('')
    } catch (e) {
      if (unmountedRef.current) return
      setDmItems([])
      setGroupItems([])
      setDmGeneratedAt(null)
      setGroupGeneratedAt(null)
      setError(e?.message || 'Failed to load birthdays')
    } finally {
      if (!unmountedRef.current) setLoading(false)
    }
  }

  async function waitForBirthdayDone() {
    while (!unmountedRef.current) {
      const r = await fetch('/api/birthdays/status', { cache: 'no-store' })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`)
      setStatus(data)
      if (!data?.running) {
        if (data?.status === 'error') throw new Error(data?.error || 'Birthday generation failed')
        return
      }
      await new Promise(resolve => setTimeout(resolve, 1200))
    }
  }

  async function onGenerate() {
    setGenerating(true)
    setError('')
    setMessage('')
    try {
      const r = await fetch('/api/sync-birthdays', { method: 'POST' })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`)
      setStatus(data)
      await waitForBirthdayDone()
      await loadBirthdays()
      setMessage('Birthdays generated (DM + group chats).')
    } catch (e) {
      setError(e?.message || 'Failed to generate birthdays')
    } finally {
      if (!unmountedRef.current) setGenerating(false)
    }
  }

  useEffect(() => {
    unmountedRef.current = false
    loadBirthdays()
    return () => {
      unmountedRef.current = true
    }
  }, [])

  const displayItems = useMemo(() => {
    const dm = dmItems.map(row => ({ ...row, _source: 'dm' }))
    if (!showGroupBirthdays) return dm
    const gr = groupItems.map(row => ({ ...row, _source: 'group' }))
    return [...dm, ...gr]
  }, [dmItems, groupItems, showGroupBirthdays])

  const sortedItems = useMemo(() => {
    return [...displayItems].sort((a, b) => {
      const aConf = confidenceFor(a)
      const bConf = confidenceFor(b)
      const aLow = aConf < 0
      const bLow = bConf < 0
      if (aLow !== bLow) return aLow ? 1 : -1
      const aDist = birthdayDistanceFromToday(a?.date)
      const bDist = birthdayDistanceFromToday(b?.date)
      if (aDist !== bDist) return aDist - bDist
      const confDiff = bConf - aConf
      if (confDiff !== 0) return confDiff
      return String(a?.chat_person_name || '').localeCompare(String(b?.chat_person_name || ''))
    })
  }, [displayItems])

  async function saveRow(item) {
    if (item._source === 'group') return
    const id = rowId(item)
    const draft = drafts[id]
    if (!draft) return
    setSavingIds(prev => ({ ...prev, [id]: true }))
    setError('')
    setMessage('')
    try {
      const r = await fetch('/api/birthdays/update', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_person_jid: item?.chat_person_jid || item?.jid || '',
          reference_pk: item?.reference_pk,
          birthday_person_name: draft.birthday_person_name,
          date: draft.date,
        }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`)
      const updated = data?.item
      setDmItems(prev => prev.map(row => {
        if (String(row?.chat_person_jid) !== String(updated?.chat_person_jid)) return row
        if (String(row?.reference_pk ?? '') !== String(updated?.reference_pk ?? '')) return row
        return { ...row, ...updated }
      }))
      setMessage('Birthday row updated.')
    } catch (e) {
      setError(e?.message || 'Failed to save birthday row')
    } finally {
      if (!unmountedRef.current) {
        setSavingIds(prev => {
          const next = { ...prev }
          delete next[id]
          return next
        })
      }
    }
  }

  async function setReminder(item) {
    const id = rowId(item)
    const draft = drafts[id]
    if (!draft) return
    setReminderIds(prev => ({ ...prev, [id]: true }))
    setError('')
    setMessage('')
    try {
      const r = await fetch('/api/birthdays/reminder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          birthday_person_name: draft.birthday_person_name,
          date: draft.date,
        }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`)
      setMessage('Reminder set in Google Calendar.')
    } catch (e) {
      setError(e?.message || 'Failed to set reminder')
    } finally {
      if (!unmountedRef.current) {
        setReminderIds(prev => {
          const next = { ...prev }
          delete next[id]
          return next
        })
      }
    }
  }

  const scopeLabel = status?.scope === 'group' ? 'Group chats' : 'DM chats'
  const hasAnyRows = dmItems.length > 0 || groupItems.length > 0
  const hasGroupOnly = dmItems.length === 0 && groupItems.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: 'var(--space-5) var(--space-4) var(--space-3)', flexShrink: 0 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 2 }}>Birthday Wishes</h1>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Search DM and group chats for birthday references, then resolve person/date using AI. Generate runs both; use the toggle to list group results.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating}
            style={{
              border: '1px solid var(--border-subtle)',
              background: generating ? 'var(--bg-card)' : 'var(--bg-elevated)',
              color: generating ? 'var(--text-tertiary)' : 'var(--text-primary)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 12,
              fontWeight: 600,
              padding: '6px 10px',
            }}
          >
            {generating ? 'Generating…' : 'Generate birthdays'}
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showGroupBirthdays}
              onChange={e => setShowGroupBirthdays(e.target.checked)}
            />
            Show group chat birthdays
          </label>
        </div>
        {(dmGeneratedAt || groupGeneratedAt) && (
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 6 }}>
            {dmGeneratedAt && <span>DM data: {new Date(dmGeneratedAt).toLocaleString()}</span>}
            {dmGeneratedAt && groupGeneratedAt && ' · '}
            {groupGeneratedAt && <span>Group data: {new Date(groupGeneratedAt).toLocaleString()}</span>}
          </p>
        )}
        {message && <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 8 }}>{message}</p>}
        {generating && status?.phase === 'scan' && (
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
            {scopeLabel}: went over {status?.chats_done || 0} chats, found {status?.refs_found || 0} references, {status?.chats_left || 0} chats left.
          </p>
        )}
        {generating && status?.phase === 'adjudicate' && (
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
            {scopeLabel}: reviewed {status?.refs_done || 0} of {status?.refs_total || 0} references, {status?.rows_ready || 0} rows ready.
          </p>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 var(--space-4)', paddingBottom: 80 }}>
        {error && (
          <div style={{ padding: 12, color: 'var(--text-secondary)', borderTop: '1px solid var(--border-subtle)' }}>
            {error}
          </div>
        )}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '160px 180px 110px 1fr 72px 118px',
          gap: '0 16px',
          padding: '6px 12px',
          marginBottom: 4,
        }}>
          {['Chat Person', 'Birthday Person', 'Birthday Date', 'Reference Message', 'Save', 'Reminder'].map(h => (
            <span key={h} style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
              textTransform: 'uppercase', color: 'var(--text-tertiary)',
            }}>{h}</span>
          ))}
        </div>

        {!loading && !error && !hasAnyRows && (
          <div style={{ padding: 16, color: 'var(--text-secondary)', borderTop: '1px solid var(--border-subtle)' }}>
            {(dmGeneratedAt || groupGeneratedAt) ? 'Generation completed but no birthdays were detected.' : 'No birthday data yet. Click Generate birthdays.'}
          </div>
        )}
        {!loading && !error && hasGroupOnly && !showGroupBirthdays && (
          <div style={{ padding: 12, color: 'var(--text-secondary)', fontSize: 13, borderTop: '1px solid var(--border-subtle)' }}>
            No DM birthday rows. Turn on <strong>Show group chat birthdays</strong> to see group results.
          </div>
        )}
        {sortedItems.map((item, i) => (
          (() => {
            const id = rowId(item)
            const draft = drafts[id] || {
              birthday_person_name: String(item?.birthday_person_name || 'Unknown'),
              date: fmtDate(item?.date),
            }
            const rowConfidence = confidenceFor(item)
            const isGroup = item._source === 'group'
            return (
          <div
            key={id}
            style={{
              display: 'grid',
              gridTemplateColumns: '160px 180px 110px 1fr 72px 118px',
              gap: '0 16px',
              padding: '10px 12px',
              borderTop: i === 0 ? '1px solid var(--border-subtle)' : 'none',
              borderBottom: '1px solid var(--border-subtle)',
              alignItems: 'start',
            }}
          >
            <div>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                {item.chat_person_name || item.name || 'Unknown'}
              </span>
              {isGroup && (
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2, fontWeight: 600, letterSpacing: '0.04em' }}>GROUP CHAT</div>
              )}
              {(item.chat_person_jid || item.jid) && (
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>
                  {item.chat_person_jid || item.jid}
                </div>
              )}
            </div>

            <input
              value={draft.birthday_person_name}
              onChange={e => setDrafts(prev => ({ ...prev, [id]: { ...draft, birthday_person_name: e.target.value } }))}
              readOnly={isGroup}
              style={{ fontSize: 13, color: 'var(--text-primary)', padding: '4px 6px', border: '1px solid var(--border-subtle)', borderRadius: 6, background: isGroup ? 'var(--bg-elevated)' : 'var(--bg-card)', opacity: isGroup ? 0.85 : 1 }}
            />

            <input
              value={draft.date}
              onChange={e => setDrafts(prev => ({ ...prev, [id]: { ...draft, date: e.target.value } }))}
              readOnly={isGroup}
              placeholder="DD-MMM"
              style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '4px 6px', border: '1px solid var(--border-subtle)', borderRadius: 6, background: isGroup ? 'var(--bg-elevated)' : 'var(--bg-card)', opacity: isGroup ? 0.85 : 1 }}
            />

            <span style={{
              fontSize: 13, color: 'var(--text-primary)',
              lineHeight: 1.5, paddingTop: 1,
            }}>
              {item.reference_message || 'No reference message'}
            </span>

            <button
              type="button"
              onClick={() => saveRow(item)}
              disabled={Boolean(savingIds[id]) || !item?.reference_pk || isGroup}
              title={isGroup ? 'Edits apply to DM birthdays only' : undefined}
              style={{
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-elevated)',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                padding: '6px 8px',
                opacity: savingIds[id] ? 0.7 : 1,
              }}
            >
              {savingIds[id] ? '…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setReminder(item)}
              disabled={
                Boolean(reminderIds[id])
                || !draft?.date
                || !draft?.birthday_person_name
                || String(draft.birthday_person_name).trim().toLowerCase() === 'unknown'
                || rowConfidence < 0
              }
              style={{
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-elevated)',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                padding: '6px 8px',
                opacity: reminderIds[id] ? 0.7 : 1,
              }}
            >
              {reminderIds[id] ? 'Setting…' : 'Set reminder'}
            </button>
          </div>
            )
          })()
        ))}
      </div>
    </div>
  )
}
