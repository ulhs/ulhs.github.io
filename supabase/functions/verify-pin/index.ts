// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import CryptoJS from "https://esm.sh/crypto-js@4.2.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

console.log("Edge function loaded and starting");

serve(async (req) => {
  console.log("Edge function received request:", req.method, req.url);

  if (req.method === 'OPTIONS') {
    console.log("Handling OPTIONS request");
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { lrn, code, pin } = await req.json();
    console.log("Received request:", { lrn, code });

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing Supabase credentials.");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // First get the student to get parent PSID
    console.log(`🔍 Fetching student with LRN ${lrn}...`);
    const { data: student, error: studentError } = await supabase
      .from('students')
      .select('lrn, parent_messenger_id')
      .eq('lrn', lrn)
      .single();

    if (studentError) {
      console.error(`❌ Error fetching student:`, studentError);
    }
    
    if (!student) {
      throw new Error('Invalid LRN or student not found');
    }
    console.log(`✅ Found student ${student.lrn}`);

    // Verify the code
    console.log(`🔍 Verifying code ${code}...`);
    const { data: validCode, error: codeError } = await supabase
      .from('verification_codes')
      .select('*')
      .eq('code', code)
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (codeError) {
      console.error(`❌ Error checking verification code:`, codeError);
    }
    
    if (!validCode) {
      throw new Error('Invalid or expired verification code');
    }
    console.log(`✅ Code is valid!`);
    
    // Hash the new PIN using the same method as send-messenger-alert and login
    console.log(`🔐 Hashing PIN...`);
    const salt = CryptoJS.lib.WordArray.random(128/8).toString();
    const hashedPin = CryptoJS.SHA256(pin + salt).toString();
    const parentPin = salt + ':' + hashedPin;
    console.log(`✅ PIN hashed successfully!`);

    const { data: guardianLink, error: guardianLinkError } = await supabase
      .from('parent_student_links')
      .select('id')
      .eq('student_lrn', lrn)
      .eq('parent_psid', validCode.parent_psid)
      .eq('notify_parent', true)
      .maybeSingle();

    if (guardianLinkError || !guardianLink) {
      throw new Error('This guardian link is not active. Please complete Messenger registration first.');
    }

    // Update only this guardian's PIN, not every guardian linked to the student.
    console.log(`💾 Updating parent PIN for guardian PSID ${validCode.parent_psid}...`);
    const { error: updatePinError } = await supabase
      .from('parent_student_links')
      .update({ parent_pin: parentPin })
      .eq('id', guardianLink.id);

    if (updatePinError) {
      console.error(`❌ Error updating PIN:`, updatePinError);
      throw updatePinError;
    }
    console.log(`✅ PIN updated successfully!`);

    // Consume the code only after the guardian relationship and PIN update succeed.
    console.log(`💾 Marking code as used...`);
    const { error: updateCodeError } = await supabase
      .from('verification_codes')
      .update({ used: true })
      .eq('id', validCode.id);

    if (updateCodeError) {
      console.error("Error marking code as used:", updateCodeError);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });
  } catch (error) {
    console.error("Edge function error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400
    });
  }
});
