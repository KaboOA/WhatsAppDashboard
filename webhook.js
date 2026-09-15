require('dotenv').config()
const express = require('express')
const path = require('path')
const cors = require('cors')
const { createClient } = require('@supabase/supabase-js')

const app = express()

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
  optionsSuccessStatus: 200
}))
app.options('*', cors())
app.use(express.json())
app.use(express.static(path.join(__dirname)))

// ── Supabase Client ────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// ── Parse ACCOUNTS from .env ───────────────────────────────────────────────────
let ACCOUNTS = {}
try {
  if (process.env.ACCOUNTS) {
    ACCOUNTS = JSON.parse(process.env.ACCOUNTS)
  }
} catch (e) {
  console.error('⚠️ Failed to parse ACCOUNTS from .env:', e.message)
}

// ── Whitelist of allowed phone number IDs & WABA mapping ───────────────────────
const rawPhoneMapping = (process.env.WA_ALLOWED_PHONE_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean)

const ALLOWED_PHONE_IDS = []
const PHONE_TO_WABA = {}

rawPhoneMapping.forEach(pair => {
  const [phoneId, wabaId] = pair.split(':').map(s => s.trim())
  if (phoneId) {
    ALLOWED_PHONE_IDS.push(phoneId)
    PHONE_TO_WABA[phoneId] = wabaId || process.env.WA_WABA_ID
  }
})

// Automatically whitelist all phone_number_ids from ACCOUNTS in .env
Object.values(ACCOUNTS).forEach(acc => {
  if (acc.phoneNumberId && !ALLOWED_PHONE_IDS.includes(acc.phoneNumberId)) {
    ALLOWED_PHONE_IDS.push(acc.phoneNumberId)
  }
  if (acc.phoneNumberId && acc.wabaId) {
    PHONE_TO_WABA[acc.phoneNumberId] = acc.wabaId
  }
})

console.log('📋 ACCOUNTS loaded:', Object.keys(ACCOUNTS).length)
console.log('📋 ALLOWED_PHONE_IDS:', JSON.stringify(ALLOWED_PHONE_IDS))
console.log('📋 PHONE_TO_WABA:', JSON.stringify(PHONE_TO_WABA))

// ── Helper: Resolve access token for a given phone ID ──────────────────────────
function getAccessTokenForPhoneId(phoneId) {
  const acc = Object.values(ACCOUNTS).find(a => a.phoneNumberId === phoneId)
  return acc?.accessToken || process.env.WA_ACCESS_TOKEN
}

// ── In-Memory Numbers Health Cache ─────────────────────────────────────────────
// Checks are 100% instant in RAM (0ms latency, 0 DB cost during message sending).
// Cache is automatically refreshed periodically (default 15 mins) and via Supabase Realtime.
const NUMBERS_CACHE_TTL_MS = parseInt(process.env.NUMBERS_CACHE_TTL_MS || '900000', 10) // 15 mins default
const NUMBERS_CACHE = {}
let LAST_NUMBERS_CACHE_UPDATE = 0
let isRefreshingCache = false

async function refreshNumbersCache(force = false) {
  if (isRefreshingCache && !force) return
  isRefreshingCache = true

  try {
    // 1. Initialize from in-memory / .env ACCOUNTS
    Object.values(ACCOUNTS).forEach(acc => {
      if (acc.phoneNumberId) {
        const hasIssue = acc.hasIssue === true || acc.has_issue === true || acc.isActive === false || acc.is_active === false
        NUMBERS_CACHE[acc.phoneNumberId] = {
          phoneNumberId: acc.phoneNumberId,
          label: acc.label || acc.phoneNumberId,
          hasIssue: hasIssue,
          isActive: !hasIssue,
          issueReason: hasIssue ? (acc.issueReason || acc.issue_reason || 'Marked with issue in accounts configuration') : null
        }
      }
    })

    // 2. Fetch latest status from Supabase numbers table (1 single batch query)
    const { data, error } = await supabase
      .from('numbers')
      .select('phone_number_id, "isActive", has_issue, issue_reason, label')

    if (!error && Array.isArray(data)) {
      data.forEach(row => {
        const phoneId = row.phone_number_id
        if (phoneId) {
          const hasIssue = row.has_issue === true || row.isActive === false
          NUMBERS_CACHE[phoneId] = {
            phoneNumberId: phoneId,
            label: row.label || NUMBERS_CACHE[phoneId]?.label || phoneId,
            hasIssue: hasIssue,
            isActive: !hasIssue,
            issueReason: hasIssue ? (row.issue_reason || 'Marked with issue in database') : null
          }
        }
      })
    }

    LAST_NUMBERS_CACHE_UPDATE = Date.now()
  } catch (err) {
    // Fallback gracefully to in-memory config
  } finally {
    isRefreshingCache = false
  }
}

