// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

console.log("Parent Photo Edge Function loaded and starting");

serve(async (req) => {
  console.log("Parent Photo received request:", req.method, req.url);

  if (req.method === 'OPTIONS') {
    console.log("Handling OPTIONS request");
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { parentPsid, studentLrn } = await req.json();
    console.log("Photo request:", { parentPsid, studentLrn });

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

    // First, verify that the student belongs to this specific guardian.
    const { data: student, error: studentError } = await supabase
      .from('students')
      .select('lrn, photo_url, parent_messenger_id')
      .eq('lrn', studentLrn)
      .single();

    const { data: link, error: linkError } = await supabase
      .from('parent_student_links')
      .select('id')
      .eq('student_lrn', studentLrn)
      .eq('parent_psid', parentPsid)
      .eq('notify_parent', true)
      .maybeSingle();

    if (studentError || !student || linkError || !link) {
      throw new Error("Invalid student or parent.");
    }

    // Get the photo path, default to profiles/{lrn}.webp if not provided
    const photoPath = student.photo_url || `profiles/${studentLrn}.webp`;
    
    // Generate a signed URL that's valid for 1 hour
    const { data: signedUrlData, error: signedUrlError } = await supabase
      .storage
      .from('student-photos')
      .createSignedUrl(photoPath, 3600);

    if (signedUrlError) {
      console.error("Error generating signed URL:", signedUrlError);
      throw new Error("Failed to generate photo URL.");
    }

    return new Response(JSON.stringify({
      success: true,
      signedUrl: signedUrlData.signedUrl
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error) {
    console.error("Parent Photo error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400
    });
  }
});
