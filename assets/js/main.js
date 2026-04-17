/* --- HELPER: GET ROOT PATH --- */
function getRootPath() {
    const pathParts = window.location.pathname.split('/').filter(p => p !== '');
    const pagesIndex = pathParts.indexOf('pages');
    let root = '';
    if (pagesIndex !== -1) {
        const depth = pathParts.length - pagesIndex - 1;
        for (let i = 0; i < depth; i++) root += '../';
    }
    return root;
}

/* --- GLOBAL CHATBOT INITIALIZATION --- */
(function() {
    const root = getRootPath();
    const dataPath = root + 'assets/data/';
    let chatbotData = null;
    let dictionaryData = null;
    let aboutData = null;

    function injectChatbot() {
        if (document.getElementById('faq-bot-toggle')) return;
        if (!document.body) return;

        // Skip chatbot for admin pages
        const isAdminPage = window.location.pathname.includes('admin.html') || 
                          window.location.pathname.includes('id-gen.html');
        if (isAdminPage) return;

        const botContainer = document.createElement('div');
        botContainer.className = 'faq-bot-container';
        botContainer.innerHTML = `
            <div class="faq-bot-toggle" id="faq-bot-toggle">
                <span class="bot-icon">💬</span>
            </div>
            <div class="faq-bot-window" id="faq-bot-window">
                <div class="faq-bot-header">
                    <h4>ULHS Assistant</h4>
                    <span class="faq-bot-close" id="faq-bot-close">&times;</span>
                </div>
                <div class="faq-bot-messages" id="faq-bot-messages"></div>
                <div class="faq-suggestions">
                    <span class="suggestion-chip">Enrollment</span>
                    <span class="suggestion-chip">Scholarships</span>
                    <span class="suggestion-chip">SHS Tracks</span>
                </div>
                <div class="faq-bot-input-area">
                    <input type="text" class="faq-bot-input" id="faq-bot-input" placeholder="Ask a question...">
                    <button class="faq-bot-send" id="faq-bot-send">➤</button>
                </div>
            </div>
        `;
        document.body.appendChild(botContainer);
        setupBotEvents();
    }

    async function loadBotData() {
        try {
            const botRes = await fetch(`${dataPath}chatbot.json`);
            if (botRes.ok) chatbotData = await botRes.json();
            
            const dictRes = await fetch(`${dataPath}pages/dictionary.json`);
            if (dictRes.ok) dictionaryData = await dictRes.json();

            const aboutRes = await fetch(`${dataPath}pages/about.json`);
            if (aboutRes.ok) aboutData = await aboutRes.json();
        } catch (err) {
            console.warn("Bot data load failed:", err);
        }
    }

    function setupBotEvents() {
        const toggle = document.getElementById('faq-bot-toggle');
        const window = document.getElementById('faq-bot-window');
        const close = document.getElementById('faq-bot-close');
        const send = document.getElementById('faq-bot-send');
        const input = document.getElementById('faq-bot-input');
        const messages = document.getElementById('faq-bot-messages');
        const chips = document.querySelectorAll('.suggestion-chip');

        if (!toggle || !window) return;

        toggle.addEventListener('click', () => {
            const isVisible = window.style.display === 'flex';
            window.style.display = isVisible ? 'none' : 'flex';
            if (!isVisible) {
                input.focus();
                if (messages.children.length === 0) {
                    const welcome = chatbotData ? chatbotData.config.welcome_message : "Flehew! I'm your ULHS assistant. How can I help you today?";
                    addMsg(welcome, 'bot', [], messages);
                }
            }
        });

        close.addEventListener('click', (e) => {
            e.stopPropagation();
            window.style.display = 'none';
        });

        send.addEventListener('click', () => handleSend(input, messages));
        input.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleSend(input, messages); });
        chips.forEach(chip => {
            chip.addEventListener('click', () => {
                input.value = chip.textContent;
                handleSend(input, messages);
            });
        });
    }

    function handleSend(input, container) {
        const query = input.value.trim();
        if (!query) return;
        addMsg(query, 'user', [], container);
        input.value = '';

        const indicator = showTyping(container);
        setTimeout(() => {
            if (indicator && indicator.parentNode) indicator.parentNode.removeChild(indicator);
            const response = getResponse(query);
            addMsg(response.text, 'bot', response.links, container);
        }, chatbotData ? chatbotData.config.typing_delay : 600);
    }

    function showTyping(container) {
        const div = document.createElement('div');
        div.className = 'typing-indicator';
        div.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
        return div;
    }

    function addMsg(text, sender, links, container) {
        const div = document.createElement('div');
        div.className = `message ${sender}-message`;
        div.innerHTML = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        
        if (links && links.length > 0) {
            const linksDiv = document.createElement('div');
            linksDiv.className = 'message-links';
            links.forEach(link => {
                const a = document.createElement('a');
                a.href = link.url.startsWith('http') ? link.url : root + link.url;
                if (link.url.startsWith('http')) a.target = "_blank";
                a.textContent = link.text;
                a.className = 'bot-link';
                linksDiv.appendChild(a);
            });
            div.appendChild(linksDiv);
        }
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }

    function getResponse(input) {
        const lower = input.toLowerCase();
        if (!chatbotData) return { text: "I'm still loading my knowledge base...", links: [] };

        for (const item of chatbotData.knowledge_base) {
            if (item.keywords.some(kw => lower.includes(kw))) return { text: item.response, links: item.links || [] };
        }

        if (aboutData) {
            const teacher = [...aboutData.leadership, ...aboutData.jhs_faculty, ...aboutData.shs_faculty]
                .find(t => lower.includes(t.name.toLowerCase()) || (t.role && lower.includes(t.role.toLowerCase())));
            if (teacher) return { text: `You're asking about **${teacher.name}** (${teacher.role}).`, links: [{ text: `Message ${teacher.name}`, url: teacher.link }] };
        }

        if (dictionaryData) {
            const term = dictionaryData.terms.find(t => lower.includes(t.word.toLowerCase()) || lower.includes(t.meaning.toLowerCase()));
            if (term) return { text: `**${term.word}** means: ${term.meaning}`, links: [{ text: "View Dictionary", url: "pages/blaan-dictionary.html" }] };
        }

        return { text: chatbotData.config.fallback_message, links: [{ text: "Talk to a Teacher", url: "pages/about-dumu.html" }] };
    }

    // Run as early as possible
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            injectChatbot();
            loadBotData();
        });
    } else {
        injectChatbot();
        loadBotData();
    }
})();

