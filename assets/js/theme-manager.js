/**
 * THEME MANAGER
 * Handles global light/dark mode persistence and UI synchronization.
 */

const ThemeManager = {
    init() {
        // 1. Apply theme immediately if document.body exists, or wait for it
        const applyInitialTheme = () => {
            const currentTheme = localStorage.getItem('theme');
            this.updateThemeUI(currentTheme === 'dark');
        };

        if (document.body) {
            applyInitialTheme();
        } else {
            const observer = new MutationObserver(() => {
                if (document.body) {
                    applyInitialTheme();
                    observer.disconnect();
                }
            });
            observer.observe(document.documentElement, { childList: true });
        }

        // 2. Set up event listeners for all toggles
        document.addEventListener('DOMContentLoaded', () => {
            this.setupToggles();
            
            // Re-run setup if content changes (for dynamic headers)
            const bodyObserver = new MutationObserver(() => this.setupToggles());
            bodyObserver.observe(document.body, { childList: true, subtree: true });
        });
    },

    setupToggles() {
        const themeToggles = document.querySelectorAll('.theme-toggle');
        themeToggles.forEach(toggle => {
            if (toggle.dataset.listenerAttached) return;
            
            toggle.addEventListener('click', () => {
                const isCurrentlyDark = document.body.classList.contains('dark-mode');
                const newThemeIsDark = !isCurrentlyDark;
                
                this.updateThemeUI(newThemeIsDark);
                localStorage.setItem('theme', newThemeIsDark ? 'dark' : 'light');
            });
            toggle.dataset.listenerAttached = 'true';
        });
    },

    updateThemeUI(isDark) {
        if (!document.body) return;

        if (isDark) {
            document.body.classList.add('dark-mode');
        } else {
            document.body.classList.remove('dark-mode');
        }

        // Update all toggle icons and tooltips
        const themeToggles = document.querySelectorAll('.theme-toggle');
        themeToggles.forEach(toggle => {
            toggle.textContent = isDark ? '☀️' : '🌙';
            toggle.setAttribute('data-tooltip', isDark ? 'Switch to Light' : 'Switch to Dark');
        });
    }
};

// Initialize immediately to prevent flash of unstyled content
ThemeManager.init();
