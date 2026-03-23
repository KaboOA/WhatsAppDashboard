require('dotenv').config()
const express = require('express')
const { createClient } = require('@supabase/supabase-js')

const app = express()
app.use(express.json())

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// ── GET: Meta webhook verification ──────────────────────────
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

// ── POST: Webhook (messages + statuses) ─────────────────────
app.post('/webhook', async (req, res) => {
  res.sendStatus(200)

  try {
    const value = req.body.entry?.[0]?.changes?.[0]?.value

    console.log('📥 FULL WEBHOOK:', JSON.stringify(req.body, null, 2))

    const ALLOWED_PHONE_ID = process.env.WA_PHONE_NUMBER_ID
    if (value?.metadata?.phone_number_id !== ALLOWED_PHONE_ID) {
      console.log('⚠️ Ignored — wrong phone number ID')
      return
    }

    const messages = value?.messages
    const statuses = value?.statuses

    // ── Handle statuses (DELIVERED / READ / FAILED) ──
    if (statuses?.length) {
      for (const s of statuses) {
        let updateData = {
          status: s.status,
          error: null
        }

        if (s.recipient_id) {
          updateData.contact_phone = '+' + s.recipient_id
        }

        console.log('📦 STATUS UPDATE:', JSON.stringify(s, null, 2))

        // 🔥 HANDLE FAILED
        if (s.status === 'failed') {
          console.log('❌ MESSAGE FAILED')
          console.log('🆔 ID:', s.id)
          console.log('📱 TO:', s.recipient_id)

          if (s.errors?.length) {
            s.errors.forEach((err, i) => {
              console.log(`🚨 Error ${i + 1}`)
              console.log('Code:', err.code)
              console.log('Title:', err.title)
              console.log('Message:', err.message)
              console.log('Details:', err.error_data?.details)
            })

            // ✅ save error in DB
            updateData.error = JSON.stringify(s.errors)
          } else {
            console.log('⚠️ No error details from Meta')
          }
        }

        const { error } = await supabase
          .from('messages')
          .update(updateData)
          .eq('id', s.id)

        if (error) console.error('❌ Supabase update error:', error.message)
        else console.log(`📬 Updated ${s.id} → ${s.status}`)
      }
    }

    // ── Handle incoming messages ──
    if (messages?.length) {
      for (const msg of messages) {
        if (msg.type !== 'text') {
          console.log(`⚠️ Skip type: ${msg.type}`)
          continue
        }

        const contactPhone = '+' + msg.from
        const contact = value.contacts?.find(c => c.wa_id === msg.from)
        const name = contact?.profile?.name || contactPhone

        console.log(`📩 Incoming from ${name}: ${msg.text.body}`)

        const { error } = await supabase.from('messages').upsert({
          id: msg.id,
          contact_phone: contactPhone,
          contact_name: name,
          body: msg.text.body,
          direction: 'received',
          status: 'delivered',
          timestamp: parseInt(msg.timestamp) * 1000,
        }, { onConflict: 'id' })

        if (error) console.error('❌ Insert error:', error.message)
        else console.log('✅ Saved message')
      }
    }

  } catch (e) {
    console.error('💥 Webhook crash:', e.message)
  }
})

// ── Helper: render template ────────────────────────────────
async function renderTemplate(tempName, data) {
  try {
    const url = `https://graph.facebook.com/v21.0/${process.env.WA_WABA_ID}/message_templates?name=${tempName}`

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}`
      }
    })

    const json = await res.json()

    const template = json.data?.[0]
    if (!template) return `[${tempName}] ${data?.join(' | ')}`

    const bodyComp = template.components?.find(c => c.type === 'BODY')
    if (!bodyComp?.text) return `[${tempName}] ${data?.join(' | ')}`

    let rendered = bodyComp.text

    if (data?.length) {
      data.forEach((val, i) => {
        rendered = rendered.replace(`{{${i + 1}}}`, val)
      })
    }

    return rendered

  } catch (e) {
    console.error('❌ Template fetch error:', e.message)
    return `[${tempName}] ${data?.join(' | ')}`
  }
}

// ── POST: Send template ────────────────────────────────────
app.post('/send', async (req, res) => {
  const { to, tempName, data } = req.body

  try {
    console.log('📤 SENDING REQUEST:')
    console.log(JSON.stringify({ to, tempName, data }, null, 2))

    const metaRes = await fetch(
      `https://graph.facebook.com/v21.0/${process.env.WA_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: tempName,
            language: { code: 'en' }, // ⚠️ غيرها لو template عربي
            components: data?.length ? [
              {
                type: 'body',
                parameters: data.map(text => ({
                  type: 'text',
                  text
                }))
              }
            ] : []
          }
        }),
      }
    )

    const metaData = await metaRes.json()

    console.log('📥 META RESPONSE:')
    console.log(JSON.stringify(metaData, null, 2))

    if (!metaRes.ok) {
      console.error('❌ META ERROR')
      return res.status(500).json({ error: metaData })
    }

    const msgId = metaData.messages?.[0]?.id
    const contactPhone = to.startsWith('+') ? to : '+' + to

    const renderedBody = await renderTemplate(tempName, data)

    const { error } = await supabase.from('messages').insert({
      id: msgId,
      contact_phone: contactPhone,
      body: renderedBody,
      direction: 'sent',
      status: 'sent',
      timestamp: Date.now(),
    })

    if (error) console.error('❌ Supabase insert error:', error.message)

    res.json({ success: true, id: msgId })

  } catch (e) {
    console.error('💥 Send crash:', e.message)
    res.status(500).json({ error: e.message })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`))