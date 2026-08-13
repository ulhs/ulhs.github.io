// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EXAM_SOURCE_BUCKET = 'exam-source';

const LETTER_TO_INDEX: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 };

function resolveCorrectAnswerText(question: any): string {
  const raw = String(question.correct_answer ?? '').trim();
  if (!raw) return '';
  const choices = Array.isArray(question.choices) ? question.choices : [];
  if (choices.length === 0) return raw;
  const upper = raw.toUpperCase();
  if (LETTER_TO_INDEX[upper] !== undefined) {
    const idx = LETTER_TO_INDEX[upper];
    if (typeof choices[idx] === 'string') {
      return String(choices[idx]).trim();
    }
  }
  return raw;
}

function sanitizeQuestionsForStudent(questions: any[]): any[] {
  return questions.map((q) => ({
    id: q.id || `q-${q.position}`,
    position: q.position,
    question_text: q.question_text,
    question_type: q.question_type,
    choices: Array.isArray(q.choices) ? q.choices : [],
    points: Number(q.points || 1)
  }));
}

function parseChoicesFallback(raw: any): string[] {
  if (!raw) return [];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function loadQuestionsForExam(
  supabase: any,
  exam: any,
  _includeAnswers: boolean
): Promise<any[]> {
  const bucketPath: string | undefined = (exam as any).questions_bucket_path;

  if (!bucketPath) {
    console.warn(`[exam-source] Exam ${exam.id} has no questions_bucket_path configured.`);
    return [];
  }

  try {
    const { data: fileData, error: dlError } = await supabase
      .storage
      .from(EXAM_SOURCE_BUCKET)
      .download(bucketPath);

    if (dlError || !fileData) {
      console.warn(`[exam-source] Bucket download failed for path: ${bucketPath}`, dlError?.message || 'no data');
      return [];
    }

    const raw = await fileData.text();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      console.warn(`[exam-source] Invalid JSON in bucket file ${bucketPath}:`, (parseErr as Error).message);
      return [];
    }

    if (!Array.isArray(parsed)) {
      console.warn(`[exam-source] Bucket file ${bucketPath} is not a JSON array.`);
      return [];
    }

    return parsed.map((q: any) => ({
      ...q,
      id: q.id || `${(exam as any).id}-pos-${q.position}`,
      exam_id: (exam as any).id,
      choices: Array.isArray(q.choices) ? q.choices : parseChoicesFallback(q.choices),
      correct_answer: q.correct_answer ? resolveCorrectAnswerText({ ...q, choices: Array.isArray(q.choices) ? q.choices : parseChoicesFallback(q.choices) }) : q.correct_answer
    }));
  } catch (bucketErr) {
    console.warn(`[exam-source] Failed to load questions from bucket ${bucketPath}:`, (bucketErr as Error).message);
    return [];
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing Supabase credentials.');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    const authHeader = req.headers.get('authorization') || '';
    const accessToken = authHeader.startsWith('Bearer ') ? authHeader.replace('Bearer ', '') : null;

    if (!accessToken) {
      throw new Error('Unauthorized: missing access token.');
    }

    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userData?.user?.id) {
      console.error('Auth verification failed:', userError);
      throw new Error('Unauthorized: invalid token.');
    }

    const profileId = userData.user.id;

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, can_manage_exams, can_manage_grades')
      .eq('id', profileId)
      .single();

    if (profileError || !profile) {
      console.error('Profile validation failed:', profileError, profile);
      throw new Error('Unauthorized: profile not found.');
    }

    const isAdminOrManager = (profileData: any) => {
      return !!profileData && (
        String(profileData.role).toLowerCase() === 'admin'
        || String(profileData.role).toLowerCase() === 'school_head'
        || profileData.can_manage_exams === true
        || profileData.can_manage_grades === true
      );
    };

    const isStudent = String(profile.role).toLowerCase() === 'student';

    const payload = await req.json();
    const { type } = payload;

    if (!type) {
      throw new Error('Missing request type.');
    }

    switch (type) {
      case 'admin-exam-results': {
        if (!isAdminOrManager(profile)) {
          throw new Error('Unauthorized: admin access required.');
        }

        const { data: attempts, error: attemptsError } = await supabase
          .from('exam_attempts')
          .select('id, profile_id, exam_id, term, status, score, submitted_at, created_at, exam:exams(id,title,subject,term,questions_bucket_path), profile:profiles(id,full_name,email)')
          .order('submitted_at', { ascending: false })
          .limit(1000);

        if (attemptsError) throw attemptsError;

        return new Response(JSON.stringify({ attempts: attempts || [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        });
      }

      case 'list-exams': {
        const term = Number(payload.term) || 1;

        if (!isStudent) {
          throw new Error('Unauthorized: student access required.');
        }

        const { data: exams, error: examsError } = await supabase
          .from('exams')
          .select('*')
          .eq('term', term)
          .eq('is_active', true)
          .order('created_at', { ascending: true });

        if (examsError) throw examsError;

        const examIds = exams.map((exam) => exam.id);
        let attempts = [];

        if (examIds.length > 0) {
          const { data: attemptsData, error: attemptsError } = await supabase
            .from('exam_attempts')
            .select('id, exam_id, score, status, submitted_at, created_at')
            .eq('profile_id', profileId)
            .in('exam_id', examIds)
            .order('submitted_at', { ascending: false });

          if (attemptsError) throw attemptsError;
          attempts = attemptsData || [];
        }

        const latestAttempts = attempts.reduce((acc, attempt) => {
          if (!acc[attempt.exam_id]) {
            acc[attempt.exam_id] = attempt;
          }
          return acc;
        }, {} as Record<string, any>);

        const result = exams.map((exam) => ({
          ...exam,
          latestAttempt: latestAttempts[exam.id] || null,
          has_questions: !!exam.questions_bucket_path
        }));

        return new Response(JSON.stringify({ exams: result }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        });
      }

      case 'exam-detail': {
        const examId = payload.examId;
        if (!examId) throw new Error('Missing exam ID.');

        const { data: exam, error: examError } = await supabase
          .from('exams')
          .select('*')
          .eq('id', examId)
          .single();

        if (examError || !exam) throw examError || new Error('Exam not found.');

        if (!exam.questions_bucket_path) {
          throw new Error('This exam has no question source attached yet. Contact administrator.');
        }

        const loadedQuestions = await loadQuestionsForExam(supabase, exam, false);

        if (loadedQuestions.length === 0) {
          throw new Error('Questions file not found or empty in storage bucket. Contact administrator.');
        }

        const { data: attempts, error: attemptsError } = await supabase
          .from('exam_attempts')
          .select('id, status, score, submitted_at, created_at')
          .eq('profile_id', profileId)
          .eq('exam_id', examId)
          .order('submitted_at', { ascending: false })
          .limit(1);

        if (attemptsError) throw attemptsError;

        const questions = sanitizeQuestionsForStudent(loadedQuestions);

        return new Response(JSON.stringify({ exam, questions, latestAttempt: attempts?.[0] || null }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        });
      }

      case 'submit-attempt': {
        const examId = payload.examId;
        const answers = payload.answers || {};
        const term = Number(payload.term) || 1;

        if (!examId) throw new Error('Missing exam ID.');

        const { data: exam, error: examError } = await supabase
          .from('exams')
          .select('*')
          .eq('id', examId)
          .single();

        if (examError || !exam) throw examError || new Error('Exam not found.');

        if (!exam.questions_bucket_path) {
          throw new Error('This exam has no question source attached yet. Cannot submit.');
        }

        const questions = await loadQuestionsForExam(supabase, exam, true);

        if (questions.length === 0) {
          throw new Error('Questions not found in storage bucket. Cannot score exam.');
        }

        let totalPoints = 0;
        let earnedPoints = 0;
        const answerRows = [];
        const questionResults = [];

        for (const question of questions) {
          const qKey = question.id || `q-${question.position}`;
          const selected = String(answers[qKey] ?? '').trim();
          const correct = resolveCorrectAnswerText(question);
          let isCorrect = false;

          if (question.question_type === 'short_answer') {
            isCorrect = selected && selected.toLowerCase() === correct.toLowerCase();
          } else {
            isCorrect = selected !== '' && selected === correct;
          }

          const maxPoints = Number(question.points || 1);
          const pointsAwarded = isCorrect ? maxPoints : 0;
          totalPoints += maxPoints;
          earnedPoints += pointsAwarded;

          questionResults.push({
            questionId: qKey,
            questionText: question.question_text,
            selectedAnswer: selected,
            correctAnswer: correct,
            isCorrect,
            pointsAwarded,
            maxPoints
          });

          const dbQuestionId = qKey;
          answerRows.push({
            question_id: dbQuestionId,
            selected_answer: selected,
            is_correct: isCorrect,
            points_awarded: pointsAwarded
          });
        }

        const { data: attemptData, error: attemptError } = await supabase
          .from('exam_attempts')
          .insert([{
            profile_id: profileId,
            exam_id: examId,
            term,
            status: 'completed',
            score: earnedPoints,
            started_at: new Date().toISOString(),
            submitted_at: new Date().toISOString()
          }])
          .select('*')
          .single();

        if (attemptError || !attemptData) throw attemptError || new Error('Unable to save exam attempt.');

        const attemptId = attemptData.id;
        const preparedAnswers = answerRows.map((row) => ({
          ...row,
          attempt_id: attemptId
        }));

        const { error: answersError } = await supabase
          .from('exam_answers')
          .insert(preparedAnswers);

        if (answersError) throw answersError;

        return new Response(JSON.stringify({
          attempt: attemptData,
          results: questionResults,
          totalPoints,
          score: earnedPoints
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        });
      }

      default:
        throw new Error('Invalid request type.');
    }
  } catch (error) {
    console.error('Student Exams error:', error);
    return new Response(JSON.stringify({ error: error.message || String(error) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400
    });
  }
});
