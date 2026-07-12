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
    const { data: student, error: studentError } = await supabase
      .from('students')
      .select('lrn, parent_messenger_id')
      .eq('lrn', lrn)
      .single();

    if (studentError || !student || !student.parent_messenger_id) {
      throw new Error('Invalid LRN or student not linked to parent');
    }

    // Verify the code
    const { data: validCode, error: codeError } = await supabase
      .from('verification_codes')
      .select('*')
      .eq('parent_psid', student.parent_messenger_id)
      .eq('code', code)
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (codeError || !validCode) {
      throw new Error('Invalid or expired verification code');
    }

    // Mark code as used
    const { error: updateCodeError } = await supabase
      .from('verification_codes')
      .update({ used: true })
      .eq('id', validCode.id);

    if (updateCodeError) {
      console.error("Error marking code as used:", updateCodeError);
    }

    // Hash the new PIN using the same method as send-messenger-alert and login
    const salt = CryptoJS.lib.WordArray.random(128/8).toString();
    const hashedPin = CryptoJS.SHA256(pin + salt).toString();
    const parentPin = salt + ':' + hashedPin;

    // Update parent PIN for all linked students
    const { error: updatePinError } = await supabase
      .from('students')
      .update({ parent_pin: parentPin })
      .eq('parent_messenger_id', student.parent_messenger_id);

    if (updatePinError) {
      throw updatePinError;
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
