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
  const indexPath = path.join(rootDir, 'output', 'index.json')

  const contactsPayload = await readJson(contactsPath, { contacts: [], generated_at: null })
  const followupsPayload = await readJson(followupsPath, { items: [] })
  const indexRows = await readJson(indexPath, [])

  const contacts = Array.isArray(contactsPayload?.contacts) ? contactsPayload.contacts : []
  const photoIndex = await getWhatsAppPhotoIndex(rootDir)
  const followups = Array.isArray(followupsPayload?.items) ? followupsPayload.items : []
  const dmIndexByJid = new Map()
  const followupsByKey = new Map()

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

      return {
        ...contact,
        relation: contact?.context?.relation || contact?.relation || '',
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
          const followupsSystemPromptPath = path.join(promptsDir, 'followups_system_prompt.txt')

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

          async function runPythonStep(script, args = []) {
            return await new Promise((resolve, reject) => {
              const child = spawn('.venv/bin/python', [script, ...args], {
                cwd: rootDir,
                stdio: ['ignore', 'pipe', 'pipe'],
              })
              let stdout = ''
              let stderr = ''
              child.stdout.on('data', chunk => { stdout += String(chunk) })
              child.stderr.on('data', chunk => { stderr += String(chunk) })
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

          let isSyncingAll = false
          server.middlewares.use('/api/sync', async (req, res) => {
            if (req.method !== 'POST') {
              sendJson(res, 405, { error: 'Method not allowed' })
              return
            }
            if (isSyncingAll) {
              sendJson(res, 409, { error: 'Sync already in progress' })
              return
            }

            isSyncingAll = true
            try {
              const body = await readRequestJson(req).catch(() => ({}))
              const exportArgs = body?.full ? ['--full'] : []
              const steps = [
                ['export.py', exportArgs],
                ['scripts/seed_watchlist.py', []],
                ['scripts/summarize.py', []],
                ['scripts/bundle_followups.py', []],
                ['scripts/bundle_chats_table.py', []],
              ]
              const results = []
              for (const [script, args] of steps) {
                results.push(await runPythonStep(script, args))
              }
              sendJson(res, 200, {
                ok: true,
                message: 'Sync complete',
                logs: results.map(r => `$ ${r.script}\n${r.logs}`).join('\n\n').trim(),
                status: await getSetupStatus(),
              })
            } catch (err) {
              sendJson(res, 500, { error: err?.message || 'Sync failed' })
            } finally {
              isSyncingAll = false
            }
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
                    const text = (m.content || '').toString()
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
                    system: 'You are a helpful assistant for general Q&A.',
                    messages: history,
                  }),
                })

                const json = await anthropicResp.json()
                if (!anthropicResp.ok) {
                  res.statusCode = anthropicResp.status
                  res.setHeader('Content-Type', 'application/json')
                  res.end(JSON.stringify({ error: json?.error?.message || 'Anthropic request failed' }))
                  return
                }

                const textBlocks = Array.isArray(json?.content) ? json.content.filter(b => b?.type === 'text') : []
                const text = textBlocks.map(b => b.text || '').join('\n').trim()
                res.statusCode = 200
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ message: text }))
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
