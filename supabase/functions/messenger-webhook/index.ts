import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const FB_PAGE_ACCESS_TOKEN = Deno.env.get('FB_PAGE_ACCESS_TOKEN')
const VERIFY_TOKEN = Deno.env.get('MESSENGER_VERIFY_TOKEN') || 'ULHS_VERIFY_TOKEN'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

Deno.serve(async (req) => {
  const url = new URL(req.url)

  // 1. Webhook Verification (GET request)
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('✅ Webhook Verified')
      return new Response(challenge, { status: 200 })
    }
    return new Response('Forbidden', { status: 403 })
  }

  // 2. Handle Incoming Events (POST request)
  if (req.method === 'POST') {
    try {
      const body = await req.json()

      if (body.object === 'page') {
        for (const entry of body.entry) {
          // Safety check: Ensure messaging array exists and is not empty
          if (!entry.messaging || entry.messaging.length === 0) continue

          const messagingEvent = entry.messaging[0]
          const psid = messagingEvent.sender?.id

          if (!psid) continue

          // Check for 'ref' parameter in referral or postback
          let lrn = messagingEvent.referral?.ref?.replace('reg_', '') || 
                    messagingEvent.postback?.referral?.ref?.replace('reg_', '')

          if (lrn && lrn.length === 12) {
            console.log(`📝 Registration attempt: PSID ${psid} for LRN ${lrn}`)
            
            // Update database
            const { data, error } = await supabase
              .from('students')
              .update({ 
                  parent_messenger_id: psid,
                  notify_parent: true 
              })
              .eq('lrn', lrn)
              .select()

            if (!error && data && data.length > 0) {
              console.log(`✅ PSID ${psid} linked to ${data[0].full_name}`)
              // Send confirmation back to parent
              await sendConfirmation(psid, data[0].full_name)
            } else if (error) {
              console.error(`❌ DB Update Error for LRN ${lrn}:`, error.message)
            }
          }
        }
        return new Response('EVENT_RECEIVED', { status: 200 })
      }
    } catch (err) {
      console.error('🔥 Webhook Processing Error:', err.message)
      return new Response('Internal Error', { status: 500 })
    }
  }

  return new Response('Not Found', { status: 404 })
})

async function sendConfirmation(psid: string, studentName: string) {
  const message = `✅ Registration Successful! You will now receive attendance alerts for ${studentName}. Thank you!`
  
  await fetch(`https://graph.facebook.com/v12.0/me/messages?access_token=${FB_PAGE_ACCESS_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: psid },
      message: { text: message }
    })
  })
}