// Initial cache load on server startup
refreshNumbersCache(true).catch(() => {})

// Realtime listener: updates cache instantly if database changes in Supabase
try {
  supabase
    .channel('numbers_status_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'numbers' }, payload => {
      const row = payload.new
      if (row && row.phone_number_id) {
        const hasIssue = row.has_issue === true || row.isActive === false
        NUMBERS_CACHE[row.phone_number_id] = {
          phoneNumberId: row.phone_number_id,
          label: row.label || NUMBERS_CACHE[row.phone_number_id]?.label || row.phone_number_id,
          hasIssue: hasIssue,
          isActive: !hasIssue,
          issueReason: hasIssue ? (row.issue_reason || 'Marked with issue in database') : null
        }
        console.log(`🔄 Realtime cache updated for number ${row.phone_number_id}: hasIssue=${hasIssue}`)
      }
    })
    .subscribe()
} catch (e) {
  // Realtime channel is optional
}

// ── Helper: Check whether a phone number ID has an issue or is disabled ─────────
async function checkPhoneNumberHealth(phoneId) {
  // 1. Whitelist validation
  if (!phoneId || !ALLOWED_PHONE_IDS.includes(phoneId)) {
    return {
      allowed: false,
      hasIssue: true,
      error: `Phone number ID "${phoneId}" is not in the whitelist.`,
      reason: 'Not in whitelist'
    }
  }

  // 2. Refresh cache in background if TTL has expired
  if (Date.now() - LAST_NUMBERS_CACHE_UPDATE > NUMBERS_CACHE_TTL_MS) {
    refreshNumbersCache().catch(() => {})
  }

  // 3. Instant In-Memory RAM Lookup (0ms, 0 DB cost)
  const cached = NUMBERS_CACHE[phoneId]
  if (cached && cached.hasIssue) {
    const reason = cached.issueReason || 'Number is marked with an issue'
    return {
      allowed: false,
      hasIssue: true,
      error: `Phone number ${phoneId} has an active issue and cannot send messages. (${reason})`,
      reason: reason,
      label: cached.label
    }
  }

  return { allowed: true, hasIssue: false, label: cached?.label }
}

// ── Serve Frontend ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'))
})

// ── POST /api/login — Validate phone & password against .env ACCOUNTS ─────────
app.post('/api/login', async (req, res) => {
  const { phone, password } = req.body || {}
  if (!phone || !password) {
    return res.status(400).json({ success: false, error: 'Phone number and password are required.' })
  }

  const cleanPhone = phone.trim()
  const account = ACCOUNTS[cleanPhone]

  if (!account || account.password !== password.trim()) {
    return res.status(401).json({ success: false, error: 'Invalid phone number or password.' })
  }

  const health = await checkPhoneNumberHealth(account.phoneNumberId)

  return res.json({
    success: true,
    account: {
      phone: cleanPhone,
      phoneNumberId: account.phoneNumberId,
      accessToken: account.accessToken,
      label: account.label || cleanPhone,
      hasIssue: health.hasIssue,
      isActive: health.allowed,
      issueReason: health.reason || null,
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNib3dpa2VjZGxpcmpjb2xlaHZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3MDE0NzQsImV4cCI6MjA4OTI3NzQ3NH0.z8CVfotwo7aRxSWYvTSqpkybbThT-F8g1p33KLQK7zs',
    }
  })
})

// ── GET /api/config — Public configuration for frontend ──────────────────────
app.get('/api/config', (req, res) => {
  res.json({
    backendUrl: process.env.BACKEND_URL || '',
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  })
})

