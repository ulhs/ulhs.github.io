import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const FB_PAGE_ACCESS_TOKEN = Deno.env.get('FB_PAGE_ACCESS_TOKEN')
const VERIFY_TOKEN = Deno.env.get('MESSENGER_VERIFY_TOKEN') || 'ULHS_VERIFY_TOKEN'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Critical Error: Supabase environment variables are missing!");
}

const supabase = createClient(
  SUPABASE_URL ?? '',
  SUPABASE_SERVICE_ROLE_KEY ?? ''
)

Deno.serve(async (req) => {
  const url = new URL(req.url)
  console.log(`📥 Incoming request: ${req.method} ${url.pathname}`);

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
          let lrn = messagingEvent.referral?.ref || messagingEvent.postback?.referral?.ref

          if (lrn) {
            lrn = lrn.replace(/reg_/i, ''); // Case-insensitive strip
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
          // Handle Get Started button without referral
          else if (messagingEvent.postback?.payload === 'GET_STARTED') {
            await sendResponse(psid, `👋 Flehew! Welcome to the ULHS Attendance Alert System.\n\nTo link a student, please use the registration link on our website or send: LINK [12-digit LRN]`);
          }
          
          // 2b. Handle Commands (via Text Message)
          else if (messagingEvent.message?.text) {
            const rawText = messagingEvent.message.text.trim();
            const text = rawText.toUpperCase();
            console.log(`💬 Processing text from PSID ${psid}: "${rawText}"`)
            
            // Handle manual "reg_LRN" code from Alternative section
            if (text.startsWith('REG_')) {
              const targetLrn = rawText.toUpperCase().replace('REG_', '').replace(/[^0-9]/g, '').trim();
              console.log(`🔍 Manual REG attempt for LRN: ${targetLrn}`);
              
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
                  console.error(`❌ DB Error (REG_):`, error.message)
                  await sendResponse(psid, `❌ System Error: Could not link LRN ${targetLrn} at this time. Please try again later.`);
                } else if (data && data.length > 0) {
                  console.log(`✅ Manual link success: ${data[0].full_name}`);
                  await sendConfirmation(psid, data[0].full_name, targetLrn);
                } else {
                  console.warn(`⚠️ LRN not found: ${targetLrn}`);
                  await sendResponse(psid, `❌ Registration Failed: The LRN ${targetLrn} was not found in our records. Please ensure the LRN is correct.`);
                }
              } else {
                await sendResponse(psid, `❓ Invalid Code: The LRN in your message must be exactly 12 digits long. Example: reg_123456789012`);
              }
            }
            else if (text.startsWith('LINK')) {
              // Extract LRN: remove 'LINK', symbols, and spaces
              const targetLrn = text.replace('LINK', '').replace(/[^0-9]/g, '').trim();
              console.log(`🔍 LINK command for LRN: ${targetLrn}`);
              
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
                  console.log(`✅ LINK success for ${data[0].full_name}`);
                  await sendConfirmation(psid, data[0].full_name, targetLrn);
                } else {
                  console.warn(`⚠️ LINK LRN not found: ${targetLrn}`);
                  await sendResponse(psid, `❌ Link failed. The 12-digit LRN ${targetLrn} is not registered in our system.`);
                }
              } else {
                await sendResponse(psid, `❓ To link a student manually, please send: LINK [12-digit LRN]`);
              }
            } else if (text.startsWith('UNLINK')) {
              const targetLrn = text.replace('UNLINK', '').replace(/[^0-9]/g, '').trim();
              console.log(`🔍 UNLINK command for LRN: ${targetLrn}`);
              
              if (targetLrn.length === 12) {
                const { data, error } = await supabase
                  .from('students')
                  .update({ 
                    parent_messenger_id: null,
                    notify_parent: false 
                  })
                  .eq('lrn', targetLrn)
                  .eq('parent_messenger_id', psid)
                  .select()

                if (!error && data && data.length > 0) {
                  console.log(`✅ UNLINK success for ${data[0].full_name}`);
                  await sendResponse(psid, `✅ Successfully unlinked from ${data[0].full_name}. You will no longer receive alerts for this LRN.`);
                } else {
                  console.warn(`⚠️ UNLINK failed for LRN ${targetLrn}`);
                  await sendResponse(psid, `❌ Unlink failed. Please ensure the LRN ${targetLrn} is correct and currently linked to your account.`);
                }
              } else {
                await sendResponse(psid, `❓ To stop alerts for a student, please send: UNLINK [12-digit LRN]`);
              }
            } else if (text === 'LIST' || text === 'STUDENTS' || text === 'HELP' || text === 'GET STARTED' || text === 'GET_STARTED') {
              console.log(`📋 Processing command "${text}" for PSID: ${psid}`);
              
              const { data, error } = await supabase
                .from('students')
                .select('full_name, lrn')
                .eq('parent_messenger_id', psid);

              if (error) {
                console.error(`❌ DB Error (${text}):`, error.message);
                await sendResponse(psid, `❌ Error: Could not retrieve your student list at this time.`);
              } else if (data && data.length > 0) {
                console.log(`✅ Found ${data.length} students for PSID ${psid}`);
                const studentList = data.map(s => `• ${s.full_name} (${s.lrn})`).join('\n');
                await sendResponse(psid, `📋 You are currently receiving alerts for:\n\n${studentList}\n\nCommands:\n• LIST - See linked students\n• LINK [LRN] - Link another student\n• UNLINK [LRN] - Stop receiving alerts`);
              } else {
                console.warn(`⚠️ No students found for PSID ${psid}`);
                await sendResponse(psid, `👋 Flehew! You don't have any students linked to this account yet.\n\nTo link a student, send: LINK [12-digit LRN]`);
              }
            } else if (text === 'PING') {
              await sendResponse(psid, `🏓 Pong! The ULHS bot is online and responding. Your PSID is: ${psid}`);
            } else if (/^\d{12}$/.test(text)) {
              // If user sends JUST the 12-digit LRN
              console.log(`🔍 12-digit LRN detected: ${text}`);
              const { data, error } = await supabase
                .from('students')
                .update({ 
                  parent_messenger_id: psid,
                  notify_parent: true 
                })
                .eq('lrn', text)
                .select()

              if (error) {
                console.error(`❌ DB Error (LRN Only):`, error.message)
                await sendResponse(psid, `❌ System Error: Could not link LRN ${text} at this time.`);
              } else if (data && data.length > 0) {
                console.log(`✅ LRN link success: ${data[0].full_name}`);
                await sendConfirmation(psid, data[0].full_name, text);
              } else {
                console.warn(`⚠️ LRN not found: ${text}`);
                await sendResponse(psid, `❌ Registration Failed: The LRN ${text} was not found in our records.`);
              }
            } else {
              console.log(`❓ Unknown command from PSID ${psid}: "${rawText}"`);
              await sendResponse(psid, `🤖 I didn't quite catch that. Try sending:\n• LIST - To see linked students\n• LINK [LRN] - To add a student\n• PING - To test connection`);
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
  console.log(`📡 Attempting to send message to PSID ${psid}...`);
  
  if (!FB_PAGE_ACCESS_TOKEN) {
    console.error("❌ Critical Error: FB_PAGE_ACCESS_TOKEN is not set in Supabase secrets!");
    return;
  }

  try {
    // For responses to user messages/actions within the 24-hour window, 
    // we should use messaging_type: "RESPONSE".
    // For proactive alerts (attendance), we would use "MESSAGE_TAG".
    const res = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${FB_PAGE_ACCESS_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: psid },
        message: { text: text },
        messaging_type: "RESPONSE" 
      })
    })
    
    const responseData = await res.json();
    
    if (!res.ok) {
      console.error(`❌ Messenger API Error for PSID ${psid}:`, JSON.stringify(responseData));
      
      // If RESPONSE fails because of the 24-hour window, try with a TAG as a fallback
      if (responseData.error?.code === 10 || responseData.error?.error_subcode === 2018001) {
        console.log(`🔄 Attempting fallback with MESSAGE_TAG for PSID ${psid}...`);
        const fallbackRes = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${FB_PAGE_ACCESS_TOKEN}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { id: psid },
            message: { text: text },
            messaging_type: "MESSAGE_TAG",
            tag: "CONFIRMED_EVENT_UPDATE"
          })
        });
        const fallbackData = await fallbackRes.json();
        if (!fallbackRes.ok) {
          console.error(`❌ Fallback also failed:`, JSON.stringify(fallbackData));
        } else {
          console.log(`✅ Fallback success for PSID ${psid}.`);
        }
      }
    } else {
      console.log(`✅ Message successfully sent to PSID ${psid}. Message ID: ${responseData.message_id}`)
    }
  } catch (err) {
    console.error(`🔥 Fetch Error sending to PSID ${psid}:`, err.message)
  }
}
