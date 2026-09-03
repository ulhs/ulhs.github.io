// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import CryptoJS from "https://esm.sh/crypto-js@4.2.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

console.log("Parent Login Edge Function loaded and starting");

serve(async (req) => {
  console.log("Parent Login received request:", req.method, req.url);

  if (req.method === 'OPTIONS') {
    console.log("Handling OPTIONS request");
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { lrn, pin } = await req.json();
    console.log("Login request for LRN:", lrn);

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

    // 1. Fetch the student by LRN
    console.log("Fetching student by LRN...");
    const { data: student, error: studentError } = await supabase
      .from('students')
      .select('lrn, full_name, parent_messenger_id, parent_guardian_name, section, grade_level, photo_url, student_id_number, parent_pin')
      .eq('lrn', lrn)
      .single();

    if (studentError || !student) {
      console.error("Student not found or error:", studentError);
      throw new Error("Invalid login attempt.");
    }

    const { data: guardianLinks, error: linksError } = await supabase
      .from('parent_student_links')
      .select('parent_psid, parent_guardian_name, parent_pin')
      .eq('student_lrn', lrn);

    if (linksError) {
      throw linksError;
    }

    const matchingLink = (guardianLinks || []).find(link => {
      if (!link.parent_pin) return false;
      const [salt, storedHash] = link.parent_pin.split(':');
      return CryptoJS.SHA256(pin + salt).toString() === storedHash;
    });

    // Legacy fallback for records created before the relationship table migration.
    const legacyPinMatches = !matchingLink && student.parent_pin
      ? (() => {
          const [salt, storedHash] = student.parent_pin.split(':');
          return CryptoJS.SHA256(pin + salt).toString() === storedHash;
        })()
      : false;

    if (!matchingLink && !legacyPinMatches) {
      throw new Error("PIN not set for this account. Please set a PIN first.");
    }

    const parentPsid = matchingLink?.parent_psid || student.parent_messenger_id;

    // 4. Fetch all students linked to this parent
    console.log("Fetching all linked students for parent PSID:", parentPsid);
    const { data: linkedRows, error: studentsError } = await supabase
      .from('parent_student_links')
      .select('student_lrn, students(lrn, full_name, section, grade_level, photo_url, student_id_number)')
      .eq('parent_psid', parentPsid)
      .eq('notify_parent', true);

    if (studentsError) {
      console.error("Error fetching linked students:", studentsError);
      throw new Error("Failed to load linked students.");
    }

    const allStudents = (linkedRows || []).map(row => row.students).filter(Boolean);

    // 5. Return success response with all necessary data
    return new Response(JSON.stringify({
      success: true,
      parentPsid,
      parentName: matchingLink?.parent_guardian_name || student.parent_guardian_name,
      students: allStudents,
      activeStudentLrn: lrn
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error) {
    console.error("Parent Login error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400
    });
  }
});
