# Database Policy Guide

## 📋 **Policy Files You Have:**

1. **`backup_current_policies_20250625.sql`** ✅
   - Your original policies (backup!)
   - Use this if you ever need to go back

2. **`proper_secure_rls_policies.sql`** ✅
   - Secure policies that work with your system
   - Recommended for everyday use

3. **`restore_dangerous_policies.sql`**
   - The original unsafe policies (just in case)
   - **NOT recommended for production**

4. **`create_grades_table.sql` & `create_achievements_table.sql`**
   - Table creation scripts

5. **Sample data & reference files**
   - For testing and guidance

---

## 🚀 **How to Switch Policies:**

### Want to use the **SECURE policies**?
1. Open `proper_secure_rls_policies.sql`
2. Run it in Supabase SQL Editor

### Want to go **BACK TO ORIGINAL**?
1. Open `backup_current_policies_20250625.sql`
2. Run it in Supabase SQL Editor

---

## 📝 **Note:**
- Always test after changing policies!
- Make sure all functionality still works!

## Attendance duplicate review

Before using the Duplicate Attendance Review page, ensure the attendance duplicate schema from `supabase/migrations/20260903_sardo_process_schema.sql` has been applied. Then run `20261008_attendance_duplicate_review_tracking.sql` in the Supabase SQL Editor. The latter adds role-checked, paginated duplicate detection, duplicate confirmation, and review tracking. Duplicate records are retained; confirming one tags it for exclusion from dashboard counts, and marking it reviewed is a separate action.