/* --- MOBILE NAVIGATION TOGGLE --- */
document.addEventListener('DOMContentLoaded', () => {
    const navToggle = document.getElementById('nav-toggle');
    const navToggleLabel = document.querySelector('.nav-toggle-label');
    const navLinks = document.querySelector('.nav-links');
    const navItems = document.querySelectorAll('.nav-links a');

    function setMobileMenuState(isOpen) {
        if (!navLinks) return;

        if (navToggle) {
            navToggle.checked = isOpen;
        }

        navLinks.classList.toggle('active', isOpen);
        document.body.classList.toggle('no-scroll', isOpen);
    }

    // Sync CSS checkbox state with JS-controlled menu state
    if (navToggle && navLinks) {
        navToggle.addEventListener('change', () => {
            setMobileMenuState(navToggle.checked);
        });
    }

    // Explicit label click handling is more reliable on Android emulators
    if (navToggleLabel) {
        navToggleLabel.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            setMobileMenuState(!navLinks.classList.contains('active'));
        });
    }

    // Close menu when a link is clicked
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            setMobileMenuState(false);
        });
    });

    // Optional: Close menu when clicking outside
    document.addEventListener('click', (e) => {
        if (navLinks && navLinks.classList.contains('active') &&
            !e.target.closest('.nav-toggle') &&
            !e.target.closest('.nav-links') && 
            !e.target.closest('.nav-toggle-label')) {
            setMobileMenuState(false);
        }
    });

    const dictionarySearch = document.getElementById('dictionary-search');
    const dictionaryCards = document.querySelectorAll('.dict-card');
    const dictionaryResultsCount = document.getElementById('dictionary-results-count');
    const dictionaryEmptyState = document.getElementById('dictionary-empty-state');

    if (dictionarySearch && dictionaryCards.length > 0) {
        const updateDictionaryResults = () => {
            const query = dictionarySearch.value.trim().toLowerCase();
            let visibleCount = 0;

            dictionaryCards.forEach(card => {
                const searchableText = card.textContent.toLowerCase();
                const isMatch = searchableText.includes(query);

                card.classList.toggle('is-hidden', !isMatch);

                if (isMatch) {
                    visibleCount += 1;
                }
            });

            if (dictionaryResultsCount) {
                dictionaryResultsCount.textContent = query
                    ? `${visibleCount} term${visibleCount === 1 ? '' : 's'} found`
                    : `${dictionaryCards.length} terms available`;
            }

            if (dictionaryEmptyState) {
                dictionaryEmptyState.classList.toggle('visible', visibleCount === 0);
            }
        };

        dictionarySearch.addEventListener('input', updateDictionaryResults);
        updateDictionaryResults();
    }

    /* --- BACK TO TOP BUTTON LOGIC --- */
    const backToTopBtn = document.createElement('div');
    backToTopBtn.id = 'backToTop';
    backToTopBtn.innerHTML = '↑';
    backToTopBtn.setAttribute('data-tooltip', 'Back to Top');
    document.body.appendChild(backToTopBtn);

    window.onscroll = function() {
        if (document.body.scrollTop > 300 || document.documentElement.scrollTop > 300) {
            backToTopBtn.style.display = "flex";
        } else {
            backToTopBtn.style.display = "none";
        }
    };

    backToTopBtn.addEventListener('click', () => {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });

    /* --- LIGHTBOX LOGIC --- */
    const lightbox = document.createElement('div');
    lightbox.className = 'lightbox-overlay';
    lightbox.innerHTML = `
        <div class="lightbox-content">
            <span class="lightbox-close">&times;</span>
            <img src="" alt="Enlarged Image">
            <div class="lightbox-caption"></div>
        </div>
    `;
    document.body.appendChild(lightbox);

    const lightboxImg = lightbox.querySelector('img');
    const lightboxCaption = lightbox.querySelector('.lightbox-caption');
    const lightboxClose = lightbox.querySelector('.lightbox-close');

    // Attach to all gallery images
    document.addEventListener('click', (e) => {
        const galleryCard = e.target.closest('.gallery-card');
        if (galleryCard) {
            const img = galleryCard.querySelector('img');
            const title = galleryCard.querySelector('h4');
            const desc = galleryCard.querySelector('p');
            
            if (img) {
                lightboxImg.src = img.src;
                lightboxCaption.innerHTML = `<strong>${title ? title.textContent : ''}</strong><br>${desc ? desc.textContent : ''}`;
                lightbox.classList.add('active');
                document.body.style.overflow = 'hidden'; // Prevent scroll
            }
        }
    });

    lightboxClose.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) closeLightbox();
    });

    function closeLightbox() {
        lightbox.classList.remove('active');
        document.body.style.overflow = 'auto';
    }

    /* --- SCROLL REVEAL LOGIC --- */
    const revealElements = document.querySelectorAll('.reveal');
    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('active');
            }
        });
    }, { threshold: 0.1 });

    revealElements.forEach(el => revealObserver.observe(revealElements.length > 0 ? el : document.createElement('div'))); // Fallback

    // Re-check elements if they were added dynamically (optional)
    function initScrollReveal() {
        document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));
    }
    initScrollReveal();

    /* --- DARK MODE LOGIC --- */
    const themeToggle = document.getElementById('theme-toggle');
    const currentTheme = localStorage.getItem('theme');

    function updateThemeUI(isDark) {
        if (isDark) {
            document.body.classList.add('dark-mode');
            if (themeToggle) {
                themeToggle.textContent = '☀️';
                themeToggle.setAttribute('data-tooltip', 'Switch to Light');
            }
        } else {
            document.body.classList.remove('dark-mode');
            if (themeToggle) {
                themeToggle.textContent = '🌙';
                themeToggle.setAttribute('data-tooltip', 'Switch to Dark');
            }
        }
    }

    if (currentTheme === 'dark') {
        updateThemeUI(true);
    } else {
        updateThemeUI(false);
    }

    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const isDark = document.body.classList.toggle('dark-mode');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
            updateThemeUI(isDark);
        });
    }

    /* --- DYNAMIC CONTENT LOADING --- */
    async function loadDynamicContent() {
        const root = getRootPath();
        const dataPath = root + 'assets/data/';
        const componentPath = root + 'assets/components/';

        // Skip shared components for admin pages to preserve custom headers
        const isAdminPage = window.location.pathname.includes('/pages/admin/');
        if (!isAdminPage) {
            // 0. Load Shared Components (Header/Footer)
            await loadSharedComponents(componentPath, root);
        }

        // 2. Load Global Config (Footer, etc.)
        try {
            const configRes = await fetch(`${dataPath}config.json`);
            const config = await configRes.json();
            updateGlobalUI(config, root);
        } catch (err) { console.warn("Config not found:", err); }

        const pathParts = window.location.pathname.split('/');
        const lastPart = pathParts.pop() || 'index.html';
        const page = lastPart.endsWith('.html') ? lastPart : lastPart + '.html';
        
        if (page === 'index.html') {
            loadHomePage(dataPath);
        } else {
            switch(page) {
                case 'career-portal.html':
                    loadCareerPortal(dataPath);
                    break;
                case 'about-dumu.html':
                    loadAboutPage(dataPath);
                    break;
                case 'community-tlogan.html':
                    loadCommunityPage(dataPath);
                    break;
                case 'calendar.html':
                    loadCalendarPage(dataPath);
                    break;
                case 'blaan-dictionary.html':
                    loadDictionaryPage(dataPath);
                    break;
                case 'student-life.html':
                    loadStudentLifePage(dataPath);
                    break;
                case 'transparency.html':
                    loadTransparencyPage(dataPath);
                    break;
                case 'alumni-stories.html':
                    loadAlumniStoriesPage(dataPath);
                    break;
                case 'enrollment.html':
                    loadEnrollmentHub(dataPath);
                    break;
                case 'enrollment-jhs.html':
                    loadEnrollmentJHS(dataPath);
                    break;
                case 'enrollment-shs.html':
                    loadEnrollmentSHS(dataPath);
                    break;
                case 'academics-gnare.html':
                    loadAcademicsPage(dataPath);
                    break;
                case 'academics-jhs.html':
                    loadAcademicsJHS(dataPath);
                    break;
                case 'academics-shs.html':
                    loadAcademicsSHS(dataPath);
                    break;
                case 'downloads-center.html':
                    loadDownloadsPage(dataPath);
                    break;
                case 'slt-beadwork.html':
                    loadBeadworkPage(dataPath);
                    break;
                case 'contact.html':
                    setupContactForm();
                    break;
            }
        }
    }

    async function loadSharedComponents(path, root) {
        const headerEl = document.querySelector('header');
        const footerEl = document.querySelector('footer');

        if (headerEl) {
            try {
                const res = await fetch(`${path}header.html`);
                if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
                let html = await res.text();
                headerEl.innerHTML = html.replace(/{root}/g, root);
                setupHeaderLogic();
            } catch (err) {
                console.error("Error loading header:", err);
            }
        }

        if (footerEl) {
            try {
                const res = await fetch(`${path}footer.html`);
                if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
                let html = await res.text();
                footerEl.innerHTML = html.replace(/{root}/g, root);
            } catch (err) {
                console.error("Error loading footer:", err);
            }
        }
    }

    function setupHeaderLogic() {
        // Re-initialize nav toggle logic for mobile
        const navToggle = document.getElementById('nav-toggle');
        const navLinks = document.querySelector('.nav-links');
        if (navToggle && navLinks) {
            navToggle.addEventListener('change', () => {
                navLinks.classList.toggle('active', navToggle.checked);
                document.body.classList.toggle('no-scroll', navToggle.checked);
            });
        }

        // Set active link
        const pathParts = window.location.pathname.split('/');
        const lastPart = pathParts.pop() || 'index.html';
        const currentPage = lastPart.endsWith('.html') ? lastPart : lastPart + '.html';
        const navItems = document.querySelectorAll('.nav-links a');
        navItems.forEach(item => {
            const itemPage = item.getAttribute('data-page');
            if (itemPage === currentPage) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });

        // Sync theme toggle UI after header loads
        const themeBtn = document.getElementById('theme-toggle');
        if (themeBtn) {
            const isDark = document.body.classList.contains('dark-mode');
            themeBtn.textContent = isDark ? '☀️' : '🌙';
            themeBtn.setAttribute('data-tooltip', isDark ? 'Switch to Light' : 'Switch to Dark');

            themeBtn.addEventListener('click', () => {
                const isDark = document.body.classList.toggle('dark-mode');
                localStorage.setItem('theme', isDark ? 'dark' : 'light');
                themeBtn.textContent = isDark ? '☀️' : '🌙';
                themeBtn.setAttribute('data-tooltip', isDark ? 'Switch to Light' : 'Switch to Dark');
            });
        }
    }

    function setupContactForm() {
        const contactForm = document.querySelector('.main-form');
        if (!contactForm) return;

        contactForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const form = e.target;
            const data = new FormData(form);
            const button = form.querySelector('button[type="submit"]');
            const originalText = button.textContent;

            try {
                button.disabled = true;
                button.textContent = 'Sending...';

                const response = await fetch(form.action, {
                    method: 'POST',
                    body: data,
                    headers: {
                        'Accept': 'application/json'
                    }
                });

                if (response.ok) {
                    // Success! Redirect to our custom thanks.html
                    window.location.href = 'thanks.html';
                } else {
                    const result = await response.json();
                    if (result.errors) {
                        alert(result.errors.map(error => error.message).join(", "));
                    } else {
                        alert("Oops! There was a problem submitting your form. Please try again.");
                    }
                }
            } catch (error) {
                alert("Oops! There was a problem submitting your form. Please check your connection and try again.");
            } finally {
                button.disabled = false;
                button.textContent = originalText;
            }
        });
    }

    function injectAnnouncement(data, root) {
        if (document.getElementById('site-announcement')) return;
        if (sessionStorage.getItem('announcementDismissed')) return;

        const header = document.querySelector('header');
        if (!header) return;

        const banner = document.createElement('div');
        banner.id = 'site-announcement';
        banner.className = 'announcement-banner';
        
        const linkUrl = data.link.startsWith('http') ? data.link : root + data.link;
        const target = data.link.startsWith('http') ? 'target="_blank"' : '';
        
        banner.innerHTML = `
            <div class="announcement-content">
                <span class="announcement-text">${data.text}</span>
                <a href="${linkUrl}" class="announcement-btn" ${target}>${data.button_text}</a>
            </div>
            <button class="announcement-close" id="close-announcement">&times;</button>
        `;

        // Insert below the header
        header.after(banner);

        document.getElementById('close-announcement').addEventListener('click', () => {
            banner.style.display = 'none';
            sessionStorage.setItem('announcementDismissed', 'true');
        });
    }

    function updateGlobalUI(config, root) {
        // Update Footer Social Links if they exist
        const fbLink = document.querySelector('.social-icon.fb')?.parentElement;
        const ytLink = document.querySelector('.social-icon.yt')?.parentElement;
        if (fbLink && config.social.facebook) fbLink.href = config.social.facebook;
        if (ytLink && config.social.youtube) ytLink.href = config.social.youtube;

        // Update Footer Navigation if it exists
        const footerNav = document.querySelector('.footer-nav ul');
        if (footerNav && config.footer_links) {
            footerNav.innerHTML = config.footer_links.map(link => {
                const url = link.url.startsWith('http') ? link.url : root + link.url;
                return `<li><a href="${url}">${link.text}</a></li>`;
            }).join('');
        }

        // --- HOMEPAGE ANNOUNCEMENT BANNER ---
        const isHomePage = window.location.pathname === '/' || 
                          window.location.pathname.endsWith('index.html') ||
                          (window.location.pathname.split('/').pop() === '');
        
        if (isHomePage && config.announcement && config.announcement.enabled) {
            injectAnnouncement(config.announcement, root);
        }

        // Update Site-wide Branding (School Name in Footer/Header)
        const headerNameMain = document.querySelector('.data-name-main');
        const headerNameSub = document.querySelector('.data-name-sub');
        if (headerNameMain && config.school_name_main) headerNameMain.textContent = config.school_name_main;
        if (headerNameSub && config.school_name_sub) headerNameSub.textContent = config.school_name_sub;

        const footerBrandName = document.querySelector('.footer-brand h4');
        if (footerBrandName) footerBrandName.textContent = config.school_name;

        const footerAddress = document.querySelector('.footer-brand p');
        if (footerAddress) footerAddress.textContent = config.address;

        // Populate Contact Page if on it
        const contactPanel = document.getElementById('contact-info-panel');
        if (contactPanel) {
            const addr = contactPanel.querySelector('.data-address');
            const phone = contactPanel.querySelector('.data-phone');
            const emails = contactPanel.querySelector('.data-emails');
            const hours = contactPanel.querySelector('.data-hours');

            if (addr) addr.textContent = config.address;
            if (phone) phone.textContent = config.phone;
            if (hours) hours.textContent = config.office_hours;
            if (emails) {
                emails.innerHTML = config.email.map(e => `<p>${e}</p>`).join('');
            }
        }
    }

    async function loadHomePage(dataPath) {
        try {
            const res = await fetch(`${dataPath}pages/index.json`);
            const data = await res.json();

            // Hero Section
            const heroOverlay = document.querySelector('#hero-section .hero-overlay');
            if (heroOverlay) {
                heroOverlay.innerHTML = `
                    <h1>${data.hero.title}</h1>
                    <p>${data.hero.subtitle}</p>
                    <div class="hero-btns">
                        <a href="pages/academics-gnare.html" class="btn">ACADEMIC PROGRAMS</a>
                        <a href="pages/slt-beadwork.html" class="btn btn-secondary">OUR BEADWORK HERITAGE</a>
                    </div>
                `;
            }

            // Stats Grid
            const statsGrid = document.getElementById('stats-grid');
            if (statsGrid) {
                statsGrid.innerHTML = data.stats_cards.map((card, i) => `
                    <div class="card reveal reveal-bottom delay-${i + 1}">
                        <div class="card-icon">${card.icon}</div>
                        <h3>${card.title}</h3>
                        <p>${card.description}</p>
                        <a href="${card.link}" class="card-link">${card.link_text}</a>
                    </div>
                `).join('');
            }

            // Vision Section
            const visionSection = document.querySelector('#vision-section .intro-text');
            if (visionSection) {
                visionSection.innerHTML = `
                    <h2 class="accent-title">${data.vision.title}</h2>
                    <p>${data.vision.description}</p>
                `;
            }

            // Promo Section
            const promoContainer = document.querySelector('#promo-section .promo-container');
            if (promoContainer) {
                promoContainer.innerHTML = `
                    <div class="promo-content">
                        <h2>${data.promo.title}</h2>
                        <p>${data.promo.description}</p>
                        <a href="${data.promo.btn_link}" class="btn">${data.promo.btn_text}</a>
                    </div>
                `;
            }
            initScrollReveal();
        } catch (err) { console.error("Error loading home page data:", err); }
    }

    async function loadCareerPortal(dataPath) {
        try {
            const res = await fetch(`${dataPath}pages/career.json`);
            const data = await res.json();

            // Render Institutions
            const instGrid = document.getElementById('institution-grid');
            if (instGrid) {
                instGrid.innerHTML = data.institutions.map((inst, i) => `
                    <div class="card reveal reveal-bottom delay-${(i % 6) + 1}">
                        <div class="card-icon">${inst.icon}</div>
                        <h3>${inst.name}</h3>
                        <p>${inst.type} Tertiary Institution</p>
                        <a href="${inst.link}" target="_blank" class="btn btn-small">Visit Facebook</a>
                    </div>
                `).join('');
            }

            // Render Scholarships
            const scholarContainer = document.getElementById('scholarships-container');
            if (scholarContainer) {
                let html = '';
                for (const key in data.scholarships) {
                    const cat = data.scholarships[key];
                    html += `
                        <div class="scholarship-category reveal reveal-bottom">
                            <h3 class="tier-title">${cat.title}</h3>
                            <p class="tier-desc">${cat.description}</p>
                            <div class="scholarship-grid">
                                ${cat.items.map(item => `
                                    <div class="card">
                                        <div class="card-icon">${item.icon}</div>
                                        <h3>${item.name}</h3>
                                        <p>${item.description}</p>
                                        <a href="${item.link}" target="_blank" class="card-link">Learn More →</a>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `;
                }
                scholarContainer.innerHTML = html;
            }

            // Render Alumni
            const alumniIntro = document.getElementById('alumni-intro');
            if (alumniIntro) {
                alumniIntro.innerHTML = `
                    <h2 class="section-title reveal reveal-bottom delay-1">${data.alumni.title}</h2>
                    <p class="section-subtitle reveal reveal-bottom delay-2">${data.alumni.description}</p>
                `;
            }

            const alumniGrid = document.getElementById('alumni-grid');
            if (alumniGrid) {
                alumniGrid.innerHTML = data.alumni.stories.map((story, i) => `
                    <div class="alumni-card reveal reveal-bottom delay-${(i % 6) + 3}">
                        <img src="${story.image}" alt="Alumni" class="alumni-photo" loading="lazy">
                        <span class="tag">${story.batch}</span>
                        <h3>${story.name}</h3>
                        <p>"${story.quote}"</p>
                    </div>
                `).join('');
            }

            initScrollReveal(); // Re-trigger animations
        } catch (err) { console.error("Error loading career portal data:", err); }
    }

    async function loadAboutPage(dataPath) {
        try {
            const res = await fetch(`${dataPath}pages/about.json`);
            const data = await res.json();

            const renderTeacher = (t, i) => `
                <div class="card teacher-item reveal reveal-bottom delay-${(i % 6) + 1}">
                    <div class="teacher-image-container">
                        <img src="${t.image}" alt="${t.name}" loading="lazy">
                    </div>
                    <h3><a href="${t.link}" title="Message me" target="_blank" class="name-link">${t.name}</a></h3>
                    <p class="role">${t.role}</p>
                    <p class="tribal-title">${t.title}</p>
                    <p class="faculty-bio">${t.bio}</p>
                </div>
            `;

            // Admin Grid
            const adminGrid = document.getElementById('admin-grid');
            if (adminGrid) {
                const head = data.leadership[0];
                let adminHtml = `
                    <div class="card school-head-feature">
                        <div class="head-flex-container">
                            <div class="head-image-box">
                                <div class="teacher-image-container">
                                    <img src="${head.image}" alt="${head.name}" loading="lazy">
                                </div>
                                <h3><a href="${head.link}" title="Message me" target="_blank" class="name-link">${head.name}</a></h3>
                                <p class="role">${head.role}</p>
                                <p class="tribal-title">${head.title}</p>
                            </div>
                            <div class="head-message-box">
                                <h3 class="message-title">School Head's Message</h3>
                                <div class="message-content">
                                    <p>${head.bio}</p>
                                    <p class="signature">${head.signature}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
                adminHtml += data.leadership.slice(1).map(renderTeacher).join('');
                adminGrid.innerHTML = adminHtml;
            }

            // JHS Grid
            const jhsGrid = document.getElementById('jhs-grid');
            if (jhsGrid) jhsGrid.innerHTML = data.jhs_faculty.map(renderTeacher).join('');

            // SHS Grid
            const shsGrid = document.getElementById('shs-grid');
            if (shsGrid) shsGrid.innerHTML = data.shs_faculty.map(renderTeacher).join('');

            initScrollReveal(); // Re-trigger animations
        } catch (err) { console.error("Error loading about page data:", err); }
    }

    async function loadCommunityPage(dataPath) {
        try {
            const res = await fetch(`${dataPath}pages/community.json`);
            const data = await res.json();

            const sltGrid = document.getElementById('slt-grid');
            if (sltGrid) {
                sltGrid.innerHTML = data.slt_items.map((item, i) => `
                    <div class="card slt-card reveal reveal-bottom delay-${(i % 6) + 2}">
                        <div class="slt-image-box">
                            <img src="${item.image}" alt="${item.title}">
                        </div>
                        <div class="dict-word-row">
                            <h3>${item.title}</h3>
                            ${item.audio ? `<button class="audio-btn" data-src="${item.audio}" aria-label="Play">▶</button>` : ''}
                        </div>
                        <p>${item.description}</p>
                        ${item.link !== '#' ? `<a href="${item.link}" class="btn btn-small">View Our Projects →</a>` : ''}
                    </div>
                `).join('');
            }

            const quoteBox = document.querySelector('.quote-box');
            if (quoteBox) {
                quoteBox.innerHTML = `
                    <div class="dict-word-row" style="justify-content: center; gap: 20px;">
                        <p style="margin-bottom: 0;">"${data.elders_wisdom.quote}"</p>
                        ${data.elders_wisdom.audio ? `<button class="audio-btn" data-src="${data.elders_wisdom.audio}" aria-label="Play">▶</button>` : ''}
                    </div>
                    <span>— ${data.elders_wisdom.author}</span>
                `;
            }

            // Audio logic for community page
            const audio = new Audio();
            document.querySelectorAll('.audio-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const src = btn.getAttribute('data-src');
                    if (!src) return;
                    if (audio.src !== src) audio.src = src;
                    audio.play().catch(() => {});
                });
            });

            initScrollReveal();
        } catch (err) { console.error("Error loading community page data:", err); }
    }

    async function loadCalendarPage(dataPath) {
        try {
            const res = await fetch(`${dataPath}pages/calendar.json`);
            const data = await res.json();

            const calendarFrame = document.querySelector('.calendar-container iframe');
            if (calendarFrame) calendarFrame.src = data.google_calendar_src;

            const calendarLink = document.querySelector('.calendar-link');
            if (calendarLink) calendarLink.href = data.official_calendar_image;

            initScrollReveal();
        } catch (err) { console.error("Error loading calendar page data:", err); }
    }

    async function loadDictionaryPage(dataPath) {
        try {
            const res = await fetch(`${dataPath}pages/dictionary.json`);
            const data = await res.json();

            const dictGrid = document.getElementById('dictionary-grid');
            if (dictGrid) {
                dictGrid.innerHTML = data.terms.map((term, i) => `
                    <div class="dict-card reveal reveal-bottom delay-${(i % 6) + 3}">
                        <div class="dict-word-row">
                            <div class="dict-word">${term.word}</div>
                            ${term.audio ? `<button class="audio-btn" data-src="${term.audio}" aria-label="Play pronunciation">▶</button>` : ''}
                        </div>
                        <div class="dict-pronunciation">${term.pronunciation}</div>
                        <div class="dict-meaning">${term.meaning}</div>
                    </div>
                `).join('');

                const audio = new Audio();
                const buttons = dictGrid.querySelectorAll('.audio-btn');
                buttons.forEach(btn => {
                    btn.addEventListener('click', () => {
                        const src = btn.getAttribute('data-src');
                        if (!src) return;
                        if (audio.src !== src) {
                            audio.src = src;
                        }
                        audio.play().catch(() => {});
                    });
                });
            }

            const searchInput = document.getElementById('dictionary-search');
            if (searchInput) {
                searchInput.placeholder = data.search_config.placeholder;
                document.querySelector('.dictionary-search-label').textContent = data.search_config.label;
            }

            initScrollReveal();
        } catch (err) { console.error("Error loading dictionary page data:", err); }
    }

    async function loadStudentLifePage(dataPath) {
        try {
            const res = await fetch(`${dataPath}pages/student-life.json`);
            const data = await res.json();

            const videoContainer = document.querySelector('.video-container iframe');
            if (videoContainer) videoContainer.src = data.video.src;

            const videoCaption = document.querySelector('.italic-gray');
            if (videoCaption) videoCaption.textContent = data.video.caption;

            const galleryGrid = document.getElementById('gallery-grid');
            if (galleryGrid) {
                galleryGrid.innerHTML = data.photos.map((photo, i) => `
                    <div class="gallery-card reveal reveal-bottom delay-${(i % 6) + 3}">
                        <img src="${photo.image}" alt="${photo.title}">
                        <div class="gallery-overlay">
                            <h4>${photo.title}</h4>
                            <p>${photo.description}</p>
                        </div>
                    </div>
                `).join('');
            }

            initScrollReveal();
        } catch (err) { console.error("Error loading student life page data:", err); }
    }

    async function loadTransparencyPage(dataPath) {
        try {
            const res = await fetch(`${dataPath}pages/transparency.json`);
            const data = await res.json();

            const transparencyGrid = document.getElementById('reports-grid');
            if (transparencyGrid) {
                transparencyGrid.innerHTML = data.reports.map((report, i) => `
                    <div class="card transparency-card reveal reveal-bottom delay-${(i % 6) + 3}">
                        <div class="card-icon">${report.icon}</div>
                        <h3>${report.title}</h3>
                        <p>${report.description}</p>
                        <a href="${report.link}" class="btn btn-small" target="_blank">View PDF</a>
                    </div>
                `).join('');
            }

            const noticeBox = document.querySelector('.transparency-notice');
            if (noticeBox) {
                noticeBox.innerHTML = `
                    <h3>${data.financial_notice.title}</h3>
                    <p>${data.financial_notice.description}</p>
                    <p><a href="downloads-center.html" class="btn btn-small">Open Downloads Center</a></p>
                `;
            }

            initScrollReveal();
        } catch (err) { console.error("Error loading transparency page data:", err); }
    }

    async function loadAlumniStoriesPage(dataPath) {
        try {
            const res = await fetch(`${dataPath}pages/alumni-stories.json`);
            const data = await res.json();

            // Load intro section
            const alumniIntro = document.getElementById('alumni-intro');
            if (alumniIntro) {
                alumniIntro.innerHTML = `
                    <h2 class="section-title reveal reveal-bottom delay-1">${data.title}</h2>
                    <p class="section-subtitle reveal reveal-bottom delay-2">${data.description}</p>
                `;
            }

            // Load alumni stories
            const alumniGrid = document.getElementById('alumni-grid');
            if (alumniGrid && data.stories) {
                alumniGrid.innerHTML = data.stories.map((story, index) => `
                    <div class="alumni-card reveal reveal-bottom delay-${(index + 3)}">
                        <img src="${story.image}" alt="Alumni" class="alumni-photo" loading="lazy">
                        <span class="tag">${story.batch}</span>
                        <h3>${story.name}</h3>
                        <p>"${story.quote}"</p>
                    </div>
                `).join('');
            }

            initScrollReveal();
        } catch (err) { console.error("Error loading alumni stories page data:", err); }
    }

    async function loadAcademicsPage(dataPath) {
        try {
            const res = await fetch(`${dataPath}pages/academics.json`);
            const data = await res.json();

            const pathsGrid = document.getElementById('academics-paths');
            if (pathsGrid) {
                pathsGrid.innerHTML = data.paths.map((path, i) => `
                    <a href="${path.link}" class="split-card ${path.type} reveal reveal-${i === 0 ? 'left' : 'right'} delay-${i + 1}">
                        <div class="split-icon">${path.icon}</div>
                        <h2>${path.title}</h2>
                        <p>${path.grades}</p>
                        <p>${path.description}</p>
                        <span class="btn btn-small btn-bead-${path.type === 'jhs' ? 'red' : 'blue'}">${path.btn_text}</span>
                    </a>
                `).join('');
            }

            const virtualTourIntro = document.querySelector('#virtual-tour-section .intro-text');
            if (virtualTourIntro) {
                virtualTourIntro.innerHTML = `
                    <h2 class="accent-title">${data.virtual_tour.title}</h2>
                    <p>${data.virtual_tour.description}</p>
                `;
            }

            const virtualTourVideo = document.querySelector('#virtual-tour-section iframe');
            if (virtualTourVideo) virtualTourVideo.src = data.virtual_tour.src;

            const visionIntro = document.querySelector('#academics-vision .intro-text');
            if (visionIntro) {
                visionIntro.innerHTML = `
                    <h2 class="accent-title">${data.vision.title}</h2>
                    <p>${data.vision.description}</p>
                `;
            }

            initScrollReveal();
        } catch (err) { console.error("Error loading academics page data:", err); }
    }

    async function loadDownloadsPage(dataPath) {
        try {
            const res = await fetch(`${dataPath}pages/downloads.json`);
            const data = await res.json();

            const banner = document.getElementById('downloads-banner');
            if (banner) {
                banner.innerHTML = `
                    <h1>${data.banner.title}</h1>
                    <p>${data.banner.subtitle}</p>
                `;
            }

            const intro = document.getElementById('downloads-intro');
            if (intro) {
                intro.innerHTML = `
                    <h2 class="accent-title">${data.intro.title}</h2>
                    <p>${data.intro.description}</p>
                `;
            }

            const grid = document.getElementById('downloads-grid');
            if (grid) {
                grid.innerHTML = data.files.map((file, i) => `
                    <div class="card download-card reveal reveal-bottom delay-${(i % 6) + 2}">
                        <div class="card-icon">${file.icon}</div>
                        <span class="download-meta">${file.category}</span>
                        <h3>${file.title}</h3>
                        <p>${file.description}</p>
                        <div class="download-actions">
                            <a href="${file.link}" class="btn btn-small" target="_blank">View File</a>
                            <a href="${file.link}" class="btn btn-small" download>Download</a>
                        </div>
                    </div>
                `).join('');
            }

            initScrollReveal();
        } catch (err) { console.error("Error loading downloads page data:", err); }
    }

    /* --- ENROLLMENT FORM MODAL --- */
    function setupEnrollmentTriggers() {
        const triggers = document.querySelectorAll('[data-enroll-trigger]');
        triggers.forEach(trigger => {
            trigger.addEventListener('click', (e) => {
                e.preventDefault();
                const type = trigger.getAttribute('data-enroll-trigger');
                
                if (type.startsWith('old-student')) {
                    injectOldStudentModal();
                    const modal = document.getElementById('old-student-modal');
                    if (modal) {
                        modal.hidden = false;
                        // Auto-scroll to top when modal opens
                        const scrollTarget = modal.querySelector('.enroll-module') || modal;
                        scrollTarget.scrollTo({ top: 0 });
                        
                        const targetLevel = document.getElementById('old-target-level');
                        if (targetLevel) {
                            const isSHS = type === 'old-student-shs';
                            Array.from(targetLevel.options).forEach(opt => {
                                if (opt.value === '') return;
                                const val = parseInt(opt.value);
                                if (isSHS) {
                                    // For Grade 12 Confirmation, hide Grade 11
                                    opt.hidden = val !== 12;
                                } else {
                                    // For JHS Confirmation, show Grades 8-10
                                    opt.hidden = val >= 11;
                                }
                            });

                            if (isSHS) {
                                targetLevel.value = '12';
                                targetLevel.classList.add('is-locked');
                                targetLevel.style.pointerEvents = 'none';
                                targetLevel.style.background = 'rgba(0,0,0,0.05)';
                            } else {
                                targetLevel.value = '';
                                targetLevel.classList.remove('is-locked');
                                targetLevel.style.pointerEvents = 'auto';
                                targetLevel.style.background = '';
                            }
                        }
                    }
                } else {
                    injectEnrollmentModal();
                    const modal = document.getElementById('enrollment-form-modal');
                    if (modal) {
                        modal.hidden = false;
                        // Auto-scroll to top when modal opens
                        const scrollTarget = modal.querySelector('.enroll-module') || modal;
                        scrollTarget.scrollTo({ top: 0 });

                        const typeSelect = document.getElementById('enroll-type-modal');
                        if (typeSelect && type) {
                            // Store context for transferees
                            const form = modal.querySelector('form');
                            if (form) form.setAttribute('data-context', type === 'grade7' ? 'jhs' : 'shs');

                            // Filter Enrollment Types for JHS vs SHS
                            Array.from(typeSelect.options).forEach(opt => {
                                if (opt.value === '' || opt.value === 'transferee') {
                                    opt.hidden = false;
                                    return;
                                }
                                if (type === 'grade7') { // JHS
                                    opt.hidden = opt.value === 'grade11';
                                } else if (type === 'grade11') { // SHS
                                    opt.hidden = opt.value === 'grade7';
                                }
                            });

                            typeSelect.value = type;
                            typeSelect.dispatchEvent(new Event('change'));
                        }
                    }
                }
            });
        });
    }

    function injectOldStudentModal() {
        if (document.getElementById('old-student-modal')) return;

        const modal = document.createElement('div');
        modal.id = 'old-student-modal';
        modal.className = 'enroll-modal';
        modal.hidden = true;
        modal.innerHTML = `
            <div class="enroll-module" style="max-width: 600px; width: 100%; max-height: 90vh; overflow-y: auto;">
                <button type="button" class="faq-bot-close" id="old-modal-close" style="position: absolute; top: 15px; right: 20px; font-size: 2rem;">&times;</button>
                <div class="enroll-module-header">
                    <h2 class="accent-title">Confirmation Slip</h2>
                    <p>For Continuing/Old Students. High-speed confirmation for the upcoming school year.</p>
                </div>

                <div class="enroll-progress" aria-hidden="true">
                    <div class="enroll-progress-bar">
                        <div class="enroll-progress-fill" id="old-progress-fill"></div>
                    </div>
                    <div class="enroll-progress-steps">
                        <span class="old-step-indicator active" data-step="1">1</span>
                        <span class="old-step-indicator" data-step="2">2</span>
                        <span class="old-step-indicator" data-step="3">3</span>
                    </div>
                </div>

                <form id="old-student-form" class="enroll-form" style="margin-top: 25px;" novalidate>
                    <div class="enroll-error" id="old-error" role="alert" hidden></div>

                    <div class="old-step active" data-step="1">
                        <div class="enroll-grid">
                            <div class="form-group">
                                <label for="old-lrn">12-Digit LRN</label>
                                <input type="text" id="old-lrn" name="LRN" required inputmode="numeric" pattern="\\d{12}" maxlength="12" placeholder="123456789012">
                            </div>
                            <div class="form-group">
                                <label for="old-lastname">Last Name</label>
                                <input type="text" id="old-lastname" name="Last Name" required placeholder="Last Name">
                            </div>
                            <div class="form-group">
                                <label for="old-firstname">First Name</label>
                                <input type="text" id="old-firstname" name="First Name" required placeholder="First Name">
                            </div>
                            <div class="form-group">
                                <label for="old-middlename">Middle Name (Optional)</label>
                                <input type="text" id="old-middlename" name="Middle Name" placeholder="Middle Name">
                            </div>
                            <div class="form-group">
                            <label for="old-extension">Extension Name (Optional)</label>
                                <input type="text" id="old-extension" name="Extension Name" placeholder="e.g. Jr., III (Leave blank if none)">
                        </div>
                            <div class="form-group">
                                <label for="old-target-level">Grade Level to Enroll</label>
                                <select id="old-target-level" name="Grade Level" required>
                                    <option value="" disabled selected>Select Grade</option>
                                    <option value="8">Grade 8</option>
                                    <option value="9">Grade 9</option>
                                    <option value="10">Grade 10</option>
                                    <option value="11">Grade 11</option>
                                    <option value="12">Grade 12</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <div class="old-step" data-step="2">
                        <div class="form-group">
                            <label style="font-weight: 700; display: block; margin-bottom: 10px;">Do you confirm your intent to enroll for the upcoming school year?</label>
                            <div style="display: flex; gap: 30px; align-items: center;">
                                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 1.1rem;">
                                    <input type="radio" name="Intent to Enroll" value="Yes" required style="width: 20px; height: 20px;"> YES
                                </label>
                                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 1.1rem;">
                                    <input type="radio" name="Intent to Enroll" value="No" required style="width: 20px; height: 20px;"> NO
                                </label>
                            </div>
                        </div>

                        <div class="form-group mt-3" style="display: flex; align-items: flex-start; gap: 10px; background: var(--soft-abaca); padding: 15px; border-radius: 10px; border: 1px solid var(--abaca-cream);">
                            <input type="checkbox" id="old-agreement" name="Data Agreement" required style="width: auto; margin-top: 5px;">
                            <label for="old-agreement" style="font-size: 0.9rem; cursor: pointer; color: var(--midnight-black); line-height: 1.5;">
                                I hereby certify that the above information given are true and correct to the best of my knowledge and I allow the Department of Education to use my child's details to create and/or update his/her learner profile in the Learner Information System. The information herein shall be treated as confidential in compliance with the Data Privacy Act of 2012.
                            </label>
                        </div>
                    </div>

                    <div class="old-step" data-step="3">
                        <div class="enroll-review">
                            <h3 class="accent-title">Review Confirmation Details</h3>
                            <p style="margin-bottom: 15px; font-size: 0.9rem; color: var(--text-gray);">Please check all information before confirming.</p>
                            <div class="enroll-review-grid" id="old-review-grid"></div>
                        </div>
                    </div>

                    <div class="enroll-actions" style="margin-top: 25px;">
                        <button type="button" class="btn btn-secondary" id="old-prev" disabled>Back</button>
                        <button type="button" class="btn" id="old-next">Next</button>
                        <button type="submit" class="btn btn-gold" id="old-submit" style="display: none;">Confirm Enrollment</button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(modal);

        const closeBtn = document.getElementById('old-modal-close');
        const cancelBtn = document.getElementById('old-cancel');
        const closeModal = () => { modal.hidden = true; };
        
        if (closeBtn) closeBtn.onclick = closeModal;
        if (cancelBtn) cancelBtn.onclick = closeModal;
        modal.onclick = (e) => { if (e.target === modal) closeModal(); };

        initOldStudentForm();
    }

    function initOldStudentForm() {
        const form = document.getElementById('old-student-form');
        if (!form) return;

        injectThanksModal();

        const getValue = (id) => document.getElementById(id)?.value.trim() || '—';

        const errorEl = document.getElementById('old-error');
        const btnPrev = document.getElementById('old-prev');
        const btnNext = document.getElementById('old-next');
        const btnSubmit = document.getElementById('old-submit');
        const thanksModal = document.getElementById('enroll-thanks-modal');
        const progressFill = document.getElementById('old-progress-fill');
        const stepIndicators = Array.from(document.querySelectorAll('.old-step-indicator'));
        const steps = Array.from(form.querySelectorAll('.old-step'));
        const totalSteps = steps.length;
        let currentStep = 1;

        function setError(message) {
            if (!errorEl) return;
            errorEl.textContent = message;
            errorEl.hidden = false;
            // Scroll to top of modal/form to show the error
            const scrollTarget = form.closest('.enroll-module') || form;
            scrollTarget.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function showStep(step) {
            currentStep = step;
            steps.forEach(s => s.classList.toggle('active', Number(s.getAttribute('data-step')) === step));
            
            const isLastStep = step === totalSteps;
            btnPrev.disabled = step === 1;
            btnNext.style.display = isLastStep ? 'none' : 'block';
            btnSubmit.style.display = isLastStep ? 'block' : 'none';

            // Progress Bar
            const pct = Math.round((step / totalSteps) * 100);
            if (progressFill) progressFill.style.width = `${pct}%`;
            stepIndicators.forEach(ind => {
                const indStep = Number(ind.getAttribute('data-step'));
                ind.classList.toggle('active', indStep <= step);
            });

            if (isLastStep) updateReview();

            // Auto-scroll to top of form/modal
            const scrollTarget = form.closest('.enroll-module') || form;
            scrollTarget.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function validateStep(step) {
            const container = steps.find(s => Number(s.getAttribute('data-step')) === step);
            if (!container) return true;

            const inputs = Array.from(container.querySelectorAll('input, select'));
            for (const input of inputs) {
                if (input.required && !input.value && input.type !== 'radio') {
                    input.focus();
                    setError('Please fill out all required fields.');
                    return false;
                }
                if (input.id === 'old-lrn' && !/^\d{12}$/.test(input.value.trim())) {
                    input.focus();
                    setError('LRN must be exactly 12 digits.');
                    return false;
                }
            }

            if (step === 2) {
                const confirmVal = form.querySelector('input[name="Intent to Enroll"]:checked')?.value;
                if (!confirmVal) {
                    setError('Please select YES or NO to confirm your intent.');
                    return false;
                }
                if (step === 3) {
                    const agreeCb = document.getElementById(`old-agreement`);
                    if (agreeCb && !agreeCb.checked) {
                        agreeCb.focus();
                        setError('Please certify that the information provided is true and correct to proceed.');
                        return false;
                    }
                }
            }

            errorEl.hidden = true;
            return true;
        }

        function updateReview() {
            const reviewGrid = document.getElementById('old-review-grid');
            if (!reviewGrid) return;

            const confirmVal = (form.querySelector('input[name="Intent to Enroll"]:checked')?.value || '—');
            
            const lastName = getValue('old-lastname');
            const firstName = getValue('old-firstname');
            const middleName = getValue('old-middlename');
            const extension = getValue('old-extension');
            const fullName = `${lastName}, ${firstName}${middleName !== '—' ? ' ' + middleName : ''}${extension !== '—' ? ' ' + extension : ''}`;

            const items = [
                { label: 'Full Name', value: fullName },
                { label: '12-Digit LRN', value: getValue('old-lrn') },
                { label: 'Grade to Enroll', value: 'Grade ' + getValue('old-target-level') },
                { label: 'Intent to Enroll', value: confirmVal },
                { label: 'Data Agreement', value: document.getElementById('old-agreement')?.checked ? 'Accepted' : 'Not Accepted' }
            ];

            const type = getValue('enroll-type-modal');
            if (type === 'transferee') {
                items.push({ label: 'Previous School ID', value: getValue('enroll-prev-school-id') });
                items.push({ label: 'Previous School Address', value: getValue('enroll-prev-school-address') });
                items.push({ label: 'Previous School Last Attended', value: getValue('enroll-prev-school-last-attended') });
            }

            reviewGrid.innerHTML = items.map(item => `
                <div class="enroll-review-item">
                    <span>${item.label}</span>
                    <strong>${item.value || '—'}</strong>
                </div>
            `).join('');
        }

        btnPrev.addEventListener('click', () => { if (currentStep > 1) showStep(currentStep - 1); });
        btnNext.addEventListener('click', () => { if (validateStep(currentStep)) showStep(currentStep + 1); });

        // Auto-check agreement if "YES" is selected
        const intentRadios = form.querySelectorAll('input[name="Intent to Enroll"]');
        const agreementCheckbox = document.getElementById('old-agreement');
        if (intentRadios && agreementCheckbox) {
            intentRadios.forEach(radio => {
                radio.addEventListener('change', () => {
                    if (radio.value === 'Yes' && radio.checked) {
                        agreementCheckbox.checked = true;
                    }
                });
            });
        }

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!validateStep(currentStep)) return;

            btnSubmit.disabled = true;
            const originalText = btnSubmit.textContent;
            btnSubmit.textContent = 'Confirming...';

            try {
                // Submit to FormSubmit.co
                const formData = new FormData();
                const lastName = getValue('old-lastname');
                const firstName = getValue('old-firstname');
                formData.append('_subject', `Old Student Confirmation: ${lastName}, ${firstName} - Grade ${getValue('old-target-level')}`);
                formData.append('_template', 'table');
                formData.append('_captcha', 'false');

                // FormSubmit.co endpoint
                const endpoint = `https://formsubmit.co/upperlabay.nhs@deped.gov.ph`;

                // Add all form fields using their 'name' attribute
                const allInputs = Array.from(form.querySelectorAll('input, select'));
                
                allInputs.forEach(field => {
                    if (!field.name) return;
                    
                    if (field.type === 'radio') {
                        if (field.checked) formData.append(field.name, field.value);
                    } else if (field.type === 'checkbox') {
                        if (field.checked) formData.append(field.name, 'Accepted');
                    } else if (field.value) {
                        formData.append(field.name, field.value);
                    }
                });

                const response = await fetch(endpoint, {
                    method: 'POST',
                    body: formData,
                    headers: {
                        'Accept': 'application/json'
                    }
                });

                const result = await response.json().catch(() => ({}));

                if (!response.ok) {
                    throw new Error(result.message || 'Submission failed');
                }

                try {
                    const oldModal = document.getElementById('old-student-modal');
                    if (oldModal) oldModal.hidden = true;
                } catch (modalErr) {
                    console.error('Error hiding old modal:', modalErr);
                }

                if (thanksModal) {
                    try {
                        // Re-attach close button handler to ensure it works
                        const closeBtn = thanksModal.querySelector('#enroll-thanks-close');
                        if (closeBtn) {
                            closeBtn.onclick = () => {
                                thanksModal.hidden = true;
                                thanksModal.style.display = 'none';
                                thanksModal.style.zIndex = '';
                            };
                        }
                        thanksModal.onclick = (e) => {
                            if (e.target === thanksModal) {
                                thanksModal.hidden = true;
                                thanksModal.style.display = 'none';
                                thanksModal.style.zIndex = '';
                            }
                        };

                        const thanksTitle = thanksModal.querySelector('#enroll-thanks-title');
                        const thanksMsg = thanksModal.querySelector('#enroll-thanks-message');
                        if (thanksTitle) thanksTitle.textContent = 'Confirmation Received!';
                        if (thanksMsg) thanksMsg.textContent = 'Enrollment confirmation successful! We are grateful for your continued trust in our school community and are glad to have you back.';
                        
                        // Force display with inline styles that override CSS
                        thanksModal.hidden = false;
                        thanksModal.style.display = 'flex';
                        thanksModal.style.zIndex = '9999';
                    } catch (modalErr) {
                        console.error('Error showing thanks modal:', modalErr);
                        alert('Confirmation Received! Your intent to enroll has been recorded.');
                    }
                }
                form.reset();
                showStep(1);
            } catch (err) {
                setError('Submission failed. Please try again.');
            } finally {
                btnSubmit.disabled = false;
                btnSubmit.textContent = originalText;
            }
        });

        showStep(1);
    }

    function injectEnrollmentModal() {
        if (document.getElementById('enrollment-form-modal')) return;

        const modal = document.createElement('div');
        modal.id = 'enrollment-form-modal';
        modal.className = 'enroll-modal';
        modal.hidden = true;
        modal.innerHTML = `
            <div class="enroll-module" style="max-width: 800px; width: 100%; max-height: 90vh; overflow-y: auto;">
                <button type="button" class="faq-bot-close" id="enroll-modal-close" style="position: absolute; top: 15px; right: 20px; font-size: 2rem;">&times;</button>
                <div class="enroll-module-header">
                    <h2 class="accent-title">Online Enrollment Form</h2>
                    <p>Complete the steps below to submit your details.</p>
                </div>

                <div class="enroll-progress" aria-hidden="true">
                    <div class="enroll-progress-bar">
                        <div class="enroll-progress-fill" id="enroll-progress-fill-modal"></div>
                    </div>
                    <div class="enroll-progress-steps">
                        <span class="enroll-step-indicator active" data-step="1">1</span>
                        <span class="enroll-step-indicator" data-step="2">2</span>
                        <span class="enroll-step-indicator" data-step="3">3</span>
                        <span class="enroll-step-indicator" data-step="4">4</span>
                        <span class="enroll-step-indicator" data-step="5">5</span>
                    </div>
                </div>

                <form id="modal-enrollment-form" class="enroll-form" enctype="multipart/form-data" novalidate>
                    <div class="enroll-error" id="enroll-error-modal" role="alert" hidden></div>

                    <div class="enroll-step active" data-step="1">
                        <div class="enroll-grid">
                            <div class="form-group">
                                <label for="enroll-type-modal">Enrollment Type</label>
                                <select id="enroll-type-modal" name="Enrollment Type" required>
                                    <option value="" disabled selected>Select</option>
                                    <option value="grade7">Grade 7 (New Student)</option>
                                    <option value="grade11">Grade 11 (New Student)</option>
                                    <option value="transferee">Transferee</option>
                                </select>
                            </div>

                            <div class="form-group">
                                <label for="enroll-lastname-modal">Last Name</label>
                                <input type="text" id="enroll-lastname-modal" name="Last Name" required placeholder="Last Name">
                            </div>

                            <div class="form-group">
                                <label for="enroll-firstname-modal">First Name</label>
                                <input type="text" id="enroll-firstname-modal" name="First Name" required placeholder="First Name">
                            </div>

                            <div class="form-group">
                                <label for="enroll-middlename-modal">Middle Name (Optional)</label>
                                <input type="text" id="enroll-middlename-modal" name="Middle Name" placeholder="Middle Name">
                            </div>

                            <div class="form-group">
                                <label for="enroll-extension-modal">Extension Name (Optional)</label>
                                <input type="text" id="enroll-extension-modal" name="Extension Name" placeholder="e.g. Jr., III (Leave blank if none)">
                            </div>

                            <div class="form-group">
                                <label for="enroll-birthdate-modal">Birthdate</label>
                                <input type="date" id="enroll-birthdate-modal" name="Birthdate" required>
                            </div>

                            <div class="form-group">
                                <label for="enroll-age-modal">Age</label>
                                <input type="number" id="enroll-age-modal" name="Age" readonly placeholder="Auto-calculated" style="background: rgba(30, 79, 163, 0.05); font-weight: 700;">
                            </div>

                            <div class="form-group">
                                <label for="enroll-sex-modal">Sex</label>
                                <select id="enroll-sex-modal" name="Sex" required>
                                    <option value="" disabled selected>Select</option>
                                    <option value="male">Male</option>
                                    <option value="female">Female</option>
                                </select>
                            </div>

                            <div class="form-group">
                                <label for="enroll-mother-tongue-modal">Mother Tongue</label>
                                <input type="text" id="enroll-mother-tongue-modal" name="Mother Tongue" required placeholder="e.g. Blaan, Cebuano, Tagalog">
                            </div>

                            <div class="form-group">
                                <label for="enroll-religion-modal">Religion</label>
                                <input type="text" id="enroll-religion-modal" name="Religion" required placeholder="e.g. Roman Catholic, Islam, SDA">
                            </div>

                            <div class="form-group">
                                <label for="enroll-ip-modal">Indigenous People (IP) Member?</label>
                                <select id="enroll-ip-modal" name="IP Member" required>
                                    <option value="no">No</option>
                                    <option value="yes">Yes</option>
                                </select>
                            </div>

                            <div class="form-group" id="ip-specify-container-modal" hidden>
                                <label for="enroll-ip-specify-modal">Please specify IP Group</label>
                                <input type="text" id="enroll-ip-specify-modal" name="IP Group" placeholder="e.g. Blaan, Tboli, Manobo">
                            </div>

                            <div class="form-group">
                                <label for="enroll-disability-modal">Is the child a Learner with Disability?</label>
                                <select id="enroll-disability-modal" name="Has Disability" required>
                                    <option value="no">No</option>
                                    <option value="yes">Yes</option>
                                </select>
                            </div>

                            <div class="form-group" id="disability-type-container-modal" hidden>
                                <label for="enroll-disability-type-modal">Type of Disability</label>
                                <select id="enroll-disability-type-modal" name="Disability Type">
                                    <option value="" disabled selected>Select Disability Type</option>
                                    <option value="visual-blind">Visual Impairment - Blind</option>
                                    <option value="visual-low-vision">Visual Impairment - Low Vision</option>
                                    <option value="hearing">Hearing Impairment</option>
                                    <option value="learning">Learning Disability</option>
                                    <option value="intellectual">Intellectual Disability</option>
                                    <option value="autism">Autism Spectrum Disorder</option>
                                    <option value="emotional">Emotional-Behavioral Disorder</option>
                                    <option value="orthopedic">Orthopedic/Physical Handicap</option>
                                    <option value="multiple">Multiple Disorder</option>
                                    <option value="speech">Speech/Language Disorder</option>
                                    <option value="cerebral">Cerebral Palsy</option>
                                    <option value="special-health">Special Health Problem/Chronic Disease</option>
                                    <option value="special-health-cancer">Special Health Problem - Cancer</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <div class="enroll-step" data-step="2">
                        <div class="enroll-grid">
                            <div class="form-group">
                                <label for="enroll-lrn-modal">12-Digit LRN</label>
                                <input type="text" id="enroll-lrn-modal" name="LRN" required inputmode="numeric" pattern="\\d{12}" maxlength="12" placeholder="123456789012">
                            </div>

                            <div class="form-group">
                                <label for="enroll-psa-modal">PSA Birth Certificate No. (Optional)</label>
                                <input type="text" id="enroll-psa-modal" name="PSA Number" placeholder="Enter PSA number">
                            </div>

                            <div class="form-group">
                                <label for="enroll-4ps-modal">4Ps ID (If applicable)</label>
                                <input type="text" id="enroll-4ps-modal" name="4Ps ID" placeholder="Enter 4Ps ID">
                            </div>
                        </div>

                        <div class="enroll-address-section mt-2">
                            <h4 class="accent-title" style="font-size: 1.1rem; margin-bottom: 10px;">Current Address</h4>
                            <div class="enroll-grid">
                                <div class="form-group">
                                    <label for="enroll-curr-house-modal">House No. / Street</label>
                                    <input type="text" id="enroll-curr-house-modal" name="Current House" required placeholder="House No. / Street">
                                </div>
                                <div class="form-group">
                                    <label for="enroll-curr-sitio-modal">Sitio / Street Name</label>
                                    <input type="text" id="enroll-curr-sitio-modal" name="Current Sitio" required placeholder="Sitio / Street Name">
                                </div>
                                <div class="form-group">
                                    <label for="enroll-curr-barangay-modal">Barangay</label>
                                    <input type="text" id="enroll-curr-barangay-modal" name="Current Barangay" required placeholder="Barangay">
                                </div>
                                <div class="form-group">
                                    <label for="enroll-curr-city-modal">Municipality / City</label>
                                    <input type="text" id="enroll-curr-city-modal" name="Current City" required placeholder="Municipality / City">
                                </div>
                                <div class="form-group">
                                    <label for="enroll-curr-province-modal">Province</label>
                                    <input type="text" id="enroll-curr-province-modal" name="Current Province" required placeholder="Province">
                                </div>
                                <div class="form-group">
                                    <label for="enroll-curr-country-modal">Country</label>
                                    <input type="text" id="enroll-curr-country-modal" name="Current Country" required value="Philippines">
                                </div>
                                <div class="form-group">
                                    <label for="enroll-curr-zip-modal">Zip Code</label>
                                    <input type="text" id="enroll-curr-zip-modal" name="Current Zip" required placeholder="e.g. 9500 -  if you came from General Santos City">
                                </div>
                            </div>
                        </div>

                        <div class="enroll-address-section mt-2">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                <h4 class="accent-title" style="font-size: 1.1rem; margin: 0;">Permanent Address</h4>
                                <label style="font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; gap: 5px;">
                                    <input type="checkbox" id="enroll-same-address-modal" name="Same Address" style="width: auto;"> Same as Current?
                                </label>
                            </div>
                            <div class="enroll-grid" id="permanent-address-fields-modal">
                                <div class="form-group">
                                    <label for="enroll-perm-house-modal">House No. / Street</label>
                                    <input type="text" id="enroll-perm-house-modal" name="Permanent House" required placeholder="House No. / Street">
                                </div>
                                <div class="form-group">
                                    <label for="enroll-perm-sitio-modal">Sitio / Street Name</label>
                                    <input type="text" id="enroll-perm-sitio-modal" name="Permanent Sitio" required placeholder="Sitio / Street Name">
                                </div>
                                <div class="form-group">
                                    <label for="enroll-perm-barangay-modal">Barangay</label>
                                    <input type="text" id="enroll-perm-barangay-modal" name="Permanent Barangay" required placeholder="Barangay">
                                </div>
                                <div class="form-group">
                                    <label for="enroll-perm-city-modal">Municipality / City</label>
                                    <input type="text" id="enroll-perm-city-modal" name="Permanent City" required placeholder="Municipality / City">
                                </div>
                                <div class="form-group">
                                    <label for="enroll-perm-province-modal">Province</label>
                                    <input type="text" id="enroll-perm-province-modal" name="Permanent Province" required placeholder="Province">
                                </div>
                                <div class="form-group">
                                    <label for="enroll-perm-country-modal">Country</label>
                                    <input type="text" id="enroll-perm-country-modal" name="Permanent Country" required value="Philippines">
                                </div>
                                <div class="form-group">
                                    <label for="enroll-perm-zip-modal">Zip Code</label>
                                    <input type="text" id="enroll-perm-zip-modal" name="Permanent Zip" required placeholder="Zip Code">
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="enroll-step" data-step="3">
                        <div class="enroll-grid">
                            <div class="form-group">
                                <label for="enroll-mother-modal">Mother's Maiden Name</label>
                                <input type="text" id="enroll-mother-modal" name="Mother Name" required placeholder="Last Name, First Name, Middle Name">
                            </div>

                            <div class="form-group">
                                <label for="enroll-father-modal">Father's Name</label>
                                <input type="text" id="enroll-father-modal" name="Father Name" required placeholder="Last Name, First Name, Middle Name">
                            </div>

                            <div class="form-group">
                                <label for="enroll-guardian-modal">Guardian's Name (If not parents)</label>
                                <input type="text" id="enroll-guardian-modal" name="Guardian Name" placeholder="Full name of guardian">
                            </div>

                            <div class="form-group">
                                <label for="enroll-guardian-contact-modal">Parent/Guardian Contact No. (Optional)</label>
                                <input type="tel" id="enroll-guardian-contact-modal" name="Guardian Contact" inputmode="tel" placeholder="09123456789">
                            </div>
                        </div>

                        <div class="enroll-conditional" data-cond="grade7" hidden>
                            <div class="enroll-grid">
                                <div class="form-group">
                                    <label for="enroll-elem-school-modal">Elementary School Graduated</label>
                                    <input type="text" id="enroll-elem-school-modal" name="Elementary School" placeholder="Name of elementary school">
                                </div>
                            </div>
                        </div>

                        <div class="enroll-conditional" data-cond="grade11" hidden>
                            <div class="enroll-grid">
                                <div class="form-group">
                                    <label for="enroll-track-modal">SHS Track Preference</label>
                                    <select id="enroll-track-modal" name="SHS Track">
                                        <option value="" disabled selected>Select SHS Pathway</option>
                                        <option value="academic">Academic</option>
                                        <option value="techpro">Technical Professional</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div class="enroll-conditional" data-cond="transferee" hidden>
                            <div class="enroll-grid">
                                <div class="form-group">
                                    <label for="enroll-prev-school-id-modal">Previous School Name</label>
                                    <input type="text" id="enroll-prev-school-id-modal" name="Previous School" placeholder="Name of Previous School">
                                </div>
                                <div class="form-group">
                                    <label for="enroll-prev-school-address-modal">Previous School Address</label>
                                    <input type="text" id="enroll-prev-school-address-modal" name="Previous School Address" placeholder="Complete address of previous school">
                                </div>
                            </div>
                        </div>

                        <div class="form-group mt-3" style="display: flex; align-items: flex-start; gap: 10px; background: var(--soft-abaca); padding: 15px; border-radius: 10px; border: 1px solid var(--abaca-cream);">
                            <input type="checkbox" id="enroll-agreement-modal" name="Agreement" required style="width: auto; margin-top: 5px;">
                            <label for="enroll-agreement-modal" style="font-size: 0.9rem; cursor: pointer; color: var(--midnight-black); line-height: 1.5;">
                                I hereby certify that the above information given are true and correct to the best of my knowledge and I allow the Department of Education to use my child’s details to create and/or update his/her learner profile in the Learner Information System. The information herein shall be treated as confidential in compliance with the Data Privacy Act of 2012.
                            </label>
                        </div>
                    </div>

                    <div class="enroll-step" data-step="4">
                        <div class="enroll-module-header" style="margin-bottom: 20px;">
                            <h3 class="accent-title" style="font-size: 1.3rem;">Document Requirements</h3>
                            <p style="font-size: 0.9rem; color: var(--primary-color);"><strong>Important:</strong> Please prepare the following documents for submission during the first week of classes:</p>
                        </div>

                        <div class="enroll-grid">
                            <div style="background: var(--light-bg); padding: 20px; border-radius: 8px; border-left: 4px solid var(--primary-color);">
                                <h4 style="margin-bottom: 15px; color: var(--primary-color);">📋 Required Documents for Submission:</h4>
                                <ul style="margin: 0; padding-left: 20px; line-height: 1.6;">
                                    <li><strong>SF9 (Report Card)</strong> - Latest report card from previous level</li>
                                    <li><strong>PSA Birth Certificate</strong> - Original or certified true copy</li>
                                    <li><strong>SF10 (Permanent Record)</strong> - For all students</li>
                                </ul>
                                
                                <h4 style="margin: 20px 0 15px 0; color: var(--primary-color);">📚 Additional Documents (if applicable):</h4>
                                <ul style="margin: 0; padding-left: 20px; line-height: 1.6;">
                                    <li><strong>Good Moral Character</strong> - From previous school</li>
                                    <li><strong>Certificate of Completion</strong> - For Grades 7 & 11 students</li>
                                    <li><strong>NCAE Results</strong> - For Grade 11 students</li>
                                    <li><strong>4Ps ID</strong> - If applicable</li>
                                </ul>
                                
                                <p style="margin-top: 20px; padding: 15px; background: var(--accent-color); color: white; border-radius: 6px; text-align: center;">
                                    <strong>📅 Submit these documents during the first week of classes to complete your enrollment.</strong>
                                </p>
                            </div>
                        </div>
                    </div>

                    <div class="enroll-step" data-step="5">
                        <div class="enroll-review">
                            <h3 class="accent-title">Review Enrollment Data</h3>
                            <p style="margin-bottom: 15px; font-size: 0.9rem; color: var(--text-gray);">Please check all information before submitting.</p>
                            <div class="enroll-review-grid" id="enroll-review-modal"></div>
                        </div>
                    </div>

                    <div class="enroll-actions">
                        <button type="button" class="btn btn-secondary" id="enroll-prev-modal" disabled>Back</button>
                        <button type="button" class="btn" id="enroll-next-modal">Next</button>
                        <button type="submit" class="btn btn-gold" id="enroll-submit-modal" style="display: none;">Submit Enrollment</button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(modal);

        // Setup events for this specific modal
        const closeBtn = document.getElementById('enroll-modal-close');
        closeBtn.onclick = () => { modal.hidden = true; };
        modal.onclick = (e) => { if (e.target === modal) modal.hidden = true; };

        // Initialize logic for the modal form
        initEnrollmentModuleSY2026('modal-enrollment-form');
    }

    function injectThanksModal() {
        const existingModal = document.getElementById('enroll-thanks-modal');
        if (existingModal) {
            // Re-attach close button handler
            const closeBtn = existingModal.querySelector('#enroll-thanks-close');
            if (closeBtn) {
                closeBtn.onclick = () => {
                    existingModal.hidden = true;
                    existingModal.style.display = 'none';
                };
            }
            existingModal.onclick = (e) => {
                if (e.target === existingModal) {
                    existingModal.hidden = true;
                    existingModal.style.display = 'none';
                }
            };
            return;
        }

        const modal = document.createElement('div');
        modal.id = 'enroll-thanks-modal';
        modal.className = 'enroll-modal';
        modal.hidden = true;
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="enroll-modal-content" role="dialog" aria-modal="true" aria-labelledby="enroll-thanks-title">
                <h3 id="enroll-thanks-title" class="accent-title">Thank you!</h3>
                <p id="enroll-thanks-message">Your enrollment details were submitted successfully. Please wait for further instructions via school announcements or Facebook updates.</p>
                <button type="button" class="btn" id="enroll-thanks-close">Close</button>
            </div>
        `;
        document.body.appendChild(modal);

        const closeBtn = document.getElementById('enroll-thanks-close');
        if (closeBtn) {
            closeBtn.onclick = () => {
                modal.hidden = true;
                modal.style.display = 'none';
            };
        }
        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.hidden = true;
                modal.style.display = 'none';
            }
        };
    }

    async function loadEnrollmentHub(dataPath) {
        try {
            const res = await fetch(`${dataPath}pages/enrollment.json`);
            const data = await res.json();

            const banner = document.getElementById('enrollment-banner');
            if (banner) {
                banner.innerHTML = `
                    <h1>${data.banner.title}</h1>
                    <p>${data.banner.subtitle}</p>
                `;
            }

            const pathsGrid = document.getElementById('enrollment-paths');
            if (pathsGrid) {
                pathsGrid.innerHTML = data.paths.map((path, i) => `
                    <a href="${path.link}" class="split-card ${path.type} reveal reveal-${i === 0 ? 'left' : 'right'} delay-${i + 1}">
                        <div class="split-icon">${path.icon}</div>
                        <h2>${path.title}</h2>
                        <p>${path.grades}</p>
                        <p>${path.description}</p>
                        <span class="btn btn-small btn-bead-${path.type === 'jhs' ? 'red' : 'blue'}">${path.btn_text}</span>
                    </a>
                `).join('');
            }

            const scheduleIntro = document.querySelector('#enrollment-schedule .intro-text');
            if (scheduleIntro) {
                scheduleIntro.innerHTML = `
                    <h2 class="accent-title">${data.schedule.title}</h2>
                    <p>${data.schedule.description}</p>
                    <p><a href="downloads-center.html" class="btn btn-gold">Open Downloads Center</a></p>
                `;
            }

            initScrollReveal();
        } catch (err) { console.error("Error loading enrollment hub data:", err); }
    }

    function initEnrollmentModuleSY2026(formId = 'new-enrollment-form') {
        const form = document.getElementById(formId);
        if (!form) return;

        injectThanksModal();

        const isModal = formId === 'modal-enrollment-form';
        const suffix = isModal ? '-modal' : '';

        /*
        Google Forms mapping guide:
        1) Open your Google Form in a browser.
        2) Click Preview (eye icon) and open DevTools.
        3) Inspect each form input element and look for its "name" attribute in the submitted payload.
           It will look like: entry.1234567890
        4) Copy those entry IDs into ENTRY below so each website field maps to the right Google Sheet column.
        5) Use the form "formResponse" URL:
           https://docs.google.com/forms/d/e/<FORM_ID>/formResponse
        */
        const GOOGLE_FORM_ACTION_URL = '';
        const ENTRY = {
            enrollmentType: '',
            fullName: '',
            birthdate: '',
            lrn: '',
            psaNumber: '',
            address: '',
            guardianName: '',
            guardianContact: '',
            fourPsId: '',
            elementarySchool: '',
            shsTrack: '',
            previousSchoolId: '',
            previousSchoolAddress: ''
        };

        const errorEl = document.getElementById(`enroll-error${suffix}`);
        const progressFill = document.getElementById(`enroll-progress-fill${suffix}`);
        const stepIndicators = Array.from(form.closest(isModal ? '.enroll-module' : 'section').querySelectorAll('.enroll-step-indicator'));

        const steps = Array.from(form.querySelectorAll('.enroll-step'));
        const totalSteps = steps.length;

        const btnPrev = document.getElementById(`enroll-prev${suffix}`);
        const btnNext = document.getElementById(`enroll-next${suffix}`);
        const btnSubmit = document.getElementById(`enroll-submit${suffix}`);

        const enrollmentTypeEl = document.getElementById(`enroll-type${suffix}`);
        const condBlocks = Array.from(form.querySelectorAll('.enroll-conditional'));
        const elemSchoolEl = document.getElementById(`enroll-elem-school${suffix}`);
        const trackEl = document.getElementById(`enroll-track${suffix}`);
        const prevSchoolIdEl = document.getElementById(`enroll-prev-school-id${suffix}`);
        const prevSchoolAddrEl = document.getElementById(`enroll-prev-school-address${suffix}`);

        // Document inputs
        const docPsaEl = document.getElementById(`enroll-doc-psa${suffix}`);
        const docCompletionEl = document.getElementById(`enroll-doc-completion${suffix}`);
        const docSf9El = document.getElementById(`enroll-doc-sf9${suffix}`);
        const docSf10El = document.getElementById(`enroll-doc-sf10${suffix}`);
        const docNcaeEl = document.getElementById(`enroll-doc-ncae${suffix}`);

        const thanksModal = document.getElementById('enroll-thanks-modal');
        const thanksClose = document.getElementById('enroll-thanks-close');

        const disabilityEl = document.getElementById(`enroll-disability${suffix}`);
        const disabilityTypeContainer = document.getElementById(`disability-type-container${suffix}`);
        const ipEl = document.getElementById(`enroll-ip${suffix}`);
        const ipSpecifyContainer = document.getElementById(`ip-specify-container${suffix}`);
        const sameAddressEl = document.getElementById(`enroll-same-address${suffix}`);
        const permAddressFields = document.getElementById(`permanent-address-fields${suffix}`);

        if (disabilityEl) {
            disabilityEl.addEventListener('change', () => {
                const isYes = disabilityEl.value === 'yes';
                if (disabilityTypeContainer) disabilityTypeContainer.hidden = !isYes;
                const typeSelect = document.getElementById(`enroll-disability-type${suffix}`);
                if (typeSelect) typeSelect.required = isYes;
            });
        }

        if (ipEl) {
            ipEl.addEventListener('change', () => {
                const isYes = ipEl.value === 'yes';
                if (ipSpecifyContainer) ipSpecifyContainer.hidden = !isYes;
                const specifyInput = document.getElementById(`enroll-ip-specify${suffix}`);
                if (specifyInput) specifyInput.required = isYes;
            });
        }

        const birthdateEl = document.getElementById(`enroll-birthdate${suffix}`);
        const ageEl = document.getElementById(`enroll-age${suffix}`);
        if (birthdateEl && ageEl) {
            birthdateEl.addEventListener('change', () => {
                const birthDate = new Date(birthdateEl.value);
                const today = new Date();
                let age = today.getFullYear() - birthDate.getFullYear();
                const m = today.getMonth() - birthDate.getMonth();
                if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
                    age--;
                }
                ageEl.value = isNaN(age) ? '' : age;
            });
        }

        if (sameAddressEl) {
            sameAddressEl.addEventListener('change', () => {
                const isSame = sameAddressEl.checked;
                if (isSame) syncPermanentAddress();
                if (permAddressFields) {
                    const inputs = permAddressFields.querySelectorAll('input');
                    inputs.forEach(input => input.disabled = isSame);
                }
            });

            // Sync on input change if "same" is checked
            const currentAddressInputs = form.querySelectorAll('.enroll-address-section:first-of-type input');
            currentAddressInputs.forEach(input => {
                input.addEventListener('input', () => {
                    if (sameAddressEl.checked) syncPermanentAddress();
                });
            });
        }

        function syncPermanentAddress() {
            const fields = ['house', 'sitio', 'barangay', 'city', 'province', 'country', 'zip'];
            fields.forEach(f => {
                const curr = document.getElementById(`enroll-curr-${f}${suffix}`);
                const perm = document.getElementById(`enroll-perm-${f}${suffix}`);
                if (curr && perm) perm.value = curr.value;
            });
        }

        let currentStep = 1;

        function setError(message) {
            if (!errorEl) return;
            errorEl.textContent = message;
            errorEl.hidden = false;
            // Scroll to top of modal/form to show the error
            const scrollTarget = form.closest('.enroll-module') || form;
            scrollTarget.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function clearError() {
            if (!errorEl) return;
            errorEl.textContent = '';
            errorEl.hidden = true;
        }

        function setConditionalRequirements(type) {
            if (elemSchoolEl) elemSchoolEl.required = false;
            if (trackEl) trackEl.required = false;
            if (prevSchoolIdEl) prevSchoolIdEl.required = false;
            if (prevSchoolAddrEl) prevSchoolAddrEl.required = false;

            // Docs - SF9 is mandatory for all new students (Grade 7 & 11)
            // Other docs are optional as per user request
            if (docSf9El) docSf9El.required = true; 
            if (docSf10El) docSf10El.required = false;
            if (docNcaeEl) docNcaeEl.required = false;

            if (type === 'grade7') {
                if (elemSchoolEl) elemSchoolEl.required = true;
            }
            if (type === 'grade11') {
                if (trackEl) trackEl.required = true;
            }
            if (type === 'transferee') {
                if (prevSchoolIdEl) prevSchoolIdEl.required = true;
                if (prevSchoolAddrEl) prevSchoolAddrEl.required = true;
            }
        }

        function updateConditionalVisibility(type) {
            condBlocks.forEach(block => {
                const shouldShow = block.getAttribute('data-cond') === type;
                block.hidden = !shouldShow;
            });
            setConditionalRequirements(type);
        }

        function updateProgress(step) {
            const pct = Math.round((step / totalSteps) * 100);
            if (progressFill) progressFill.style.width = `${pct}%`;
            stepIndicators.forEach(ind => {
                const indStep = Number(ind.getAttribute('data-step'));
                ind.classList.toggle('active', indStep <= step);
            });
        }

        function showStep(step) {
            currentStep = step;
            steps.forEach(s => s.classList.toggle('active', Number(s.getAttribute('data-step')) === step));

            const isLastStep = step === totalSteps;

            btnPrev.disabled = step === 1;
            
            // Toggle visibility using display style for more robust behavior with flex containers
            btnNext.style.display = isLastStep ? 'none' : 'block';
            btnSubmit.style.display = isLastStep ? 'block' : 'none';

            // Change Next button text on Step 4 to "Preview"
            if (step === 4) {
                btnNext.textContent = 'Preview Enrollment Data';
            } else {
                btnNext.textContent = 'Next';
            }

            updateProgress(step);
            clearError();

            if (isLastStep) {
                updateReview();
            }

            // Auto-scroll to top of form/modal
            const scrollTarget = form.closest('.enroll-module') || form;
            scrollTarget.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function validateStep(step) {
            const container = steps.find(s => Number(s.getAttribute('data-step')) === step);
            if (!container) return true;

            const visibleInputs = Array.from(container.querySelectorAll('input, select, textarea'))
                .filter(el => {
                    if (el.closest('[hidden]')) return false;
                    return true;
                });

            for (const el of visibleInputs) {
                if (!el.checkValidity()) {
                    el.focus();
                    setError(el.validationMessage || 'Please complete the required fields.');
                    return false;
                }
            }

            if (step === 2) {
                const lrnEl = document.getElementById(`enroll-lrn${suffix}`);
                if (lrnEl) {
                    const lrn = lrnEl.value.trim();
                    if (!/^\d{12}$/.test(lrn)) {
                        lrnEl.focus();
                        setError('LRN must be exactly 12 digits.');
                        return false;
                    }
                }
            }

            if (step === 1) {
                const type = enrollmentTypeEl.value;
                if (!type) {
                    enrollmentTypeEl.focus();
                    setError('Please select an enrollment type.');
                    return false;
                }
            }

            return true;
        }

        function getValue(id) {
            const el = document.getElementById(`${id}${suffix}`);
            return el ? el.value.trim() : '';
        }

        function updateReview() {
            const reviewEl = document.getElementById(`enroll-review${suffix}`);
            if (!reviewEl) return;

            const type = getValue('enroll-type');
            const typeLabel =
                type === 'grade7' ? 'Grade 7 (New Student)' :
                type === 'grade11' ? 'Grade 11 (New Student)' :
                type === 'transferee' ? 'Transferee' : '';

            const isSameAddress = document.getElementById(`enroll-same-address${suffix}`)?.checked;
            const currentAddress = `${getValue('enroll-curr-house')}, ${getValue('enroll-curr-sitio')}, ${getValue('enroll-curr-barangay')}, ${getValue('enroll-curr-city')}, ${getValue('enroll-curr-province')}, ${getValue('enroll-curr-zip')}, ${getValue('enroll-curr-country')}`;
            const permanentAddress = `${getValue('enroll-perm-house')}, ${getValue('enroll-perm-sitio')}, ${getValue('enroll-perm-barangay')}, ${getValue('enroll-perm-city')}, ${getValue('enroll-perm-province')}, ${getValue('enroll-perm-zip')}, ${getValue('enroll-perm-country')}`;

            const lastName = getValue('enroll-lastname');
            const firstName = getValue('enroll-firstname');
            const middleName = getValue('enroll-middlename');
            const extension = getValue('enroll-extension');
            const fullName = `${lastName}, ${firstName}${middleName ? ' ' + middleName : ''}${extension ? ' ' + extension : ''}`;

            const items = [
                { label: 'Enrollment Type', value: typeLabel },
                { label: 'Full Name', value: fullName },
                { label: 'Birthdate', value: getValue('enroll-birthdate') },
                { label: 'Age', value: getValue('enroll-age') },
                { label: 'Sex', value: getValue('enroll-sex').toUpperCase() },
                { label: 'Mother Tongue', value: getValue('enroll-mother-tongue') },
                { label: 'Religion', value: getValue('enroll-religion') },
                { label: 'IP Member', value: getValue('enroll-ip') === 'yes' ? `Yes (${getValue('enroll-ip-specify')})` : 'No' },
                { label: 'Disability', value: getValue('enroll-disability') === 'yes' ? `Yes (${getValue('enroll-disability-type')})` : 'No' },
                { label: 'LRN', value: getValue('enroll-lrn') },
                { label: 'PSA No.', value: getValue('enroll-psa') },
                { 
                    label: isSameAddress ? 'Current & Permanent Address' : 'Current Address', 
                    value: currentAddress 
                }
            ];

            items.push(
                { label: 'Permanent Address', value: permanentAddress },
                { label: 'Mother\'s Maiden Name', value: getValue('enroll-mother') },
                { label: 'Father\'s Name', value: getValue('enroll-father') },
                { label: 'Guardian', value: getValue('enroll-guardian') || 'N/A' },
                { label: 'Contact No.', value: getValue('enroll-guardian-contact') },
                { label: '4Ps ID', value: getValue('enroll-4ps') || 'N/A' },
                { label: 'Data Privacy Agreement', value: document.getElementById(`enroll-agreement${suffix}`)?.checked ? 'Accepted' : 'Not Accepted' }
            );

            if (type === 'grade7') items.push({ label: 'Elementary School Graduated', value: getValue('enroll-elem-school') });
            if (type === 'grade11') items.push({ label: 'SHS Track/Strand', value: getValue('enroll-track') });
            if (type === 'transferee') {
                items.push({ label: 'Previous School ID', value: getValue('enroll-prev-school-id') });
                items.push({ label: 'Previous School Address', value: getValue('enroll-prev-school-address') });
                items.push({ label: 'Previous School Last Attended', value: getValue('enroll-prev-school-last-attended') });
            }

            reviewEl.innerHTML = items.map(item => `
                <div class="enroll-review-item">
                    <span>${item.label}</span>
                    <strong>${item.value || '—'}</strong>
                </div>
            `).join('');
        }

        async function submitFormWithFiles() {
            const formData = new FormData();
            
            // FormSubmit.co configurations
            const lastName = getValue('enroll-lastname');
            const firstName = getValue('enroll-firstname');
            const type = enrollmentTypeEl.value;
            const context = form.getAttribute('data-context') || 'jhs';
            
            let subjectType = type;
            if (type === 'transferee') {
                subjectType = `Transferee (${context.toUpperCase()})`;
            } else if (type === 'grade7') {
                subjectType = 'Grade 7';
            } else if (type === 'grade11') {
                subjectType = 'Grade 11';
            }

            formData.append('_subject', `New Enrollment: ${lastName}, ${firstName} - ${subjectType}`);
            formData.append('_template', 'table');
            formData.append('_captcha', 'false');
            formData.append('_honey', ''); // Anti-spam field

            // FormSubmit.co endpoint
            const endpoint = `https://formsubmit.co/upperlabay.nhs@deped.gov.ph`;

            // Add all form fields using their 'name' attribute
            const allInputs = Array.from(form.querySelectorAll('input, select, textarea'));
            
            allInputs.forEach(field => {
                if (!field.name) return;
                
                // Skip hidden containers' fields (like optional IP or disability details)
                if (field.closest('[hidden]')) return;

                if (field.type === 'file') {
                    if (field.files && field.files.length > 0) {
                        formData.append(field.name, field.files[0]);
                    }
                } else if (field.type === 'checkbox') {
                    if (field.checked) formData.append(field.name, 'Accepted');
                } else if (field.value) {
                    formData.append(field.name, field.value);
                }
            });

            const response = await fetch(endpoint, {
                method: 'POST',
                body: formData,
                headers: {
                    'Accept': 'application/json'
                }
            });

            const result = await response.json().catch(() => ({}));

            if (!response.ok) {
                const errorMsg = result.message || 'Form submission failed.';
                throw new Error(errorMsg);
            }
        }

        function showThanks() {
            try {
                if (isModal) {
                    const modal = document.getElementById('enrollment-form-modal');
                    if (modal) modal.hidden = true;
                }
                
                // Ensure thanks modal exists
                let modal = document.getElementById('enroll-thanks-modal');
                if (!modal) {
                    injectThanksModal();
                    modal = document.getElementById('enroll-thanks-modal');
                    if (!modal) {
                        alert('Enrollment Submitted Successfully!');
                        return;
                    }
                }

                // Re-attach close button handler to ensure it works
                const closeBtn = modal.querySelector('#enroll-thanks-close');
                if (closeBtn) {
                    closeBtn.onclick = () => {
                        modal.hidden = true;
                        modal.style.display = 'none';
                        modal.style.zIndex = '';
                    };
                }
                modal.onclick = (e) => {
                    if (e.target === modal) {
                        modal.hidden = true;
                        modal.style.display = 'none';
                        modal.style.zIndex = '';
                    }
                };

                const type = enrollmentTypeEl.value;
                const context = form.getAttribute('data-context') || 'jhs'; // Default to jhs
                const titleEl = modal.querySelector('#enroll-thanks-title');
                const messageEl = modal.querySelector('#enroll-thanks-message');

                if (titleEl) titleEl.textContent = 'Enrollment Submitted Successfully!';
                if (messageEl) {
                    if (type === 'grade7') {
                        messageEl.textContent = 'Your JHS enrollment details have been successfully submitted. Please prepare your required documents: SF9, SF10, and PSA Birth Certificate. Supplementary documents—like your Grade 6 Certificate of Completion and Good Moral Character—may be requested during the first week of classes. Kindly wait for further school announcements.';
                    } else if (type === 'grade11') {
                        messageEl.textContent = 'Your SHS enrollment details have been successfully submitted. Please prepare your required documents: SF9, SF10, and PSA Birth Certificate. Supplementary documents—like your Grade 10 Certificate of Completion and Good Moral Character—may be requested during the first week of classes. Kindly wait for further school announcements.';
                    } else if (type === 'transferee') {
                        const level = context === 'shs' ? 'SHS' : 'JHS';
                        messageEl.textContent = `Your ${level} enrollment details as a transferee have been successfully submitted. Please prepare your required documents: SF9 (Report Card), SF10 (Permanent Record), and PSA Birth Certificate. Kindly wait for further instructions and school announcements.`;
                    } else {
                        messageEl.textContent = 'Your enrollment confirmation details have been successfully submitted. We are delighted to have you remain a part of our school community!';
                    }
                }

                // Force display with inline styles that override CSS
                modal.hidden = false;
                modal.style.display = 'flex';
                modal.style.zIndex = '9999';
            } catch (err) {
                console.error('Error in showThanks:', err);
                alert('Enrollment Submitted Successfully!');
            }
        }

        function hideThanks() {
            const modal = document.getElementById('enroll-thanks-modal');
            if (modal) {
                modal.hidden = true;
                modal.style.display = 'none';
                modal.style.zIndex = '';
            }
        }

        enrollmentTypeEl.addEventListener('change', () => {
            updateConditionalVisibility(enrollmentTypeEl.value);
            if (currentStep === totalSteps) updateReview();

            // Auto-check agreement when enrollment type is selected (shows intent)
            const agreementCheckbox = document.getElementById(`enroll-agreement${suffix}`);
            if (agreementCheckbox && enrollmentTypeEl.value) {
                agreementCheckbox.checked = true;
            }
        });

        btnPrev.addEventListener('click', () => {
            if (currentStep > 1) showStep(currentStep - 1);
        });

        btnNext.addEventListener('click', () => {
            if (!validateStep(currentStep)) return;
            if (currentStep < totalSteps) showStep(currentStep + 1);
        });

        // Explicitly handle the submit button click as well
        btnSubmit.addEventListener('click', (e) => {
            console.log('Submit button clicked directly');
            handleSubmission();
        });

        // Form submit event
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            console.log('Form submit event fired');
            handleSubmission();
        });

        async function handleSubmission() {
            if (btnSubmit.disabled) return;
            
            console.log('Starting handleSubmission sequence...');
            clearError();
            
            if (!validateStep(currentStep)) {
                console.warn('Validation failed at step:', currentStep);
                return;
            }

            btnSubmit.disabled = true;
            const originalText = btnSubmit.textContent;
            btnSubmit.textContent = 'Submitting...';

            try {
                console.log('Calling FormSubmit.co API...');
                await submitFormWithFiles();
                console.log('API Response: Success');
                
                showThanks();
                
                form.reset();
                updateConditionalVisibility('');
                showStep(1);
            } catch (err) {
                console.error('Submission Error:', err);
                setError(err.message || 'Submission failed. Please try again.');
            } finally {
                btnSubmit.disabled = false;
                btnSubmit.textContent = originalText;
            }
        }

        updateConditionalVisibility('');
        showStep(1);
    }

    async function loadEnrollmentJHS(dataPath) {
        try {
            const res = await fetch(`${dataPath}pages/enrollment-jhs.json`);
            const data = await res.json();

            const banner = document.querySelector('.page-banner');
            if (banner) {
                banner.innerHTML = `
                    <h1>${data.banner.title}</h1>
                    <p>${data.banner.subtitle}</p>
                `;
            }

            const optionsGrid = document.querySelector('.section-container .grid');
            if (optionsGrid) {
                optionsGrid.innerHTML = data.options.map((opt, i) => {
                    let buttonsHtml = '';
                    if (opt.buttons) {
                        buttonsHtml = opt.buttons.map(btn => `
                            <a href="${btn.link}" 
                               ${btn.is_download ? 'download' : ''} 
                               ${btn.trigger ? `data-enroll-trigger="${btn.trigger}"` : 'target="_blank"'}
                               class="btn ${btn.class || ''} mt-1">${btn.text}</a>
                        `).join('');
                    } else {
                        buttonsHtml = `
                            <a href="${opt.link}" 
                               ${opt.is_download ? 'download' : ''} 
                               ${!opt.is_download && opt.link.includes('forms.gle') ? 'data-enroll-trigger="grade7"' : 'target="_blank"'}
                               class="btn ${opt.is_download ? 'mt-1' : ''}">${opt.btn_text}</a>
                        `;
                    }

                    return `
                        <div class="card reveal reveal-bottom delay-${i + 1}">
                            <div class="card-icon">${opt.icon}</div>
                            <h3>${opt.title}</h3>
                            <p>${opt.description}</p>
                            ${opt.note ? `<p><strong>Note:</strong> ${opt.note}</p>` : ''}
                            <div class="enroll-btn-group">
                                ${buttonsHtml}
                            </div>
                            ${opt.is_download ? `<p class="mt-1 opacity-8">Print and fill out before visiting the school office.</p>` : ''}
                        </div>
                    `;
                }).join('');

                setupEnrollmentTriggers();
            }

            const reqContainer = document.querySelector('.req-container');
            if (reqContainer) {
                reqContainer.innerHTML = `
                    <h2 class="section-title">${data.requirements.title}</h2>
                    <p>${data.requirements.subtitle}</p>
                    <div class="req-grid">
                        ${data.requirements.items.map((item, i) => `
                            <div class="req-item reveal reveal-left delay-${i + 2}">
                                <span class="check">✔</span>
                                <div>
                                    <h4>${item.title}</h4>
                                    <p>${item.description}</p>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `;
            }

            initScrollReveal();
        } catch (err) { console.error("Error loading JHS enrollment data:", err); }
    }

    async function loadEnrollmentSHS(dataPath) {
        try {
            const res = await fetch(`${dataPath}pages/enrollment-shs.json`);
            const data = await res.json();

            const banner = document.querySelector('.page-banner');
            if (banner) {
                banner.innerHTML = `
                    <h1>${data.banner.title}</h1>
                    <p>${data.banner.subtitle}</p>
                `;
            }

            const optionsGrid = document.querySelector('.section-container .grid');
            if (optionsGrid) {
                optionsGrid.innerHTML = data.options.map((opt, i) => {
                    let buttonsHtml = '';
                    if (opt.buttons) {
                        buttonsHtml = opt.buttons.map(btn => `
                            <a href="${btn.link}" 
                               ${btn.is_download ? 'download' : ''} 
                               ${btn.trigger ? `data-enroll-trigger="${btn.trigger}"` : 'target="_blank"'}
                               class="btn ${btn.class || ''} mt-1">${btn.text}</a>
                        `).join('');
                    } else {
                        buttonsHtml = `
                            <a href="${opt.link}" 
                               ${opt.link && opt.link.includes('forms.gle') ? 'data-enroll-trigger="grade11"' : 'target="_blank"'}
                               class="btn mt-1">${opt.btn_text}</a>
                        `;
                    }

                    return `
                        <div class="card reveal reveal-bottom delay-${i + 1}">
                            <div class="card-icon">${opt.icon}</div>
                            <h3>${opt.title}</h3>
                            <p>${opt.description}</p>
                            ${opt.note ? `<p>${opt.note}</p>` : ''}
                            <div class="enroll-btn-group">
                                ${buttonsHtml}
                            </div>
                        </div>
                    `;
                }).join('');

                setupEnrollmentTriggers();
            }

            const reqContainer = document.querySelector('.req-container');
            if (reqContainer) {
                reqContainer.innerHTML = `
                    <h2 class="section-title">${data.requirements.title}</h2>
                    <p>${data.requirements.subtitle}</p>
                    <div class="req-grid">
                        ${data.requirements.items.map((item, i) => `
                            <div class="req-item reveal reveal-left delay-${i + 2}">
                                <span class="check">✔</span>
                                <div>
                                    <h4>${item.title}</h4>
                                    <p>${item.description}</p>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `;
            }

            initScrollReveal();
        } catch (err) { console.error("Error loading SHS enrollment data:", err); }
    }

    async function loadAcademicsJHS(dataPath) {
        try {
            const res = await fetch(`${dataPath}pages/academics-jhs.json`);
            const data = await res.json();

            const banner = document.querySelector('.page-banner');
            if (banner) {
                banner.innerHTML = `
                    <h1>${data.banner.title}</h1>
                    <p>${data.banner.subtitle}</p>
                `;
            }

            const intro = document.querySelector('.intro-text');
            if (intro) {
                intro.innerHTML = `
                    <h2 class="accent-title">${data.intro.title}</h2>
                    <p>${data.intro.description}</p>
                `;
            }

            const cardsGrid = document.querySelector('.section-container .grid');
            if (cardsGrid) {
                cardsGrid.innerHTML = data.cards.map((card, i) => `
                    <div class="card reveal reveal-bottom delay-${i + 2}">
                        <div class="card-icon">${card.icon}</div>
                        <h3>${card.title}</h3>
                        <p>${card.description}</p>
                    </div>
                `).join('');
            }

            initScrollReveal();
        } catch (err) { console.error("Error loading JHS academics data:", err); }
    }

    async function loadAcademicsSHS(dataPath) {
        try {
            const res = await fetch(`${dataPath}pages/academics-shs.json`);
            const data = await res.json();

            const banner = document.querySelector('.page-banner');
            if (banner) {
                banner.innerHTML = `
                    <h1>${data.banner.title}</h1>
                    <p>${data.banner.subtitle}</p>
                `;
            }

            const intro = document.querySelector('.intro-text');
            if (intro) {
                intro.innerHTML = `
                    <h2 class="accent-title">${data.intro.title}</h2>
                    <p>${data.intro.description}</p>
                `;
            }

            const container = document.querySelector('.section-container.reveal.reveal-bottom');
            if (container) {
                // Clear existing dynamic tiers if any, but keep the intro-text
                const introText = container.querySelector('.intro-text');
                container.innerHTML = '';
                if (introText) container.appendChild(introText);

                data.tiers.forEach((tier, i) => {
                    const tierDiv = document.createElement('div');
                    tierDiv.className = `curriculum-tier reveal reveal-bottom delay-${(i * 3) + 2} ${i > 0 ? 'mt-4' : ''}`;
                    tierDiv.innerHTML = `
                        <h3 class="tier-title">${tier.title}</h3>
                        <p class="tier-desc">${tier.description}</p>
                        <div class="grid">
                            ${tier.cards.map((card, j) => `
                                <div class="card reveal reveal-${j === 0 ? 'left' : 'right'} delay-${(i * 3) + j + 3}">
                                    <div class="card-icon">${card.icon}</div>
                                    <h3>${card.title}</h3>
                                    <p>${card.description}</p>
                                </div>
                            `).join('')}
                        </div>
                    `;
                    container.appendChild(tierDiv);
                });
            }

            initScrollReveal();
        } catch (err) { console.error("Error loading SHS academics data:", err); }
    }

    async function loadBeadworkPage(dataPath) {
        try {
            const res = await fetch(`${dataPath}pages/slt-beadwork.json`);
            const data = await res.json();

            const banner = document.querySelector('.page-banner');
            if (banner) {
                banner.innerHTML = `
                    <h1>${data.banner.title}</h1>
                    <p>${data.banner.subtitle}</p>
                `;
            }

            const processSection = document.querySelector('.section-container.reveal.reveal-bottom');
            if (processSection) {
                processSection.innerHTML = `
                    <h2 class="section-title reveal reveal-bottom delay-1">${data.process.title}</h2>
                    <p class="section-subtitle reveal reveal-bottom delay-2">${data.process.subtitle}</p>
                    <div class="step-container">
                        ${data.process.steps.map((step, i) => `
                            <div class="step-item reveal reveal-${i % 2 === 0 ? 'left' : 'right'} delay-${i + 3}">
                                ${i % 2 === 0 ? `
                                    <div class="step-number">${step.id}</div>
                                    <div class="step-content">
                                        <div class="dict-word-row">
                                            <h3>${step.title}</h3>
                                            ${step.audio ? `<button class="audio-btn" data-src="${step.audio}" aria-label="Play">▶</button>` : ''}
                                        </div>
                                        <p>${step.description}</p>
                                    </div>
                                ` : `
                                    <div class="step-content text-right">
                                        <div class="dict-word-row" style="justify-content: flex-end; gap: 15px;">
                                            ${step.audio ? `<button class="audio-btn" data-src="${step.audio}" aria-label="Play">▶</button>` : ''}
                                            <h3>${step.title}</h3>
                                        </div>
                                        <p>${step.description}</p>
                                    </div>
                                    <div class="step-number">${step.id}</div>
                                `}
                            </div>
                        `).join('')}
                    </div>
                `;
            }

            const gallerySection = document.querySelector('.gallery-section');
            if (gallerySection) {
                gallerySection.innerHTML = `
                    <h2 class="section-title reveal reveal-bottom delay-1">${data.gallery.title}</h2>
                    <p class="section-subtitle reveal reveal-bottom delay-2">${data.gallery.subtitle}</p>
                    <div class="gallery-grid">
                        ${data.gallery.photos.map((photo, i) => `
                            <div class="gallery-item reveal reveal-bottom delay-${i + 3}">
                                <img src="${photo.src}" alt="${photo.alt}">
                            </div>
                        `).join('')}
                    </div>
                `;
            }

            // Audio logic for beadwork page
            const audio = new Audio();
            document.querySelectorAll('.audio-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const src = btn.getAttribute('data-src');
                    if (!src) return;
                    if (audio.src !== src) audio.src = src;
                    audio.play().catch(() => {});
                });
            });

            initScrollReveal();
        } catch (err) { console.error("Error loading beadwork data:", err); }
    }

    loadDynamicContent();
});

