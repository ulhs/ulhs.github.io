(function() {
    async function initVisitorCounter() {
        const counterEl = document.getElementById('visitor-count');
        if (!counterEl) return;

        try {
            // Using counterapi.dev - a free, reliable visitor counter API
            const response = await fetch('https://api.counterapi.dev/v1/ulhs-website/visits/up');
            const data = await response.json();
            
            if (data && data.count) {
                // Format number with commas (e.g., 1,234)
                counterEl.textContent = data.count.toLocaleString();
            } else {
                counterEl.textContent = '---';
            }
        } catch (err) {
            console.warn("Visitor counter failed:", err);
            counterEl.textContent = '---';
        }
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initVisitorCounter);
    } else {
        initVisitorCounter();
    }
})();