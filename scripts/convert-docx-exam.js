const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');

function usage() {
  console.log(`
Usage:
  node scripts/convert-docx-exam.js parse <questions-docx> <answer-docx> <out-questions-json> <out-answers-json>

Example:
  node scripts/convert-docx-exam.js parse data/exam-source/g7-ve-term1-questions.docx data/exam-source/g7-ve-term1-answer_key.docx data/exam-source/g7-ve-term1-questions.json data/exam-source/g7-ve-term1-answer_key.json
`);
}

async function extractText(docxPath) {
  const res = await mammoth.extractRawText({ path: docxPath });
  return res.value || '';
}

function parseQuestions(rawText) {
  // Normalize line endings
  const normalized = rawText.replace(/\r/g, '');
  // Split into question blocks by lines starting with a number+dot
  const blocks = normalized.split(/\n(?=\s*\d+\.)/).map(s => s.trim()).filter(Boolean);
  const questions = blocks.map((block) => {
    const m = block.match(/^\s*(\d+)\.\s*([\s\S]*)$/);
    if (!m) return null;
    const idx = Number(m[1]);
    const content = m[2].trim();
    // Split choices by lines that start with A. B. etc
    const parts = content.split(/\n(?=\s*[A-D]\.?\s+)/);
    const qText = parts.shift().replace(/\s+/g, ' ').trim();
    const choices = parts.map(p => {
      const mm = p.match(/^\s*([A-D])\.?\s*(.*)$/s);
      return mm ? mm[2].replace(/\s+/g, ' ').trim() : p.replace(/\s+/g,' ').trim();
    });
    return {
      position: idx,
      question_text: qText,
      question_type: 'multiple_choice',
      choices: choices,
      correct_answer: null,
      points: 1
    };
  }).filter(Boolean);
  return questions;
}

function parseAnswerKeyText(rawText) {
  const normalized = rawText.replace(/\r/g, '\n');
  const lines = normalized.split(/\n/).map(l => l.trim()).filter(Boolean);
  // Keep only single-letter answers (A-D) or first char of each line
  return lines.map(l => {
    const match = l.match(/^([A-D])/i);
    if (match) return match[1].toUpperCase();
    // fallback: take first non-whitespace character
    return l.trim()[0] ? l.trim()[0].toUpperCase() : l;
  });
}

async function runParse(questionsDocx, answersDocx, outQuestionsJson, outAnswersJson) {
  if (!fs.existsSync(questionsDocx)) throw new Error('Questions file not found: ' + questionsDocx);
  if (!fs.existsSync(answersDocx)) throw new Error('Answer key file not found: ' + answersDocx);

  const qText = await extractText(questionsDocx);
  const aText = await extractText(answersDocx);

  const questions = parseQuestions(qText);
  const answers = parseAnswerKeyText(aText);

  // attach answers if counts match, otherwise leave correct_answer null
  if (answers.length === questions.length) {
    questions.forEach((q, i) => q.correct_answer = answers[i]);
  } else {
    console.warn('Answer count does not match question count. Questions will have null correct_answer.');
  }

  fs.mkdirSync(path.dirname(outQuestionsJson), { recursive: true });
  fs.writeFileSync(outQuestionsJson, JSON.stringify(questions, null, 2), 'utf8');
  fs.writeFileSync(outAnswersJson, JSON.stringify(answers, null, 2), 'utf8');

  console.log(`Wrote ${questions.length} questions to ${outQuestionsJson}`);
  console.log(`Wrote ${answers.length} answers to ${outAnswersJson}`);
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (!cmd || cmd === 'help') return usage();
  if (cmd === 'parse') {
    const [,, questionsDocx, answersDocx, outQuestionsJson, outAnswersJson] = process.argv;
    if (!questionsDocx || !answersDocx || !outQuestionsJson || !outAnswersJson) return usage();
    await runParse(questionsDocx, answersDocx, outQuestionsJson, outAnswersJson);
  } else {
    usage();
  }
}

main().catch(err => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