/* --- OPEN CALENDAR IN NEW TAB --- */
function openFullscreen() {
    // Determine the correct path based on current location
    const root = getRootPath();
    const fileUrl = root + "assets/documents/school-calendar.webp";
    window.open(fileUrl, '_blank');
}

/* --- ADMIN & ID GENERATOR LOGIC --- */
function setupAdminLogic() {
    const loginForm = document.getElementById('login-form');
    if (loginForm) initAdminLogin();

    const idForm = document.getElementById('id-form');
    if (idForm) initIDGenerator();
}

async function initAdminLogin() {
    async function sha256(message) {
        const msgBuffer = new TextEncoder().encode(message);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    const targetHash = 'ac9689e2272427085e35b9d3e3e8bed88cb3434828b43b86fc0596cad4c6e270'; //password_hash

    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const pwd = document.getElementById('password').value.trim();
        const hash = await sha256(pwd);

        if (hash === targetHash) {
            sessionStorage.setItem('adminLoggedIn', 'true');
            window.location.href = 'id-gen.html';
        } else {
            const errorMsg = document.getElementById('error-msg');
            if (errorMsg) errorMsg.style.display = 'block';
        }
    });
}

async function initIDGenerator() {
    const video = document.getElementById('webcam-video');
    const capturedPhoto = document.getElementById('captured-photo');
    const btnCapture = document.getElementById('btn-capture');
    const btnUpload = document.getElementById('btn-upload');
    const fileInput = document.getElementById('file-input');
    const btnRetake = document.getElementById('btn-retake');
    const addressSelect = document.getElementById('address-select');
    const addressManual = document.getElementById('address-manual');
    const birthdateInput = document.getElementById('birthdate');
    const birthdateError = document.getElementById('birthdate-error');
    const removeBgToggle = document.getElementById('remove-bg-toggle');
    const processingOverlay = document.getElementById('processing-overlay');

    // Image Editor Elements
    const editorModal = document.getElementById('editor-modal');
    const editorImage = document.getElementById('editor-image');
    const btnRotateLeft = document.getElementById('btn-rotate-left');
    const btnRotateRight = document.getElementById('btn-rotate-right');
    const rotateArbitrary = document.getElementById('rotate-arbitrary');
    const rotateVal = document.getElementById('rotate-val');
    const btnCancelEdit = document.getElementById('btn-cancel-edit');
    const btnApplyEdit = document.getElementById('btn-apply-edit');
    let cropper;

    // Initialize Selfie Segmentation
    let selfieSegmentation;
    if (typeof SelfieSegmentation !== 'undefined') {
        selfieSegmentation = new SelfieSegmentation({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`
        });
        selfieSegmentation.setOptions({
            modelSelection: 0,
            selfieMode: false,
        });
    }

    if (birthdateInput) {
        birthdateInput.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length > 2 && value.length <= 4) {
                value = value.slice(0, 2) + '-' + value.slice(2);
            } else if (value.length > 4) {
                value = value.slice(0, 2) + '-' + value.slice(2, 4) + '-' + value.slice(4, 8);
            }
            e.target.value = value;

            if (value.length === 10) {
                if (isValidDate(value)) {
                    if (birthdateError) birthdateError.style.display = 'none';
                    birthdateInput.style.borderColor = '';
                } else {
                    if (birthdateError) birthdateError.style.display = 'block';
                    birthdateInput.style.borderColor = 'var(--madder-red)';
                }
            } else {
                if (birthdateError) birthdateError.style.display = 'none';
                birthdateInput.style.borderColor = '';
            }
        });
    }

    if (addressSelect) {
        addressSelect.addEventListener('change', () => {
            if (addressSelect.value === 'others') {
                addressManual.style.display = 'block';
                addressManual.required = true;
            } else {
                addressManual.style.display = 'none';
                addressManual.required = false;
            }
        });
    }

    async function initWebcam() {
        if (!video) return;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { aspectRatio: 3/4 } });
            video.srcObject = stream;
        } catch (err) {
            console.error("Error accessing webcam:", err);
        }
    }

    if (btnCapture) {
        btnCapture.addEventListener('click', async () => {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = video.videoWidth;
            tempCanvas.height = video.videoHeight;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(video, 0, 0);
            openEditor(tempCanvas.toDataURL('image/webp'));
        });
    }

    if (btnUpload) {
        btnUpload.addEventListener('click', () => fileInput.click());
    }

    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => openEditor(event.target.result);
            reader.readAsDataURL(file);
        });
    }

    function openEditor(imageSrc) {
        if (!editorImage || !editorModal) return;
        editorImage.src = imageSrc;
        editorModal.style.display = 'block';
        if (cropper) cropper.destroy();
        cropper = new Cropper(editorImage, {
            aspectRatio: 3/4,
            viewMode: 1,
            dragMode: 'move',
            autoCropArea: 1,
            restore: false,
            guides: true,
            center: true,
            highlight: false,
            cropBoxMovable: true,
            cropBoxResizable: true,
            toggleDragModeOnDblclick: false,
        });
        if (rotateArbitrary) rotateArbitrary.value = 0;
        if (rotateVal) rotateVal.textContent = 0;
    }

    if (btnRotateLeft) btnRotateLeft.addEventListener('click', () => cropper && cropper.rotate(-90));
    if (btnRotateRight) btnRotateRight.addEventListener('click', () => cropper && cropper.rotate(90));
    
    if (rotateArbitrary) {
        rotateArbitrary.addEventListener('input', (e) => {
            const val = e.target.value;
            if (rotateVal) rotateVal.textContent = val;
            if (cropper) cropper.rotateTo(val);
        });
    }

    if (btnCancelEdit) {
        btnCancelEdit.addEventListener('click', () => {
            editorModal.style.display = 'none';
            if (cropper) cropper.destroy();
        });
    }

    if (btnApplyEdit) {
        btnApplyEdit.addEventListener('click', async () => {
            const canvas = cropper.getCroppedCanvas({
                width: 600,
                height: 800,
                imageSmoothingEnabled: true,
                imageSmoothingQuality: 'high',
            });
            editorModal.style.display = 'none';
            if (cropper) cropper.destroy();
            await processImage(canvas);
        });
    }

    window.addEventListener('click', (e) => {
        if (e.target === editorModal) {
            editorModal.style.display = 'none';
            if (cropper) cropper.destroy();
        }
    });

    async function processImage(sourceCanvas) {
        if (processingOverlay) processingOverlay.style.display = 'flex';

        if (removeBgToggle && removeBgToggle.checked && selfieSegmentation) {
            selfieSegmentation.onResults((results) => {
                const canvas = document.createElement('canvas');
                canvas.width = results.image.width;
                canvas.height = results.image.height;
                const ctx = canvas.getContext('2d');
                ctx.save();
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.filter = 'blur(2px)';
                ctx.drawImage(results.segmentationMask, 0, 0, canvas.width, canvas.height);
                ctx.globalCompositeOperation = 'source-in';
                ctx.filter = 'none';
                ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
                ctx.restore();

                const shadowCanvas = document.createElement('canvas');
                shadowCanvas.width = canvas.width;
                shadowCanvas.height = canvas.height;
                const shadowCtx = shadowCanvas.getContext('2d');
                shadowCtx.filter = 'drop-shadow(0 0 5px rgba(0,0,0,0.2))';
                shadowCtx.drawImage(canvas, 0, 0);

                const enhancedCanvas = enhanceImage(shadowCanvas);
                capturedPhoto.src = enhancedCanvas.toDataURL('image/webp', 0.9);
                finishCapture();
            });
            await selfieSegmentation.send({ image: sourceCanvas });
        } else {
            const enhancedCanvas = enhanceImage(sourceCanvas);
            capturedPhoto.src = enhancedCanvas.toDataURL('image/webp', 0.9);
            finishCapture();
        }
    }

    function finishCapture() {
        if (capturedPhoto) capturedPhoto.style.display = 'block';
        if (video) video.style.display = 'none';
        if (btnCapture) btnCapture.style.display = 'none';
        if (btnUpload) btnUpload.style.display = 'none';
        if (btnRetake) btnRetake.style.display = 'inline-block';
        if (processingOverlay) processingOverlay.style.display = 'none';
    }

    function enhanceImage(sourceCanvas) {
        const width = sourceCanvas.width;
        const height = sourceCanvas.height;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, width, height);
        ctx.filter = 'contrast(1.08) saturate(1.05) brightness(1.02)';
        ctx.drawImage(sourceCanvas, 0, 0);
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        const sharpenMatrix = [0, -0.5, 0, -0.5, 3, -0.5, 0, -0.5, 0];
        const side = Math.round(Math.sqrt(sharpenMatrix.length));
        const halfSide = Math.floor(side/2);
        const output = ctx.createImageData(width, height);
        const outputData = output.data;
        for (let y=0; y<height; y++) {
            for (let x=0; x<width; x++) {
                const sy = y, sx = x, dstOff = (y*width+x)*4;
                let r=0, g=0, b=0, a=0;
                for (let cy=0; cy<side; cy++) {
                    for (let cx=0; cx<side; cx++) {
                        const scy = sy + cy - halfSide, scx = sx + cx - halfSide;
                        if (scy >= 0 && scy < height && scx >= 0 && scx < width) {
                            const srcOff = (scy*width+scx)*4, wt = sharpenMatrix[cy*side+cx];
                            r += data[srcOff] * wt; g += data[srcOff+1] * wt; b += data[srcOff+2] * wt; a += data[srcOff+3] * wt;
                        }
                    }
                }
                outputData[dstOff] = r; outputData[dstOff+1] = g; outputData[dstOff+2] = b; outputData[dstOff+3] = data[dstOff+3];
            }
        }
        ctx.putImageData(output, 0, 0);
        return canvas;
    }

    if (btnRetake) {
        btnRetake.addEventListener('click', () => {
            capturedPhoto.style.display = 'none';
            video.style.display = 'block';
            btnCapture.style.display = 'inline-block';
            btnUpload.style.display = 'inline-block';
            btnRetake.style.display = 'none';
            if (fileInput) fileInput.value = '';
        });
    }

    initWebcam();

    // Canvas Generation
    const canvasFront = document.getElementById('canvas-front');
    const canvasBack = document.getElementById('canvas-back');
    if (!canvasFront || !canvasBack) return;

    const ctxFront = canvasFront.getContext('2d');
    const ctxBack = canvasBack.getContext('2d');
    const imgFront = new Image();
    const imgBack = new Image();
    imgFront.src = '../../assets/admin/id-front.webp';
    imgBack.src = '../../assets/admin/id-back.webp';

    const btnGenerate = document.getElementById('btn-generate');
    if (btnGenerate) {
        btnGenerate.addEventListener('click', async () => {
            const form = document.getElementById('id-form');
            if (!form.checkValidity()) { form.reportValidity(); return; }
            if (capturedPhoto.style.display === 'none') { alert("Please capture a student photo first."); return; }

            const firstname = document.getElementById('firstname').value.toUpperCase();
            const miVal = document.getElementById('mi').value.trim();
            const mi = miVal ? (miVal.endsWith('.') ? miVal.toUpperCase() : miVal.toUpperCase() + '.') : "";
            const lastname = document.getElementById('lastname').value.toUpperCase();
            const lrn = document.getElementById('lrn').value;
            const birthdate = birthdateInput.value;

            if (!isValidDate(birthdate)) {
                if (birthdateError) birthdateError.style.display = 'block';
                birthdateInput.style.borderColor = 'var(--madder-red)';
                alert("Invalid birthdate. Please use mm-dd-yyyy format and ensure the date exists.");
                birthdateInput.focus();
                return;
            }

            const colorName = "#0ff184", colorLRN = "#a52a2a", colorBirthdate = "#2980b9";
            const fontIdDetails = "Acme", baseFontSize = 28;

            ctxFront.drawImage(imgFront, 0, 0, 600, 960);
            const photoX = 8.09, photoY = 312.99, photoW = 272.54 - 8.09, photoH = 646.68 - 312.99;
            const photoImg = new Image();
            photoImg.onload = async () => {
                const borderRadius = 15, borderWidth = 6, borderColor = "#2980b9";
                ctxFront.save();
                ctxFront.beginPath(); ctxFront.roundRect(photoX, photoY, photoW, photoH, borderRadius); ctxFront.clip();
                ctxFront.drawImage(photoImg, photoX, photoY, photoW, photoH);
                ctxFront.restore();
                ctxFront.strokeStyle = borderColor; ctxFront.lineWidth = borderWidth;
                ctxFront.beginPath(); ctxFront.roundRect(photoX, photoY, photoW, photoH, borderRadius); ctxFront.stroke();

                ctxFront.textAlign = "left"; ctxFront.strokeStyle = "black"; ctxFront.lineWidth = 10; ctxFront.lineJoin = "round";
                const maxWidthFront = 280;
                ctxFront.fillStyle = colorName;
                const nameFontSize = drawAutoScaledText(ctxFront, firstname, 280.89, 367.15, maxWidthFront, baseFontSize, fontIdDetails, "bold", true);
                drawAutoScaledText(ctxFront, mi, 284.03, 401.71, maxWidthFront, nameFontSize, fontIdDetails, "bold", true);
                drawAutoScaledText(ctxFront, lastname, 285.61, 439.05, maxWidthFront, nameFontSize, fontIdDetails, "bold", true);
                ctxFront.fillStyle = colorLRN;
                drawAutoScaledText(ctxFront, lrn, 348.44, 540.73, maxWidthFront, baseFontSize, fontIdDetails, "bold", true);
                ctxFront.fillStyle = colorBirthdate;
                drawAutoScaledText(ctxFront, birthdate, 346.08, 633.41, maxWidthFront, baseFontSize, fontIdDetails, "bold", true);

                const qrX = 178.29, qrY = 689.10, qrW = 420.99 - 178.29, qrH = 932.58 - 689.10;
                const qrData = `NAME: ${firstname} ${mi} ${lastname}\nLRN: ${lrn}`;
                try {
                    const qrUrl = await QRCode.toDataURL(qrData, { margin: 1, width: 300 });
                    const qrImg = new Image();
                    qrImg.onload = () => {
                        ctxFront.drawImage(qrImg, qrX, qrY, qrW, qrH);
                        const btnDownloadFront = document.getElementById('btn-download-front');
                        if (btnDownloadFront) btnDownloadFront.disabled = false;
                    };
                    qrImg.src = qrUrl;
                } catch (err) { console.error("QR Error:", err); }
            };
            photoImg.src = capturedPhoto.src;

            ctxBack.drawImage(imgBack, 0, 0, 600, 960);
            ctxBack.fillStyle = "#000"; ctxBack.textAlign = "left"; 
            const backFont = "bold 24px Acme";
            ctxBack.font = backFont;
            ctxBack.fillText(document.getElementById('guardian').value, 185, 552);
            const address = addressSelect.value === 'others' ? addressManual.value : addressSelect.value;
            wrapText(ctxBack, address, 185, 627, 350, 28, backFont);
            const mobile = document.getElementById('parent-mobile').value || "N/A";
            ctxBack.font = backFont;
            ctxBack.fillText(mobile, 185, 719);
            const btnDownloadBack = document.getElementById('btn-download-back');
            if (btnDownloadBack) btnDownloadBack.disabled = false;
        });
    }

    function drawAutoScaledText(ctx, text, x, y, maxWidth, baseSize, font, weight = "normal", stroke = false) {
        let fontSize = baseSize;
        ctx.font = `${weight} ${fontSize}px ${font}`;
        let textWidth = ctx.measureText(text).width;
        while (textWidth > maxWidth && fontSize > 10) {
            fontSize -= 1; ctx.font = `${weight} ${fontSize}px ${font}`; textWidth = ctx.measureText(text).width;
        }
        if (stroke) ctx.strokeText(text, x, y);
        ctx.fillText(text, x, y);
        return fontSize;
    }

    function isValidDate(dateStr) {
        const parts = dateStr.split("-");
        if (parts.length !== 3) return false;
        const m = parseInt(parts[0], 10), d = parseInt(parts[1], 10), y = parseInt(parts[2], 10);
        const date = new Date(y, m - 1, d);
        return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
    }

    function wrapText(context, text, x, y, maxWidth, lineHeight, font) {
        if (font) context.font = font;
        const words = text.split(' ');
        let line = '';
        for (let n = 0; n < words.length; n++) {
            let testLine = line + words[n] + ' ';
            let metrics = context.measureText(testLine);
            if (metrics.width > maxWidth && n > 0) {
                context.fillText(line, x, y); line = words[n] + ' '; y += lineHeight;
            } else { line = testLine; }
        }
        context.fillText(line, x, y);
    }

    const btnDownloadFront = document.getElementById('btn-download-front');
    if (btnDownloadFront) {
        btnDownloadFront.addEventListener('click', () => {
            const link = document.createElement('a');
            link.download = `ID-Front-${document.getElementById('lastname').value}.png`;
            link.href = canvasFront.toDataURL('image/png');
            link.click();
        });
    }

    const btnDownloadBack = document.getElementById('btn-download-back');
    if (btnDownloadBack) {
        btnDownloadBack.addEventListener('click', () => {
            const link = document.createElement('a');
            link.download = `ID-Back-${document.getElementById('lastname').value}.png`;
            link.href = canvasBack.toDataURL('image/png');
            link.click();
        });
    }
}

// Call setup on load
document.addEventListener('DOMContentLoaded', setupAdminLogic);
