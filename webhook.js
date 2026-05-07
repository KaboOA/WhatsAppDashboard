
// add bool to stop from begin do number migration first.

// require('dotenv').config()
// const express = require('express')
// const { createClient } = require('@supabase/supabase-js')

// const app = express()
// app.use(express.json())

// const supabase = createClient(
//   process.env.SUPABASE_URL,
//   process.env.SUPABASE_SERVICE_ROLE_KEY
// )

// // ── Whitelist of allowed phone number IDs & WABA mapping ────────────────────
// // Comma-separated mapping in env: WA_ALLOWED_PHONE_IDS=111:waba1,222:waba2
// const rawPhoneMapping = (process.env.WA_ALLOWED_PHONE_IDS || '')
//   .split(',')
//   .map(id => id.trim())
//   .filter(Boolean)

// const ALLOWED_PHONE_IDS = []
// const PHONE_TO_WABA = {}

// rawPhoneMapping.forEach(pair => {
//   const [phoneId, wabaId] = pair.split(':').map(s => s.trim())
//   if (phoneId) {
//     ALLOWED_PHONE_IDS.push(phoneId)
//     PHONE_TO_WABA[phoneId] = wabaId || process.env.WA_WABA_ID
//   }
// })

// // Log on startup so you can verify in Railway logs
// console.log('📋 ALLOWED_PHONE_IDS:', JSON.stringify(ALLOWED_PHONE_IDS))
// console.log('📋 PHONE_TO_WABA:', JSON.stringify(PHONE_TO_WABA))

// // ── GET /debug — hit this in your browser to verify config ──────────────────
// app.get('/debug', (req, res) => {
//   res.json({
//     allowedPhoneIds: ALLOWED_PHONE_IDS,
//     phoneToWaba: PHONE_TO_WABA,
//     count: ALLOWED_PHONE_IDS.length,
//     hasSupabaseUrl: !!process.env.SUPABASE_URL,
//     hasAccessToken: !!process.env.WA_ACCESS_TOKEN,
//     hasVerifyToken: !!process.env.WA_VERIFY_TOKEN,
//     envRaw: process.env.WA_ALLOWED_PHONE_IDS || '(not set)',
//   })
// })

// // ── GET: Meta webhook verification ──────────────────────────────────────────
// app.get('/webhook', (req, res) => {
//   const mode = req.query['hub.mode']
//   const token = req.query['hub.verify_token']
//   const challenge = req.query['hub.challenge']

//   console.log('🔑 Webhook verify attempt — mode:', mode, 'token:', token)

//   if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
//     console.log('✅ Webhook verified by Meta')
//     return res.status(200).send(challenge)
//   }
//   console.log('❌ Verification failed — token mismatch')
//   res.sendStatus(403)
// })

// // ── POST: Incoming messages & status updates ─────────────────────────────────
// app.post('/webhook', async (req, res) => {
//   res.sendStatus(200)

//   try {
//     // ── DEBUG: log raw entry so we can see exactly what Meta sends ──
//     const entry = req.body.entry?.[0]
//     const change = entry?.changes?.[0]
//     const value = change?.value

//     console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
//     console.log('📨 WEBHOOK HIT')
//     console.log('   entry.id:', entry?.id)
//     console.log('   field:', change?.field)
//     console.log('   phone_number_id:', value?.metadata?.phone_number_id)
//     console.log('   display_phone:', value?.metadata?.display_phone_number)
//     console.log('   has messages:', !!(value?.messages?.length))
//     console.log('   has statuses:', !!(value?.statuses?.length))
//     console.log('   whitelist:', JSON.stringify(ALLOWED_PHONE_IDS))
//     console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

//     // Check against whitelist of allowed phone number IDs
//     const incomingPhoneId = value?.metadata?.phone_number_id
//     if (!incomingPhoneId) {
//       console.log('⚠️ BLOCKED — no phone_number_id in payload')
//       return
//     }
//     if (!ALLOWED_PHONE_IDS.includes(incomingPhoneId)) {
//       console.log(`⚠️ BLOCKED — "${incomingPhoneId}" NOT in [${ALLOWED_PHONE_IDS.join(', ')}]`)
//       console.log(`   typeof incomingPhoneId: ${typeof incomingPhoneId}`)
//       console.log(`   exact comparison with each:`)
//       ALLOWED_PHONE_IDS.forEach((id, i) => {
//         console.log(`     [${i}] "${id}" === "${incomingPhoneId}" → ${id === incomingPhoneId} (lengths: ${id.length} vs ${incomingPhoneId.length})`)
//       })
//       return
//     }

//     // Check if the number is active in Supabase
//     try {
//       const { data: numberData, error: numberError } = await supabase
//         .from('numbers')
//         .select('isActive')
//         .eq('phone_number_id', incomingPhoneId)
//         .single()

