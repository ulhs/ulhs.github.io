// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import CryptoJS from "https://esm.sh/crypto-js@4.2.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function generateRegistrationToken() {
  return Math.random().toString(36).toUpperCase().slice(2, 10).padEnd(8, 'X');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { lrn, pin } = await req.json();
    const normalizedLrn = String(lrn ?? '').trim();
    if (!/^\d{12}$/.test(normalizedLrn) || !/^\d{4}$/.test(String(pin ?? ''))) {
      throw new Error('Invalid registration details.');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: students, error: studentError } = await supabase
      .from('students')
      .select('full_name, lrn')
      .limit(5000);
    if (studentError) throw studentError;

    const student = (students || []).find((row) => {
      const stored = String(row.lrn ?? '').replace(/\D+/g, '').replace(/^0+/, '');
      const requested = normalizedLrn.replace(/^0+/, '');
      return stored && stored === requested;
    });
    if (!student) return new Response(JSON.stringify({ student: null }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
    });

    const salt = CryptoJS.lib.WordArray.random(128 / 8).toString();
    const parentPin = `${salt}:${CryptoJS.SHA256(String(pin) + salt).toString()}`;
    const code = generateRegistrationToken();
    const { error: codeError } = await supabase.from('verification_codes').insert({
      parent_psid: `PENDING_${Date.now()}_${normalizedLrn}`,
      student_lrn: normalizedLrn,
      code,
      parent_pin: parentPin,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      used: false,
    });
    if (codeError) throw codeError;

    return new Response(JSON.stringify({ student, registrationToken: code }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
    });
  } catch (error) {
    console.error('Parent registration start failed:', error);
    return new Response(JSON.stringify({ error: 'Unable to start registration right now.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
    });
  }
});