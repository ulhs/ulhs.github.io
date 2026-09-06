(() => {
    const STORAGE_KEY = 'parentPortalLanguage';
    const DEFAULT_LANGUAGE = 'en';
    const supportedLanguages = ['ceb-en', 'en', 'fil'];
    const runtimeScriptUrl = document.currentScript?.src;
    const originalTextByNode = new WeakMap();
    const translatedTextByNode = new WeakMap();
    const originalAttributeValues = new WeakMap();
    const originalDocumentTitle = document.title;
    let translations = null;
    let currentLanguage = localStorage.getItem(STORAGE_KEY) || DEFAULT_LANGUAGE;
    let isApplyingTranslations = false;

    function getDictionary() {
        return translations?.[currentLanguage] || translations?.[DEFAULT_LANGUAGE] || {};
    }

    function translate(key, fallback = key) {
        return getDictionary()[key] || fallback;
    }

    function translateTextNodes(root = document) {
        const dictionary = getPhraseDictionary();
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const textNodes = [];
        let node;
        while ((node = walker.nextNode())) textNodes.push(node);

        textNodes.forEach(textNode => {
            const parent = textNode.parentElement;
            if (!originalTextByNode.has(textNode)) {
                originalTextByNode.set(textNode, textNode.nodeValue.trim());
            }
            const sourceText = originalTextByNode.get(textNode);
            if (!parent || !sourceText || parent.closest('script, style, textarea, option')) return;
            let translatedText = sourceText;
            Object.entries(dictionary)
                .sort(([, left], [, right]) => right.source.length - left.source.length)
                .forEach(([, phrase]) => {
                    translatedText = translatedText.split(phrase.source).join(phrase.target);
                });
            if (translatedText !== sourceText) {
                const leadingWhitespace = textNode.nodeValue.match(/^\s*/)?.[0] || '';
                const trailingWhitespace = textNode.nodeValue.match(/\s*$/)?.[0] || '';
                textNode.nodeValue = leadingWhitespace + translatedText + trailingWhitespace;
            }
            translatedTextByNode.set(textNode, translatedText);
        });
    }

    function translateAttributes(root = document) {
        const dictionary = getPhraseDictionary();
        root.querySelectorAll('input, textarea, select, button, a, [aria-label], [title]').forEach(element => {
            ['placeholder', 'title', 'aria-label'].forEach(attribute => {
                if (!element.hasAttribute(attribute)) return;
                if (!originalAttributeValues.has(element)) {
                    originalAttributeValues.set(element, {});
                }
                const originals = originalAttributeValues.get(element);
                if (!(attribute in originals)) originals[attribute] = element.getAttribute(attribute);
                let translated = originals[attribute];
                Object.values(dictionary)
                    .sort((left, right) => right.source.length - left.source.length)
                    .forEach(phrase => {
                        translated = translated.split(phrase.source).join(phrase.target);
                    });
                element.setAttribute(attribute, translated);
            });
        });
    }

    function getPhraseDictionary() {
        const english = translations?.[DEFAULT_LANGUAGE] || {};
        const selected = getDictionary();
        const phrases = {};

        Object.keys(english).forEach(key => {
            if (key === 'source' || typeof english[key] !== 'string' || typeof selected[key] !== 'string') return;
            if (english[key] !== selected[key]) {
                phrases[key] = { source: english[key], target: selected[key] };
            }
        });

        Object.entries(selected.source || {}).forEach(([source, target]) => {
            if (source !== target) phrases[`source:${source}`] = { source, target };
        });

        return phrases;
    }

    function translatePhraseText(text) {
        let translated = text;
        Object.values(getPhraseDictionary())
            .sort((left, right) => right.source.length - left.source.length)
            .forEach(phrase => {
                translated = translated.split(phrase.source).join(phrase.target);
            });
        return translated;
    }

    function applyTranslations(root = document) {
        if (!translations) return;
        isApplyingTranslations = true;

        try {
            const dictionary = getDictionary();

            root.querySelectorAll('[data-i18n]').forEach(element => {
                const key = element.dataset.i18n;
                if (dictionary[key]) element.textContent = dictionary[key];
            });

            root.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
                const key = element.dataset.i18nPlaceholder;
                if (dictionary[key]) element.placeholder = dictionary[key];
            });

            root.querySelectorAll('[data-i18n-title]').forEach(element => {
                const key = element.dataset.i18nTitle;
                if (dictionary[key]) element.title = dictionary[key];
            });

            translateTextNodes(root);
            translateAttributes(root);
            document.title = translatePhraseText(originalDocumentTitle);
            document.documentElement.lang = currentLanguage === 'fil' ? 'fil' : currentLanguage === 'ceb-en' ? 'ceb' : 'en';
            document.querySelectorAll('[data-parent-language]').forEach(select => {
                select.value = currentLanguage;
                select.setAttribute('aria-label', dictionary.languageLabel || 'Language');
            });
            window.dispatchEvent(new CustomEvent('parentLanguageChanged', { detail: { language: currentLanguage } }));
        } finally {
            isApplyingTranslations = false;
        }
    }

    function addLanguageSelector() {
        document.querySelectorAll('[data-parent-language]').forEach(select => {
            select.addEventListener('change', event => {
                currentLanguage = supportedLanguages.includes(event.target.value) ? event.target.value : DEFAULT_LANGUAGE;
                localStorage.setItem(STORAGE_KEY, currentLanguage);
                applyTranslations();
            });
        });
    }

    async function init() {
        try {
            const scriptUrl = runtimeScriptUrl || `${window.location.origin}/assets/js/parent-language.js`;
            const translationUrl = new URL('../data/parent-translations.json', scriptUrl);
            const response = await fetch(translationUrl);
            if (!response.ok) throw new Error(`Translation file returned ${response.status}`);
            translations = await response.json();
            addLanguageSelector();
            applyTranslations();

            const nativeAlert = window.alert.bind(window);
            window.alert = message => nativeAlert(translatePhraseText(String(message)));

            const observer = new MutationObserver(mutations => {
                if (isApplyingTranslations) return;

                mutations.forEach(mutation => {
                    if (mutation.type === 'characterData') {
                        const textNode = mutation.target;
                        const currentText = textNode.nodeValue.trim();
                        if (currentText && currentText !== translatedTextByNode.get(textNode)) {
                            originalTextByNode.set(textNode, currentText);
                            applyTranslations(textNode.parentElement || document);
                        }
                    }
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) applyTranslations(node);
                    });
                });
            });
            observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        } catch (error) {
            console.warn('Parent language support unavailable:', error);
        }
    }

    window.parentTranslate = translate;
    window.parentTranslateText = translatePhraseText;
    window.parentApplyTranslations = applyTranslations;
    window.parentSupportedLanguages = supportedLanguages;
    init();
})();