// ── GET /api/numbers — List all registered numbers & their status ──────────────
app.get('/api/numbers', async (req, res) => {
  const numbersList = []
  for (const [phone, acc] of Object.entries(ACCOUNTS)) {
    const health = await checkPhoneNumberHealth(acc.phoneNumberId)
    numbersList.push({
      phone,
      phoneNumberId: acc.phoneNumberId,
      label: acc.label || phone,
      hasIssue: health.hasIssue,
      isActive: health.allowed,
      issueReason: health.reason || null,
    })
  }
  res.json({ success: true, count: numbersList.length, numbers: numbersList })
})

// ── POST /api/numbers/status — Update issue / active status of a number ────────
app.post('/api/numbers/status', async (req, res) => {
  const { phoneNumberId, hasIssue, isActive, issueReason } = req.body || {}

  if (!phoneNumberId) {
    return res.status(400).json({ success: false, error: 'phoneNumberId is required.' })
  }

  // 1. Update in-memory NUMBERS_CACHE instantly (0ms)
  if (!NUMBERS_CACHE[phoneNumberId]) {
    NUMBERS_CACHE[phoneNumberId] = { phoneNumberId, label: phoneNumberId }
  }
  if (typeof hasIssue === 'boolean') {
    NUMBERS_CACHE[phoneNumberId].hasIssue = hasIssue
    NUMBERS_CACHE[phoneNumberId].isActive = !hasIssue
  }
  if (typeof isActive === 'boolean') {
    NUMBERS_CACHE[phoneNumberId].isActive = isActive
    NUMBERS_CACHE[phoneNumberId].hasIssue = !isActive
  }
  if (typeof issueReason === 'string') {
    NUMBERS_CACHE[phoneNumberId].issueReason = issueReason
  } else if (hasIssue === false || isActive === true) {
    NUMBERS_CACHE[phoneNumberId].issueReason = null
  }

  // 2. Update in-memory ACCOUNTS object
  const acc = Object.values(ACCOUNTS).find(a => a.phoneNumberId === phoneNumberId)
  if (acc) {
    if (typeof hasIssue === 'boolean') acc.hasIssue = hasIssue
    if (typeof isActive === 'boolean') acc.isActive = isActive
    if (typeof issueReason === 'string') acc.issueReason = issueReason
    else if (hasIssue === false || isActive === true) acc.issueReason = null
  }

  // 3. Update Supabase numbers table in background if configured
  try {
    const updatePayload = {
      phone_number_id: phoneNumberId,
      updated_at: new Date().toISOString()
    }
    if (typeof hasIssue === 'boolean') updatePayload.has_issue = hasIssue
    if (typeof isActive === 'boolean') updatePayload['isActive'] = isActive
    if (issueReason !== undefined) updatePayload.issue_reason = issueReason

    await supabase.from('numbers').upsert(updatePayload, { onConflict: 'phone_number_id' })
  } catch (err) {
    console.warn('Could not sync to Supabase numbers table:', err.message)
  }

  const health = await checkPhoneNumberHealth(phoneNumberId)
  return res.json({
    success: true,
    phoneNumberId,
    hasIssue: health.hasIssue,
    isActive: health.allowed,
    issueReason: health.reason || null
  })
})

// ── GET /debug — Verify configuration ──────────────────────────────────────────
app.get('/debug', async (req, res) => {
  const accountsStatus = []
  for (const [phone, acc] of Object.entries(ACCOUNTS)) {
    const health = await checkPhoneNumberHealth(acc.phoneNumberId)
    accountsStatus.push({
      phone,
      phoneNumberId: acc.phoneNumberId,
      label: acc.label || phone,
      hasIssue: health.hasIssue,
      isActive: health.allowed,
      issueReason: health.reason || null
    })
  }

  res.json({
    accountCount: Object.keys(ACCOUNTS).length,
    allowedPhoneIds: ALLOWED_PHONE_IDS,
    phoneToWaba: PHONE_TO_WABA,
    accountsStatus,
    cache: {
      ttlMinutes: Math.round(NUMBERS_CACHE_TTL_MS / 60000),
      lastUpdated: LAST_NUMBERS_CACHE_UPDATE ? new Date(LAST_NUMBERS_CACHE_UPDATE).toISOString() : null,
      cachedCount: Object.keys(NUMBERS_CACHE).length
    },
    count: ALLOWED_PHONE_IDS.length,
    hasSupabaseUrl: !!process.env.SUPABASE_URL,
    hasAccessToken: !!process.env.WA_ACCESS_TOKEN,
    hasVerifyToken: !!process.env.WA_VERIFY_TOKEN,
    envRaw: process.env.WA_ALLOWED_PHONE_IDS || '(not set)',
  })
})