//       if (numberError && numberError.code !== 'PGRST116') {
//         console.error('Supabase numbers query error:', numberError.message)
//       }

//       if (numberData && numberData.isActive === false) {
//         console.log(`⚠️ BLOCKED — number ${incomingPhoneId} is marked inactive in database`)
//         return // Just return 200 (already sent) so Meta stops retrying
//       }
//     } catch (err) {
//       console.error('Exception checking number status:', err.message)
//     }

//     console.log(`✅ ALLOWED — phone_number_id ${incomingPhoneId}`)

//     const messages = value?.messages
//     const statuses = value?.statuses

//     // ── Handle delivery / read receipts ──
//     if (statuses?.length) {
//       for (const s of statuses) {
//         const updateData = { status: s.status, phone_number_id: incomingPhoneId }

//         // Capture error details from failed status updates
//         if (s.status === 'failed' && s.errors?.length) {
//           updateData.error = s.errors.map(e => e.title || e.message || JSON.stringify(e)).join('; ')
//         }

//         // Meta sends recipient_id on status updates — use it to fill contact_phone
//         if (s.recipient_id) {
//           updateData.contact_phone = '+' + s.recipient_id
//         }

//         const { error } = await supabase
//           .from('messages')
//           .update(updateData)
//           .eq('id', s.id)

//         if (error) console.error('Status update error:', error.message)
//         else console.log(`📬 Status updated → ${s.id}: ${s.status}`)
//       }
//     }

//     // ── Handle incoming text messages ──
//     if (messages?.length) {
//       for (const msg of messages) {
//         if (msg.type !== 'text') {
//           console.log(`⚠️  Skipping non-text message type: ${msg.type}`)
//           continue
//         }

//         const contactPhone = '+' + msg.from
//         const contact = value.contacts?.find(c => c.wa_id === msg.from)
//         const name = contact?.profile?.name || contactPhone

//         console.log(`📩 Incoming from ${name} (${contactPhone}): ${msg.text.body}`)

//         const { error } = await supabase.from('messages').upsert({
//           id: msg.id,
//           phone_number_id: incomingPhoneId,
//           contact_phone: contactPhone,
//           contact_name: name,
//           body: msg.text.body,
//           direction: 'received',
//           status: 'delivered',
//           timestamp: parseInt(msg.timestamp) * 1000,
//         }, { onConflict: 'id' })

//         if (error) console.error('Insert error:', error.message)
//         else console.log(`✅ Saved to Supabase (phone_number_id: ${incomingPhoneId})`)
//       }
//     }

//   } catch (e) {
//     console.error('Webhook crash:', e.message)
//   }
// })

// // ── Helper: fetch template text from Meta & render with parameters ───────────
// async function renderTemplate(tempName, data, wabaId) {
//   try {
//     if (!wabaId) throw new Error('wabaId is missing')
//     const url = `https://graph.facebook.com/v21.0/${wabaId}/message_templates?name=${tempName}`
//     const res = await fetch(url, {
//       headers: { 'Authorization': `Bearer ${process.env.WA_ACCESS_TOKEN}` }
//     })
//     const json = await res.json()

//     const template = json.data?.[0]
//     if (!template) return `[${tempName}] ${data?.join(' | ') || ''}`

//     const bodyComp = template.components?.find(c => c.type === 'BODY')
//     if (!bodyComp?.text) return `[${tempName}] ${data?.join(' | ') || ''}`

//     let rendered = bodyComp.text
//     if (data?.length) {
//       data.forEach((val, i) => {
//         rendered = rendered.replace(`{{${i + 1}}}`, val)
//       })
//     }

//     return rendered
//   } catch (e) {
//     console.error('Template fetch error:', e.message)
//     return `[${tempName}] ${data?.join(' | ') || ''}`
//   }
// }

// // ── POST: Send a template message ────────────────────────────────────────────
// app.post('/send', async (req, res) => {
//   let { to, tempName, data, phoneNumberId } = req.body

//   if (!phoneNumberId) {
//     phoneNumberId = '1057331837443942'
//   }

//   // Validate phoneNumberId against whitelist
//   if (!phoneNumberId || !ALLOWED_PHONE_IDS.includes(phoneNumberId)) {
//     console.log(`⚠️ /send blocked — phoneNumberId "${phoneNumberId}" not in whitelist`)
//     return res.status(400).json({ success: false, error: 'Invalid or missing phoneNumberId' })
//   }

//   // Check if the number is active in Supabase
//   try {
//     const { data: numberData, error: numberError } = await supabase
//       .from('numbers')
//       .select('isActive')
//       .eq('phone_number_id', phoneNumberId)
//       .single()

