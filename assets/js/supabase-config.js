// Supabase Configuration
const SUPABASE_URL = 'https://gqtsjaqlhbwmkxbrwsxh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdxdHNqYXFsaGJ3bWt4YnJ3c3hoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MTQxMzksImV4cCI6MjA5MzA5MDEzOX0.8hPE2wA8ic7Rm6taCOzzv5AAzVmayzHqg1lhZxXRlQ4';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

window.supabaseClient = supabaseClient;
