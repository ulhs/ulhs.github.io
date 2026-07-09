console.log('🔹 Parent Nav JS loaded!');
document.addEventListener('DOMContentLoaded', async () => {
    // --- Idle Auto-Logout (15 Minutes) ---
    let idleLogoutTimeout;
    const IDLE_TIMEOUT = 15 * 60 * 1000; // 15 minutes

    function resetIdleTimer() {
        clearTimeout(idleLogoutTimeout);
        idleLogoutTimeout = setTimeout(() => {
            console.log('⏰ Idle timeout triggered - logging out parent');
            alert('Session expired due to inactivity. Please login again.');
            handleParentLogout();
        }, IDLE_TIMEOUT);
    }

    // Track all user interactions
    const idleEvents = ['mousemove', 'mousedown', 'keypress', 'scroll', 'touchstart', 'touchmove'];
    idleEvents.forEach(event => {
        document.addEventListener(event, resetIdleTimer, true);
    });

    // --- Parent Session Guard ---
    async function syncParentSession() {
        if (!window.supabaseClient) {
            setTimeout(syncParentSession, 100);
            return;
        }

        // Check if we're on a parent portal page
        if (window.location.pathname.includes('/parent-portal/')) {
            
            // Check for parent session
            const parentPsid = secureSession.getItem('parentPsid');
            const parentStudents = secureSession.getItem('parentStudents');
            
            if (!parentPsid && !window.location.pathname.includes('login.html')) {
                // No session and not on login page -> redirect
                window.location.replace('./login.html');
                return;
            }
            
            // If we have a PSID but no students, fetch them
            if (parentPsid && !parentStudents) {
                await fetchParentStudents(parentPsid);
            }

            // Start idle timer only on valid session
            if (parentPsid && !window.location.pathname.includes('login.html')) {
                resetIdleTimer();
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
                secureSession.setItem('parentStudents', students);
                // Set first student as active by default
                if (!secureSession.getItem('activeStudentLrn')) {
                    secureSession.setItem('activeStudentLrn', students[0].lrn);
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
        
        // Clear idle timer
        clearTimeout(idleLogoutTimeout);
        
        // Clear parent session data
        secureSession.removeItem('parentPsid');
        secureSession.removeItem('parentStudents');
        secureSession.removeItem('activeStudentLrn');
        secureSession.removeItem('parentName');
        
        window.location.href = './login.html';
    };

    // --- Get Active Student ---
    window.getActiveStudent = function() {
        const students = secureSession.getItem('parentStudents') || [];
        const activeLrn = secureSession.getItem('activeStudentLrn');
        return students.find(s => s.lrn === activeLrn) || students[0] || null;
    };

    // --- Switch Active Student ---
    window.switchStudent = function(lrn) {
        secureSession.setItem('activeStudentLrn', lrn);
        window.dispatchEvent(new CustomEvent('studentSwitched', { detail: { lrn } }));
        // Refresh the page to update content
        window.location.reload();
    };

    // --- Initialize ---
    await syncParentSession();
});
