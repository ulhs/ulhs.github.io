/**
 * Zipper Reveal Animation Component
 * Role: Senior Frontend Engineer & UI/UX Specialist
 * Tech Stack: GSAP for Animation, Vanilla JS for structure
 */

class ZipperReveal {
    constructor() {
        // 1. Accessibility Check: prefers-reduced-motion
        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (prefersReducedMotion) {
            console.log('Zipper Animation: Reduced motion preferred, skipping animation.');
            this.revealImmediately();
            return;
        }

        this.init();
    }

    init() {
        // Create the overlay container
        this.overlay = document.createElement('div');
        this.overlay.id = 'zipper-overlay';
        
        // Create left and right panels
        this.leftPanel = this.createPanel('left');
        this.rightPanel = this.createPanel('right');
        
        // Create "Teeth" for each panel
        this.createTeeth(this.leftPanel, true);
        this.createTeeth(this.rightPanel, false);
        
        // Add panels to overlay
        this.overlay.appendChild(this.leftPanel);
        this.overlay.appendChild(this.rightPanel);
        
        // Add overlay to body
        document.body.prepend(this.overlay);
        
        // Prepare hero reveal
        this.prepareHero();
        
        // Check if GSAP is loaded, if not, wait for it or load it
        if (typeof gsap === 'undefined') {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js';
            script.onload = () => this.startAnimation();
            document.head.appendChild(script);
        } else {
            this.startAnimation();
        }
    }

    createPanel(side) {
        const panel = document.createElement('div');
        panel.className = `zipper-panel ${side}`;
        return panel;
    }

    createTeeth(panel, isLeft) {
        const teethContainer = document.createElement('div');
        teethContainer.className = 'zipper-teeth-container';
        
        // Create teeth for the full height
        const teethCount = Math.ceil(window.innerHeight / 30); // Compact spacing
        for (let i = 0; i < teethCount; i++) {
            const tooth = document.createElement('div');
            tooth.className = 'tooth';
            teethContainer.appendChild(tooth);
        }
        
        panel.appendChild(teethContainer);
    }

    prepareHero() {
        const heroSection = document.getElementById('hero-section');
        if (heroSection) {
            heroSection.classList.add('hero-reveal');
        }
    }

    revealImmediately() {
        const heroSection = document.getElementById('hero-section');
        if (heroSection) {
            heroSection.style.opacity = '1';
            heroSection.style.transform = 'scale(1)';
        }
    }

    startAnimation() {
        // Use a small delay to ensure DOM is ready and content is loaded
        if (document.readyState === 'complete') {
            this.animate();
        } else {
            window.addEventListener('load', () => this.animate());
        }
    }

    animate() {
        // GSAP Timeline
        const tl = gsap.timeline({
            defaults: { ease: "power4.inOut", duration: 5.0 }
        });

        // 1. Staggered "Teeth" pull apart
        const leftTeeth = this.leftPanel.querySelectorAll('.tooth');
        const rightTeeth = this.rightPanel.querySelectorAll('.tooth');

        // Unzip from top downwards - slowed down for 5s feel
        tl.to(leftTeeth, {
            x: -40,
            stagger: {
                each: 0.08,
                from: "top"
            },
            opacity: 0,
            duration: 3.0
        }, 0);

        tl.to(rightTeeth, {
            x: 40,
            stagger: {
                each: 0.08,
                from: "top"
            },
            opacity: 0,
            duration: 3.0
        }, 0);

        // 2. Panels slide off-screen (The Reveal)
        tl.to(this.leftPanel, {
            x: '-100%',
            duration: 5.0,
            ease: "power4.inOut"
        }, 0.5);

        tl.to(this.rightPanel, {
            x: '100%',
            duration: 5.0,
            ease: "power4.inOut"
        }, 0.5);

        // 3. Hero Reveal with scale and opacity
        const heroSection = document.querySelector('.hero-reveal');
        if (heroSection) {
            tl.to(heroSection, {
                opacity: 1,
                scale: 1,
                duration: 3.0,
                ease: "power2.out"
            }, 2.0);
            
            // Hero Overlay (Text/Button) pops in at the end
            const heroOverlay = heroSection.querySelector('.hero-overlay');
            if (heroOverlay) {
                tl.from(heroOverlay, { 
                    y: 40, 
                    opacity: 0, 
                    duration: 2.0,
                    ease: "back.out(1.7)"
                }, 3.5);
            }
        }

        // 4. Cleanup: remove overlay to save memory
        tl.set(this.overlay, { display: 'none', onComplete: () => this.overlay.remove() });
    }
}

// Initializing the component
new ZipperReveal();
