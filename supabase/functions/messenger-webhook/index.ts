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
          if (!entry.messaging) continue

          for (const messagingEvent of entry.messaging) {
            const psid = messagingEvent.sender?.id
            if (!psid) continue

            // 2a. Handle Registration (via Referral or Postback)
            const rawLrn = messagingEvent.referral?.ref || messagingEvent.postback?.referral?.ref

            if (rawLrn) {
              const lrn = rawLrn.replace(/reg_/i, '').replace(/[^0-9]/g, '').trim();
              console.log(`📝 Registration attempt: PSID ${psid} for LRN ${lrn} (Raw: ${rawLrn})`)
              
              if (lrn.length !== 12) {
                console.warn(`⚠️ Invalid LRN length (${lrn.length}): ${lrn}`)
                await sendResponse(psid, `❌ Registration Failed: Ang LRN ${lrn} dapat 12 ka digits gyud.`)
              } else {
                // First, check if student exists to avoid RLS/select issues
                const { data: student, error: fetchError } = await supabase
                  .from('students')
                  .select('full_name, lrn')
                  .eq('lrn', lrn)
                  .single()

                if (fetchError || !student) {
                  console.warn(`⚠️ Student not found for LRN ${lrn}:`, fetchError?.message)
                  await sendResponse(psid, `❌ Registration Failed: Dili makit-an ang LRN ${lrn} sa among listahan.`)
                } else {
                  // Now perform the update
                  const { error: updateError } = await supabase
                    .from('students')
                    .update({ 
                        parent_messenger_id: psid,
                        notify_parent: true 
                    })
                    .eq('lrn', lrn)

                  if (updateError) {
                    console.error(`❌ Database error during update for LRN ${lrn}:`, updateError.message)
                    await sendResponse(psid, `❌ Registration Error: Dili ma-update ang database sa pagkakaron.`)
                  } else {
                    console.log(`✅ PSID ${psid} successfully linked to ${student.full_name} (LRN: ${lrn})`)
                    await sendConfirmation(psid, student.full_name, lrn)
                  }
                }
              }
            } 
            // Handle Get Started button without referral
            else if (messagingEvent.postback?.payload === 'GET_STARTED') {
              console.log(`🚀 GET_STARTED received from PSID ${psid}`)
              await sendResponse(psid, `👋 Flehew! Welcome to the ULHS Attendance Alert System.\n\nPara ma-link ang estudyante, gamita ang registration link sa among website o i-send ang: LINK [12-digit LRN]`);
            }
            
            // 2b. Handle Commands (via Text Message)
            else if (messagingEvent.message?.text) {
              const rawText = messagingEvent.message.text.trim();
              const text = rawText.toUpperCase();
              console.log(`💬 Processing text from PSID ${psid}: "${rawText}"`)
              
              // Handle manual "reg_LRN" code from Alternative section
              if (text.startsWith('REG_')) {
                const targetLrn = rawText.replace(/reg_/i, '').replace(/[^0-9]/g, '').trim();
                console.log(`🔍 Manual REG attempt for LRN: ${targetLrn} (Original: ${rawText})`);
                
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
                    await sendResponse(psid, `❌ System Error: Dili ma-link ang LRN ${targetLrn} sa pagkakaron.`);
                  } else if (data && data.length > 0) {
                    console.log(`✅ Manual link success: ${data[0].full_name} (LRN: ${targetLrn})`);
                    await sendConfirmation(psid, data[0].full_name, targetLrn);
                  } else {
                    console.warn(`⚠️ Manual REG LRN not found: ${targetLrn}`);
                    await sendResponse(psid, `❌ Registration Failed: Dili makit-an ang LRN ${targetLrn} sa among listahan.`);
                  }
                } else {
                  console.warn(`⚠️ Invalid manual REG LRN length: ${targetLrn}`);
                  await sendResponse(psid, `❓ Invalid Code: Dapat 12 ka digits gyud ang LRN sa imong message. Example: reg_123456789012`);
                }
              }
              else if (text.startsWith('LINK')) {
                const targetLrn = rawText.replace(/LINK/i, '').replace(/[^0-9]/g, '').trim();
                console.log(`🔍 LINK command for LRN: ${targetLrn} (Original: ${rawText})`);
                
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
                    await sendResponse(psid, `❌ Error: Nagkaproblema ang system sa pag-link sa LRN ${targetLrn}.`)
                  } else if (data && data.length > 0) {
                    console.log(`✅ LINK success for ${data[0].full_name} (LRN: ${targetLrn})`);
                    await sendConfirmation(psid, data[0].full_name, targetLrn);
                  } else {
                    console.warn(`⚠️ LINK LRN not found: ${targetLrn}`);
                    await sendResponse(psid, `❌ Link failed. Ang 12-digit LRN ${targetLrn} wala sa among system.`);
                  }
                } else {
                  console.warn(`⚠️ Invalid LINK LRN length: ${targetLrn}`);
                  await sendResponse(psid, `❓ Para ma-link ang estudyante, i-send ang: LINK [12-digit LRN]`);
                }
              } else if (text.startsWith('UNLINK')) {
                const targetLrn = rawText.replace(/UNLINK/i, '').replace(/[^0-9]/g, '').trim();
                console.log(`🔍 UNLINK command for LRN: ${targetLrn} (Original: ${rawText})`);
                
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

                  if (error) {
                    console.error(`❌ DB Error (UNLINK):`, error.message)
                    await sendResponse(psid, `❌ Error unlinking student. Palihog sulayi pag-usab unya.`);
                  } else if (data && data.length > 0) {
                    console.log(`✅ UNLINK success for ${data[0].full_name} (LRN: ${targetLrn})`);
                    await sendResponse(psid, `✅ Successfully unlinked from ${data[0].full_name}. Dili na ka makadawat ug alerts para ani nga LRN.`);
                  } else {
                    console.warn(`⚠️ UNLINK failed/No match for LRN ${targetLrn} and PSID ${psid}`);
                    await sendResponse(psid, `❌ Unlink failed. Siguraduha nga sakto ang LRN ${targetLrn} ug naka-link kini sa imong account.`);
                  }
                } else {
                  console.warn(`⚠️ Invalid UNLINK LRN length: ${targetLrn}`);
                  await sendResponse(psid, `❓ Para ma-stop ang alerts, i-send ang: UNLINK [12-digit LRN]`);
                }
              } else if (text === 'LIST' || text === 'STUDENTS' || text === 'HELP' || text === 'GET STARTED' || text === 'GET_STARTED') {
                console.log(`📋 Processing command "${text}" for PSID: ${psid}`);
                
                const { data, error } = await supabase
                  .from('students')
                  .select('full_name, lrn')
                  .eq('parent_messenger_id', psid);

                if (error) {
                  console.error(`❌ DB Error (${text}) for PSID ${psid}:`, error.message);
                  await sendResponse(psid, `❌ Error: Dili makuha ang imong student list sa pagkakaron.`);
                } else if (data && data.length > 0) {
                  console.log(`✅ Found ${data.length} students for PSID ${psid}: ${data.map(s => s.full_name).join(', ')}`);
                  const studentList = data.map(s => `• ${s.full_name} (${s.lrn})`).join('\n');
                  await sendResponse(psid, `📋 Nagadawat ka ug alerts ni:\n\n${studentList}\n\nCommands:\n• LIST - See linked students\n• LINK [LRN] - Link another student\n• UNLINK [LRN] - Stop receiving alerts`);
                } else {
                  console.warn(`⚠️ No students found for PSID ${psid}`);
                  await sendResponse(psid, `👋 Flehew! Wala pa kay estudyante nga naka-link sa imong account.\n\nPara ma-link ang estudyante, i-send ang: LINK [12-digit LRN]`);
                }
              } else if (text === 'PING') {
                console.log(`🏓 PING received from PSID ${psid}`)
                await sendResponse(psid, `🏓 Pong! Ang ULHS bot kay online na ug andam na sa imong commands. Your PSID is: ${psid}`);
              } else if (/^\d{12}$/.test(text)) {
                // If user sends JUST the 12-digit LRN
                const lrn = text;
                console.log(`🔍 12-digit LRN detected: ${lrn} from PSID ${psid}`);
                const { data, error } = await supabase
                  .from('students')
                  .update({ 
                    parent_messenger_id: psid,
                    notify_parent: true 
                  })
                  .eq('lrn', lrn)
                  .select()

                if (error) {
                  console.error(`❌ DB Error (LRN Only) for LRN ${lrn}:`, error.message)
                  await sendResponse(psid, `❌ System Error: Dili ma-link ang LRN ${lrn} sa pagkakaron.`);
                } else if (data && data.length > 0) {
                  console.log(`✅ LRN link success: ${data[0].full_name} (LRN: ${lrn})`);
                  await sendConfirmation(psid, data[0].full_name, lrn);
                } else {
                  console.warn(`⚠️ LRN not found (LRN Only): ${lrn}`);
                  await sendResponse(psid, `❌ Registration Failed: Ang LRN ${lrn} wala sa among listahan.`);
                }
              } else {
                console.log(`❓ Unknown command from PSID ${psid}: "${rawText}"`);
                await sendResponse(psid, `🤖 Ha? Usba daw pag-type. Pwede nimo i-send ang:\n• LIST - Para makita ang linked students\n• LINK [LRN] - Para mag-add ug estudyante\n• PING - Para i-test ang connection`);
              }
            }
          }
        }
        return new Response('EVENT_RECEIVED', { status: 200 })
      }
      console.warn(`⚠️ Received non-page object: ${body.object}`);
      return new Response('NOT_PAGE', { status: 200 })
    } catch (err) {
      console.error('🔥 Webhook Processing Error:', err instanceof Error ? err.stack : err)
      return new Response('Internal Error', { status: 500 })
    }
  }

  return new Response('Not Found', { status: 404 })
})

