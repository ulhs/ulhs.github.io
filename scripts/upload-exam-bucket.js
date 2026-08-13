const fs = require('fs');
const path = require('path');

const BUCKET_NAME = 'exam-source';

function usage() {
  console.log(`
Usage:
  node scripts/upload-exam-bucket.js <json-file-or-directory> [remote-path]

  Uploads a single JSON or every *.json inside a directory to the private
  "${BUCKET_NAME}" Supabase Storage bucket.

Examples:
  node scripts/upload-exam-bucket.js data/exam-source/g7-ve-term1-questions.json
  node scripts/upload-exam-bucket.js data/exam-source
  node scripts/upload-exam-bucket.js data/exam-source/g7-ve-term1-questions.json g7/term1/ve.json

Environment variables:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
`);
}

async function uploadOne(supabase, localFile, remotePath) {
  const contents = fs.readFileSync(localFile);
  const fileName = path.basename(localFile);
  const finalRemote = remotePath || fileName;
  const { data, error } = await supabase
    .storage
    .from(BUCKET_NAME)
    .upload(finalRemote, contents, {
      contentType: 'application/json',
      upsert: true,
      cacheControl: 'no-store'
    });

  if (error) throw error;
  console.log(`✓ Uploaded ${localFile}  →  ${BUCKET_NAME}/${finalRemote}`);
  return finalRemote;
}

function collectJsonFiles(input) {
  const resolved = path.resolve(input);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File or directory not found: ${resolved}`);
  }
  const stat = fs.statSync(resolved);
  if (stat.isFile()) {
    if (!resolved.toLowerCase().endsWith('.json')) {
      throw new Error(`Only .json files are supported for upload.`);
    }
    return [resolved];
  }
  return fs.readdirSync(resolved)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .map((name) => path.join(resolved, name));
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    usage();
    process.exit(0);
  }

  const input = args[0];
  const remotePath = args[1] || null;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  }

  let createClient;
  try {
    ({ createClient } = require('@supabase/supabase-js'));
  } catch (e) {
    throw new Error('Missing dependency @supabase/supabase-js. Install with `npm install @supabase/supabase-js`.');
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const files = collectJsonFiles(input);
  if (!files.length) {
    console.warn('No .json files found to upload.');
    process.exit(0);
  }

  if (remotePath && files.length > 1) {
    throw new Error('remote-path can only be used when uploading a single file.');
  }

  for (const file of files) {
    const rp = remotePath || null;
    await uploadOne(supabase, file, rp);
  }

  console.log(`\nDone. ${files.length} file(s) uploaded.`);
}

main().catch((err) => {
  console.error('Upload failed:', err.message || err);
  process.exit(1);
});
