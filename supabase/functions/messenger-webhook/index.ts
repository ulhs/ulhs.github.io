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

          // 2a. Handle Registration (via Referral or Postback)
          let lrn = messagingEvent.referral?.ref?.replace('reg_', '') || 
                    messagingEvent.postback?.referral?.ref?.replace('reg_', '')

          if (lrn && lrn.length === 12) {
            console.log(`📝 Registration attempt: PSID ${psid} for LRN ${lrn}`)
            
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
              await sendConfirmation(psid, data[0].full_name, lrn)
            }
          } 
          
          // 2b. Handle Commands (via Text Message)
          else if (messagingEvent.message?.text) {
            const text = messagingEvent.message.text.trim().toUpperCase();
            
            if (text.startsWith('UNLINK')) {
              const targetLrn = text.replace('UNLINK', '').trim();
              
              if (targetLrn.length === 12) {
                const { data, error } = await supabase
                  .from('students')
                  .update({ 
                    parent_messenger_id: null,
                    notify_parent: false 
                  })
                  .eq('lrn', targetLrn)
                  .eq('parent_messenger_id', psid) // Security: only unlink if they own it
                  .select()

                if (!error && data && data.length > 0) {
                  await sendResponse(psid, `✅ Successfully unlinked from ${data[0].full_name}. You will no longer receive alerts for this LRN.`);
                } else {
                  await sendResponse(psid, `❌ Unlink failed. Please ensure the LRN ${targetLrn} is correct and currently linked to your account.`);
                }
              } else {
                await sendResponse(psid, `❓ To stop alerts for a student, please send: UNLINK [12-digit LRN]`);
              }
            } else if (text === 'LIST' || text === 'STUDENTS' || text === 'HELP') {
              const { data, error } = await supabase
                .from('students')
                .select('full_name, lrn')
                .eq('parent_messenger_id', psid);

              if (!error && data && data.length > 0) {
                const studentList = data.map(s => `• ${s.full_name} (${s.lrn})`).join('\n');
                await sendResponse(psid, `📋 You are currently receiving alerts for:\n\n${studentList}\n\nTo unlink a student, send: UNLINK [LRN]`);
              } else {
                await sendResponse(psid, `❌ You don't have any students linked to this account yet. Please visit the school portal to register.`);
              }
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

async function sendConfirmation(psid: string, studentName: string, lrn: string) {
   const message = `✅ Registration Successful! You will now receive attendance alerts for ${studentName}. \n\nTo see all your linked students, send: LIST\nTo stop alerts, send: UNLINK ${lrn}`
   await sendResponse(psid, message)
 }

async function sendResponse(psid: string, text: string) {
  await fetch(`https://graph.facebook.com/v12.0/me/messages?access_token=${FB_PAGE_ACCESS_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: psid },
      message: { text: text }
    })
  })
}
