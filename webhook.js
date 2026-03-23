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
          contact_phone: contactPhone,
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
  const { to, tempName, data } = req.body

  // Normalize phone early so it's available in all branches
  const contactPhone = to.startsWith('+') ? to : '+' + to

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

    // ── Meta API returned an error ──
    if (!metaRes.ok) {
      console.error('Meta API error:', metaData)

      const errorText = metaData.error?.message || JSON.stringify(metaData)
      const renderedBody = await renderTemplate(tempName, data)

      // Log the failed attempt to Supabase with error details
      await supabase.from('messages').insert({
        contact_phone: contactPhone,
        body: renderedBody,
        direction: 'sent',
        status: 'failed',
        error: errorText,
        timestamp: Date.now(),
      }).catch(err => console.error('Failed to log error to Supabase:', err.message))

      return res.status(500).json({ success: false, error: errorText })
    }

    // ── Success — save the sent message ──
    const msgId = metaData.messages?.[0]?.id
    const renderedBody = await renderTemplate(tempName, data)

    const { error } = await supabase.from('messages').insert({
      id: msgId,
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
    await supabase.from('messages').insert({
      contact_phone: contactPhone,
      body: `[${tempName}] ${data?.join(' | ') || ''}`,
      direction: 'sent',
      status: 'failed',
      error: e.message,
      timestamp: Date.now(),
    }).catch(err => console.error('Failed to log error to Supabase:', err.message))

    res.status(500).json({ success: false, error: e.message })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`🚀 Webhook server running on port ${PORT}`))