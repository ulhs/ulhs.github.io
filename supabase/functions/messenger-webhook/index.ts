// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

console.log("Edge function loaded and starting");

const FB_PAGE_ACCESS_TOKEN = Deno.env.get('FB_PAGE_ACCESS_TOKEN');
const VERIFY_TOKEN = Deno.env.get('MESSENGER_VERIFY_TOKEN') || 'ULHS_VERIFY_TOKEN';
const FB_APP_SECRET = Deno.env.get('FB_APP_SECRET');

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Critical Error: Supabase environment variables are missing!");
}

const supabase = createClient(
  SUPABASE_URL ?? '',
  SUPABASE_SERVICE_ROLE_KEY ?? ''
);

async function verifyFacebookSignature(rawBody, signatureHeader) {
  if (!FB_APP_SECRET) {
    console.warn('⚠️ FB_APP_SECRET is not set. Refusing webhook POST without signature validation.');
    return false;
  }

  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    console.warn('⚠️ Missing or malformed X-Hub-Signature-256 header.');
    return false;
  }

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(FB_APP_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
    const expectedSignature = Array.from(new Uint8Array(signature))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');

    const providedSignature = signatureHeader.slice('sha256='.length).toLowerCase();
    return expectedSignature === providedSignature;
  } catch (error) {
    console.error('🔥 Error validating Facebook webhook signature:', error);
    return false;
  }
}

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
    console.log("Handling OPTIONS request");
    return new Response('ok', { headers: corsHeaders });
  }
  
  const url = new URL(req.url);
  console.log(`📥 Incoming request: ${req.method} ${url.pathname}`);

  try {
    // 1. Webhook Verification (GET request)
    if (req.method === 'GET') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');

      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('✅ Webhook Verified');
        return new Response(challenge, { headers: { ...corsHeaders, 'Content-Type': 'text/plain' }, status: 200 });
      }
      return new Response('Forbidden', { headers: { ...corsHeaders, 'Content-Type': 'text/plain' }, status: 403 });
    }

    // 2. Handle Incoming Events (POST request)
    if (req.method === 'POST') {
      const rawBody = await req.text();
      const signatureHeader = req.headers.get('x-hub-signature-256') || '';

      if (!await verifyFacebookSignature(rawBody, signatureHeader)) {
        console.warn('🚫 Rejected invalid Facebook webhook signature.');
        return new Response('Forbidden', { headers: { ...corsHeaders, 'Content-Type': 'text/plain' }, status: 403 });
      }

      const body = JSON.parse(rawBody);

      if (body.object === 'page') {
        for (const entry of body.entry) {
          if (!entry.messaging) continue;

          for (const messagingEvent of entry.messaging) {
            const psid = messagingEvent.sender?.id;
            if (!psid) continue;

            // 2a. Handle Registration (via Referral or Postback)
            const rawLrn = messagingEvent.referral?.ref || messagingEvent.postback?.referral?.ref;

            if (rawLrn) {
              const registrationRef = parseRegistrationReference(rawLrn);
              const lrn = registrationRef ? registrationRef.lrn : rawLrn.replace(/reg_/i, '').replace(/[^0-9]/g, '').trim();
              console.log(`📝 Registration attempt: PSID ${psid} for LRN ${lrn} (Raw: ${rawLrn})`);
              
              if (!registrationRef || !registrationRef.token) {
                console.warn(`⚠️ Ref registration missing secure confirmation token for PSID ${psid}: ${rawLrn}`);
                await sendResponse(psid, `⚠️ Secure registration requires the confirmation code generated by the website. Please complete the registration flow from the official ULHS Parent Registration page.`);
              } else if (lrn.length !== 12) {
                console.warn(`⚠️ Invalid LRN length (${lrn.length}): ${lrn}`);
                await sendResponse(psid, `❌ Registration Failed: Ang LRN ${lrn} dapat 12 ka digits gyud.`);
              } else {
                const token = registrationRef.token.toUpperCase();
                const { data: matchingCode, error: codeLookupError } = await supabase
                  .from('verification_codes')
                  .select('*')
                  .eq('student_lrn', lrn)
                  .eq('code', token)
                  .eq('used', false)
                  .gt('expires_at', new Date().toISOString())
                  .order('created_at', { ascending: false })
                  .limit(1)
                  .single();

                if (codeLookupError || !matchingCode) {
                  console.warn(`⚠️ Referral rejected for PSID ${psid}: missing or invalid matching secure code ${token} for LRN ${lrn}`);
                  await sendResponse(psid, `⚠️ Your Messenger registration is not complete yet. Please use the secure registration page, receive the confirmation code, and send it back through Messenger before linking this student.`);
                  continue;
                }

                console.log(`✅ Registration referral received for PSID ${psid} and LRN ${lrn}; awaiting explicit CONFIRM message.`);
                await sendResponse(psid, `👋 Your secure registration request is ready. Please reply with the exact confirmation message shown on the ULHS registration page: CONFIRM ${token} ${lrn}`);
              }
            } 
            // Handle Get Started button without referral
            else if (messagingEvent.postback?.payload === 'GET_STARTED') {
              console.log(`🚀 GET_STARTED received from PSID ${psid}`);
              await sendResponse(psid, `👋 Flehew! Welcome to the ULHS Attendance Alert System.\n\nPara ma-link ang estudyante, gamita ang registration link sa among website o i-send ang: LINK [12-digit LRN]\nPara makakuha ug verification code para sa PIN, i-send: RESET`);
            }
            
            // 2b. Handle Commands (via Text Message)
            else if (messagingEvent.message?.text) {
              const rawText = messagingEvent.message.text.trim();
              const text = rawText.toUpperCase();
              console.log(`💬 Processing text from PSID ${psid}: "${rawText}" (uppercase: "${text}")`);
              
              // Handle RESET/VERIFY commands first (highest priority)
              if (text.startsWith('RESET') || text.startsWith('VERIFY')) {
                console.log(`🔐 Verification code request from PSID ${psid}`);
                
                // Generate 6-digit code first (even before checking students or saving to DB)
                const code = Math.floor(100000 + Math.random() * 900000).toString();
                console.log(`🔐 Generated verification code: ${code}`);
                
                // First check if parent has at least one linked student
                console.log(`🔍 Checking linked students for PSID ${psid}`);
                const { data: linkedRows, error: studentsError } = await supabase
                  .from('parent_student_links')
                  .select('student_lrn, students(lrn, full_name)')
                  .eq('parent_psid', psid)
                  .eq('notify_parent', true);
                const students = (linkedRows || []).map(row => row.students).filter(Boolean);
                
                if (studentsError) {
                  console.error(`❌ Error checking linked students for PSID ${psid}:`, JSON.stringify(studentsError));
                }
                
                if (!students || students.length === 0) {
                  console.warn(`⚠️ No linked students found for PSID ${psid}`);
                  await sendResponse(psid, `⚠️ Wala pa kay naka-link nga estudyante. Palihug link sa usa ka estudyante una gamit ang LINK command.`);
                  continue;
                }
                
                console.log(`✅ Found ${students.length} linked students for PSID ${psid}:`, students.map(s => `${s.full_name} (${s.lrn})`).join(', '));
                
                // Try to save to database, but even if it fails, still send the code
                console.log(`💾 Saving verification code to database...`);
                const { error } = await supabase
                  .from('verification_codes')
                  .insert({
                    parent_psid: psid,
                    code: code
                  });
                
                if (error) {
                  console.error(`❌ Error saving verification code to database:`, JSON.stringify(error));
                  // Still send the code, just warn about the DB issue
                  await sendResponse(psid, `🔐 Here's your verification code: ${code}\n\nKini nga code mag-expire after 10 minutes. Gamita kini aron ma-set or ma-reset ang imong PIN sa parent portal.\n\n⚠️ Note: Nagkaproblema sa pag-save sa code sa database, but okay ra gamiton ni!`);
                } else {
                  console.log(`✅ Verification code ${code} saved successfully for PSID ${psid}`);
                  await sendResponse(psid, `🔐 Here's your verification code: ${code}\n\nKini nga code mag-expire after 10 minutes. Gamita kini aron ma-set or ma-reset ang imong PIN sa parent portal.`);
                }
                continue;
              }
              // Handle secure confirmation code from Messenger
              else if (text.startsWith('CONFIRM')) {
                const parsedConfirm = parseConfirmationMessage(rawText);
                if (!parsedConfirm) {
                  console.warn(`⚠️ Invalid CONFIRM payload from PSID ${psid}: "${rawText}"`);
                  await sendResponse(psid, `❓ Use the format: CONFIRM <code> [12-digit LRN]\n\nExample: CONFIRM 810807 210008160013`);
                  continue;
                }

                console.log(`🔐 Validating confirmation code ${parsedConfirm.code} for PSID ${psid} and LRN ${parsedConfirm.lrn || 'unspecified'}`);

                const pendingLrn = parsedConfirm.lrn || null;
                let codeQuery = supabase
                  .from('verification_codes')
                  .select('*')
                  .eq('code', parsedConfirm.code)
                  .eq('used', false)
                  .gt('expires_at', new Date().toISOString());

                if (pendingLrn) {
                  codeQuery = codeQuery.eq('student_lrn', pendingLrn);
                } else {
                  codeQuery = codeQuery.eq('parent_psid', psid);
                }

                const { data: validCode, error: codeError } = await codeQuery
                  .order('created_at', { ascending: false })
                  .limit(1)
                  .single();

                if (codeError || !validCode) {
                  console.warn(`⚠️ Invalid or expired confirmation code for PSID ${psid}: ${parsedConfirm.code}`);
                  await sendResponse(psid, `❌ Invalid or expired confirmation code. Please request a fresh verification code from the secure registration flow.`);
                  continue;
                }

                if (pendingLrn) {
                  const { error: updatePendingError } = await supabase
                    .from('verification_codes')
                    .update({ parent_psid: psid })
                    .eq('id', validCode.id);

                  if (updatePendingError) {
                    console.error(`⚠️ Failed to attach PSID ${psid} to valid registration code ${validCode.id}:`, updatePendingError);
                  }
                }

                const targetLrn = parsedConfirm.lrn || null;
                const { data: studentData, error: studentLookupError } = targetLrn
                  ? await supabase
                      .from('students')
                      .select('lrn, full_name, parent_messenger_id')
                      .eq('lrn', targetLrn)
                      .single()
                  : await supabase
                      .from('students')
                      .select('lrn, full_name, parent_messenger_id')
                      .eq('parent_messenger_id', psid)
                      .order('created_at', { ascending: true })
                      .limit(1)
                      .single();

                if (studentLookupError || !studentData) {
                  console.warn(`⚠️ No target student found for PSID ${psid} while confirming code ${parsedConfirm.code}`);
                  await sendResponse(psid, `❌ I could not match that confirmation code to a student record. Please try again or request a new code.`);
                  continue;
                }

                const { data: updatedLink, error: updateError } = await supabase
                  .from('parent_student_links')
                  .upsert({
                    student_lrn: studentData.lrn,
                    parent_psid: psid,
                    notify_parent: true
                  }, { onConflict: 'student_lrn,parent_psid' })
                  .select();

                if (updateError) {
                  console.error(`❌ Error linking student ${studentData.lrn} to PSID ${psid}:`, updateError);
                  await sendResponse(psid, `❌ I could not complete the link. Please try again.`);
                  continue;
                }

                if (!updatedLink || updatedLink.length === 0) {
                  console.warn(`⚠️ Confirmed code was valid, but the guardian link for LRN ${studentData.lrn} was not created for PSID ${psid}.`);
                  await sendResponse(psid, `❌ The confirmation was valid, but the link did not update correctly. Please try again or request a fresh code.`);
                  continue;
                }

                const legacyPsids = String(studentData.parent_messenger_id || '')
                  .split(',')
                  .map(id => id.trim())
                  .filter(Boolean);
                if (!legacyPsids.includes(psid)) {
                  await supabase
                    .from('students')
                    .update({ parent_messenger_id: [...legacyPsids, psid].join(','), notify_parent: true })
                    .eq('lrn', studentData.lrn);
                }

                const { error: markUsedError } = await supabase
                  .from('verification_codes')
                  .update({ used: true })
                  .eq('id', validCode.id);

                if (markUsedError) {
                  console.error(`❌ Error marking verification code ${validCode.id} as used:`, markUsedError);
                }

                console.log(`✅ Confirmed code ${parsedConfirm.code} for PSID ${psid} and student LRN ${studentData.lrn}`);
                await sendResponse(psid, `✅ Confirmation successful! Your Messenger account is now linked to ${studentData.full_name} (${studentData.lrn}).\n\nYou can now use your secure PIN flow and receive attendance alerts.`);
              }
              
              // Handle NAME command: Set parent/guardian name
              else if (text.startsWith('NAME')) {
                const newName = rawText.replace(/NAME/i, '').trim();
                console.log(`🔍 NAME command: Setting name to "${newName}" for PSID ${psid}`);
                
                if (!newName) {
                  await sendResponse(psid, `❓ Please include your name. Example: NAME Juan Dela Cruz`);
                  continue;
                }
                
                const { data, error } = await supabase
                  .from('parent_student_links')
                  .update({ parent_guardian_name: newName, updated_at: new Date().toISOString() })
                  .eq('parent_psid', psid)
                  .select();
                  
                if (error) {
                  console.error(`❌ DB Error (NAME):`, error.message);
                  await sendResponse(psid, `❌ Error updating your name. Please try again later.`);
                } else if (data && data.length > 0) {
                  console.log(`✅ NAME updated for PSID ${psid} to "${newName}"`);
                  await sendResponse(psid, `✅ Okay! We've updated your name to: ${newName}`);
                } else {
                  await sendResponse(psid, `❌ You haven't linked any students yet. First, link a student using the secure registration flow from the ULHS website.`);
                }
              }
              // Manual registration codes are not accepted directly for security.
              else if (text.startsWith('REG_')) {
                console.warn(`⚠️ Blocked direct REG_ registration attempt for PSID ${psid}`);
                await sendResponse(psid, `⚠️ Direct REG_ registration is disabled for security. Please use the official ULHS Parent Registration page and complete the secure Messenger confirmation flow.`);
              }
              else if (text.startsWith('LINK')) {
                console.warn(`⚠️ Blocked direct LINK registration attempt for PSID ${psid}`);
                await sendResponse(psid, `⚠️ Direct LINK-by-LRN registration is disabled for security. Please use the official ULHS Parent Registration page and complete the secure Messenger code confirmation.`);
              } else if (text.startsWith('UNLINK')) {
                const targetLrn = rawText.replace(/UNLINK/i, '').replace(/[^0-9]/g, '').trim();
                console.log(`🔍 UNLINK command for LRN: ${targetLrn} (Original: ${rawText})`);
                
                if (targetLrn.length === 12) {
                  try {
                    const { data: linkedStudents, error: linkedFetchError } = await supabase
                      .from('parent_student_links')
                      .select('id, student_lrn, students(full_name)')
                      .eq('parent_psid', psid)
                      .eq('student_lrn', targetLrn);

                    if (linkedFetchError) {
                      throw linkedFetchError;
                    }

                    const updates = [];
                    const studentsToUpdate = linkedStudents || [];

                    for (const studentRow of studentsToUpdate) {
                      updates.push({
                        id: studentRow.id,
                        lrn: studentRow.student_lrn,
                        full_name: studentRow.students?.full_name || studentRow.student_lrn
                      });
                    }

                    if (updates.length === 0) {
                      console.warn(`⚠️ UNLINK failed/No match for LRN ${targetLrn} and PSID ${psid}`);
                      await sendResponse(psid, `❌ Unlink failed. Siguraduha nga sakto ang LRN ${targetLrn} ug naka-link kini sa imong account.`);
                    } else {
                      const updateResults = await Promise.all(updates.map(async (row) => {
                        const { data, error } = await supabase
                          .from('parent_student_links')
                          .delete()
                          .eq('id', row.id)
                          .select();

                        if (error) {
                          console.error(`❌ DB Error cleaning PSID for ${row.lrn}:`, error.message);
                          return null;
                        }

                        return data?.[0] || null;
                      }));

                      const successfulRows = updateResults.filter(Boolean);
                      const targetStudent = studentsToUpdate[0];

                      if (successfulRows.length > 0 && targetStudent) {
                        const { data: legacyStudent } = await supabase
                          .from('students')
                          .select('parent_messenger_id')
                          .eq('lrn', targetLrn)
                          .single();
                        const remainingPsids = String(legacyStudent?.parent_messenger_id || '')
                          .split(',')
                          .map(id => id.trim())
                          .filter(id => id && id !== psid);
                        await supabase
                          .from('students')
                          .update({
                            parent_messenger_id: remainingPsids.length > 0 ? remainingPsids.join(',') : null,
                            notify_parent: remainingPsids.length > 0
                          })
                          .eq('lrn', targetLrn);

                        console.log(`✅ UNLINK success for ${targetStudent.students?.full_name || targetLrn} (LRN: ${targetLrn}) for PSID ${psid}.`);
                        await sendResponse(psid, `✅ Successfully unlinked from ${targetStudent.students?.full_name || targetLrn}. Dili na ka makadawat ug alerts para ani nga LRN.`);
                      } else {
                        console.warn(`⚠️ UNLINK failed/No match for LRN ${targetLrn} and PSID ${psid}`);
                        await sendResponse(psid, `❌ Unlink failed. Siguraduha nga sakto ang LRN ${targetLrn} ug naka-link kini sa imong account.`);
                      }
                    }
                  } catch (error) {
                    console.error(`❌ DB Error (UNLINK):`, error.message);
                    await sendResponse(psid, `❌ Error unlinking student. Palihog sulayi pag-usab unya.`);
                  }
                } else {
                  console.warn(`⚠️ Invalid UNLINK LRN length: ${targetLrn}`);
                  await sendResponse(psid, `❓ Para ma-stop ang alerts, i-send ang: UNLINK [12-digit LRN]`);
                }
              } else if (text === 'LIST' || text === 'STUDENTS' || text === 'HELP' || text === 'GET STARTED' || text === 'GET_STARTED') {
                console.log(`📋 Processing command "${text}" for PSID: ${psid}`);
                
                const { data: links, error } = await supabase
                  .from('parent_student_links')
                  .select('student_lrn, parent_guardian_name, students(full_name, lrn)')
                  .eq('parent_psid', psid)
                  .eq('notify_parent', true);
                const data = (links || []).map(link => ({
                  full_name: link.students?.full_name,
                  lrn: link.students?.lrn || link.student_lrn,
                  parent_guardian_name: link.parent_guardian_name
                })).filter(student => student.full_name);

                if (error) {
                  console.error(`❌ DB Error (${text}) for PSID ${psid}:`, error.message);
                  await sendResponse(psid, `❌ Error: Dili makuha ang imong student list sa pagkakaron.`);
                } else if (data && data.length > 0) {
                  console.log(`✅ Found ${data.length} students for PSID ${psid}: ${data.map(s => s.full_name).join(', ')}`);
                  const studentList = data.map(s => {
                    const nameInfo = s.parent_guardian_name ? ` (Guardian: ${s.parent_guardian_name})` : '';
                    return `• ${s.full_name} (${s.lrn})${nameInfo}`;
                  }).join('\n');
                  await sendResponse(psid, `📋 Nagadawat ka ug alerts ni:\n\n${studentList}\n\n💡 Tip: I-send ang 'PING' kada adlaw o kada semana aron magpabilin ka active ug makadawat gihapon ug alerts! (Facebook nagablock ug messages kung walay interaction sulod sa 24 oras)\n\nCommands:\n• LIST - See linked students\n• NAME [Your Name] - Para i-set o i-update ang imong name\n• LINK [LRN] - Link another student\n• UNLINK [LRN] - Stop receiving alerts\n• RESET - Get a verification code to set/reset your PIN\n• PING - Test connection`);
                } else {
                  console.warn(`⚠️ No students found for PSID ${psid}`);
                  await sendResponse(psid, `👋 Flehew! Wala pa kay estudyante nga naka-link sa imong account.\n\nPara ma-link ang estudyante, i-send ang: LINK [12-digit LRN]`);
                }
              } else if (text === 'PING') {
                console.log(`🏓 PING received from PSID ${psid}`);
                await sendResponse(psid, `🏓 Pong! Ang ULHS bot kay online na ug andam na sa imong commands. Your PSID is: ${psid}\n\n✅ Salamat sa pag-PING! Kini magpabilin sa imong 24-hour window active aron makadawat ka gihapon ug attendance alerts!`);
              } else if (/^\d{12}$/.test(text)) {
                const lrn = text;
                console.log(`⚠️ Blocked bare-LRN registration attempt for ${lrn} from PSID ${psid}`);
                await sendResponse(psid, `⚠️ For security, direct LRN-only registration is disabled. Please complete the secure registration flow from the ULHS Parent Registration page or send the exact secure confirmation code you received there.`);
              } else {
                console.log(`❓ Unknown command from PSID ${psid}: "${rawText}"`);
                await sendResponse(psid, `🤖 Ha? Usba daw pag-type.\n\nPara ma-link ug estudyante, palihug gamita ang official ULHS Parent Registration page ug i-complete ang secure Messenger confirmation process.\n\nAvailable commands:\n• LIST - Para makita ang linked students\n• NAME [Your Name] - Para i-set o i-update ang imong name\n• UNLINK [LRN] - Para mu-undang ug alerts\n• RESET - Para makakuha ug verification code sa PIN\n• PING - Para i-test ang connection`);
              }
            }
          }
        }
        return new Response('EVENT_RECEIVED', { headers: { ...corsHeaders, 'Content-Type': 'text/plain' }, status: 200 });
      }
      console.warn(`⚠️ Received non-page object: ${body.object}`);
      return new Response('NOT_PAGE', { headers: { ...corsHeaders, 'Content-Type': 'text/plain' }, status: 200 });
    }

    return new Response('Not Found', { headers: { ...corsHeaders, 'Content-Type': 'text/plain' }, status: 404 });
  } catch (error) {
    console.error("Edge function error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});

function parseRegistrationReference(ref) {
  const cleaned = String(ref || '').trim();
  const match = cleaned.match(/^reg_(\d{12})(?:_([A-Z0-9]{6,12}))?$/i);
  if (!match) return null;
  return { lrn: match[1], token: match[2] ? match[2].toUpperCase() : null };
}

function parseConfirmationMessage(rawText) {
  const cleaned = String(rawText || '').trim();
  const match = cleaned.match(/^CONFIRM\s+([A-Z0-9]{6,12})(?:\s+(\d{12}))?$/i);
  if (!match) return null;
  return {
    code: match[1].toUpperCase(),
    lrn: match[2] || null
  };
}

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
    });
    
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
      console.log(`✅ Message sent successfully to PSID ${psid}. ID: ${responseData.message_id}`);
    }
  } catch (err) {
    console.error(`🔥 Network error sending to PSID ${psid}:`, err.message);
  }
}
