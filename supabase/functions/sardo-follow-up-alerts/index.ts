// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sardo-cron-secret',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const expectedSecret = Deno.env.get('SARDO_ALERT_CRON_SECRET')
    if (expectedSecret && req.headers.get('x-sardo-cron-secret') !== expectedSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const pageToken = Deno.env.get('FB_PAGE_ACCESS_TOKEN')
    if (!supabaseUrl || !serviceRoleKey || !pageToken) throw new Error('Missing Supabase or Facebook secrets.')

    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const today = new Date().toISOString().slice(0, 10)
    const { data: followUps, error: followUpError } = await supabase
      .from('sardo_interventions')
      .select('id, student_lrn, risk_level, risk_score, status, follow_up_date, notes')
      .in('risk_level', ['Critical', 'High'])
      .in('status', ['open', 'in_progress'])
      .or(`follow_up_date.is.null,follow_up_date.lte.${today}`)
    if (followUpError) throw followUpError

    let sent = 0
    let skipped = 0
    const results = []
    for (const followUp of followUps || []) {
      const { data: students, error: studentError } = await supabase
        .from('students')
        .select('lrn, full_name, notify_parent, parent_messenger_id, parent_phone')
        .eq('lrn', followUp.student_lrn)
        .limit(1)
      if (studentError) throw studentError
      const student = students?.[0]
      if (!student?.notify_parent || !student.parent_messenger_id) {
        skipped++
        results.push({ intervention_id: followUp.id, status: 'no_active_parent_link' })
        continue
      }

      const psids = String(student.parent_messenger_id).split(',').map(value => value.trim()).filter(Boolean)
      for (const psid of psids) {
        const { data: alreadySent } = await supabase
          .from('notification_logs')
          .select('id')
          .eq('student_lrn', String(student.lrn))
          .eq('parent_psid', psid)
          .eq('context', 'sardo-follow-up')
          .gte('sent_at', `${today}T00:00:00.000Z`)
          .limit(1)
        if (alreadySent?.length) {
          skipped++
          continue
        }

        const { data: currentStudent } = await supabase
          .from('students')
          .select('notify_parent, parent_messenger_id')
          .eq('lrn', student.lrn)
          .limit(1)
        const live = currentStudent?.[0]
        const livePsids = String(live?.parent_messenger_id || '').split(',').map(value => value.trim()).filter(Boolean)
        if (!live?.notify_parent || !livePsids.includes(psid)) {
          skipped++
          continue
        }

        const message = `ULHS SARDO follow-up: ${student.full_name} currently has ${followUp.risk_level} attendance risk (${followUp.risk_score}/100). Please contact the school for follow-up support.`
        let success = false
        let errorMessage = null
        try {
          const response = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${pageToken}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ recipient: { id: psid }, message: { text: message } })
          })
          const result = await response.json()
          success = response.ok && !result.error
          errorMessage = result.error ? JSON.stringify(result.error) : null
        } catch (error) {
          errorMessage = String(error?.message || error)
        }

        await supabase.from('notification_logs').insert({
          student_lrn: String(student.lrn),
          student_name: student.full_name,
          parent_psid: psid,
          session: 'SARDO',
          status: followUp.risk_level,
          type: 'sardo-follow-up',
          context: 'sardo-follow-up',
          success,
          error_message: errorMessage
        })
        success ? sent++ : skipped++
        if (!success && student.parent_phone) {
          await supabase.from('notification_fallback_queue').insert({
            student_lrn: String(student.lrn),
            student_name: student.full_name,
            recipient: student.parent_phone,
            channel: 'sms',
            message
          })
        }
        results.push({ intervention_id: followUp.id, psid, success })
      }
    }

    return new Response(JSON.stringify({ date: today, sent, skipped, results }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
