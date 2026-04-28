import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn, spawnSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { appendFile, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'

const PEOPLE_CACHE = {
  key: null,
  rows: null,
  generatedAt: null,
}

const PHOTO_INDEX_CACHE = {
  key: null,
  byJid: new Map(),
}

const CALLS_CACHE = {
  key: null,
  rows: null,
}

const CRM_CONTEXT_CACHE = {
  key: null,
  builtAtMs: 0,
  value: '',
}

const CRM_TOOLS = [
  {
    name: 'search_people',
    description: 'Find contacts by name, relation, category, or watchlist.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        on_watchlist: { type: 'boolean' },
        category: { type: 'string', enum: ['startup', 'personal', 'family', 'logistics'] },
        relation_contains: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_person',
    description: 'Get full CRM profile and summary for one person.',
    input_schema: {
      type: 'object',
      required: ['jid'],
      properties: {
        jid: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_chat_summary',
    description: 'Get rolling summary and open threads for a chat jid.',
    input_schema: {
      type: 'object',
      required: ['jid'],
      properties: {
        jid: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_followups',
    description: 'List active followups with optional filters.',
    input_schema: {
      type: 'object',
      properties: {
        urgency: { type: 'string', enum: ['today', 'tomorrow', 'week', 'next'] },
        category: { type: 'string', enum: ['startup', 'personal', 'family', 'logistics'] },
        jid: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'search_messages',
    description: 'Regex search raw chat messages by chat/date/sender.',
    input_schema: {
      type: 'object',
      required: ['query'],
      properties: {
        jid: { type: 'string' },
        query: { type: 'string' },
        from_me: { type: 'boolean' },
        since: { type: 'string' },
        until: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_messages',
    description: 'List messages in one chat with date and order controls.',
    input_schema: {
      type: 'object',
      required: ['jid'],
      properties: {
        jid: { type: 'string' },
        since: { type: 'string' },
        until: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        order: { type: 'string', enum: ['asc', 'desc'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'create_calendar_event',
    description: 'Create an event on the user\'s primary Google Calendar via Composio. Use ISO 8601 datetimes. For all-day or recurring events (e.g. birthdays), pass an RRULE string in `recurrence` like "RRULE:FREQ=YEARLY". Confirm details with the user before calling unless they were explicit.',
    input_schema: {
      type: 'object',
      required: ['summary', 'start_datetime', 'end_datetime'],
      properties: {
        summary: { type: 'string', description: 'Event title.' },
        description: { type: 'string' },
        location: { type: 'string' },
        start_datetime: { type: 'string', description: 'ISO 8601 start, e.g. 2026-05-01T10:00:00 (interpreted in `timezone` if given, else UTC).' },
        end_datetime: { type: 'string', description: 'ISO 8601 end, must be after start.' },
        timezone: { type: 'string', description: 'IANA timezone, e.g. America/Los_Angeles. Defaults to UTC.' },
        attendees: { type: 'array', items: { type: 'string' }, description: 'Attendee email addresses.' },
        recurrence: { type: 'array', items: { type: 'string' }, description: 'RFC5545 RRULE strings, e.g. ["RRULE:FREQ=YEARLY"].' },
      },
      additionalProperties: false,
    },
  },
]

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

async function readRequestJson(req) {
  return await new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

async function getFileStamp(filePath) {
  try {
    const info = await stat(filePath)
    return `${filePath}:${info.mtimeMs}`
  } catch {
    return `${filePath}:missing`
  }
}

async function readLocalEnv(rootDir) {
  const envPath = path.join(rootDir, '.env')
  const values = {}
  let raw = ''
  try {
    raw = await readFile(envPath, 'utf8')
  } catch {
    return { values, raw: '' }
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const [key, ...rest] = trimmed.split('=')
    values[key.trim()] = rest.join('=').trim().replace(/^['"]|['"]$/g, '')
  }
  return { values, raw }
}

async function writeLocalEnv(rootDir, updates) {
  const envPath = path.join(rootDir, '.env')
  const { raw } = await readLocalEnv(rootDir)
  const lines = raw ? raw.split(/\r?\n/) : []
  const seen = new Set()
  const next = lines.map(line => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return line
    const key = trimmed.split('=')[0].trim()
    if (!(key in updates)) return line
    seen.add(key)
    return `${key}=${updates[key]}`
  })

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) next.push(`${key}=${value}`)
  }

  await writeFile(envPath, `${next.join('\n').replace(/\n+$/g, '')}\n`, 'utf8')
}

async function getAnthropicConfig(rootDir, viteEnv = {}) {
  const { values } = await readLocalEnv(rootDir)
  return {
    anthropicKey: values.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || viteEnv.ANTHROPIC_API_KEY || '',
    anthropicModel: values.ANTHROPIC_MODEL || process.env.ANTHROPIC_MODEL || viteEnv.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
  }
}

async function getComposioConfig(rootDir, viteEnv = {}) {
  const { values } = await readLocalEnv(rootDir)
  return {
    apiKey: values.COMPOSIO_API_KEY || process.env.COMPOSIO_API_KEY || viteEnv.COMPOSIO_API_KEY || '',
    userId: values.COMPOSIO_USER_ID || process.env.COMPOSIO_USER_ID || viteEnv.COMPOSIO_USER_ID || '',
    authConfigId: values.COMPOSIO_AUTH_CONFIG_ID || process.env.COMPOSIO_AUTH_CONFIG_ID || viteEnv.COMPOSIO_AUTH_CONFIG_ID || '',
    connectionId: values.COMPOSIO_CONNECTION_ID || process.env.COMPOSIO_CONNECTION_ID || viteEnv.COMPOSIO_CONNECTION_ID || '',
  }
}

let composioModulePromise = null
async function getComposioClient(apiKey) {
  if (!apiKey) throw new Error('Missing Composio API key. Open Setup → Google Calendar.')
  if (!composioModulePromise) composioModulePromise = import('@composio/core')
  const mod = await composioModulePromise
  return new mod.Composio({ apiKey })
}

function makeComposioUserId() {
  const rand = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6)
  return `crm_${rand}`
}

function buildLegacyWatchlistPayload(contacts, generatedAt) {
  const chats = contacts
    .filter(contact => Boolean(contact?.on_watchlist))
    .map(contact => ({
      jid: contact?.jid || '',
      name: contact?.name || '',
      category: contact?.category || 'personal',
    }))

  return {
    chats,
    _meta: {
      generated: generatedAt,
      source: 'contacts',
    },
  }
}

async function countMessagesInLast30Days(chatPath, cutoffMs) {
  let count = 0
  const lines = createInterface({
    input: createReadStream(chatPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })

  for await (const line of lines) {
    if (!line.trim()) continue
    try {
      const msg = JSON.parse(line)
      const timestampMs = Date.parse(msg?.timestamp || '')
      if (!Number.isNaN(timestampMs) && timestampMs >= cutoffMs) {
        count += 1
      }
    } catch {
      // Ignore malformed rows instead of failing the whole table.
    }
  }

  return count
}

function getOpenFollowupsCount(followupsByKey, contact) {
  return followupsByKey.get(contact?.jid || '') || followupsByKey.get(contact?.jkey || '') || 0
}

function normalizeRelation(value) {
  const cleaned = String(value || '').toLowerCase().replace(/[^a-z ]+/g, ' ')
  const words = cleaned.split(/\s+/).filter(Boolean).slice(0, 2)
  return words.join(' ')
}

function normalizePersonName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function textValue(block) {
  if (!block) return ''
  if (typeof block === 'string') return block
  if (Array.isArray(block)) return block.map(textValue).join('\n')
  if (typeof block?.text === 'string') return block.text
  return ''
}

function parseDateInput(rawValue, { now = new Date() } = {}) {
  const raw = String(rawValue || '').trim().toLowerCase()
  if (!raw) return null
  const absolute = Date.parse(raw)
  if (!Number.isNaN(absolute)) return new Date(absolute)
  const rel = raw.match(/^(\d+)\s*(day|days|week|weeks|month|months)$/)
  if (rel) {
    const count = Number.parseInt(rel[1], 10)
    const unit = rel[2]
    let days = count
    if (unit.startsWith('week')) days = count * 7
    if (unit.startsWith('month')) days = count * 30
    const d = new Date(now)
    d.setDate(d.getDate() - days)
    return d
  }
  return null
}

function truncateText(value, max = 500) {
  const text = String(value || '')
  if (text.length <= max) return text
  return `${text.slice(0, max)}...`
}

function normalizeContextPatch(raw = {}, base = {}) {
  const merged = {
    relation: normalizeRelation(raw?.relation ?? base?.relation ?? ''),
    home_location: String(raw?.home_location ?? base?.home_location ?? '').trim(),
    age: null,
    other: '',
    context_last_updated: new Date().toISOString(),
  }
  const ageRaw = raw?.age ?? base?.age
  if (Number.isInteger(ageRaw) && ageRaw > 0 && ageRaw < 130) {
    merged.age = ageRaw
  } else if (typeof ageRaw === 'string' && /^\d+$/.test(ageRaw.trim())) {
    const parsed = Number.parseInt(ageRaw.trim(), 10)
    if (parsed > 0 && parsed < 130) merged.age = parsed
  }

  const other = String(raw?.other ?? base?.other ?? '').trim()
  merged.other = other.split(/\s+/).filter(Boolean).slice(0, 10).join(' ')
  return merged
}

async function appendJsonl(filePath, payload) {
  const line = `${JSON.stringify(payload)}\n`
  await appendFile(filePath, line, 'utf8')
}

function getWhatsAppRoots() {
  const home = process.env.HOME || ''
  if (!home) return null
  const waRoot = path.join(home, 'Library', 'Group Containers', 'group.net.whatsapp.WhatsApp.shared')
  const dbPath = path.join(waRoot, 'ChatStorage.sqlite')
  const mediaDir = path.join(waRoot, 'Media', 'Profile')
  return { waRoot, dbPath, mediaDir }
}

async function fileExists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

async function resolveWhatsAppProfileMediaPath(mediaDir, jid, zpath, zpictureid) {
  if (!zpath) return null
  if (!zpath.startsWith('Media/Profile/')) return null

  const base = zpath.replace(/^Media\/Profile\//, '')
  const candidates = [
    path.join(mediaDir, `${base}.thumb`),
    path.join(mediaDir, `${base}.jpg`),
    zpictureid ? path.join(mediaDir, `${String(jid).split('@')[0]}-${zpictureid}.thumb`) : null,
    zpictureid ? path.join(mediaDir, `${String(jid).split('@')[0]}-${zpictureid}.jpg`) : null,
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate
  }
  return null
}

async function getWhatsAppPhotoIndex(rootDir) {
  const roots = getWhatsAppRoots()
  if (!roots) return new Map()
  const { dbPath, mediaDir } = roots
  const cacheKey = [await getFileStamp(dbPath), await getFileStamp(mediaDir)].join('|')
  if (PHOTO_INDEX_CACHE.key === cacheKey) return PHOTO_INDEX_CACHE.byJid

  const sql = "SELECT ZJID, ZPATH, ZPICTUREID FROM ZWAPROFILEPICTUREITEM ORDER BY ZREQUESTDATE DESC;"
  const result = spawnSync('sqlite3', [dbPath, sql], { encoding: 'utf8' })
  const byJid = new Map()
  if (result.status === 0) {
    const lines = String(result.stdout || '').split('\n').map(s => s.trim()).filter(Boolean)
    // Ordered by request date desc; first valid path per jid wins.
    for (const line of lines) {
      const [jid, zpath, zpictureid] = line.split('|')
      if (!jid || byJid.has(jid)) continue
      const resolved = await resolveWhatsAppProfileMediaPath(mediaDir, jid, zpath, zpictureid)
      if (resolved) byJid.set(jid, resolved)
    }
  }

  PHOTO_INDEX_CACHE.key = cacheKey
  PHOTO_INDEX_CACHE.byJid = byJid
  return byJid
}

function parseSqlNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(value || '')
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseSqlInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function coreDataTimestampToIso(value) {
  const ts = parseSqlNumber(value, NaN)
  return Number.isFinite(ts) ? new Date((ts + 978307200) * 1000).toISOString() : null
}

function getCallStatus({ incoming, missed }) {
  if (missed) return 'missed'
  return incoming ? 'incoming' : 'outgoing'
}

function getCallStatusLabel(status) {
  if (status === 'missed') return 'Missed'
  if (status === 'incoming') return 'Incoming'
  if (status === 'outgoing') return 'Outgoing'
  return 'Unknown'
}

async function getWhatsAppCalls(rootDir) {
  const home = process.env.HOME || ''
  if (!home) return []
  const callDbPath = path.join(home, 'Library', 'Group Containers', 'group.net.whatsapp.WhatsApp.shared', 'CallHistory.sqlite')
  const cacheKey = await getFileStamp(callDbPath)
  if (CALLS_CACHE.key === cacheKey && Array.isArray(CALLS_CACHE.rows)) return CALLS_CACHE.rows

  const contactsPayload = await readJson(path.join(rootDir, 'output', 'contacts.json'), { contacts: [] })
  const contacts = Array.isArray(contactsPayload?.contacts) ? contactsPayload.contacts : []
  const nameByJid = new Map(contacts.map(c => [c?.jid, c?.name]).filter(([jid]) => Boolean(jid)))

  const sql = `
    SELECT
      a.Z_PK,
      a.ZFIRSTDATE,
      a.ZINCOMING,
      a.ZMISSED,
      a.ZMISSEDREASON,
      a.ZVIDEO,
      a.ZLINKTOKEN,
      e.Z_PK,
      e.ZDATE,
      e.ZDURATION,
      e.ZOUTCOME,
      e.ZGROUPJIDSTRING,
      e.ZGROUPCALLCREATORUSERJIDSTRING,
      e.ZCALLIDSTRING,
      p.ZJIDSTRING,
      p.ZOUTCOME
    FROM ZWAAGGREGATECALLEVENT a
    LEFT JOIN ZWACDCALLEVENT e
      ON e.Z1CALLEVENTS = a.Z_PK
    LEFT JOIN ZWACDCALLEVENTPARTICIPANT p
      ON p.Z1PARTICIPANTS = e.Z_PK
    ORDER BY a.ZFIRSTDATE DESC, e.ZDATE DESC
    LIMIT 500;
  `
  const result = spawnSync('sqlite3', [callDbPath, sql], { encoding: 'utf8' })
  const byCall = new Map()
  if (result.status === 0) {
    const lines = String(result.stdout || '').split('\n').map(s => s.trim()).filter(Boolean)
    for (const line of lines) {
      const [
        aggregatePk,
        firstDate,
        zincoming,
        zmissed,
        zmissedReason,
        zvideo,
        linkToken,
        eventPk,
        eventDate,
        zduration,
        zoutcome,
        groupJid,
        groupCreatorJid,
        callId,
        participantJid,
        participantOutcome,
      ] = line.split('|')
      if (!aggregatePk) continue

      const key = linkToken || `aggregate:${aggregatePk}`
      const incoming = parseSqlInteger(zincoming) === 1
      const missed = parseSqlInteger(zmissed) === 1
      const video = parseSqlInteger(zvideo) === 1
      const durationSec = Math.max(0, Number.parseFloat(zduration || '0') || 0)
      const iso = coreDataTimestampToIso(firstDate || eventDate)
      const existing = byCall.get(key)
      const row = existing || {
        id: key,
        aggregate_id: parseSqlInteger(aggregatePk) || aggregatePk,
        at: iso,
        duration_seconds: 0,
        duration_minutes: 0,
        status: getCallStatus({ incoming, missed }),
        status_label: getCallStatusLabel(getCallStatus({ incoming, missed })),
        direction: incoming ? 'incoming' : 'outgoing',
        direction_label: incoming ? 'Incoming' : 'Outgoing',
        media: video ? 'video' : 'audio',
        media_label: video ? 'Video' : 'Audio',
        missed,
        missed_reason: parseSqlInteger(zmissedReason),
        outcome: parseSqlInteger(zoutcome),
        participant_outcomes: [],
        call_ids: [],
        call_id: '',
        link_token: linkToken || '',
        is_group: Boolean(groupJid),
        group_jid: groupJid || '',
        peer_jid: '',
        peer_name: '',
        participants: [],
      }

      row.duration_seconds = Math.max(row.duration_seconds, durationSec)
      row.duration_minutes = Math.round((row.duration_seconds / 60) * 10) / 10
      row.is_group = row.is_group || Boolean(groupJid)
      row.group_jid = row.group_jid || groupJid || ''
      row.outcome = row.outcome || parseSqlInteger(zoutcome)

      if (callId && !row.call_ids.includes(callId)) {
        row.call_ids.push(callId)
        row.call_id = row.call_id || callId
      }

      const participantOutcomeValue = parseSqlInteger(participantOutcome, NaN)
      if (Number.isFinite(participantOutcomeValue)) row.participant_outcomes.push(participantOutcomeValue)

      const peerJid = participantJid || groupCreatorJid || groupJid || ''
      if (peerJid && !row.participants.some(participant => participant.jid === peerJid)) {
        row.participants.push({
          jid: peerJid,
          name: nameByJid.get(peerJid) || '',
        })
      }

      if (!row.peer_jid && peerJid) {
        row.peer_jid = peerJid
        row.peer_name = nameByJid.get(peerJid) || ''
      }

      byCall.set(key, row)
    }
  }
  const rows = [...byCall.values()].sort((a, b) => Date.parse(b?.at || '') - Date.parse(a?.at || ''))
  CALLS_CACHE.key = cacheKey
  CALLS_CACHE.rows = rows
  return rows
}

async function buildPeopleRows(rootDir) {
  const contactsPath = path.join(rootDir, 'output', 'contacts.json')
  const followupsPath = path.join(rootDir, 'public', 'data', 'followups.json')
  const birthdaysPath = path.join(rootDir, 'public', 'data', 'birthdays.json')
  const indexPath = path.join(rootDir, 'output', 'index.json')

  const contactsPayload = await readJson(contactsPath, { contacts: [], generated_at: null })
  const followupsPayload = await readJson(followupsPath, { items: [] })
  const birthdaysPayload = await readJson(birthdaysPath, { items: [] })
  const indexRows = await readJson(indexPath, [])

  const contacts = Array.isArray(contactsPayload?.contacts) ? contactsPayload.contacts : []
  const photoIndex = await getWhatsAppPhotoIndex(rootDir)
  const followups = Array.isArray(followupsPayload?.items) ? followupsPayload.items : []
  const birthdays = Array.isArray(birthdaysPayload?.items) ? birthdaysPayload.items : []
  const dmIndexByJid = new Map()
  const followupsByKey = new Map()
  const bestBirthdayByName = new Map()

  for (const row of Array.isArray(indexRows) ? indexRows : []) {
    if (!row || row.type !== 'dm' || !row.jid) continue
    dmIndexByJid.set(row.jid, row)
  }

  for (const item of followups) {
    const keys = [item?.jid, item?.jkey].filter(Boolean)
    for (const key of keys) {
      followupsByKey.set(key, (followupsByKey.get(key) || 0) + 1)
    }
  }

  for (const item of birthdays) {
    const birthdayPersonName = String(item?.birthday_person_name || '').trim()
    if (!birthdayPersonName || birthdayPersonName.toLowerCase() === 'unknown') continue
    const key = normalizePersonName(birthdayPersonName)
    if (!key) continue
    const confidence = Number(item?.confidence || 0)
    const current = bestBirthdayByName.get(key)
    if (!current || confidence > Number(current?.confidence || 0)) {
      bestBirthdayByName.set(key, {
        date: String(item?.date || '').trim(),
        confidence,
        source_chat: String(item?.chat_person_name || '').trim(),
      })
    }
  }

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)
  const cutoffMs = cutoff.getTime()

  const rows = await Promise.all(
    contacts.map(async contact => {
      const chatRow = dmIndexByJid.get(contact?.jid || '')
      let recentMessages30d = 0

      if (chatRow?.file) {
        const firstMessageMs = Date.parse(`${chatRow.first_message || ''}T00:00:00`)
        const lastMessageMs = Date.parse(`${chatRow.last_message || ''}T23:59:59`)

        if (!Number.isNaN(lastMessageMs) && lastMessageMs < cutoffMs) {
          recentMessages30d = 0
        } else if (!Number.isNaN(firstMessageMs) && firstMessageMs >= cutoffMs) {
          recentMessages30d = Number(chatRow.total_messages || 0)
        } else {
          const chatPath = path.join(rootDir, 'output', chatRow.file)
          recentMessages30d = await countMessagesInLast30Days(chatPath, cutoffMs)
        }
      }

      const autoBirthday = bestBirthdayByName.get(normalizePersonName(contact?.name || '')) || null
      const manualBirthday = String(contact?.birthday || '').trim()
      const birthday = manualBirthday || String(autoBirthday?.date || '')
      const birthdayConfidence = manualBirthday
        ? Number(contact?.birthday_confidence || 1)
        : Number(autoBirthday?.confidence || 0)
      const birthdaySourceChat = manualBirthday
        ? String(contact?.birthday_source_chat || 'manual')
        : String(autoBirthday?.source_chat || '')
      return {
        ...contact,
        relation: contact?.context?.relation || contact?.relation || '',
        birthday,
        birthday_confidence: birthdayConfidence,
        birthday_source_chat: birthdaySourceChat,
        photo_url: photoIndex.has(contact?.jid || '')
          ? `/api/people/photo?jid=${encodeURIComponent(contact?.jid || '')}`
          : '',
        recent_messages_30d: recentMessages30d,
        open_followups: getOpenFollowupsCount(followupsByKey, contact),
      }
    }),
  )

  return {
    generatedAt: contactsPayload?.generated_at || null,
    rows,
  }
}

async function getPeopleRows(rootDir) {
  const cacheKey = [
    await getFileStamp(path.join(rootDir, 'output', 'contacts.json')),
    await getFileStamp(path.join(rootDir, 'output', 'index.json')),
    await getFileStamp(path.join(rootDir, 'public', 'data', 'followups.json')),
    await getFileStamp(path.join(rootDir, 'public', 'data', 'birthdays.json')),
  ].join('|')

  if (PEOPLE_CACHE.key === cacheKey && Array.isArray(PEOPLE_CACHE.rows)) {
    return {
      generatedAt: PEOPLE_CACHE.generatedAt,
      rows: PEOPLE_CACHE.rows,
    }
  }

  const payload = await buildPeopleRows(rootDir)
  PEOPLE_CACHE.key = cacheKey
  PEOPLE_CACHE.generatedAt = payload.generatedAt
  PEOPLE_CACHE.rows = payload.rows
  return payload
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      {
        name: 'anthropic-chat-endpoint',
        configureServer(server) {
          const rootDir = process.cwd()
          const outputDir = path.join(rootDir, 'output')
          const promptsDir = path.join(rootDir, 'prompts')
          const outputContactsPath = path.join(outputDir, 'contacts.json')
          const publicContactsPath = path.join(rootDir, 'public', 'data', 'contacts.json')
          const publicWatchlistPath = path.join(rootDir, 'public', 'data', 'watchlist.json')
          const followupStatePath = path.join(outputDir, 'followup_state.json')
          const followupFeedbackPath = path.join(outputDir, 'followup_feedback.jsonl')
          const reviewQueuePath = path.join(outputDir, 'context_update_queue.json')
          const feedbackJudgePromptPath = path.join(promptsDir, 'feedback_judge_system_prompt.txt')
          const followupsDataPath = path.join(rootDir, 'public', 'data', 'followups.json')
          const birthdaysDataPath = path.join(rootDir, 'public', 'data', 'birthdays.json')
          const groupBirthdaysDataPath = path.join(rootDir, 'public', 'data', 'group_birthdays.json')
          const syncHistoryPath = path.join(outputDir, 'sync_history.json')
          const followupsSystemPromptPath = path.join(promptsDir, 'followups_system_prompt.txt')
          const qaSystemPromptPath = path.join(promptsDir, 'qa_system_prompt.txt')

          async function updateContactWatchlist(jid, onWatchlist) {
            const contactsPayload = await readJson(outputContactsPath, { contacts: [], _meta: {} })
            const contacts = Array.isArray(contactsPayload?.contacts) ? contactsPayload.contacts : []
            const contact = contacts.find(row => row?.jid === jid)
            if (!contact) return false
            if (String(contact?.jid || '').endsWith('@g.us')) {
              return false
            }

            const generatedAt = new Date().toISOString()
            contact.on_watchlist = onWatchlist
            contact.updated_at = generatedAt
            contactsPayload.generated_at = generatedAt

            const contactsJson = JSON.stringify(contactsPayload, null, 2)
            await writeFile(outputContactsPath, contactsJson, 'utf8')
            await writeFile(publicContactsPath, contactsJson, 'utf8')
            await writeFile(
              publicWatchlistPath,
              JSON.stringify(buildLegacyWatchlistPayload(contacts, generatedAt), null, 2),
              'utf8',
            )
            return true
          }

          async function updateContactProfile(jid, patch = {}) {
            const contactsPayload = await readJson(outputContactsPath, { contacts: [], _meta: {} })
            const contacts = Array.isArray(contactsPayload?.contacts) ? contactsPayload.contacts : []
            const contact = contacts.find(row => row?.jid === jid)
            if (!contact) return null

            const nextContext = normalizeContextPatch(patch?.context || {}, contact?.context || {})
            const now = new Date().toISOString()
            if (typeof patch?.name === 'string') {
              contact.name = patch.name.trim() || contact.name
            }
            if (typeof patch?.category === 'string') {
              const c = patch.category.trim().toLowerCase()
              if (['startup', 'personal', 'family', 'logistics'].includes(c)) contact.category = c
            }
            if (typeof patch?.on_watchlist === 'boolean') {
              contact.on_watchlist = String(contact?.jid || '').endsWith('@g.us') ? false : patch.on_watchlist
            }
            if (typeof patch?.birthday === 'string') {
              const rawBirthday = patch.birthday.trim()
              if (!rawBirthday) {
                contact.birthday = ''
                contact.birthday_confidence = 0
                contact.birthday_source_chat = ''
              } else if (/^\d{2}-[A-Za-z]{3}$/.test(rawBirthday)) {
                contact.birthday = `${rawBirthday.slice(0, 2)}-${rawBirthday.slice(3, 4).toUpperCase()}${rawBirthday.slice(4).toLowerCase()}`
                contact.birthday_confidence = 1
                contact.birthday_source_chat = 'manual'
              }
            }
            contact.context = { ...nextContext, context_last_updated: now }
            contact.updated_at = now
            contactsPayload.generated_at = now

            const contactsJson = JSON.stringify(contactsPayload, null, 2)
            await writeFile(outputContactsPath, contactsJson, 'utf8')
            await writeFile(publicContactsPath, contactsJson, 'utf8')
            await writeFile(
              publicWatchlistPath,
              JSON.stringify(buildLegacyWatchlistPayload(contacts, now), null, 2),
              'utf8',
            )

            PEOPLE_CACHE.key = null
            PEOPLE_CACHE.rows = null
            PEOPLE_CACHE.generatedAt = null
            return contact
          }

          async function judgeFeedbackAndQueue({ followupId, jid, feedbackText, topic }) {
            const { anthropicKey, anthropicModel } = await getAnthropicConfig(rootDir, env)
            if (!anthropicKey) return { queued: false, reason: 'missing_api_key' }
            const systemPrompt = await readFile(feedbackJudgePromptPath, 'utf8')
            const contactsPayload = await readJson(outputContactsPath, { contacts: [] })
            const contacts = Array.isArray(contactsPayload?.contacts) ? contactsPayload.contacts : []
            const contact = contacts.find(row => row?.jid === jid) || {}
            const existingContext = normalizeContextPatch(contact?.context || {}, contact?.context || {})

            const userPayload = {
              followup_id: followupId,
              jid,
              topic: topic || '',
              feedback_text: feedbackText || '',
              current_context: existingContext,
            }

            const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-api-key': anthropicKey,
                'anthropic-version': '2023-06-01',
              },
              body: JSON.stringify({
                model: anthropicModel,
                max_tokens: 500,
                system: systemPrompt,
                messages: [{ role: 'user', content: JSON.stringify(userPayload) }],
              }),
            })
            const responseJson = await anthropicResp.json().catch(() => ({}))
            if (!anthropicResp.ok) {
              return { queued: false, reason: responseJson?.error?.message || 'judge_failed' }
            }

            const textBlocks = Array.isArray(responseJson?.content)
              ? responseJson.content.filter(b => b?.type === 'text')
              : []
            const text = textBlocks.map(b => b.text || '').join('\n').trim()

            let parsed = {}
            try {
              parsed = JSON.parse(text)
            } catch {
              const start = text.indexOf('{')
              const end = text.lastIndexOf('}')
              if (start >= 0 && end > start) {
                parsed = JSON.parse(text.slice(start, end + 1))
              } else {
                return { queued: false, reason: 'invalid_judge_json' }
              }
            }

            const decision = String(parsed?.decision || '').trim()
            if (!['update_system_prompt', 'update_contact_context', 'no_change'].includes(decision)) {
              return { queued: false, reason: 'invalid_decision' }
            }
            if (decision === 'no_change') {
              return { queued: false, reason: 'no_change' }
            }

            const queuePayload = await readJson(reviewQueuePath, { generated_at: null, items: [] })
            const queue = Array.isArray(queuePayload?.items) ? queuePayload.items : []
            const proposalId = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
            const contextPatch = normalizeContextPatch(parsed?.contact_context_patch || {}, existingContext)
            const systemPromptAppend = String(parsed?.system_prompt_append || '').trim()

            queue.push({
              id: proposalId,
              status: 'pending',
              needs_review: true,
              created_at: new Date().toISOString(),
              source: 'feedback_judge',
              followup_id: followupId,
              jid,
              feedback_text: feedbackText,
              reasoning_summary: String(parsed?.reasoning_summary || '').trim(),
              target_type: decision === 'update_system_prompt' ? 'system_prompt' : 'contact_context',
              proposed_before:
                decision === 'update_system_prompt'
                  ? null
                  : { context: existingContext },
              proposed_after:
                decision === 'update_system_prompt'
                  ? { system_prompt_append: systemPromptAppend }
                  : { context: contextPatch },
            })
            const updatedQueue = {
              generated_at: new Date().toISOString(),
              items: queue,
            }
            await writeFile(reviewQueuePath, JSON.stringify(updatedQueue, null, 2), 'utf8')
            return { queued: true, proposal_id: proposalId, target_type: queue.at(-1)?.target_type }
          }

          async function loadActiveFollowups() {
            const followupsPayload = await readJson(followupsDataPath, { generated_at: null, items: [] })
            const statePayload = await readJson(followupStatePath, { updated_at: null, items: {} })
            const items = Array.isArray(followupsPayload?.items) ? followupsPayload.items : []
            const stateItems = statePayload?.items && typeof statePayload.items === 'object' ? statePayload.items : {}
            const activeItems = items.filter(item => {
              const st = stateItems[item?.id]
              return !st || !['done', 'useless', 'feedback'].includes(st?.status)
            })
            return {
              generated_at: followupsPayload?.generated_at || null,
              items: activeItems,
            }
          }

          function getNormalizedLimit(value, fallback = 20) {
            const parsed = Number.parseInt(value, 10)
            if (!Number.isFinite(parsed)) return fallback
            return Math.max(1, Math.min(parsed, 50))
          }

          function getChatFileByJid(indexRows = []) {
            const out = new Map()
            for (const row of indexRows) {
              if (!row?.jid || !row?.file) continue
              out.set(row.jid, row.file)
            }
            return out
          }

          async function loadCrmContext() {
            const contactsPath = path.join(rootDir, 'output', 'contacts.json')
            const indexPath = path.join(rootDir, 'output', 'index.json')
            const summariesIndexPath = path.join(rootDir, 'public', 'data', 'summaries_index.json')
            const cacheKey = [
              await getFileStamp(contactsPath),
              await getFileStamp(indexPath),
              await getFileStamp(summariesIndexPath),
              await getFileStamp(followupsDataPath),
              await getFileStamp(followupStatePath),
              await getFileStamp(qaSystemPromptPath),
            ].join('|')
            const nowMs = Date.now()
            if (CRM_CONTEXT_CACHE.key === cacheKey && nowMs - CRM_CONTEXT_CACHE.builtAtMs < 60000) {
              return CRM_CONTEXT_CACHE.value
            }

            const contactsPayload = await readJson(contactsPath, { generated_at: null, contacts: [] })
            const indexRows = await readJson(indexPath, [])
            const summariesIndex = await readJson(summariesIndexPath, { generated_at: null, chats: [] })
            const followupsPayload = await loadActiveFollowups()
            const qaPrompt = await readFile(qaSystemPromptPath, 'utf8').catch(() => '')

            const followups = Array.isArray(followupsPayload?.items) ? followupsPayload.items : []
            const followupsByKey = new Map()
            for (const item of followups) {
              const keys = [item?.jid, item?.jkey].filter(Boolean)
              for (const key of keys) {
                followupsByKey.set(key, (followupsByKey.get(key) || 0) + 1)
              }
            }
            const contacts = Array.isArray(contactsPayload?.contacts) ? contactsPayload.contacts : []
            const byJid = new Map((Array.isArray(indexRows) ? indexRows : []).map(row => [row?.jid, row]).filter(([jid]) => Boolean(jid)))
            const directory = contacts.slice(0, 300).map(contact => {
              const row = byJid.get(contact?.jid || '')
              const relation = contact?.context?.relation || contact?.relation || ''
              const openFollowups = followupsByKey.get(contact?.jid || '') || followupsByKey.get(contact?.jkey || '') || 0
              return [
                contact?.jid || '',
                contact?.name || '',
                contact?.category || '',
                relation,
                contact?.on_watchlist ? 'watchlist' : 'not_watchlist',
                row?.last_message || contact?.last_message || '',
                String(openFollowups),
              ].join(' | ')
            })

            const summaryLines = Array.isArray(summariesIndex?.chats)
              ? summariesIndex.chats.slice(0, 200).map(chat => {
                const line = truncateText(chat?.summary_line || '', 260)
                return `${chat?.jid || ''} | ${chat?.name || ''} | ${line}`
              })
              : []

            const prompt = [
              qaPrompt.trim(),
              '',
              `today_iso: ${new Date().toISOString().slice(0, 10)}`,
              `generated_at: ${new Date().toISOString()}`,
              '',
              'directory_columns: jid | name | category | relation | watchlist_status | last_msg_date | open_followups',
              'directory:',
              directory.join('\n'),
              '',
              'active_followups_json:',
              JSON.stringify(followups.slice(0, 120)),
              '',
              'chat_summary_lines: jid | name | summary_line',
              summaryLines.join('\n'),
            ].join('\n')

            CRM_CONTEXT_CACHE.key = cacheKey
            CRM_CONTEXT_CACHE.builtAtMs = nowMs
            CRM_CONTEXT_CACHE.value = prompt
            return prompt
          }

          async function readChatMessagesByJid(jid) {
            const indexRows = await readJson(path.join(rootDir, 'output', 'index.json'), [])
            const byJid = getChatFileByJid(indexRows)
            const file = byJid.get(jid)
            if (!file) return []
            const chatPath = path.join(rootDir, 'output', file)
            const lines = createInterface({
              input: createReadStream(chatPath, { encoding: 'utf8' }),
              crlfDelay: Infinity,
            })
            const rows = []
            for await (const line of lines) {
              if (!line.trim()) continue
              try {
                rows.push(JSON.parse(line))
              } catch {
                // Ignore malformed lines.
              }
            }
            return rows
          }

          async function executeTool(name, input = {}) {
            const contactsPayload = await readJson(path.join(rootDir, 'output', 'contacts.json'), { contacts: [] })
            const contacts = Array.isArray(contactsPayload?.contacts) ? contactsPayload.contacts : []
            const followupsPayload = await loadActiveFollowups()
            const followups = Array.isArray(followupsPayload?.items) ? followupsPayload.items : []
            const indexRows = await readJson(path.join(rootDir, 'output', 'index.json'), [])
            const indexByJid = new Map((Array.isArray(indexRows) ? indexRows : []).map(row => [row?.jid, row]).filter(([jid]) => Boolean(jid)))

            if (name === 'search_people') {
              const query = String(input?.query || '').trim().toLowerCase()
              const relationContains = String(input?.relation_contains || '').trim().toLowerCase()
              const onWatchlist = typeof input?.on_watchlist === 'boolean' ? input.on_watchlist : null
              const category = String(input?.category || '').trim()
              const limit = getNormalizedLimit(input?.limit, 20)
              const rows = contacts
                .filter(contact => {
                  if (onWatchlist !== null && Boolean(contact?.on_watchlist) !== onWatchlist) return false
                  if (category && contact?.category !== category) return false
                  const relation = String(contact?.context?.relation || contact?.relation || '').toLowerCase()
                  if (relationContains && !relation.includes(relationContains)) return false
                  if (!query) return true
                  const hay = [
                    contact?.jid,
                    contact?.name,
                    contact?.category,
                    relation,
                  ].join(' ').toLowerCase()
                  return hay.includes(query)
                })
                .slice(0, limit)
                .map(contact => ({
                  jid: contact?.jid || '',
                  name: contact?.name || '',
                  category: contact?.category || '',
                  relation: contact?.context?.relation || contact?.relation || '',
                  on_watchlist: Boolean(contact?.on_watchlist),
                  last_message: indexByJid.get(contact?.jid || '')?.last_message || contact?.last_message || '',
                }))
              return { count: rows.length, items: rows }
            }

            if (name === 'list_followups') {
              const urgency = String(input?.urgency || '').trim()
              const category = String(input?.category || '').trim()
              const jid = String(input?.jid || '').trim()
              const limit = getNormalizedLimit(input?.limit, 25)
              const rows = followups
                .filter(item => (!urgency || item?.urgency === urgency))
                .filter(item => (!category || item?.category === category))
                .filter(item => (!jid || item?.jid === jid))
                .slice(0, limit)
              return { count: rows.length, items: rows }
            }

            if (name === 'get_chat_summary') {
              const jid = String(input?.jid || '').trim()
              if (!jid) return { error: 'Expected jid' }
              const jkey = jid.replace(/[@.]/g, '_')
              const summaryPath = path.join(rootDir, 'summaries', `${jkey}.json`)
              const summary = await readJson(summaryPath, null)
              if (!summary) return { error: 'No summary found for jid', jid }
              return summary
            }

            if (name === 'get_person') {
              const jid = String(input?.jid || '').trim()
              if (!jid) return { error: 'Expected jid' }
              const contact = contacts.find(row => row?.jid === jid)
              if (!contact) return { error: 'Contact not found', jid }
              const jkey = contact?.jkey || jid.replace(/[@.]/g, '_')
              const summary = await readJson(path.join(rootDir, 'summaries', `${jkey}.json`), null)
              const personFollowups = followups.filter(item => item?.jid === jid || item?.jkey === jkey).slice(0, 50)
              return {
                contact,
                summary,
                followups: personFollowups,
                chat_index: indexByJid.get(jid) || null,
              }
            }

            if (name === 'search_messages' || name === 'list_messages') {
              const jid = String(input?.jid || '').trim()
              const limit = getNormalizedLimit(input?.limit, 25)
              const sinceDate = parseDateInput(input?.since)
              const untilDate = parseDateInput(input?.until)
              const fromMe = typeof input?.from_me === 'boolean' ? input.from_me : null
              const query = String(input?.query || '').trim()
              const order = String(input?.order || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc'
              const regex = name === 'search_messages'
                ? new RegExp(query, 'i')
                : null
              const files = []
              if (jid) {
                const row = indexByJid.get(jid)
                if (!row?.file) return { error: 'jid not found in chat index', jid }
                files.push({ jid, file: row.file })
              } else if (name === 'search_messages') {
                for (const row of indexRows) {
                  if (!row?.jid || !row?.file) continue
                  files.push({ jid: row.jid, file: row.file })
                }
              } else {
                return { error: 'list_messages requires jid' }
              }

              const rows = []
              for (const target of files) {
                const chatPath = path.join(rootDir, 'output', target.file)
                const lines = createInterface({
                  input: createReadStream(chatPath, { encoding: 'utf8' }),
                  crlfDelay: Infinity,
                })
                for await (const line of lines) {
                  if (!line.trim()) continue
                  let msg = null
                  try {
                    msg = JSON.parse(line)
                  } catch {
                    continue
                  }
                  const ts = Date.parse(msg?.timestamp || '')
                  if (sinceDate && Number.isFinite(ts) && ts < sinceDate.getTime()) continue
                  if (untilDate && Number.isFinite(ts) && ts > untilDate.getTime()) continue
                  if (fromMe !== null && Boolean(msg?.from_me) !== fromMe) continue
                  const text = String(msg?.text || '')
                  if (regex && !regex.test(text)) continue
                  rows.push({
                    jid: target.jid,
                    pk: msg?.pk || null,
                    timestamp: msg?.timestamp || '',
                    from_me: Boolean(msg?.from_me),
                    sender: msg?.sender || '',
                    text: truncateText(text, 500),
                  })
                }
              }

              rows.sort((a, b) => {
                const ta = Date.parse(a?.timestamp || '')
                const tb = Date.parse(b?.timestamp || '')
                if (order === 'asc') return ta - tb
                return tb - ta
              })
              return {
                count: rows.length,
                items: rows.slice(0, limit),
              }
            }

            if (name === 'create_calendar_event') {
              const { apiKey, userId, connectionId } = await getComposioConfig(rootDir, env)
              if (!apiKey) return { error: 'Composio API key not configured. Open Setup → Google Calendar.' }
              if (!userId || !connectionId) {
                return { error: 'Google Calendar is not connected. Open Setup → Google Calendar → Connect Google Calendar.' }
              }
              const summary = String(input?.summary || '').trim()
              const startDatetime = String(input?.start_datetime || '').trim()
              const endDatetime = String(input?.end_datetime || '').trim()
              if (!summary || !startDatetime || !endDatetime) {
                return { error: 'create_calendar_event requires summary, start_datetime, end_datetime.' }
              }
              const args = {
                calendar_id: 'primary',
                summary,
                start_datetime: startDatetime,
                end_datetime: endDatetime,
              }
              if (typeof input?.description === 'string' && input.description.trim()) args.description = input.description.trim()
              if (typeof input?.location === 'string' && input.location.trim()) args.location = input.location.trim()
              if (typeof input?.timezone === 'string' && input.timezone.trim()) args.timezone = input.timezone.trim()
              if (Array.isArray(input?.attendees) && input.attendees.length) {
                args.attendees = input.attendees.map(value => String(value || '').trim()).filter(Boolean)
              }
              if (Array.isArray(input?.recurrence) && input.recurrence.length) {
                args.recurrence = input.recurrence.map(value => String(value || '').trim()).filter(Boolean)
              }
              try {
                const composio = await getComposioClient(apiKey)
                const result = await composio.tools.execute('GOOGLECALENDAR_CREATE_EVENT', {
                  userId,
                  connectedAccountId: connectionId,
                  arguments: args,
                  dangerouslySkipVersionCheck: true,
                })
                if (result?.successful === false || result?.error) {
                  return { error: result?.error || 'Composio reported the calendar call failed.', details: result }
                }
                const data = result?.data || result
                return {
                  ok: true,
                  event_id: data?.id || data?.event_id || null,
                  html_link: data?.htmlLink || data?.html_link || null,
                  start: data?.start || null,
                  end: data?.end || null,
                  summary,
                }
              } catch (err) {
                return { error: err?.message || 'Failed to create calendar event' }
              }
            }

            return { error: `Unknown tool: ${name}` }
          }

          async function runPythonStep(script, args = [], onChunk = () => {}) {
            return await new Promise((resolve, reject) => {
              const child = spawn('.venv/bin/python', [script, ...args], {
                cwd: rootDir,
                stdio: ['ignore', 'pipe', 'pipe'],
              })
              let stdout = ''
              let stderr = ''
              child.stdout.on('data', chunk => {
                const text = String(chunk)
                stdout += text
                onChunk(text)
              })
              child.stderr.on('data', chunk => {
                const text = String(chunk)
                stderr += text
                onChunk(text)
              })
              child.on('error', reject)
              child.on('close', code => {
                const logs = [stdout, stderr].filter(Boolean).join('\n').trim()
                if (code === 0) resolve({ script, logs })
                else reject(new Error(logs || `${script} failed with exit code ${code}`))
              })
            })
          }

          async function getSetupStatus() {
            const { values } = await readLocalEnv(rootDir)
            const configuredDbPath = values.WHATSAPP_DB_PATH
              ? path.resolve(values.WHATSAPP_DB_PATH.replace(/^~/, process.env.HOME || ''))
              : path.join(process.env.HOME || '', 'Library', 'Group Containers', 'group.net.whatsapp.WhatsApp.shared', 'ChatStorage.sqlite')
            const sqlite = spawnSync('sqlite3', ['--version'], { encoding: 'utf8' })
            const chatsPayload = await readJson(path.join(rootDir, 'public', 'data', 'chats_table.json'), { generated_at: null, chats: [] })

            return {
              env_file: await fileExists(path.join(rootDir, '.env')),
              anthropic_key: Boolean(String(values.ANTHROPIC_API_KEY || '').startsWith('sk-ant-')),
              anthropic_model: values.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
              whatsapp_db_path: configuredDbPath,
              whatsapp_db_found: await fileExists(configuredDbPath),
              sqlite_found: sqlite.status === 0,
              python_ready: await fileExists(path.join(rootDir, '.venv', 'bin', 'python')),
              node_modules_found: await fileExists(path.join(rootDir, 'node_modules')),
              last_sync_at: chatsPayload?.generated_at || null,
              chat_count: Array.isArray(chatsPayload?.chats) ? chatsPayload.chats.length : 0,
            }
          }

          server.middlewares.use('/api/setup/status', async (req, res) => {
            if (req.method !== 'GET') {
              sendJson(res, 405, { error: 'Method not allowed' })
              return
            }
            try {
              sendJson(res, 200, await getSetupStatus())
            } catch (err) {
              sendJson(res, 500, { error: err?.message || 'Failed to load setup status' })
            }
          })

          server.middlewares.use('/api/setup/env', async (req, res) => {
            if (req.method !== 'POST') {
              sendJson(res, 405, { error: 'Method not allowed' })
              return
            }
            try {
              const body = await readRequestJson(req)
              const apiKey = String(body?.api_key || '').trim()
              const model = String(body?.model || '').trim()
              if (!apiKey.startsWith('sk-ant-')) {
                sendJson(res, 400, { error: 'Expected an Anthropic API key starting with sk-ant-' })
                return
              }
              const updates = { ANTHROPIC_API_KEY: apiKey }
              if (model) updates.ANTHROPIC_MODEL = model
              await writeLocalEnv(rootDir, updates)
              process.env.ANTHROPIC_API_KEY = apiKey
              if (model) process.env.ANTHROPIC_MODEL = model
              sendJson(res, 200, { ok: true, status: await getSetupStatus() })
            } catch (err) {
              sendJson(res, 500, { error: err?.message || 'Failed to save .env' })
            }
          })

          async function getComposioStatusPayload() {
            const cfg = await getComposioConfig(rootDir, env)
            const payload = {
              has_api_key: Boolean(cfg.apiKey),
              has_user_id: Boolean(cfg.userId),
              has_auth_config: Boolean(cfg.authConfigId),
              has_connection: Boolean(cfg.connectionId),
              connection_status: null,
              connection_account: null,
              toolkit: 'googlecalendar',
              error: null,
            }
            if (cfg.apiKey && cfg.connectionId) {
              try {
                const composio = await getComposioClient(cfg.apiKey)
                const account = await composio.connectedAccounts.get(cfg.connectionId)
                payload.connection_status = String(account?.status || '').toUpperCase() || null
                payload.connection_account =
                  account?.data?.email
                  || account?.data?.profile?.email
                  || account?.data?.user?.email
                  || account?.data?.account?.email
                  || account?.toolkit?.slug
                  || null
              } catch (err) {
                payload.error = err?.message || 'Failed to load Composio connection'
              }
            }
            return payload
          }

          server.middlewares.use('/api/composio/status', async (req, res) => {
            if (req.method !== 'GET') {
              sendJson(res, 405, { error: 'Method not allowed' })
              return
            }
            try {
              sendJson(res, 200, await getComposioStatusPayload())
            } catch (err) {
              sendJson(res, 500, { error: err?.message || 'Failed to load Composio status' })
            }
          })

          server.middlewares.use('/api/composio/env', async (req, res) => {
            if (req.method !== 'POST') {
              sendJson(res, 405, { error: 'Method not allowed' })
              return
            }
            try {
              const body = await readRequestJson(req)
              const apiKey = String(body?.api_key || '').trim()
              if (!apiKey) {
                sendJson(res, 400, { error: 'Composio API key is required' })
                return
              }
              await writeLocalEnv(rootDir, { COMPOSIO_API_KEY: apiKey })
              process.env.COMPOSIO_API_KEY = apiKey
              sendJson(res, 200, { ok: true, status: await getComposioStatusPayload() })
            } catch (err) {
              sendJson(res, 500, { error: err?.message || 'Failed to save Composio key' })
            }
          })

          server.middlewares.use('/api/composio/connect', async (req, res) => {
            if (req.method !== 'POST') {
              sendJson(res, 405, { error: 'Method not allowed' })
              return
            }
            try {
              const cfg = await getComposioConfig(rootDir, env)
              if (!cfg.apiKey) {
                sendJson(res, 400, { error: 'Save your Composio API key first.' })
                return
              }

              const composio = await getComposioClient(cfg.apiKey)
              const updates = {}

              let userId = cfg.userId
              if (!userId) {
                userId = makeComposioUserId()
                updates.COMPOSIO_USER_ID = userId
              }

              let authConfigId = cfg.authConfigId
              if (!authConfigId) {
                try {
                  const created = await composio.authConfigs.create('googlecalendar', {
                    type: 'use_composio_managed_auth',
                    name: 'Personal CRM Google Calendar',
                  })
                  authConfigId = created?.id || created?.auth_config?.id || created?.authConfig?.id
                } catch (createErr) {
                  sendJson(res, 502, {
                    error: `Could not create a Composio auth config automatically: ${createErr?.message || createErr}. Create one for the googlecalendar toolkit at https://platform.composio.dev/ and add COMPOSIO_AUTH_CONFIG_ID=ac_... to your .env.`,
                  })
                  return
                }
                if (!authConfigId) {
                  sendJson(res, 502, { error: 'Composio did not return an auth config id.' })
                  return
                }
                updates.COMPOSIO_AUTH_CONFIG_ID = authConfigId
              }

              const connection = await composio.connectedAccounts.initiate(userId, authConfigId)
              const connectionId = connection?.id
              const redirectUrl = connection?.redirectUrl || null
              if (!connectionId) {
                sendJson(res, 502, { error: 'Composio did not return a connection id.' })
                return
              }
              updates.COMPOSIO_CONNECTION_ID = connectionId

              await writeLocalEnv(rootDir, updates)
              for (const [k, v] of Object.entries(updates)) process.env[k] = v

              sendJson(res, 200, {
                ok: true,
                connection_id: connectionId,
                redirect_url: redirectUrl,
                user_id: userId,
                auth_config_id: authConfigId,
              })
            } catch (err) {
              sendJson(res, 500, { error: err?.message || 'Failed to start Google Calendar connection' })
            }
          })

          server.middlewares.use('/api/composio/disconnect', async (req, res) => {
            if (req.method !== 'POST') {
              sendJson(res, 405, { error: 'Method not allowed' })
              return
            }
            try {
              const cfg = await getComposioConfig(rootDir, env)
              if (cfg.apiKey && cfg.connectionId) {
                try {
                  const composio = await getComposioClient(cfg.apiKey)
                  await composio.connectedAccounts.delete(cfg.connectionId)
                } catch (err) {
                  // Continue: clear local state even if Composio delete failed.
                  console.warn('[composio] disconnect failed:', err?.message || err)
                }
              }
              await writeLocalEnv(rootDir, { COMPOSIO_CONNECTION_ID: '' })
              process.env.COMPOSIO_CONNECTION_ID = ''
              sendJson(res, 200, { ok: true, status: await getComposioStatusPayload() })
            } catch (err) {
              sendJson(res, 500, { error: err?.message || 'Failed to disconnect Google Calendar' })
            }
          })

          const syncSteps = [
            { script: 'export.py', label: 'Exporting WhatsApp chats' },
            { script: 'scripts/seed_watchlist.py', label: 'Building contacts and groups' },
            { script: 'scripts/bundle_chats_table.py', label: 'Publishing dashboard data' },
          ]
          const DEFAULT_STEP_ESTIMATES = {
            'export.py': 60,
            'scripts/seed_watchlist.py': 15,
            'scripts/bundle_chats_table.py': 5,
            'scripts/summarize.py': 90,
            'scripts/bundle_followups.py': 5,
            'scripts/extract_birthdays.py': 60,
          }
          const syncState = {
            id: null,
            running: false,
            status: 'idle',
            step_index: 0,
            total_steps: syncSteps.length,
            current_step: null,
            started_at: null,
            step_started_at: null,
            finished_at: null,
            completed_step_seconds: [],
            error: null,
            logs: '',
          }
          const birthdaysState = {
            running: false,
            status: 'idle',
            /** 'dm' | 'group' — which scope is currently running during generate */
            scope: 'dm',
            phase: 'scan',
            chats_done: 0,
            chats_total: 0,
            refs_found: 0,
            chats_left: 0,
            refs_done: 0,
            refs_total: 0,
            rows_ready: 0,
            started_at: null,
            finished_at: null,
            error: null,
            logs: '',
          }

          function appendBirthdayLog(text) {
            birthdaysState.logs = `${birthdaysState.logs}${text}`.slice(-30000)
          }

          function applyBirthdayProgressChunk(chunk) {
            const lines = String(chunk || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
            for (const line of lines) {
              if (!line.startsWith('PROGRESS ')) continue
              const payload = line.slice('PROGRESS '.length).trim()
              const tokens = payload.split(/\s+/)
              for (const token of tokens) {
                const [k, v] = token.split('=')
                if (!k || v == null) continue
                if (k === 'phase') birthdaysState.phase = v
                else if (['chats_done', 'chats_total', 'refs_found', 'chats_left', 'refs_done', 'refs_total', 'rows_ready'].includes(k)) {
                  const n = Number.parseInt(v, 10)
                  if (Number.isFinite(n)) birthdaysState[k] = n
                }
              }
            }
          }

          async function getSyncHistory() {
            const payload = await readJson(syncHistoryPath, {})
            return payload && typeof payload === 'object' ? payload : {}
          }

          async function appendSyncHistory(script, seconds) {
            if (!script || !Number.isFinite(seconds) || seconds < 0) return
            const history = await getSyncHistory()
            const current = Array.isArray(history[script]) ? history[script] : []
            const next = [...current, Math.round(seconds)].filter(value => Number.isFinite(value) && value >= 0).slice(-5)
            history[script] = next
            await writeFile(syncHistoryPath, JSON.stringify(history, null, 2), 'utf8')
          }

          function estimateStepSeconds(stepScript, syncHistory) {
            const sample = Array.isArray(syncHistory?.[stepScript]) ? syncHistory[stepScript] : []
            if (sample.length) {
              const avg = sample.reduce((sum, value) => sum + value, 0) / sample.length
              return Math.max(1, Math.round(avg))
            }
            return DEFAULT_STEP_ESTIMATES[stepScript] ?? 30
          }

          async function getSyncStatePayload() {
            const startedMs = syncState.started_at ? Date.parse(syncState.started_at) : null
            const stepStartedMs = syncState.step_started_at ? Date.parse(syncState.step_started_at) : null
            const finishedMs = syncState.finished_at ? Date.parse(syncState.finished_at) : null
            const endMs = finishedMs || Date.now()
            const elapsedSeconds = startedMs ? Math.max(0, Math.round((endMs - startedMs) / 1000)) : 0
            const currentStepElapsedSeconds = syncState.running && stepStartedMs
              ? Math.max(0, Math.round((Date.now() - stepStartedMs) / 1000))
              : 0
            const activeSteps = Array.isArray(syncState.active_steps) && syncState.active_steps.length
              ? syncState.active_steps
              : syncSteps
            const currentStepKey = activeSteps[syncState.step_index]?.script || null
            const syncHistory = await getSyncHistory()
            const currentStepEstimate = currentStepKey ? estimateStepSeconds(currentStepKey, syncHistory) : 0
            const remainingCurrentStepSeconds = Math.max(0, currentStepEstimate - currentStepElapsedSeconds)
            const estimatedFutureSeconds = activeSteps
              .slice(syncState.step_index + 1)
              .reduce((sum, step) => sum + estimateStepSeconds(step.script, syncHistory), 0)
            const estimatedRemainingSeconds = syncState.running
              ? Math.max(0, Math.round(remainingCurrentStepSeconds + estimatedFutureSeconds))
              : 0

            return {
              ...syncState,
              elapsed_seconds: elapsedSeconds,
              current_step_elapsed_seconds: currentStepElapsedSeconds,
              estimated_remaining_seconds: estimatedRemainingSeconds,
            }
          }

          function appendSyncLog(text) {
            syncState.logs = `${syncState.logs}${text}`.slice(-30000)
          }

          async function runSyncJob({ full, steps = syncSteps }) {
            syncState.id = `${Date.now()}`
            syncState.running = true
            syncState.status = 'running'
            syncState.step_index = 0
            syncState.active_steps = steps
            syncState.total_steps = steps.length
            syncState.current_step = steps[0]?.label || null
            syncState.started_at = new Date().toISOString()
            syncState.step_started_at = syncState.started_at
            syncState.finished_at = null
            syncState.completed_step_seconds = []
            syncState.error = null
            syncState.logs = ''

            try {
              for (let i = 0; i < steps.length; i += 1) {
                const step = steps[i]
                const args = step.script === 'export.py' && full ? ['--full'] : []
                syncState.step_index = i
                syncState.current_step = step.label
                syncState.step_started_at = new Date().toISOString()
                appendSyncLog(`\n$ ${step.script}${args.length ? ` ${args.join(' ')}` : ''}\n`)
                const result = await runPythonStep(step.script, args, appendSyncLog)
                const stepSeconds = Math.max(0, (Date.now() - Date.parse(syncState.step_started_at)) / 1000)
                syncState.completed_step_seconds.push(stepSeconds)
                await appendSyncHistory(step.script, stepSeconds)
                if (result.logs && !syncState.logs.includes(result.logs)) appendSyncLog(`${result.logs}\n`)
              }
              syncState.step_index = syncState.total_steps
              syncState.current_step = 'Done'
              syncState.step_started_at = null
              syncState.status = 'complete'
            } catch (err) {
              syncState.status = 'error'
              syncState.error = err?.message || 'Sync failed'
              appendSyncLog(`\n${syncState.error}\n`)
            } finally {
              syncState.running = false
              syncState.finished_at = new Date().toISOString()
              syncState.active_steps = null
            }
          }

          server.middlewares.use('/api/sync', async (req, res, next) => {
            if (req.url && req.url !== '/' && req.url !== '') {
              next()
              return
            }
            if (req.method !== 'POST') {
              sendJson(res, 405, { error: 'Method not allowed' })
              return
            }
            if (syncState.running) {
              sendJson(res, 202, await getSyncStatePayload())
              return
            }

            try {
              const body = await readRequestJson(req).catch(() => ({}))
              runSyncJob({ full: Boolean(body?.full) })
              sendJson(res, 202, await getSyncStatePayload())
            } catch (err) {
              sendJson(res, 500, { error: err?.message || 'Sync failed' })
            }
          })

          server.middlewares.use('/api/sync/status', async (req, res) => {
            if (req.method !== 'GET') {
              sendJson(res, 405, { error: 'Method not allowed' })
              return
            }
            sendJson(res, 200, await getSyncStatePayload())
          })

          server.middlewares.use('/api/chat', async (req, res) => {
            if (req.method !== 'POST') {
              res.statusCode = 405
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'Method not allowed' }))
              return
            }
            const { anthropicKey, anthropicModel } = await getAnthropicConfig(rootDir, env)
            if (!anthropicKey) {
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'Missing ANTHROPIC_API_KEY in .env' }))
              return
            }

            let raw = ''
            req.on('data', chunk => { raw += chunk })
            req.on('end', async () => {
              try {
                const body = raw ? JSON.parse(raw) : {}
                const messages = Array.isArray(body.messages) ? body.messages : []
                const prompt = (body.prompt || '').toString().trim()
                const history = []

                if (messages.length) {
                  for (const m of messages) {
                    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue
                    const text = textValue(m.content || '')
                    if (!text) continue
                    history.push({ role: m.role, content: text })
                  }
                } else if (prompt) {
                  history.push({ role: 'user', content: prompt })
                }

                if (!history.length) {
                  res.statusCode = 400
                  res.setHeader('Content-Type', 'application/json')
                  res.end(JSON.stringify({ error: 'No prompt provided' }))
                  return
                }

                const runtimeSystemPrompt = await loadCrmContext()
                const turnMessages = [...history]
                const toolCalls = []
                let finalText = ''

                for (let i = 0; i < 6; i += 1) {
                  const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: {
                      'content-type': 'application/json',
                      'x-api-key': anthropicKey,
                      'anthropic-version': '2023-06-01',
                    },
                    body: JSON.stringify({
                      model: anthropicModel,
                      max_tokens: 1200,
                      system: runtimeSystemPrompt,
                      tools: CRM_TOOLS,
                      messages: turnMessages,
                    }),
                  })

                  const json = await anthropicResp.json()
                  if (!anthropicResp.ok) {
                    res.statusCode = anthropicResp.status
                    res.setHeader('Content-Type', 'application/json')
                    res.end(JSON.stringify({ error: json?.error?.message || 'Anthropic request failed' }))
                    return
                  }

                  const content = Array.isArray(json?.content) ? json.content : []
                  turnMessages.push({ role: 'assistant', content })
                  const textBlocks = content.filter(block => block?.type === 'text')
                  finalText = textBlocks.map(block => block?.text || '').join('\n').trim()
                  const toolUseBlocks = content.filter(block => block?.type === 'tool_use')
                  if (!toolUseBlocks.length) break

                  const toolResults = []
                  for (const block of toolUseBlocks) {
                    const toolName = String(block?.name || '')
                    const toolInput = block?.input && typeof block.input === 'object' ? block.input : {}
                    let toolOutput = {}
                    let isError = false
                    try {
                      toolOutput = await executeTool(toolName, toolInput)
                    } catch (toolErr) {
                      isError = true
                      toolOutput = { error: toolErr?.message || 'Tool execution failed' }
                    }
                    toolCalls.push({
                      name: toolName,
                      input: toolInput,
                    })
                    toolResults.push({
                      type: 'tool_result',
                      tool_use_id: block.id,
                      content: JSON.stringify(toolOutput),
                      is_error: isError,
                    })
                  }
                  turnMessages.push({ role: 'user', content: toolResults })
                }

                res.statusCode = 200
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ message: finalText || '(empty response)', tool_calls: toolCalls }))
              } catch (err) {
                res.statusCode = 500
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ error: err?.message || 'Failed to process chat request' }))
              }
            })
          })

          server.middlewares.use('/api/people/watchlist', async (req, res) => {
            if (req.method !== 'POST') {
              sendJson(res, 405, { error: 'Method not allowed' })
              return
            }

            try {
              const body = await readRequestJson(req)
              const jid = String(body?.jid || '').trim()
              const onWatchlist = body?.on_watchlist

              if (!jid || typeof onWatchlist !== 'boolean') {
                sendJson(res, 400, { error: 'Expected jid and boolean on_watchlist' })
                return
              }

              const ok = await updateContactWatchlist(jid, onWatchlist)
              if (!ok) {
                sendJson(res, 404, { error: 'Contact not found' })
                return
              }

              PEOPLE_CACHE.key = null
              PEOPLE_CACHE.rows = null
              PEOPLE_CACHE.generatedAt = null

              sendJson(res, 200, { ok: true, jid, on_watchlist: onWatchlist })
            } catch (err) {
              sendJson(res, 500, { error: err?.message || 'Failed to update watchlist' })
            }
          })

          server.middlewares.use('/api/people', async (req, res, next) => {
            if (req.url && req.url !== '/' && req.url !== '') {
              next()
              return
            }
            if (req.method !== 'GET') {
              sendJson(res, 405, { error: 'Method not allowed' })
              return
            }

            try {
              const payload = await getPeopleRows(rootDir)
              sendJson(res, 200, payload)
            } catch (err) {
              sendJson(res, 500, { error: err?.message || 'Failed to load people' })
            }
          })

          server.middlewares.use('/api/people/profile', async (req, res) => {
            if (req.method !== 'POST') {
              sendJson(res, 405, { error: 'Method not allowed' })
              return
            }
            try {
              const body = await readRequestJson(req)
              const jid = String(body?.jid || '').trim()
              if (!jid) {
                sendJson(res, 400, { error: 'Expected jid' })
                return
              }
              const updated = await updateContactProfile(jid, body?.patch || {})
              if (!updated) {
                sendJson(res, 404, { error: 'Contact not found' })
                return
              }
              sendJson(res, 200, { ok: true, contact: updated })
            } catch (err) {
              sendJson(res, 500, { error: err?.message || 'Failed to update profile' })
            }
          })

          server.middlewares.use('/api/calls', async (req, res) => {
            if (req.method !== 'GET') {
              sendJson(res, 405, { error: 'Method not allowed' })
              return
            }
            try {
              const calls = await getWhatsAppCalls(rootDir)
              sendJson(res, 200, { generated_at: new Date().toISOString(), calls })
            } catch (err) {
              sendJson(res, 500, { error: err?.message || 'Failed to load calls' })
            }
          })

          server.middlewares.use('/api/people/photo', async (req, res) => {
            if (req.method !== 'GET') {
              sendJson(res, 405, { error: 'Method not allowed' })
              return
            }
            try {
              const url = new URL(req.url || '', 'http://localhost')
              const jid = String(url.searchParams.get('jid') || '').trim()
              if (!jid) {
                sendJson(res, 400, { error: 'Expected jid' })
                return
              }
              const photoIndex = await getWhatsAppPhotoIndex(rootDir)
              const photoPath = photoIndex.get(jid) || null
              if (!photoPath) {
                sendJson(res, 404, { error: 'Photo not found' })
                return
              }
              const bytes = await readFile(photoPath)
              res.statusCode = 200
              res.setHeader('Content-Type', 'image/jpeg')
              res.setHeader('Cache-Control', 'no-store')
              res.end(bytes)
            } catch (err) {
              sendJson(res, 500, { error: err?.message || 'Failed to load photo' })
            }
          })

          server.middlewares.use('/api/followups', async (req, res, next) => {
            if (req.url && req.url !== '/' && req.url !== '') {
              next()
              return
            }
            if (req.method !== 'GET') {
              sendJson(res, 405, { error: 'Method not allowed' })
              return
            }
            try {
              const payload = await loadActiveFollowups()
              sendJson(res, 200, payload)
            } catch (err) {
              sendJson(res, 500, { error: err?.message || 'Failed to load followups' })
            }
          })

          server.middlewares.use('/api/followups/engage', async (req, res) => {
            if (req.method !== 'POST') {
              sendJson(res, 405, { error: 'Method not allowed' })
              return
            }
            try {
              const body = await readRequestJson(req)
              const followupId = String(body?.followup_id || '').trim()
              const actionType = String(body?.action_type || '').trim()
              const feedbackText = String(body?.feedback_text || '').trim()
              const jid = String(body?.jid || '').trim()
              const topic = String(body?.topic || '').trim()

              if (!followupId || !jid || !['done', 'useless', 'feedback'].includes(actionType)) {
                sendJson(res, 400, { error: 'Expected followup_id, jid, and action_type done|useless|feedback' })
                return
              }
              if (actionType === 'feedback' && !feedbackText) {
                sendJson(res, 400, { error: 'feedback_text is required for feedback action' })
                return
              }

              const statePayload = await readJson(followupStatePath, { updated_at: null, items: {} })
              const stateItems = statePayload?.items && typeof statePayload.items === 'object' ? statePayload.items : {}
              stateItems[followupId] = {
                status: actionType,
                engaged_at: new Date().toISOString(),
                feedback_text: actionType === 'feedback' ? feedbackText : '',
                jid,
              }
              const nextState = { updated_at: new Date().toISOString(), items: stateItems }
              await writeFile(followupStatePath, JSON.stringify(nextState, null, 2), 'utf8')
              await appendJsonl(followupFeedbackPath, {
                ts: new Date().toISOString(),
                followup_id: followupId,
                jid,
                action_type: actionType,
                text: actionType === 'feedback' ? feedbackText : '',
                ui_context: { topic },
              })

              let judgeResult = { queued: false, reason: 'ignored_action' }
              if (actionType === 'feedback') {
                judgeResult = await judgeFeedbackAndQueue({ followupId, jid, feedbackText, topic })
              }
              sendJson(res, 200, {
                ok: true,
                followup_id: followupId,
                action_type: actionType,
                judge: judgeResult,
              })
            } catch (err) {
              sendJson(res, 500, { error: err?.message || 'Failed to record followup action' })
            }
          })

          server.middlewares.use('/api/reviews', async (req, res) => {
            if (req.method === 'GET') {
              try {
                const queuePayload = await readJson(reviewQueuePath, { generated_at: null, items: [] })
                sendJson(res, 200, queuePayload)
              } catch (err) {
                sendJson(res, 500, { error: err?.message || 'Failed to load review queue' })
              }
              return
            }

            if (req.method !== 'POST') {
              sendJson(res, 405, { error: 'Method not allowed' })
              return
            }
            try {
              const body = await readRequestJson(req)
              const proposalId = String(body?.id || '').trim()
              const decision = String(body?.decision || '').trim()
              if (!proposalId || !['approve', 'reject'].includes(decision)) {
                sendJson(res, 400, { error: 'Expected id and decision approve|reject' })
                return
              }

              const queuePayload = await readJson(reviewQueuePath, { generated_at: null, items: [] })
              const items = Array.isArray(queuePayload?.items) ? queuePayload.items : []
              const idx = items.findIndex(row => row?.id === proposalId)
              if (idx < 0) {
                sendJson(res, 404, { error: 'Proposal not found' })
                return
              }
              const proposal = items[idx]
              if (proposal?.status !== 'pending') {
                sendJson(res, 409, { error: `Proposal already ${proposal?.status || 'processed'}` })
                return
              }

              if (decision === 'approve') {
                if (proposal?.target_type === 'contact_context') {
                  const contactsPayload = await readJson(outputContactsPath, { contacts: [] })
                  const contacts = Array.isArray(contactsPayload?.contacts) ? contactsPayload.contacts : []
                  const contact = contacts.find(c => c?.jid === proposal?.jid)
                  if (!contact) {
                    sendJson(res, 404, { error: 'Target contact not found for proposal' })
                    return
                  }
                  const nextContext = normalizeContextPatch(
                    proposal?.proposed_after?.context || {},
                    contact?.context || {},
                  )
                  contact.context = nextContext
                  contact.updated_at = new Date().toISOString()
                  contactsPayload.generated_at = new Date().toISOString()
                  const serialized = JSON.stringify(contactsPayload, null, 2)
                  await writeFile(outputContactsPath, serialized, 'utf8')
                  await writeFile(publicContactsPath, serialized, 'utf8')
                } else if (proposal?.target_type === 'system_prompt') {
                  const appendText = String(proposal?.proposed_after?.system_prompt_append || '').trim()
                  if (appendText) {
                    const current = await readFile(followupsSystemPromptPath, 'utf8')
                    const next = current.trimEnd() + `\n- ${appendText}\n`
                    await writeFile(followupsSystemPromptPath, next, 'utf8')
                  }
                }
              }

              items[idx] = {
                ...proposal,
                status: decision === 'approve' ? 'approved' : 'rejected',
                reviewed_at: new Date().toISOString(),
              }
              const nextQueue = {
                generated_at: new Date().toISOString(),
                items,
              }
              await writeFile(reviewQueuePath, JSON.stringify(nextQueue, null, 2), 'utf8')
              sendJson(res, 200, { ok: true, id: proposalId, status: items[idx].status })
            } catch (err) {
              sendJson(res, 500, { error: err?.message || 'Failed to apply review decision' })
            }
          })

          let isSyncingFollowups = false
          server.middlewares.use('/api/sync-followups', async (req, res) => {
            if (req.method !== 'POST') {
              res.statusCode = 405
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'Method not allowed' }))
              return
            }
            if (isSyncingFollowups) {
              res.statusCode = 409
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'Follow-ups regeneration already in progress' }))
              return
            }

            isSyncingFollowups = true
            try {
              const summarize = spawn('.venv/bin/python', ['scripts/summarize.py', '--rebuild'], {
                cwd: process.cwd(),
                stdio: ['ignore', 'pipe', 'pipe'],
              })

              const summarizeResult = await new Promise((resolve, reject) => {
                let stdout = ''
                let stderr = ''
                summarize.stdout.on('data', chunk => { stdout += String(chunk) })
                summarize.stderr.on('data', chunk => { stderr += String(chunk) })
                summarize.on('error', reject)
                summarize.on('close', code => {
                  if (code === 0) resolve({ stdout, stderr })
                  else reject(new Error(stderr || stdout || `summarize.py failed with exit code ${code}`))
                })
              })

              const bundle = spawn('.venv/bin/python', ['scripts/bundle_followups.py'], {
                cwd: process.cwd(),
                stdio: ['ignore', 'pipe', 'pipe'],
              })
              const bundleResult = await new Promise((resolve, reject) => {
                let stdout = ''
                let stderr = ''
                bundle.stdout.on('data', chunk => { stdout += String(chunk) })
                bundle.stderr.on('data', chunk => { stderr += String(chunk) })
                bundle.on('error', reject)
                bundle.on('close', code => {
                  if (code === 0) resolve({ stdout, stderr })
                  else reject(new Error(stderr || stdout || `bundle_followups.py failed with exit code ${code}`))
                })
              })

              res.statusCode = 200
              res.setHeader('Content-Type', 'application/json')
              res.end(
                JSON.stringify({
                  ok: true,
                  message: 'Follow-ups regenerated',
                  logs: [summarizeResult.stdout, summarizeResult.stderr, bundleResult.stdout, bundleResult.stderr]
                    .filter(Boolean)
                    .join('\n')
                    .trim(),
                }),
              )
            } catch (err) {
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: err?.message || 'Failed to regenerate follow-ups' }))
            } finally {
              isSyncingFollowups = false
            }
          })

          server.middlewares.use('/api/sync-birthdays', async (req, res) => {
            if (req.method !== 'POST') {
              sendJson(res, 405, { error: 'Method not allowed' })
              return
            }
            if (syncState.running || birthdaysState.running) {
              sendJson(res, 409, { error: 'Another sync job is already in progress' })
              return
            }

            birthdaysState.running = true
            birthdaysState.status = 'running'
            birthdaysState.scope = 'dm'
            birthdaysState.phase = 'scan'
            birthdaysState.chats_done = 0
            birthdaysState.chats_total = 0
            birthdaysState.refs_found = 0
            birthdaysState.chats_left = 0
            birthdaysState.refs_done = 0
            birthdaysState.refs_total = 0
            birthdaysState.rows_ready = 0
            birthdaysState.started_at = new Date().toISOString()
            birthdaysState.finished_at = null
            birthdaysState.error = null
            birthdaysState.logs = ''

            ;(async () => {
              try {
                appendBirthdayLog(`\n$ scripts/extract_birthdays.py --scope dm\n`)
                const resultDm = await runPythonStep('scripts/extract_birthdays.py', ['--scope', 'dm'], chunk => {
                  appendBirthdayLog(chunk)
                  applyBirthdayProgressChunk(chunk)
                })
                if (resultDm.logs && !birthdaysState.logs.includes(resultDm.logs)) appendBirthdayLog(`${resultDm.logs}\n`)

                birthdaysState.scope = 'group'
                birthdaysState.phase = 'scan'
                birthdaysState.chats_done = 0
                birthdaysState.chats_total = 0
                birthdaysState.refs_found = 0
                birthdaysState.chats_left = 0
                birthdaysState.refs_done = 0
                birthdaysState.refs_total = 0
                birthdaysState.rows_ready = 0
                appendBirthdayLog(`\n$ scripts/extract_birthdays.py --scope group\n`)
                const resultGroup = await runPythonStep('scripts/extract_birthdays.py', ['--scope', 'group'], chunk => {
                  appendBirthdayLog(chunk)
                  applyBirthdayProgressChunk(chunk)
                })
                if (resultGroup.logs && !birthdaysState.logs.includes(resultGroup.logs)) {
                  appendBirthdayLog(`${resultGroup.logs}\n`)
                }
                birthdaysState.status = 'complete'
                birthdaysState.scope = 'dm'
              } catch (err) {
                birthdaysState.status = 'error'
                birthdaysState.error = err?.message || 'Birthday generation failed'
                appendBirthdayLog(`\n${birthdaysState.error}\n`)
              } finally {
                birthdaysState.running = false
                birthdaysState.finished_at = new Date().toISOString()
                birthdaysState.scope = 'dm'
              }
            })()

            sendJson(res, 202, birthdaysState)
          })

          server.middlewares.use('/api/sync-birthdays-groups', async (req, res) => {
            if (req.method !== 'POST') {
              sendJson(res, 405, { error: 'Method not allowed' })
              return
            }
            if (syncState.running || birthdaysState.running) {
              sendJson(res, 409, { error: 'Another sync job is already in progress' })
              return
            }

            birthdaysState.running = true
            birthdaysState.status = 'running'
            birthdaysState.scope = 'group'
            birthdaysState.phase = 'scan'
            birthdaysState.chats_done = 0
            birthdaysState.chats_total = 0
            birthdaysState.refs_found = 0
            birthdaysState.chats_left = 0
            birthdaysState.refs_done = 0
            birthdaysState.refs_total = 0
            birthdaysState.rows_ready = 0
            birthdaysState.started_at = new Date().toISOString()
            birthdaysState.finished_at = null
            birthdaysState.error = null
            birthdaysState.logs = ''

            ;(async () => {
              try {
                appendBirthdayLog(`\n$ scripts/extract_birthdays.py --scope group\n`)
                const result = await runPythonStep('scripts/extract_birthdays.py', ['--scope', 'group'], chunk => {
                  appendBirthdayLog(chunk)
                  applyBirthdayProgressChunk(chunk)
                })
                birthdaysState.status = 'complete'
                if (result.logs && !birthdaysState.logs.includes(result.logs)) appendBirthdayLog(`${result.logs}\n`)
              } catch (err) {
                birthdaysState.status = 'error'
                birthdaysState.error = err?.message || 'Group birthday generation failed'
                appendBirthdayLog(`\n${birthdaysState.error}\n`)
              } finally {
                birthdaysState.running = false
                birthdaysState.finished_at = new Date().toISOString()
                birthdaysState.scope = 'dm'
              }
            })()

            sendJson(res, 202, birthdaysState)
          })

          server.middlewares.use('/api/birthdays', async (req, res, next) => {
            if (req.url && req.url !== '/' && req.url !== '') {
              next()
              return
            }
            if (req.method !== 'GET') {
              sendJson(res, 405, { error: 'Method not allowed' })
              return
            }
            try {
              const payload = await readJson(birthdaysDataPath, { generated_at: null, items: [] })
              sendJson(res, 200, payload)
            } catch (err) {
              sendJson(res, 500, { error: err?.message || 'Failed to load birthdays' })
            }
          })

          server.middlewares.use('/api/birthdays/update', async (req, res) => {
            if (req.method !== 'POST') {
              sendJson(res, 405, { error: 'Method not allowed' })
              return
            }
            try {
              const body = await readRequestJson(req)
              const chatPersonJid = String(body?.chat_person_jid || '').trim()
              const referencePk = body?.reference_pk
              const birthdayPersonName = String(body?.birthday_person_name || '').trim() || 'Unknown'
              const date = String(body?.date || '').trim()
              if (!chatPersonJid || referencePk == null) {
                sendJson(res, 400, { error: 'Expected chat_person_jid and reference_pk' })
                return
              }
              if (!/^\d{2}-[A-Za-z]{3}$/.test(date)) {
                sendJson(res, 400, { error: 'Expected date in DD-MMM format (e.g. 08-May)' })
                return
              }
              const normalizedDate = `${date.slice(0, 2)}-${date.slice(3, 4).toUpperCase()}${date.slice(4).toLowerCase()}`

              const payload = await readJson(birthdaysDataPath, { generated_at: null, items: [] })
              const items = Array.isArray(payload?.items) ? payload.items : []
              const idx = items.findIndex(item =>
                String(item?.chat_person_jid || '').trim() === chatPersonJid
                && String(item?.reference_pk ?? '') === String(referencePk),
              )
              if (idx < 0) {
                sendJson(res, 404, { error: 'Birthday row not found' })
                return
              }

              const updated = {
                ...items[idx],
                birthday_person_name: birthdayPersonName,
                date: normalizedDate,
                confidence: birthdayPersonName.toLowerCase() === 'unknown'
                  ? 0
                  : Math.max(Number(items[idx]?.confidence || 0), 0.99),
                edited_manually: true,
                edited_at: new Date().toISOString(),
              }
              items[idx] = updated
              const nextPayload = {
                ...payload,
                generated_at: new Date().toISOString(),
                items,
              }
              await writeFile(birthdaysDataPath, JSON.stringify(nextPayload, null, 2), 'utf8')
              sendJson(res, 200, { ok: true, item: updated })
            } catch (err) {
              sendJson(res, 500, { error: err?.message || 'Failed to update birthday row' })
            }
          })

          server.middlewares.use('/api/birthdays/reminder', async (req, res) => {
            if (req.method !== 'POST') {
              sendJson(res, 405, { error: 'Method not allowed' })
              return
            }
            try {
              const body = await readRequestJson(req)
              const birthdayPersonName = String(body?.birthday_person_name || '').trim()
              const rawDate = String(body?.date || '').trim()
              if (!birthdayPersonName || birthdayPersonName.toLowerCase() === 'unknown') {
                sendJson(res, 400, { error: 'Expected a resolved birthday person name' })
                return
              }
              const match = rawDate.match(/^(\d{2})-([A-Za-z]{3})$/)
              if (!match) {
                sendJson(res, 400, { error: 'Expected date in DD-MMM format (e.g. 08-May)' })
                return
              }

              const composioStatus = await getComposioStatusPayload()
              if (!composioStatus?.has_api_key || String(composioStatus?.connection_status || '').toUpperCase() !== 'ACTIVE') {
                sendJson(res, 400, { error: 'complete calendar setup' })
                return
              }

              const monthName = `${match[2][0].toUpperCase()}${match[2].slice(1).toLowerCase()}`
              const monthIndex = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(monthName)
              const day = Number(match[1])
              if (monthIndex < 0 || day < 1 || day > 31) {
                sendJson(res, 400, { error: 'Expected date in DD-MMM format (e.g. 08-May)' })
                return
              }

              const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
              const nowMs = Date.now()
              const nowIst = new Date(nowMs + IST_OFFSET_MS)
              const thisYear = nowIst.getUTCFullYear()
              const candidateMs = year => (
                Date.UTC(year, monthIndex, day, 22, 0, 0) - IST_OFFSET_MS - (24 * 60 * 60 * 1000)
              )
              let startMs = candidateMs(thisYear)
              if (startMs <= nowMs) startMs = candidateMs(thisYear + 1)
              const endMs = startMs + (30 * 60 * 1000)
              const fmtIst = ms => {
                const d = new Date(ms + IST_OFFSET_MS)
                const y = d.getUTCFullYear()
                const m = String(d.getUTCMonth() + 1).padStart(2, '0')
                const dd = String(d.getUTCDate()).padStart(2, '0')
                const hh = String(d.getUTCHours()).padStart(2, '0')
                const mm = String(d.getUTCMinutes()).padStart(2, '0')
                return `${y}-${m}-${dd}T${hh}:${mm}:00+05:30`
              }

              const { apiKey, userId, connectionId } = await getComposioConfig(rootDir, env)
              if (!apiKey || !userId || !connectionId) {
                sendJson(res, 400, { error: 'complete calendar setup' })
                return
              }

              try {
                const composio = await getComposioClient(apiKey)
                const result = await composio.tools.execute('GOOGLECALENDAR_CREATE_EVENT', {
                  userId,
                  connectedAccountId: connectionId,
                  arguments: {
                    calendar_id: 'primary',
                    summary: `${birthdayPersonName}'s birthday`,
                    start_datetime: fmtIst(startMs),
                    end_datetime: fmtIst(endMs),
                    timezone: 'Asia/Kolkata',
                    recurrence: ['RRULE:FREQ=YEARLY'],
                  },
                  dangerouslySkipVersionCheck: true,
                })
                if (result?.successful === false || result?.error) {
                  sendJson(res, 400, { error: 'complete calendar setup' })
                  return
                }
                sendJson(res, 200, { ok: true, message: 'reminder_set' })
              } catch {
                sendJson(res, 400, { error: 'complete calendar setup' })
              }
            } catch (err) {
              sendJson(res, 500, { error: err?.message || 'Failed to create reminder' })
            }
          })

          server.middlewares.use('/api/birthdays/status', async (req, res) => {
            if (req.method !== 'GET') {
              sendJson(res, 405, { error: 'Method not allowed' })
              return
            }
            sendJson(res, 200, birthdaysState)
          })

          server.middlewares.use('/api/birthdays/groups', async (req, res, next) => {
            if (req.url && req.url !== '/' && req.url !== '') {
              next()
              return
            }
            if (req.method !== 'GET') {
              sendJson(res, 405, { error: 'Method not allowed' })
              return
            }
            try {
              const payload = await readJson(groupBirthdaysDataPath, { generated_at: null, items: [] })
              sendJson(res, 200, payload)
            } catch (err) {
              sendJson(res, 500, { error: err?.message || 'Failed to load group birthdays' })
            }
          })
        },
      },
    ],
    build: {
      target: 'es2020',
    },
    server: {
      port: 5173,
    },
  }
})
