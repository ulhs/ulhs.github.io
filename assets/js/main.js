/* --- GLOBAL CHATBOT INITIALIZATION --- */
(function() {
    const isSubPage = window.location.pathname.includes('/pages/');
    const dataPath = isSubPage ? '../assets/data/' : 'assets/data/';
    let chatbotData = null;
    let dictionaryData = null;
    let aboutData = null;

    function injectChatbot() {
        if (document.getElementById('faq-bot-toggle')) return;
        if (!document.body) return;

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
            const root = isSubPage ? '../' : '';
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
        const isSubPage = window.location.pathname.includes('/pages/');
        const dataPath = isSubPage ? '../assets/data/' : 'assets/data/';
        const componentPath = isSubPage ? '../assets/components/' : 'assets/components/';
        const root = isSubPage ? '../' : '';

        // 0. Load Shared Components (Header/Footer)
        await loadSharedComponents(componentPath, root);

        // 2. Load Global Config (Footer, etc.)
        try {
            const configRes = await fetch(`${dataPath}config.json`);
            const config = await configRes.json();
            updateGlobalUI(config);
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

    function updateGlobalUI(config) {
        // Update Footer Social Links if they exist
        const fbLink = document.querySelector('.social-icon.fb')?.parentElement;
        const ytLink = document.querySelector('.social-icon.yt')?.parentElement;
        if (fbLink && config.social.facebook) fbLink.href = config.social.facebook;
        if (ytLink && config.social.youtube) ytLink.href = config.social.youtube;

        // Update Footer Navigation if it exists
        const footerNav = document.querySelector('.footer-nav ul');
        if (footerNav && config.footer_links) {
            footerNav.innerHTML = config.footer_links.map(link => 
                `<li><a href="${link.url}">${link.text}</a></li>`
            ).join('');
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
                optionsGrid.innerHTML = data.options.map((opt, i) => `
                    <div class="card reveal reveal-bottom delay-${i + 1}">
                        <div class="card-icon">${opt.icon}</div>
                        <h3>${opt.title}</h3>
                        <p>${opt.description}</p>
                        ${opt.note ? `<p><strong>Note:</strong> ${opt.note}</p>` : ''}
                        <a href="${opt.link}" ${opt.is_download ? 'download' : 'target="_blank"'} class="btn ${opt.is_download ? 'mt-1' : ''}">${opt.btn_text}</a>
                        ${opt.is_download ? `<p class="mt-1 opacity-8">Print and fill out before visiting the school office.</p>` : ''}
                    </div>
                `).join('');
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
                optionsGrid.innerHTML = data.options.map((opt, i) => `
                    <div class="card reveal reveal-bottom delay-${i + 1}">
                        <div class="card-icon">${opt.icon}</div>
                        <h3>${opt.title}</h3>
                        <p>${opt.description}</p>
                        ${opt.note ? `<p>${opt.note}</p>` : ''}
                        ${opt.link ? `<a href="${opt.link}" target="_blank" class="btn">${opt.btn_text}</a>` : ''}
                    </div>
                `).join('');
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
    const isSubPage = window.location.pathname.includes('/pages/');
    const fileUrl = isSubPage ? "../assets/documents/school-calendar.webp" : "assets/documents/school-calendar.webp";
    window.open(fileUrl, '_blank');
}

