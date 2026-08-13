const fs = require('fs');
const path = require('path');

const LETTER_TO_INDEX = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 };

function resolveCorrectAnswerText(question) {
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

function usage() {
  console.log(`
Bucket-First Exam Toolkit
=========================
Note: Questions are NO LONGER seeded into the exam_questions table.
Upload the resulting JSON file to the "exam-source" bucket and link the
exam metadata row via questions_bucket_path — edits take effect instantly
the next time a student loads the exam.

Usage:
  node scripts/convert-exam-questions.js parse <questions-file> [answer-key-file] [output-json-file]
    Parse a .js template (window.EXAM_QUESTIONS_DATA + window.ANSWER_KEY_DATA)
    or a .json array into a standard question JSON array.

  node scripts/convert-exam-questions.js validate <json-file>
    Sanity-check a JSON questions file for common issues (no blanks, choices
    present for MCQ, correct_answer resolvable, etc.).

Examples:
  node scripts/convert-exam-questions.js parse data/exam-source/g7-term1.js data/exam-source/g7-term1-answer.json data/exam-source/g7-term1.json
  node scripts/convert-exam-questions.js validate data/exam-source/g7-term1.json

After producing/editing the JSON:
  Upload:  node scripts/upload-exam-bucket.js data/exam-source/g7-term1.json g7/term1/ve.json
  Link:    UPDATE exams SET questions_bucket_path = 'g7/term1/ve.json' WHERE id = '<uuid>';
           — or use the Admin Exam Manager page to upload and link in one click.
`);
}

function extractTemplateString(fileText, variableName) {
  const regex = new RegExp(`${variableName}\\s*=\\s*` + '`([\\s\\S]*?)`;', 'm');
  const match = fileText.match(regex);
  if (!match) return null;
  return match[1].trim();
}

function parseQuestions(rawText) {
  const normalized = rawText.replace(/\r/g, '');
  const questionBlocks = normalized
    .split(/\n(?=\s*\d+\.)/)
    .map((block) => block.trim())
    .filter(Boolean);

  return questionBlocks.map((block, index) => {
    const match = block.match(/^\s*(\d+)\.\s*([\s\S]*)$/);
    if (!match) {
      throw new Error(`Unable to parse question block #${index + 1}: ${block}`);
    }

    const content = match[2].trim();
    const pieces = content.split(/\n(?=[A-D]\.\s*)/);
    const questionText = pieces.shift().trim().replace(/\s+/g, ' ');
    const choices = pieces.map((piece) => {
      const optionMatch = piece.match(/^([A-D])\.\s*(.*)$/s);
      if (!optionMatch) {
        throw new Error(`Unable to parse choice in question ${match[1]}: ${piece}`);
      }
      return optionMatch[2].trim().replace(/\s+/g, ' ');
    });

    return {
      position: Number(match[1]),
      question_text: questionText,
      question_type: choices.length ? 'multiple_choice' : 'short_answer',
      choices,
      correct_answer: null,
      points: 1,
    };
  });
}

function parseAnswerKey(rawText) {
  const extracted = extractTemplateString(rawText, 'window.ANSWER_KEY_DATA');
  if (!extracted) {
    throw new Error('Invalid answer key format: expected window.ANSWER_KEY_DATA = `...`;');
  }
  return extracted
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function attachAnswers(questions, answers) {
  if (answers.length !== questions.length) {
    throw new Error(`Answer count (${answers.length}) does not match question count (${questions.length}).`);
  }
  return questions.map((question, index) => {
    const merged = { ...question, correct_answer: answers[index] };
    merged.correct_answer = resolveCorrectAnswerText(merged);
    return merged;
  });
}

function isJsonFile(filePath) {
  return path.extname(filePath).toLowerCase() === '.json';
}

function loadQuestions(filePath) {
  const resolved = path.resolve(filePath);
  const contents = fs.readFileSync(resolved, 'utf8');

  if (isJsonFile(resolved)) {
    const parsed = JSON.parse(contents);
    if (!Array.isArray(parsed)) {
      throw new Error(`Expected JSON array in ${filePath}`);
    }
    return parsed.map((question, index) => {
      const normalized = {
        position: Number(question.position ?? index + 1),
        question_text: String(question.question_text ?? ''),
        question_type: question.question_type ?? (Array.isArray(question.choices) && question.choices.length ? 'multiple_choice' : 'short_answer'),
        choices: Array.isArray(question.choices) ? question.choices : [],
        correct_answer: question.correct_answer ?? null,
        points: Number(question.points ?? 1),
      };
      if (normalized.correct_answer) {
        normalized.correct_answer = resolveCorrectAnswerText(normalized);
      }
      return normalized;
    });
  }

  const rawQuestions = extractTemplateString(contents, 'window.EXAM_QUESTIONS_DATA');
  if (!rawQuestions) {
    throw new Error(`Invalid questions file format: expected window.EXAM_QUESTIONS_DATA = \`...\`; in ${filePath}`);
  }
  return parseQuestions(rawQuestions);
}

function loadAnswers(filePath) {
  if (!filePath) return [];
  const resolved = path.resolve(filePath);
  const contents = fs.readFileSync(resolved, 'utf8');

  if (isJsonFile(resolved)) {
    const parsed = JSON.parse(contents);
    if (!Array.isArray(parsed)) {
      throw new Error(`Expected JSON array in ${filePath}`);
    }
    return parsed.map((value) => String(value).trim());
  }

  return parseAnswerKey(contents);
}

function parseFile(questionsFile, answerKeyFile, outputFile) {
  const questions = loadQuestions(questionsFile);
  let finalQuestions = questions;

  if (answerKeyFile) {
    const answers = loadAnswers(answerKeyFile);
    finalQuestions = attachAnswers(questions, answers);
  }

  const output = JSON.stringify(finalQuestions, null, 2);
  if (outputFile) {
    fs.writeFileSync(path.resolve(outputFile), output, 'utf8');
    console.log(`✓ Wrote ${finalQuestions.length} questions to ${outputFile}`);
  } else {
    process.stdout.write(output);
  }

  const warnings = validateQuestions(finalQuestions);
  if (warnings.length) {
    console.warn('\nWarnings:');
    warnings.forEach((w) => console.warn('  !', w));
  }
}

function validateQuestions(questions) {
  const warnings = [];
  if (!questions.length) warnings.push('Question array is empty.');

  questions.forEach((q, i) => {
    const idx = `Q${i + 1} (pos ${q.position})`;
    if (!String(q.question_text || '').trim()) {
      warnings.push(`${idx}: question_text is blank`);
    }
    if (!['multiple_choice', 'short_answer'].includes(q.question_type)) {
      warnings.push(`${idx}: unknown question_type "${q.question_type}"`);
    }
    if (q.question_type === 'multiple_choice') {
      const choices = Array.isArray(q.choices) ? q.choices : [];
      if (choices.length < 2) {
        warnings.push(`${idx}: multiple_choice but has fewer than 2 choices`);
      }
    }
    if (q.correct_answer == null || !String(q.correct_answer).trim()) {
      warnings.push(`${idx}: missing correct_answer`);
    } else if (q.question_type === 'multiple_choice') {
      const choices = Array.isArray(q.choices) ? q.choices : [];
      if (!choices.includes(String(q.correct_answer).trim())) {
        warnings.push(`${idx}: correct_answer "${q.correct_answer}" is not in choices list`);
      }
    }
    if (typeof q.points !== 'number' || q.points <= 0) {
      warnings.push(`${idx}: points is invalid (${q.points})`);
    }
  });

  const positions = questions.map((q) => q.position);
  const uniquePositions = new Set(positions);
  if (uniquePositions.size !== positions.length) {
    warnings.push('Duplicate position values detected — sort/fix positions before upload.');
  }

  return warnings;
}

function validateFile(filePath) {
  const questions = loadQuestions(filePath);
  const warnings = validateQuestions(questions);

  console.log(`Validated ${questions.length} questions in ${filePath}`);
  const totalPoints = questions.reduce((s, q) => s + (q.points || 0), 0);
  console.log(`Total points: ${totalPoints}`);
  const mcq = questions.filter((q) => q.question_type === 'multiple_choice').length;
  const sa = questions.filter((q) => q.question_type === 'short_answer').length;
  console.log(`Multiple choice: ${mcq}, Short answer: ${sa}`);

  if (!warnings.length) {
    console.log('\n✓ All checks passed. Ready to upload to bucket.');
    return;
  }

  console.warn('\n⚠ Issues found:');
  warnings.forEach((w) => console.warn('  •', w));
  process.exitCode = 1;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    usage();
    process.exit(0);
  }

  if (command === 'parse') {
    const questionsFile = args[1];
    const maybeFile2 = args[2];
    const maybeFile3 = args[3];
    if (!questionsFile) {
      usage();
      process.exit(1);
    }

    let answerKeyFile = null;
    let outputFile = null;

    if (maybeFile3) {
      answerKeyFile = maybeFile2;
      outputFile = maybeFile3;
    } else if (maybeFile2) {
      const resolved = path.resolve(maybeFile2);
      if (fs.existsSync(resolved)) {
        answerKeyFile = maybeFile2;
      } else {
        outputFile = maybeFile2;
      }
    }

    parseFile(questionsFile, answerKeyFile, outputFile);
  } else if (command === 'validate') {
    const file = args[1];
    if (!file) { usage(); process.exit(1); }
    validateFile(file);
  } else {
    usage();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