// ── GET: Meta webhook verification ─────────────────────────────────────────────
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  console.log('🔑 Webhook verify attempt — mode:', mode, 'token:', token)

  if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
    console.log('✅ Webhook verified by Meta')
    return res.status(200).send(challenge)
  }
  console.log('❌ Verification failed — token mismatch')
  res.sendStatus(403)
})

// ── POST: Incoming messages & status updates ────────────────────────────────────
app.post('/webhook', async (req, res) => {
  res.sendStatus(200)

  try {
    const entry = req.body.entry?.[0]
    const change = entry?.changes?.[0]
    const value = change?.value

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('📨 WEBHOOK HIT')
    console.log('   entry.id:', entry?.id)
    console.log('   field:', change?.field)
    console.log('   phone_number_id:', value?.metadata?.phone_number_id)
    console.log('   display_phone:', value?.metadata?.display_phone_number)
    console.log('   has messages:', !!(value?.messages?.length))
    console.log('   has statuses:', !!(value?.statuses?.length))
    console.log('   whitelist:', JSON.stringify(ALLOWED_PHONE_IDS))
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

    // Check against whitelist of allowed phone number IDs
    const incomingPhoneId = value?.metadata?.phone_number_id
    if (!incomingPhoneId) {
      console.log('⚠️ BLOCKED — no phone_number_id in payload')
      return
    }
    if (!ALLOWED_PHONE_IDS.includes(incomingPhoneId)) {
      console.log(`⚠️ BLOCKED — "${incomingPhoneId}" NOT in [${ALLOWED_PHONE_IDS.join(', ')}]`)
      return
    }
    console.log(`✅ ALLOWED — phone_number_id ${incomingPhoneId}`)

    const messages = value?.messages
    const statuses = value?.statuses

    // ── Handle delivery / read receipts ──
    if (statuses?.length) {
      for (const s of statuses) {
        const updateData = { status: s.status, phone_number_id: incomingPhoneId }

        if (s.status === 'failed' && s.errors?.length) {
          updateData.error = s.errors.map(e => e.title || e.message || JSON.stringify(e)).join('; ')
        }

        if (s.recipient_id) {
          updateData.contact_phone = '+' + s.recipient_id
        }

        const { error } = await supabase
          .from('messages')
          .update(updateData)
          .eq('id', s.id)

        if (error) console.error('Status update error:', error.message)
        else console.log(`📬 Status updated → ${s.id}: ${s.status}`)
      }
    }

    // ── Handle incoming text messages ──
    if (messages?.length) {
      for (const msg of messages) {
        if (msg.type !== 'text') {
          console.log(`⚠️  Skipping non-text message type: ${msg.type}`)
          continue
        }

        const contactPhone = '+' + msg.from
        const contact = value.contacts?.find(c => c.wa_id === msg.from)
        const name = contact?.profile?.name || contactPhone

        console.log(`📩 Incoming from ${name} (${contactPhone}): ${msg.text.body}`)

        const { error } = await supabase.from('messages').upsert({
          id: msg.id,
          phone_number_id: incomingPhoneId,
          contact_phone: contactPhone,
          contact_name: name,
          body: msg.text.body,
          direction: 'received',
          status: 'delivered',
          timestamp: parseInt(msg.timestamp) * 1000,
        }, { onConflict: 'id' })

        if (error) console.error('Insert error:', error.message)
        else console.log(`✅ Saved to Supabase (phone_number_id: ${incomingPhoneId})`)
      }
    }

  } catch (e) {
    console.error('Webhook crash:', e.message)
  }
})

