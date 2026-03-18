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

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`🚀 Webhook server running on port ${PORT}`))