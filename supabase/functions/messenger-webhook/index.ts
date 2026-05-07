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

            if (error) {
              console.error(`❌ Database error during registration:`, error.message)
              await sendResponse(psid, `❌ Registration Error: Could not update database. Please try again later.`)
            } else if (data && data.length > 0) {
              console.log(`✅ PSID ${psid} linked to ${data[0].full_name}`)
              await sendConfirmation(psid, data[0].full_name, lrn)
            } else {
              console.warn(`⚠️ Registration failed: LRN ${lrn} not found in database.`)
              await sendResponse(psid, `❌ Registration Failed: LRN ${lrn} was not found in our records. Please ensure the LRN is correct.`)
            }
          } 
          
          // 2b. Handle Commands (via Text Message)
          else if (messagingEvent.message?.text) {
            const text = messagingEvent.message.text.trim().toUpperCase();
            console.log(`💬 Received text from PSID ${psid}: "${text}"`)
            
            if (text.startsWith('LINK')) {
              // Extract LRN: remove 'LINK', symbols, and spaces
              const targetLrn = text.replace('LINK', '').replace(/[^0-9]/g, '').trim();
              
              if (targetLrn.length === 12) {
                const { data, error } = await supabase
                  .from('students')
                  .update({ 
                    parent_messenger_id: psid,
                    notify_parent: true 
                  })
                  .eq('lrn', targetLrn)
                  .select()

                if (error) {
                  console.error(`❌ DB Error (LINK):`, error.message)
                  await sendResponse(psid, `❌ Error: System encountered a problem linking LRN ${targetLrn}.`)
                } else if (data && data.length > 0) {
                  await sendConfirmation(psid, data[0].full_name, targetLrn);
                } else {
                  await sendResponse(psid, `❌ Link failed. The 12-digit LRN ${targetLrn} is not registered in our system.`);
                }
              } else {
                await sendResponse(psid, `❓ To link a student manually, please send: LINK [12-digit LRN]`);
              }
            } else if (text.startsWith('UNLINK')) {
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
              console.log(`📋 Processing LIST command for PSID: ${psid}`);
              
              // We search for students where this PSID is anywhere in the parent_messenger_id field
              // (handles comma-separated lists)
              const { data, error } = await supabase
                .from('students')
                .select('full_name, lrn, parent_messenger_id')
                .filter('parent_messenger_id', 'ilike', `%${psid}%`);

              if (error) {
                console.error(`❌ DB Error (LIST):`, error.message);
                await sendResponse(psid, `❌ Error: Could not retrieve your student list at this time.`);
              } else if (data && data.length > 0) {
                console.log(`✅ Found ${data.length} students for PSID ${psid}`);
                const studentList = data.map(s => `• ${s.full_name} (${s.lrn})`).join('\n');
                await sendResponse(psid, `📋 You are currently receiving alerts for:\n\n${studentList}\n\nCommands:\n• LIST - See linked students\n• LINK [LRN] - Link another student\n• UNLINK [LRN] - Stop receiving alerts`);
              } else {
                console.warn(`⚠️ No students found for PSID ${psid}`);
                await sendResponse(psid, `❌ You don't have any students linked to this account yet.\n\nTo link a student, send: LINK [12-digit LRN]`);
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
   const message = `✅ Registration Successful! Makadawat na ka og attendance alerts ni ${studentName}. \n\nTo see all your linked students, send: LIST\nTo stop alerts, send: UNLINK ${lrn}`
   await sendResponse(psid, message)
 }

async function sendResponse(psid: string, text: string) {
  try {
    const res = await fetch(`https://graph.facebook.com/v12.0/me/messages?access_token=${FB_PAGE_ACCESS_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: psid },
        message: { text: text }
      })
    })
    
    if (!res.ok) {
      const error = await res.json()
      console.error(`❌ Messenger API Error for PSID ${psid}:`, JSON.stringify(error))
    } else {
      console.log(`✅ Message sent to PSID ${psid}`)
    }
  } catch (err) {
    console.error(`🔥 Fetch Error sending to PSID ${psid}:`, err.message)
  }
}