//     if (numberError && numberError.code !== 'PGRST116') {
//       console.error('Supabase numbers query error:', numberError.message)
//     }

//     if (numberData && numberData.isActive === false) {
//       console.log(`⚠️ /send blocked — number ${phoneNumberId} is marked inactive in database`)
//       return res.status(403).json({ success: false, error: 'This number is currently inactive. There is an issue with this number.' })
//     }
//   } catch (err) {
//     console.error('Exception checking number status:', err.message)
//   }

//   // Normalize phone early so it's available in all branches
//   const contactPhone = to.startsWith('+') ? to : '+' + to

//   try {
//     const metaRes = await fetch(
//       `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
//       {
//         method: 'POST',
//         headers: {
//           'Authorization': `Bearer ${process.env.WA_ACCESS_TOKEN}`,
//           'Content-Type': 'application/json',
//         },
//         body: JSON.stringify({
//           messaging_product: 'whatsapp',
//           to,
//           type: 'template',
//           template: {
//             name: tempName,
//             language: { code: 'en' },
//             components: data?.length ? [
//               {
//                 type: 'body',
//                 parameters: data.map(text => ({ type: 'text', text }))
//               }
//             ] : []
//           }
//         }),
//       }
//     )

//     const metaData = await metaRes.json()

//     // ── Meta API returned an error ──
//     if (!metaRes.ok) {
//       console.error('Meta API error:', metaData)

//       const wabaId = PHONE_TO_WABA[phoneNumberId]
//       const errorText = metaData.error?.message || JSON.stringify(metaData)
//       const renderedBody = await renderTemplate(tempName, data, wabaId)

//       // Log the failed attempt to Supabase with error details
//       const { error } = await supabase.from('messages').insert({
//         phone_number_id: phoneNumberId,
//         contact_phone: contactPhone,
//         body: renderedBody,
//         direction: 'sent',
//         status: 'failed',
//         error: errorText,
//         timestamp: Date.now(),
//       })
//       if (error) {
//         console.error('Failed to log error to Supabase:', error.message)
//       }
//       return res.status(500).json({ success: false, error: errorText })
//     }

//     // ── Success — save the sent message ──
//     const wabaId = PHONE_TO_WABA[phoneNumberId]
//     const msgId = metaData.messages?.[0]?.id
//     const renderedBody = await renderTemplate(tempName, data, wabaId)

//     const { error } = await supabase.from('messages').insert({
//       id: msgId,
//       phone_number_id: phoneNumberId,
//       contact_phone: contactPhone,
//       contact_name: null,
//       body: renderedBody,
//       direction: 'sent',
//       status: 'sent',
//       timestamp: Date.now(),
//     })

//     if (error) {
//       console.error('Supabase insert error:', error.message)
//       return res.json({ success: true, id: msgId, warning: error.message })
//     }

//     res.json({ success: true, id: msgId })

//   } catch (e) {
//     console.error('Send error:', e.message)

//     // Log crash-level errors to Supabase too
//     const { error } = await supabase.from('messages').insert({
//       phone_number_id: phoneNumberId,
//       contact_phone: contactPhone,
//       body: `[${tempName}] ${data?.join(' | ') || ''}`,
//       direction: 'sent',
//       status: 'failed',
//       error: e.message,
//       timestamp: Date.now(),
//     })
//     if (error) {
//       console.error('Failed to log error to Supabase:', error.message)
//     }
//     res.status(500).json({ success: false, error: e.message })
//   }
// })

// const PORT = process.env.PORT || 3000
// app.listen(PORT, () => console.log(`🚀 Webhook server running on port ${PORT}`))

require('dotenv').config()
const express = require('express')
const { createClient } = require('@supabase/supabase-js')

const app = express()
app.use(express.json())

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// ── Whitelist of allowed phone number IDs & WABA mapping ────────────────────
// Comma-separated mapping in env: WA_ALLOWED_PHONE_IDS=111:waba1,222:waba2
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

// Log on startup so you can verify in Railway logs
console.log('📋 ALLOWED_PHONE_IDS:', JSON.stringify(ALLOWED_PHONE_IDS))
console.log('📋 PHONE_TO_WABA:', JSON.stringify(PHONE_TO_WABA))

// ── GET /debug — hit this in your browser to verify config ──────────────────
app.get('/debug', (req, res) => {
  res.json({
    allowedPhoneIds: ALLOWED_PHONE_IDS,
    phoneToWaba: PHONE_TO_WABA,
    count: ALLOWED_PHONE_IDS.length,
    hasSupabaseUrl: !!process.env.SUPABASE_URL,
    hasAccessToken: !!process.env.WA_ACCESS_TOKEN,
    hasVerifyToken: !!process.env.WA_VERIFY_TOKEN,
    envRaw: process.env.WA_ALLOWED_PHONE_IDS || '(not set)',
  })
})

