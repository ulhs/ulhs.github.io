// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

console.log("Parent Data Edge Function loaded and starting");

serve(async (req) => {
  console.log("Parent Data received request:", req.method, req.url);

  if (req.method === 'OPTIONS') {
    console.log("Handling OPTIONS request");
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { parentPsid, studentLrn, type, dateFrom, dateTo, term } = await req.json();
    console.log("Data request:", { parentPsid, studentLrn, type, dateFrom, dateTo, term });

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

    // First, verify that the studentLrn belongs to the parentPsid
    const { data: student, error: studentError } = await supabase
      .from('students')
      .select('parent_messenger_id')
      .eq('lrn', studentLrn)
      .single();

    if (studentError || !student || student.parent_messenger_id !== parentPsid) {
      throw new Error("Invalid student or parent.");
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
