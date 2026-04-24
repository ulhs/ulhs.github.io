document.addEventListener('DOMContentLoaded', () => {
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