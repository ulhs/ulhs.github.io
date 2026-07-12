// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

console.log("Edge function loaded and starting")

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

// Helper: Fetch user's name from Facebook Graph API
async function getMessengerUserName(psid) {
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${psid}?fields=first_name,last_name,name&access_token=${FB_PAGE_ACCESS_TOKEN}`);
    if (!res.ok) {
      console.warn(`⚠️ Failed to fetch user info for PSID ${psid}:`, res.status);
      return null;
    }
    const userData = await res.json();
    return userData.name || null;
  } catch (err) {
    console.error(`🔥 Error fetching user info for PSID ${psid}:`, err.message);
    return null;
  }
}

serve(async (req) => {
  console.log("Edge function received request:", req.method, req.url);
  
  if (req.method === 'OPTIONS') {
    console.log("Handling OPTIONS request")
    return new Response('ok', { headers: corsHeaders })
  }
  
  const url = new URL(req.url)
  console.log(`📥 Incoming request: ${req.method} ${url.pathname}`);

  try {
    // 1. Webhook Verification (GET request)
    if (req.method === 'GET') {
      const mode = url.searchParams.get('hub.mode')
      const token = url.searchParams.get('hub.verify_token')
      const challenge = url.searchParams.get('hub.challenge')

      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('✅ Webhook Verified')
        return new Response(challenge, { headers: { ...corsHeaders, 'Content-Type': 'text/plain' }, status: 200 })
      }
      return new Response('Forbidden', { headers: { ...corsHeaders, 'Content-Type': 'text/plain' }, status: 403 })
    }

    // 2. Handle Incoming Events (POST request)
    if (req.method === 'POST') {
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
                // Try to get user's name from Messenger
                const defaultName = await getMessengerUserName(psid);
                
                const updateData = {
                  parent_messenger_id: psid,
                  notify_parent: true 
                };
                if (defaultName) {
                  updateData.parent_guardian_name = defaultName;
                }
                
                const { data, error } = await supabase
                  .from('students')
                  .update(updateData)
                  .eq('lrn', lrn)
                  .select()

                if (error) {
                  console.error(`❌ Database error during registration for LRN ${lrn}:`, error.message)
                  await sendResponse(psid, `❌ Registration Error: Dili ma-update ang database sa pagkakaron.`)
                } else if (data && data.length > 0) {
                  console.log(`✅ PSID ${psid} successfully linked to ${data[0].full_name} (LRN: ${lrn})`)
                  const nameMsg = defaultName ? ` (Using your name: ${defaultName})` : '';
                  await sendResponse(psid, `✅ Registration Successful! Makadawat na ka og attendance alerts ni ${data[0].full_name}.${nameMsg}\n\n💡 Tip: I-send ang 'PING' kada adlaw o kada semana aron magpabilin ka active ug makadawat gihapon ug alerts! (Facebook nagablock ug messages kung walay interaction sulod sa 24 oras)\n\nPara i-set o i-update ang imong ngalan, i-send: NAME [Your Full Name]\nPara makita ang tanan nimo nga linked students, i-send: LIST`);
                } else {
                  console.warn(`⚠️ Registration failed: LRN ${lrn} not found in database.`)
                  await sendResponse(psid, `❌ Registration Failed: Dili makit-an ang LRN ${lrn} sa among listahan.`)
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
              
              // Handle NAME command: Set parent/guardian name
              if (text.startsWith('NAME')) {
                const newName = rawText.replace(/NAME/i, '').trim();
                console.log(`🔍 NAME command: Setting name to "${newName}" for PSID ${psid}`);
                
                if (!newName) {
                  await sendResponse(psid, `❓ Please include your name. Example: NAME Juan Dela Cruz`);
                  continue;
                }
                
                const { data, error } = await supabase
                  .from('students')
                  .update({ parent_guardian_name: newName })
                  .eq('parent_messenger_id', psid)
                  .select();
                  
                if (error) {
                  console.error(`❌ DB Error (NAME):`, error.message);
                  await sendResponse(psid, `❌ Error updating your name. Please try again later.`);
                } else if (data && data.length > 0) {
                  console.log(`✅ NAME updated for PSID ${psid} to "${newName}"`);
                  await sendResponse(psid, `✅ Okay! We've updated your name to: ${newName}`);
                } else {
                  await sendResponse(psid, `❌ You haven't linked any students yet. First, link a student using: LINK [12-digit LRN]`);
                }
              }
              // Handle manual "reg_LRN" code from Alternative section
              else if (text.startsWith('REG_')) {
                const targetLrn = rawText.replace(/reg_/i, '').replace(/[^0-9]/g, '').trim();
                console.log(`🔍 Manual REG attempt for LRN: ${targetLrn} (Original: ${rawText})`);
                
                if (targetLrn.length === 12) {
                  const defaultName = await getMessengerUserName(psid);
                  const updateData: any = {
                    parent_messenger_id: psid,
                    notify_parent: true 
                  };
                  if (defaultName) updateData.parent_guardian_name = defaultName;
                  
                  const { data, error } = await supabase
                    .from('students')
                    .update(updateData)
                    .eq('lrn', targetLrn)
                    .select()

                  if (error) {
                    console.error(`❌ DB Error (REG_):`, error.message)
                    await sendResponse(psid, `❌ System Error: Dili ma-link ang LRN ${targetLrn} sa pagkakaron.`);
                  } else if (data && data.length > 0) {
                    console.log(`✅ Manual link success: ${data[0].full_name} (LRN: ${targetLrn})`);
                    const nameMsg = defaultName ? ` (Using your name: ${defaultName})` : '';
                    await sendResponse(psid, `✅ Successfully linked to ${data[0].full_name}!${nameMsg}\n\n💡 Tip: I-send ang 'PING' kada adlaw o kada semana aron magpabilin ka active ug makadawat gihapon ug alerts! (Facebook nagablock ug messages kung walay interaction sulod sa 24 oras)\n\nPara i-set o i-update ang imong ngalan, i-send: NAME [Your Full Name]`);
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
                  const defaultName = await getMessengerUserName(psid);
                  const updateData: any = {
                    parent_messenger_id: psid,
                    notify_parent: true 
                  };
                  if (defaultName) updateData.parent_guardian_name = defaultName;
                  
                  const { data, error } = await supabase
                    .from('students')
                    .update(updateData)
                    .eq('lrn', targetLrn)
                    .select()

                  if (error) {
                    console.error(`❌ DB Error (LINK):`, error.message)
                    await sendResponse(psid, `❌ Error: Nagkaproblema ang system sa pag-link sa LRN ${targetLrn}.`)
                  } else if (data && data.length > 0) {
                    console.log(`✅ LINK success for ${data[0].full_name} (LRN: ${targetLrn})`);
                    const nameMsg = defaultName ? ` (Using your name: ${defaultName})` : '';
                    await sendResponse(psid, `✅ Successfully linked to ${data[0].full_name}!${nameMsg}\n\n💡 Tip: I-send ang 'PING' kada adlaw o kada semana aron magpabilin ka active ug makadawat gihapon ug alerts! (Facebook nagablock ug messages kung walay interaction sulod sa 24 oras)\n\nPara i-set o i-update ang imong ngalan, i-send: NAME [Your Full Name]`);
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
                    console.error(`❌ DB Error (UNLINK):`, error.message);
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
                  .select('full_name, lrn, parent_guardian_name')
                  .eq('parent_messenger_id', psid);

                if (error) {
                  console.error(`❌ DB Error (${text}) for PSID ${psid}:`, error.message);
                  await sendResponse(psid, `❌ Error: Dili makuha ang imong student list sa pagkakaron.`);
                } else if (data && data.length > 0) {
                  console.log(`✅ Found ${data.length} students for PSID ${psid}: ${data.map(s => s.full_name).join(', ')}`);
                  const studentList = data.map(s => {
                    const nameInfo = s.parent_guardian_name ? ` (Guardian: ${s.parent_guardian_name})` : '';
                    return `• ${s.full_name} (${s.lrn})${nameInfo}`;
                  }).join('\n');
                  await sendResponse(psid, `📋 Nagadawat ka ug alerts ni:\n\n${studentList}\n\n💡 Tip: I-send ang 'PING' kada adlaw o kada semana aron magpabilin ka active ug makadawat gihapon ug alerts! (Facebook nagablock ug messages kung walay interaction sulod sa 24 oras)\n\nCommands:\n• LIST - See linked students\n• NAME [Your Name] - Para i-set o i-update ang imong name\n• LINK [LRN] - Link another student\n• UNLINK [LRN] - Stop receiving alerts`);
                } else {
                  console.warn(`⚠️ No students found for PSID ${psid}`);
                  await sendResponse(psid, `👋 Flehew! Wala pa kay estudyante nga naka-link sa imong account.\n\nPara ma-link ang estudyante, i-send ang: LINK [12-digit LRN]`);
                }
              } else if (text === 'PING') {
                console.log(`🏓 PING received from PSID ${psid}`)
                await sendResponse(psid, `🏓 Pong! Ang ULHS bot kay online na ug andam na sa imong commands. Your PSID is: ${psid}\n\n✅ Salamat sa pag-PING! Kini magpabilin sa imong 24-hour window active aron makadawat ka gihapon ug attendance alerts!`);
              } else if (/^\d{12}$/.test(text)) {
                // If user sends JUST the 12-digit LRN
                const lrn = text;
                console.log(`🔍 12-digit LRN detected: ${lrn} from PSID ${psid}`);
                const defaultName = await getMessengerUserName(psid);
                const updateData = {
                  parent_messenger_id: psid,
                  notify_parent: true 
                };
                if (defaultName) updateData.parent_guardian_name = defaultName;
                
                const { data, error } = await supabase
                  .from('students')
                  .update(updateData)
                  .eq('lrn', lrn)
                  .select()

                if (error) {
                  console.error(`❌ DB Error (LRN Only) for LRN ${lrn}:`, error.message)
                  await sendResponse(psid, `❌ System Error: Dili ma-link ang LRN ${lrn} sa pagkakaron.`);
                } else if (data && data.length > 0) {
                  console.log(`✅ LRN link success: ${data[0].full_name} (LRN: ${lrn})`);
                  const nameMsg = defaultName ? ` (Using your name: ${defaultName})` : '';
                  await sendResponse(psid, `✅ Successfully linked to ${data[0].full_name}!${nameMsg}\n\n💡 Tip: I-send ang 'PING' kada adlaw o kada semana aron magpabilin ka active ug makadawat gihapon ug alerts! (Facebook nagablock ug messages kung walay interaction sulod sa 24 oras)\n\nPara i-set o i-update ang imong ngalan, i-send: NAME [Your Full Name]`);
                } else {
                  console.warn(`⚠️ LRN not found (LRN Only): ${lrn}`);
                  await sendResponse(psid, `❌ Registration Failed: Ang LRN ${lrn} wala sa among listahan.`);
                }
              } else {
                console.log(`❓ Unknown command from PSID ${psid}: "${rawText}"`);
                await sendResponse(psid, `🤖 Ha? Usba daw pag-type. Pwede nimo i-send ang:\n• LIST - Para makita ang linked students\n• NAME [Your Name] - Para i-set o i-update ang imong name\n• LINK [LRN] - Para mag-add ug estudyante\n• PING - Para i-test ang connection`);
              }
            }
          }
        }
        return new Response('EVENT_RECEIVED', { headers: { ...corsHeaders, 'Content-Type': 'text/plain' }, status: 200 })
      }
      console.warn(`⚠️ Received non-page object: ${body.object}`);
      return new Response('NOT_PAGE', { headers: { ...corsHeaders, 'Content-Type': 'text/plain' }, status: 200 })
    }

    return new Response('Not Found', { headers: { ...corsHeaders, 'Content-Type': 'text/plain' }, status: 404 })
  } catch (error) {
    console.error("Edge function error:", error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})

