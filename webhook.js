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
  // Always respond 200 immediately — Meta will retry if you don't
  res.sendStatus(200)

  try {
    const value = req.body.entry?.[0]?.changes?.[0]?.value

    // ✅ Only process messages from YOUR number
    const ALLOWED_PHONE_ID = process.env.WA_PHONE_NUMBER_ID
    if (value?.metadata?.phone_number_id !== ALLOWED_PHONE_ID) {
      console.log('⚠️ Ignored — wrong phone number ID')
      return
    }
    const messages = value?.messages
    const statuses = value?.statuses

    // Handle delivery / read receipts
    if (statuses?.length) {
      for (const s of statuses) {
        const { error } = await supabase
          .from('messages')
          .update({ status: s.status })
          .eq('id', s.id)

        if (error) console.error('Status update error:', error.message)
        else console.log(`📬 Status updated → ${s.id}: ${s.status}`)
      }
    }

    // Handle incoming text messages
    if (messages?.length) {
      for (const msg of messages) {
        if (msg.type !== 'text') {
          console.log(`⚠️  Skipping non-text message type: ${msg.type}`)
          continue
        }

        const from_phone = '+' + msg.from
        const contact = value.contacts?.find(c => c.wa_id === msg.from)
        const name = contact?.profile?.name || from_phone

        console.log(`📩 Incoming from ${name} (${from_phone}): ${msg.text.body}`)

        const { error } = await supabase.from('messages').upsert({
          id: msg.id,
          from_phone,
          name,
          body: msg.text.body,
          direction: 'received',
          status: 'delivered',
          timestamp: parseInt(msg.timestamp) * 1000,  // Meta sends seconds → ms
        }, { onConflict: 'id' })

        if (error) console.error('Insert error:', error.message)
        else console.log(`✅ Saved to Supabase`)
      }
    }

  } catch (e) {
    console.error('Webhook crash:', e.message)
  }
})
// send msg
app.post('/send', async (req, res) => {
  const { to, tempName, data } = req.body
  // data = array of strings e.g. ['Ahmed', 'Math', '10:00 AM']

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

    const { error } = await supabase.from('messages').insert({
      id: msgId,
      from_phone: process.env.WA_BUSINESS_PHONE,
      to_phone: to,
      name: 'أستاذ كُريِّم - لغة عربية',
      body: `[${tempName}] ${data?.join(' | ')}`,
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