import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { psid, studentName, session, status, time, type } = await req.json()
    const FB_PAGE_ACCESS_TOKEN = Deno.env.get('FB_PAGE_ACCESS_TOKEN')

    if (!FB_PAGE_ACCESS_TOKEN) {
        throw new Error("Missing FB_PAGE_ACCESS_TOKEN secret.")
    }

    const message = type === 'arrival'
      ? `🔔 ULHS Arrival: Niabot na si ${studentName} sa eskwelahan (${session} session), ${time}. Status: ${status}.`
      : `🔔 ULHS Departure: Naka-scan out na si ${studentName} para karong adlawa, ${time}.`

    const res = await fetch(`https://graph.facebook.com/v12.0/me/messages?access_token=${FB_PAGE_ACCESS_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: psid },
        message: { text: message }
      })
    })

    const result = await res.json()
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})