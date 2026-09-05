// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  return atob(padded);
}

async function verifyParentSession(token, secret) {
  const [header, payload, signature] = String(token || '').split('.');
  if (!header || !payload || !signature) return null;
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('HMAC', key, Uint8Array.from(base64UrlDecode(signature), char => char.charCodeAt(0)), new TextEncoder().encode(signingInput));
  if (!valid) return null;
  const claims = JSON.parse(base64UrlDecode(payload));
  return claims.exp > Math.floor(Date.now() / 1000) ? claims : null;
}

console.log("Parent Data Edge Function loaded and starting");

serve(async (req) => {
  console.log("Parent Data received request:", req.method, req.url);

  if (req.method === 'OPTIONS') {
    console.log("Handling OPTIONS request");
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { parentSessionToken, studentLrn, type, dateFrom, dateTo, term } = await req.json();

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing Supabase credentials.");
    }
    const parentSessionSecret = Deno.env.get('PARENT_SESSION_SECRET') || SUPABASE_SERVICE_ROLE_KEY;
    const session = await verifyParentSession(parentSessionToken, parentSessionSecret);
    if (!session?.sub) {
      throw new Error("Invalid parent session.");
    }
    const parentPsid = session.sub;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // First, verify that the student belongs to this specific guardian.
    const { data: link, error: linkError } = await supabase
      .from('parent_student_links')
      .select('id, grades_visible, grades_visible_until')
      .eq('student_lrn', studentLrn)
      .eq('parent_psid', parentPsid)
      .eq('notify_parent', true)
      .maybeSingle();

    if (linkError || !link) {
      throw new Error("Invalid student or parent.");
    }

    const visibilityExpiresAt = link.grades_visible_until
      ? new Date(link.grades_visible_until).getTime()
      : null;
    const gradesAreVisible = link.grades_visible !== false
      || Boolean(visibilityExpiresAt && visibilityExpiresAt <= Date.now());

    if (type === 'grades' && !gradesAreVisible) {
      return new Response(JSON.stringify({
        error: 'Dili pa makita ang grades karon. Amoa kamong ginahangyo nga muadto sa eskwelahan.',
        code: 'GRADES_TEMPORARILY_UNAVAILABLE'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 403
      });
    }

    let result = {};

    switch (type) {
      case 'attendance':
        // Fetch attendance logs
        let attendanceQuery = supabase
          .from('attendance_logs')
          .select('*, modality')
          .eq('student_lrn', studentLrn)
          .order('scanned_at', { ascending: false });

        if (dateFrom) {
          const fromDate = new Date(dateFrom);
          fromDate.setHours(0, 0, 0, 0);
          attendanceQuery = attendanceQuery.gte('scanned_at', fromDate.toISOString());
        }
        if (dateTo) {
          const toDate = new Date(dateTo);
          toDate.setHours(23, 59, 59, 999);
          attendanceQuery = attendanceQuery.lte('scanned_at', toDate.toISOString());
        }
        const { data: attendance, error: attendanceError } = await attendanceQuery;
        if (attendanceError) throw attendanceError;
        result = { attendance };
        break;

      case 'grades':
        // Fetch grades
        const { data: grades, error: gradesError } = await supabase
          .from('grades')
          .select('*')
          .eq('student_lrn', studentLrn)
          .eq('term', term || 1);
        if (gradesError) throw gradesError;
        result = { grades };
        break;

      case 'achievements':
        // Fetch achievements
        const { data: achievements, error: achievementsError } = await supabase
          .from('achievements')
          .select('*')
          .eq('student_lrn', studentLrn)
          .order('awarded_at', { ascending: false });
        if (achievementsError) throw achievementsError;
        result = { achievements };
        break;

      default:
        throw new Error("Invalid type.");
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error) {
    console.error("Parent Data error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400
    });
  }
});
