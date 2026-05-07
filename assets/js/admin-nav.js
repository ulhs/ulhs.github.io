document.addEventListener('DOMContentLoaded', async () => {
    // --- Admin Session Guard ---
    async function syncAdminSession() {
        if (!window.supabaseClient) {
            setTimeout(syncAdminSession, 100);
            return;
        }

        const { data: { session } } = await window.supabaseClient.auth.getSession();
        
        if (session) {
            // If session exists but storage is empty, hydrate it
            if (!sessionStorage.getItem('adminLoggedIn')) {
                const { data: profile } = await window.supabaseClient
                    .from('profiles')
                    .select('*')
                    .eq('id', session.user.id)
                    .single();

                if (profile) {
                    sessionStorage.setItem('adminLoggedIn', 'true');
                    sessionStorage.setItem('userEmail', profile.email);
                    sessionStorage.setItem('userRole', profile.role);
                    sessionStorage.setItem('userName', profile.full_name);
                    
                    const access = {
                        attendance: profile.can_scan,
                        idGen: profile.can_manage_ids,
                        stats: profile.can_view_dashboard
                    };
                    sessionStorage.setItem('userAccess', JSON.stringify(access));
                    
                    // Trigger UI update if necessary
                    window.dispatchEvent(new Event('sessionHydrated'));
                }
            }
        } else if (!window.location.pathname.includes('login.html')) {
            // No session and not on login page -> redirect
            window.location.replace('./login.html');
        }
    }

    // Run session sync
    if (window.location.pathname.includes('/admin/')) {
        await syncAdminSession();
    }

    // --- Global Logout Handler ---
    window.handleLogout = async function(e) {
        if (e) e.preventDefault();
        
        console.log("🔐 Security: Performing Global Logout...");
        
        try {
            if (window.supabaseClient) {
                // Clear Supabase session on server
                await window.supabaseClient.auth.signOut();
            }
        } catch (err) {
            console.warn("Logout: Supabase signOut failed (expected if offline):", err.message);
        } finally {
            // Clear all administrative session data
            sessionStorage.clear();
            
            // NOTE: localStorage (Offline Cache) is preserved intentionally
            // so staff can still scan students if internet drops.
            
            window.location.href = './login.html';
        }
    };

    // --- SECURITY: SESSION HARDENING (Inactivity Timer) ---
    let inactivityTimer;
    const INACTIVITY_LIMIT = 15 * 60 * 1000; // Tightened to 15 minutes

    function resetInactivityTimer() {
        clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(async () => {
            console.warn("🕒 Security: Session timed out due to 15 minutes of inactivity.");
            alert("Your session has timed out for security purposes. You will be logged out.");
            await window.handleLogout();
        }, INACTIVITY_LIMIT);
    }

    // Attach inactivity listeners to track user presence
    if (window.location.pathname.includes('/admin/')) {
        ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'].forEach(evt => {
            document.addEventListener(evt, resetInactivityTimer, true);
        });
        resetInactivityTimer(); // Start timer on load
    }

    const navLinks = document.querySelector('.nav-links');
    const listItems = document.querySelectorAll('.nav-links .list');
    const indicator = document.querySelector('.nav-links.magic-nav .indicator');

    const pathParts = window.location.pathname.split('/');
    const lastPart = pathParts.pop() || 'index.html';
    const currentPage = lastPart.endsWith('.html') ? lastPart : lastPart + '.html';

    function getItemIndex(item) {
        return Array.from(listItems).indexOf(item);
    }

    function setIndicatorPosition(index) {
        if (indicator) {
            indicator.style.transform = `translateX(calc(80px * ${index}))`;
        }
    }

    function setActive(page) {
        listItems.forEach(item => {
            const itemPage = item.getAttribute('data-page');
            if (itemPage === page) {
                item.classList.add('active');
                setIndicatorPosition(getItemIndex(item));
            } else {
                item.classList.remove('active');
            }
        });
    }

    setActive(currentPage);

    if (navLinks && navLinks.classList.contains('magic-nav')) {
        listItems.forEach((item) => {
            item.addEventListener('mouseenter', function() {
                listItems.forEach((li) => li.classList.remove('active'));
                this.classList.add('active');
                setIndicatorPosition(getItemIndex(this));
            });
        });

        navLinks.addEventListener('mouseleave', () => {
            setActive(currentPage);
        });
    }
});