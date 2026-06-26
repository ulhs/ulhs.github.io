console.log('🔹 Parent Nav JS loaded!');
document.addEventListener('DOMContentLoaded', async () => {
    // --- Parent Session Guard ---
    async function syncParentSession() {
        if (!window.supabaseClient) {
            setTimeout(syncParentSession, 100);
            return;
        }

        // Check if we're on a parent portal page
        if (window.location.pathname.includes('/parent-portal/')) {
            
            // Check for parent session
            const parentPsid = sessionStorage.getItem('parentPsid');
            const parentStudents = sessionStorage.getItem('parentStudents');
            
            if (!parentPsid && !window.location.pathname.includes('login.html')) {
                // No session and not on login page -> redirect
                window.location.replace('./login.html');
                return;
            }
            
            // If we have a PSID but no students, fetch them
            if (parentPsid && !parentStudents) {
                await fetchParentStudents(parentPsid);
            }
        }
    }

    // --- Fetch Students Linked to Parent ---
    async function fetchParentStudents(psid) {
        try {
            const { data: students, error } = await window.supabaseClient
                .from('students')
                .select('lrn, full_name, section, grade_level, photo_url, student_id_number')
                .eq('parent_messenger_id', psid);

            if (error) throw error;

            if (students && students.length > 0) {
                sessionStorage.setItem('parentStudents', JSON.stringify(students));
                // Set first student as active by default
                if (!sessionStorage.getItem('activeStudentLrn')) {
                    sessionStorage.setItem('activeStudentLrn', students[0].lrn);
                }
                return students;
            }
            return [];
        } catch (err) {
            console.error('Error fetching parent students:', err);
            return [];
        }
    }

    // --- Parent Logout Handler ---
    window.handleParentLogout = async function(e) {
        if (e) e.preventDefault();
        
        console.log("🔐 Parent Logout...");
        
        // Clear parent session data
        sessionStorage.removeItem('parentPsid');
        sessionStorage.removeItem('parentStudents');
        sessionStorage.removeItem('activeStudentLrn');
        sessionStorage.removeItem('parentName');
        
        window.location.href = './login.html';
    };

    // --- Get Active Student ---
    window.getActiveStudent = function() {
        const students = JSON.parse(sessionStorage.getItem('parentStudents') || '[]');
        const activeLrn = sessionStorage.getItem('activeStudentLrn');
        return students.find(s => s.lrn === activeLrn) || students[0] || null;
    };

    // --- Switch Active Student ---
    window.switchStudent = function(lrn) {
        sessionStorage.setItem('activeStudentLrn', lrn);
        window.dispatchEvent(new CustomEvent('studentSwitched', { detail: { lrn } }));
        // Refresh the page to update content
        window.location.reload();
    };

    // --- Initialize ---
    await syncParentSession();
});