// ── Helper: fetch template text from Meta & render with parameters ──────────────
async function renderTemplate(tempName, data, wabaId, token) {
  try {
    if (!wabaId) throw new Error('wabaId is missing')
    const authToken = token || process.env.WA_ACCESS_TOKEN
    const url = `https://graph.facebook.com/v21.0/${wabaId}/message_templates?name=${tempName}`
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    })
    const json = await res.json()

    const template = json.data?.[0]
    if (!template) return `[${tempName}] ${data?.join(' | ') || ''}`

    const bodyComp = template.components?.find(c => c.type === 'BODY')
    if (!bodyComp?.text) return `[${tempName}] ${data?.join(' | ') || ''}`

    let rendered = bodyComp.text
    if (data?.length) {
      data.forEach((val, i) => {
        rendered = rendered.replace(`{{${i + 1}}}`, val)
      })
    }

    return rendered
  } catch (e) {
    console.error('Template fetch error:', e.message)
    return `[${tempName}] ${data?.join(' | ') || ''}`
  }
}

// ── POST: Send a template message ───────────────────────────────────────────────
app.post('/send', async (req, res) => {
  let { to, tempName, data, phoneNumberId, language } = req.body

  if (!phoneNumberId) {
    phoneNumberId = '1057331837443942'
  }

  // Validate phoneNumberId health and issue status
  const health = await checkPhoneNumberHealth(phoneNumberId)
  if (!health.allowed) {
    console.log(`⚠️ /send blocked — phoneNumberId "${phoneNumberId}": ${health.error}`)
    const contactPhone = to ? (to.startsWith('+') ? to : '+' + to) : null

    if (contactPhone) {
      try {
        const wabaId = PHONE_TO_WABA[phoneNumberId]
        const token = getAccessTokenForPhoneId(phoneNumberId)
        const renderedBody = await renderTemplate(tempName, data, wabaId, token)
        await supabase.from('messages').insert({
          phone_number_id: phoneNumberId,
          contact_phone: contactPhone,
          body: renderedBody,
          direction: 'sent',
          status: 'failed',
          error: health.error,
          timestamp: Date.now(),
        })
      } catch (e) {
        console.error('Failed to log blocked send:', e.message)
      }
    }

    return res.status(400).json({
      success: false,
      error: health.error,
      reason: health.reason,
      hasIssue: true,
      phoneNumberId
    })
  }

  const token = getAccessTokenForPhoneId(phoneNumberId)
  const contactPhone = to.startsWith('+') ? to : '+' + to

  try {
    const metaRes = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: tempName,
            language: { code: language || 'en' },
            components: data?.length ? [
              {
                type: 'body',
                parameters: data.map(text => ({ type: 'text', text }))
              }
            ] : []
          }
        }),
      }
    )

    const metaData = await metaRes.json()

    // ── Meta API returned an error ──
    if (!metaRes.ok) {
      console.error('Meta API error:', metaData)

      const wabaId = PHONE_TO_WABA[phoneNumberId]
      const errorText = metaData.error?.message || JSON.stringify(metaData)
      const renderedBody = await renderTemplate(tempName, data, wabaId, token)

      const { error } = await supabase.from('messages').insert({
        phone_number_id: phoneNumberId,
        contact_phone: contactPhone,
        body: renderedBody,
        direction: 'sent',
        status: 'failed',
        error: errorText,
        timestamp: Date.now(),
      })
      if (error) {
        console.error('Failed to log error to Supabase:', error.message)
      }
      return res.status(500).json({ success: false, error: errorText })
    }

    // ── Success — save the sent message ──
    const wabaId = PHONE_TO_WABA[phoneNumberId]
    const msgId = metaData.messages?.[0]?.id
    const renderedBody = await renderTemplate(tempName, data, wabaId, token)

    const { error } = await supabase.from('messages').insert({
      id: msgId,
      phone_number_id: phoneNumberId,
      contact_phone: contactPhone,
      contact_name: null,
      body: renderedBody,
      direction: 'sent',
      status: 'sent',
      timestamp: Date.now(),
    })

    if (error) {
      console.error('Supabase insert error:', error.message)
      return res.json({ success: true, id: msgId, warning: error.message })
    }

    res.json({ success: true, id: msgId })

  } catch (e) {
    console.error('Send error:', e.message)

    const { error } = await supabase.from('messages').insert({
      phone_number_id: phoneNumberId,
      contact_phone: contactPhone,
      body: `[${tempName}] ${data?.join(' | ') || ''}`,
      direction: 'sent',
      status: 'failed',
      error: e.message,
      timestamp: Date.now(),
    })
    if (error) {
      console.error('Failed to log error to Supabase:', error.message)
    }
    res.status(500).json({ success: false, error: e.message })
  }
})