// ── GET: Meta webhook verification ──────────────────────────────────────────
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

// ── POST: Incoming messages & status updates ─────────────────────────────────
app.post('/webhook', async (req, res) => {
  res.sendStatus(200)

  try {
    // ── DEBUG: log raw entry so we can see exactly what Meta sends ──
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
      console.log(`   typeof incomingPhoneId: ${typeof incomingPhoneId}`)
      console.log(`   exact comparison with each:`)
      ALLOWED_PHONE_IDS.forEach((id, i) => {
        console.log(`     [${i}] "${id}" === "${incomingPhoneId}" → ${id === incomingPhoneId} (lengths: ${id.length} vs ${incomingPhoneId.length})`)
      })
      return
    }
    console.log(`✅ ALLOWED — phone_number_id ${incomingPhoneId}`)

    const messages = value?.messages
    const statuses = value?.statuses

    // ── Handle delivery / read receipts ──
    if (statuses?.length) {
      for (const s of statuses) {
        const updateData = { status: s.status, phone_number_id: incomingPhoneId }

        // Capture error details from failed status updates
        if (s.status === 'failed' && s.errors?.length) {
          updateData.error = s.errors.map(e => e.title || e.message || JSON.stringify(e)).join('; ')
        }

        // Meta sends recipient_id on status updates — use it to fill contact_phone
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

// ── Helper: fetch template text from Meta & render with parameters ───────────
async function renderTemplate(tempName, data, wabaId) {
  try {
    if (!wabaId) throw new Error('wabaId is missing')
    const url = `https://graph.facebook.com/v21.0/${wabaId}/message_templates?name=${tempName}`
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${process.env.WA_ACCESS_TOKEN}` }
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

// ── POST: Send a template message ────────────────────────────────────────────
app.post('/send', async (req, res) => {
  let { to, tempName, data, phoneNumberId, language } = req.body

  if (!phoneNumberId) {
    phoneNumberId = '1057331837443942'
  }

  // Validate phoneNumberId against whitelist
  if (!phoneNumberId || !ALLOWED_PHONE_IDS.includes(phoneNumberId)) {
    console.log(`⚠️ /send blocked — phoneNumberId "${phoneNumberId}" not in whitelist`)
    return res.status(400).json({ success: false, error: 'Invalid or missing phoneNumberId' })
  }

  // Normalize phone early so it's available in all branches
  const contactPhone = to.startsWith('+') ? to : '+' + to

  try {
    const metaRes = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.WA_ACCESS_TOKEN}`,
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
      const renderedBody = await renderTemplate(tempName, data, wabaId)

      // Log the failed attempt to Supabase with error details
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
    const renderedBody = await renderTemplate(tempName, data, wabaId)

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

    // Log crash-level errors to Supabase too
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

// ── POST: Send a otp message ────────────────────────────────────────────
app.post('/send-otp', async (req, res) => {
  try {
    const { to, code, phoneNumberId, language } = req.body
    if (!phoneNumberId) {
      return res.status(400).json({ success: false, error: 'Missing phoneNumberId' })
    }
    if (!ALLOWED_PHONE_IDS.includes(phoneNumberId)) {
      return res.status(400).json({ success: false, error: 'Invalid phoneNumberId' })
    }

    const metaRes = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.WA_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: to.startsWith('+') ? to : '+' + to,
          type: 'template',
          template: {
            name: 'otp_temp',
            language: { code: language || 'en' },
            components: [
              {
                type: 'body',
                parameters: [{ type: 'text', text: code }]
              }
            ]
          }
        }),
      }
    )

    const metaData = await metaRes.json()
    if (!metaRes.ok) {
      console.error('OTP send error:', metaData)
      return res.status(500).json({ success: false, error: metaData.error?.message || JSON.stringify(metaData) })
    }

    const msgId = metaData.messages?.[0]?.id
    const { error } = await supabase.from('messages').insert({
      id: msgId,
      phone_number_id: phoneNumberId,
      contact_phone: to.startsWith('+') ? to : '+' + to,
      contact_name: null,
      body: `Your OTP is: ${code}`,
      direction: 'sent',
      status: 'sent',
      timestamp: Date.now(),
    })

    if (error) {
      console.error('Failed to save OTP to Supabase:', error.message)
      return res.json({ success: true, id: msgId, warning: error.message })
    }

    res.json({ success: true, id: msgId })

  } catch (e) {
    console.error('Send OTP crash:', e.message)
    return res.status(500).json({ success: false, error: e.message })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`🚀 Webhook server running on port ${PORT}`))