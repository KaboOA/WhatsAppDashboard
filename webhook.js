require('dotenv').config()
const express = require('express')
const { createClient } = require('@supabase/supabase-js')

const app = express()
app.use(express.json())

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// ── GET: Meta webhook verification ──────────────────────────────────────────
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

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
    const value = req.body.entry?.[0]?.changes?.[0]?.value

    const ALLOWED_PHONE_ID = process.env.WA_PHONE_NUMBER_ID
    if (value?.metadata?.phone_number_id !== ALLOWED_PHONE_ID) {
      console.log('⚠️ Ignored — wrong phone number ID')
      return
    }

    const messages = value?.messages
    const statuses = value?.statuses

    // ── Handle delivery / read receipts ──
    if (statuses?.length) {
      for (const s of statuses) {
        const updateData = { status: s.status }

        // Meta sends recipient_id on status updates — use it to fill contact_phone
        // if the original insert didn't have it yet
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
          contact_phone: contactPhone,   // ← the customer's phone
          contact_name: name,
          body: msg.text.body,
          direction: 'received',
          status: 'delivered',
          timestamp: parseInt(msg.timestamp) * 1000,
        }, { onConflict: 'id' })

        if (error) console.error('Insert error:', error.message)
        else console.log(`✅ Saved to Supabase`)
      }
    }

  } catch (e) {
    console.error('Webhook crash:', e.message)
  }
})

// ── Helper: fetch template text from Meta & render with parameters ───────────
async function renderTemplate(tempName, data) {
  try {
    const url = `https://graph.facebook.com/v21.0/${process.env.WA_WABA_ID}/message_templates?name=${tempName}`
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${process.env.WA_ACCESS_TOKEN}` }
    })
    const json = await res.json()

    const template = json.data?.[0]
    if (!template) return `[${tempName}] ${data?.join(' | ') || ''}`

    // Find the BODY component text
    const bodyComp = template.components?.find(c => c.type === 'BODY')
    if (!bodyComp?.text) return `[${tempName}] ${data?.join(' | ') || ''}`

    // Replace {{1}}, {{2}}, etc. with actual data values
    let rendered = bodyComp.text
    if (data?.length) {
      data.forEach((val, i) => {
        rendered = rendered.replace(`{{${i + 1}}}`, val)
      })
    }

    return rendered
  } catch (e) {
    console.error('Template fetch error:', e.message)
    // Fallback to the old format if fetch fails
    return `[${tempName}] ${data?.join(' | ') || ''}`
  }
}

// ── POST: Send a template message ────────────────────────────────────────────
app.post('/send', async (req, res) => {
  const { to, tempName, data } = req.body

  try {
    const metaRes = await fetch(
      `https://graph.facebook.com/v21.0/${process.env.WA_PHONE_NUMBER_ID}/messages`,
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
            language: { code: 'en' },
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

    if (!metaRes.ok) {
      console.error('Meta API error:', metaData)
      return res.status(500).json({ error: metaData })
    }

    const msgId = metaData.messages?.[0]?.id

    // Normalize the recipient phone
    let contactPhone = to.startsWith('+') ? to : '+' + to

    // Fetch & render the actual template message content
    const renderedBody = await renderTemplate(tempName, data)

    const { error } = await supabase.from('messages').insert({
      id: msgId,
      contact_phone: contactPhone,   // ← the customer's phone (recipient)
      contact_name: null,             // will be filled when they reply / from dashboard
      body: renderedBody,
      direction: 'sent',
      status: 'sent',
      timestamp: Date.now(),
    })

    if (error) console.error('Supabase insert error:', error.message)

    res.json({ success: true, id: msgId })

  } catch (e) {
    console.error('Send error:', e.message)
    res.status(500).json({ error: e.message })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`🚀 Webhook server running on port ${PORT}`))