// ── POST: Send an OTP message ──────────────────────────────────────────────────
app.post('/send-otp', async (req, res) => {
  let { to, code, phoneNumberId, language } = req.body

  if (!phoneNumberId) {
    phoneNumberId = '1057331837443942'
  }

  // Validate phoneNumberId health and issue status
  const health = await checkPhoneNumberHealth(phoneNumberId)
  if (!health.allowed) {
    console.log(`⚠️ /send-otp blocked — phoneNumberId "${phoneNumberId}": ${health.error}`)
    const contactPhone = to ? (to.startsWith('+') ? to : '+' + to) : null

    if (contactPhone) {
      try {
        const wabaId = PHONE_TO_WABA[phoneNumberId]
        const token = getAccessTokenForPhoneId(phoneNumberId)
        const renderedBody = await renderTemplate('otp_temp', [code], wabaId, token)
        await supabase.from('messages').insert({
          phone_number_id: phoneNumberId,
          contact_phone: contactPhone,
          body: renderedBody,
          direction: 'sent',
          status: 'failed',
          error: health.error,
          timestamp: Date.now(),
        })
      } catch (e) {
        console.error('Failed to log blocked OTP send:', e.message)
      }
    }

    return res.status(400).json({
      success: false,
      error: health.error,
      reason: health.reason,
      hasIssue: true,
      phoneNumberId
    })
  }

  const token = getAccessTokenForPhoneId(phoneNumberId)
  const contactPhone = to.startsWith('+') ? to : '+' + to

  try {
    const metaRes = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: 'otp_temp',
            language: { code: language || 'en' },
            components: [
              {
                type: 'body',
                parameters: [{ type: 'text', text: code }]
              },
              {
                type: 'button',
                sub_type: 'url',
                index: '0',
                parameters: [
                  { type: 'text', text: code }
                ]
              }
            ],
          }
        }),
      }
    )

    const metaData = await metaRes.json()

    // ── Meta API returned an error ──
    if (!metaRes.ok) {
      console.error('Meta API error:', metaData)

      const wabaId = PHONE_TO_WABA[phoneNumberId]
      const errorText = metaData.error?.message || JSON.stringify(metaData)
      const renderedBody = await renderTemplate('otp_temp', [code], wabaId, token)

      const { error } = await supabase.from('messages').insert({
        phone_number_id: phoneNumberId,
        contact_phone: contactPhone,
        body: renderedBody,
        direction: 'sent',
        status: 'failed',
        error: errorText,
        timestamp: Date.now(),
      })
      if (error) {
        console.error('Failed to log error to Supabase:', error.message)
      }
      return res.status(500).json({ success: false, error: errorText })
    }

    // ── Success — save the sent message ──
    const wabaId = PHONE_TO_WABA[phoneNumberId]
    const msgId = metaData.messages?.[0]?.id
    const renderedBody = await renderTemplate('otp_temp', [code], wabaId, token)

    const { error } = await supabase.from('messages').insert({
      id: msgId,
      phone_number_id: phoneNumberId,
      contact_phone: contactPhone,
      contact_name: null,
      body: renderedBody,
      direction: 'sent',
      status: 'sent',
      timestamp: Date.now(),
    })

    if (error) {
      console.error('Supabase insert error:', error.message)
      return res.json({ success: true, id: msgId, warning: error.message })
    }

    res.json({ success: true, id: msgId })

  } catch (e) {
    console.error('Send error:', e.message)

    const { error } = await supabase.from('messages').insert({
      phone_number_id: phoneNumberId,
      contact_phone: contactPhone,
      body: `otp_temp ${code || ''}`,
      direction: 'sent',
      status: 'failed',
      error: e.message,
      timestamp: Date.now(),
    })
    if (error) {
      console.error('Failed to log error to Supabase:', error.message)
    }
    res.status(500).json({ success: false, error: e.message })
  }
})

// ── Start Server ───────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`🚀 Webhook & Dashboard server running on port ${PORT}`))