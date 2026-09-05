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
            const parentSessionToken = secureSession.getItem('parentSessionToken');
            const parentStudents = secureSession.getItem('parentStudents');
            
            if (!parentSessionToken && !window.location.pathname.includes('login.html')) {
                // No session and not on login page -> redirect
                window.location.replace('./login.html');
                return;
            }
            
            // Start idle timer only on valid session
            if (parentSessionToken && !window.location.pathname.includes('login.html')) {
                resetIdleTimer();
            }
        }
    }

    // --- Parent Logout Handler ---
    window.handleParentLogout = async function(e) {
        if (e) e.preventDefault();
        
        console.log("🔐 Parent Logout...");
        
        // Clear idle timer
        clearTimeout(idleLogoutTimeout);
        
        // Clear parent session data
        secureSession.removeItem('parentSessionToken');
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