async function sendResponse(psid, text) {
  console.log(`📡 Sending message to PSID ${psid}: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
  
  if (!FB_PAGE_ACCESS_TOKEN) {
    console.error("❌ Critical Error: FB_PAGE_ACCESS_TOKEN is missing!");
    return;
  }

  const payload = {
    recipient: { id: psid },
    message: { text: text },
    messaging_type: "RESPONSE" 
  };

  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${FB_PAGE_ACCESS_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    
    const responseData = await res.json();
    
    if (!res.ok) {
      console.error(`❌ Messenger API Error (Status: ${res.status}):`, JSON.stringify(responseData));
      
      // Fallback for 24-hour window issues
      if (responseData.error?.code === 10 || responseData.error?.error_subcode === 2018001 || responseData.error?.code === 200) {
        console.log(`🔄 Attempting fallback with MESSAGE_TAG for PSID ${psid}...`);
        const fallbackPayload = {
          recipient: { id: psid },
          message: { text: text },
          messaging_type: "MESSAGE_TAG",
          tag: "CONFIRMED_EVENT_UPDATE"
        };
        
        const fallbackRes = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${FB_PAGE_ACCESS_TOKEN}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fallbackPayload)
        });
        
        const fallbackData = await fallbackRes.json();
        if (!fallbackRes.ok) {
          console.error(`❌ Fallback failed:`, JSON.stringify(fallbackData));
        } else {
          console.log(`✅ Fallback success for PSID ${psid}. Message ID: ${fallbackData.message_id}`);
        }
      }
    } else {
      console.log(`✅ Message sent successfully to PSID ${psid}. ID: ${responseData.message_id}`)
    }
  } catch (err) {
    console.error(`🔥 Network error sending to PSID ${psid}:`, err.message)
  }
}
