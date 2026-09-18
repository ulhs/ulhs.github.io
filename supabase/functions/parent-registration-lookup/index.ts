import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { lrn } = await req.json();
    const lookupLrn = String(lrn ?? '').trim();
    const normalizedLrn = lookupLrn.replace(/\D+/g, '').replace(/^0+/, '');

    if (!normalizedLrn) {
      return new Response(JSON.stringify({ student: null }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data, error } = await supabase
      .from('students')
      .select('full_name, lrn')
      .limit(5000);

    if (error) throw error;

    const student = (data || []).find((row) => {
      const storedLrn = String(row.lrn ?? '').replace(/\D+/g, '').replace(/^0+/, '');
      return storedLrn === normalizedLrn;
    }) || null;

    return new Response(JSON.stringify({ student }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('Parent registration lookup failed:', error);
    return new Response(JSON.stringify({ error: 'Unable to verify the student right now.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});