async function sendConfirmation(psid: string, studentName: string, lrn: string) {
  const message = `✅ Registration Successful! Makadawat na ka og attendance alerts ni ${studentName}. \n\nPara makita ang tanan nimo nga linked students, i-send ang: LIST\nPara i-stop ang alerts, i-send ang: UNLINK ${lrn}`
  await sendResponse(psid, message)
}

async function sendResponse(psid: string, text: string) {
  console.log(`📡 Sending message to PSID ${psid}: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
  
  if (!FB_PAGE_ACCESS_TOKEN) {
    console.error("❌ Critical Error: FB_PAGE_ACCESS_TOKEN is missing!");
    return;
  }

  // Version v12.0 is used in the other alert function and is stable
  const API_URL = `https://graph.facebook.com/v12.0/me/messages?access_token=${FB_PAGE_ACCESS_TOKEN}`;

  const trySend = async (payload: any) => {
     try {
       const res = await fetch(API_URL, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(payload)
       });
       const data = await res.json();
       return { ok: res.ok, data };
     } catch (err) {
       return { ok: false, data: { error: err.message } };
     }
   };

  // 1. Try with RESPONSE type (standard for 24h window)
  let { ok, data } = await trySend({
    recipient: { id: psid },
    message: { text: text },
    messaging_type: "RESPONSE"
  });

  // 2. Fallback: If RESPONSE fails, try with MESSAGE_TAG (for outside 24h window or referral edge cases)
  if (!ok) {
    console.warn(`⚠️ Primary send failed for PSID ${psid}, trying fallback...`, JSON.stringify(data));
    
    const fallbackResult = await trySend({
      recipient: { id: psid },
      message: { text: text },
      messaging_type: "MESSAGE_TAG",
      tag: "CONFIRMED_EVENT_UPDATE" // Allowed for automated responses to user-initiated events
    });

    if (!fallbackResult.ok) {
      console.error(`❌ All sending attempts failed for PSID ${psid}:`, JSON.stringify(fallbackResult.data));
    } else {
      console.log(`✅ Fallback success for PSID ${psid}. ID: ${fallbackResult.data.message_id}`);
    }
  } else {
    console.log(`✅ Message sent successfully to PSID ${psid}. ID: ${data.message_id}`);
  }
}
