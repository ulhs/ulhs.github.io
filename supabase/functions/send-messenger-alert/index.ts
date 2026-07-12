// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

console.log("Edge function loaded and starting")

serve(async (req) => {
  console.log("Edge function received request:", req.method, req.url)
  
  if (req.method === 'OPTIONS') {
    console.log("Handling OPTIONS request")
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { 
      psid, 
      studentName, 
      studentLrn,
      session, 
      status, 
      time, 
      type, 
      context = 'regular-scan',
      suspendedDayDate = null
    }: any = await req.json()
    
    console.log("Received request with context:", context)
    console.log("Full request data:", { psid, studentName, studentLrn, session, status, time, type, context })
    console.log("studentLrn exists:", !!studentLrn)
    
    const FB_PAGE_ACCESS_TOKEN: string | undefined = Deno.env.get('FB_PAGE_ACCESS_TOKEN')
    const SUPABASE_URL: string | undefined = Deno.env.get('SUPABASE_URL')
    const SUPABASE_SERVICE_ROLE_KEY: string | undefined = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!FB_PAGE_ACCESS_TOKEN) {
        throw new Error("Missing FB_PAGE_ACCESS_TOKEN secret.")
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error("Missing Supabase credentials.")
    }

    // Create Supabase client with service role key to bypass RLS
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

    let message: string;
    
    // Format the suspended day date nicely if provided
    let formattedDate = '';
    if (suspendedDayDate) {
      const [year, month, day] = suspendedDayDate.split('-').map(Number);
      const dateObj = new Date(year, month - 1, day);
      // Format as "July 1, 2026"
      formattedDate = dateObj.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
    }

    if (context === 'early-dismissal') {
      message = `🔔 ULHS Early Dismissal: Naka-scan out na si ${studentName} sa eskwelahan (${session} session), ${time}. Aduna na'y sayo nga paggawas tungod sa sayo nga pag-dismiss.`;
    } else if (context === 'suspended-day') {
      if (formattedDate) {
        message = `🔔 ULHS Suspended Day (${formattedDate}): Gi-marka nga present si ${studentName} sa ${session} session tungod sa gisuspende nga adlaw.`;
      } else {
        message = `🔔 ULHS Suspended Day: Gi-marka nga present si ${studentName} sa ${session} session tungod sa gisuspende nga adlaw, ${time}.`;
      }
    } else {
      // Regular scan (backward compatible)
      message = type === 'arrival'
        ? `🔔 ULHS Arrival: Niabot na si ${studentName} sa eskwelahan (${session} session), ${time}. Status: ${status}.`
        : `🔔 ULHS Departure: Naka-scan out na si ${studentName} para karong adlawa, ${time}.`;
    }

    // First, log to notification_logs table (even before Facebook API call)
    let fbResult: any = null;
    let fbSuccess: boolean = false;
    let fbErrorMessage: string | null = null;
    let logId: number | null = null;

    if (studentLrn) {
      console.log("Attempting to insert into notification_logs with data:", {
        student_lrn: studentLrn,
        student_name: studentName,
        parent_psid: psid,
        session: session,
        status: status,
        type: type,
        context: context,
        suspended_day_date: suspendedDayDate,
        success: false, // Temporary, we'll update later
        error_message: null
      })
      
      // First insert with success=false
      const { data: initialData, error: initialLogError } = await supabase
        .from('notification_logs')
        .insert({
          student_lrn: studentLrn,
          student_name: studentName,
          parent_psid: psid,
          session: session,
          status: status,
          type: type,
          context: context,
          suspended_day_date: suspendedDayDate,
          success: false,
          error_message: null
        })
        .select()
      
      if (initialLogError) {
        console.error("Error inserting into notification_logs:", initialLogError)
      } else {
        console.log("Successfully inserted initial log into notification_logs:", initialData)
        if (initialData && initialData.length > 0) {
          logId = initialData[0].id;
        }
      }

      // Now make Facebook API call
      try {
        console.log("Making Facebook API call with message:", message)
        const res = await fetch(`https://graph.facebook.com/v12.0/me/messages?access_token=${FB_PAGE_ACCESS_TOKEN}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { id: psid },
            message: { text: message }
          })
        })

        fbResult = await res.json()
        fbSuccess = !fbResult.error
        fbErrorMessage = fbResult.error ? JSON.stringify(fbResult.error) : null
        console.log("Facebook API call result:", { fbSuccess, fbResult })

        // Now update the notification_log with the actual result
        if (logId) {
          console.log("Updating notification_log with id:", logId, "to success:", fbSuccess)
          const { error: updateError } = await supabase
            .from('notification_logs')
            .update({
              success: fbSuccess,
              error_message: fbErrorMessage
            })
            .eq('id', logId)
          
          if (updateError) {
            console.error("Error updating notification_logs:", updateError)
          } else {
            console.log("Successfully updated notification_logs")
          }
        }
      } catch (fbError) {
        console.error("Facebook API call threw an error:", fbError)
        fbErrorMessage = JSON.stringify(fbError)
        // Update log with error
        if (logId) {
          const { error: updateError } = await supabase
            .from('notification_logs')
            .update({
              success: false,
              error_message: fbErrorMessage
            })
            .eq('id', logId)
          if (updateError) {
            console.error("Error updating notification_logs with error:", updateError)
          }
        }
      }
    } else {
      console.error("studentLrn is missing, skipping insert into notification_logs")
    }

    return new Response(JSON.stringify(fbResult || { success: fbSuccess, error: fbErrorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    console.error("Edge function error:", error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
