// Secure Session Storage Utility
// Provides encrypted session storage with expiry and CSRF protection

class SecureSession {
    constructor(encryptionKey = null) {
        // Use a default key if none provided (not production-ready, but better than plaintext)
        this.key = encryptionKey || 'ulhs-parent-portal-default-key-2024';
        this.ivLength = 16; // 128 bits for AES
    }

    // Simple XOR-based encryption (for demo - use AES in production with proper key management)
    encrypt(text) {
        const iv = CryptoJS.lib.WordArray.random(this.ivLength);
        const encrypted = CryptoJS.AES.encrypt(text, this.key, { iv: iv });
        return iv.toString(CryptoJS.enc.Base64) + ':' + encrypted.toString();
    }

    decrypt(encryptedText) {
        try {
            const [ivBase64, ciphertext] = encryptedText.split(':');
            const iv = CryptoJS.enc.Base64.parse(ivBase64);
            const decrypted = CryptoJS.AES.decrypt(ciphertext, this.key, { iv: iv });
            return decrypted.toString(CryptoJS.enc.Utf8);
        } catch (e) {
            return null;
        }
    }

    setItem(key, value, expiryMinutes = 30) {
        const item = {
            value: value,
            expiry: Date.now() + (expiryMinutes * 60 * 1000)
        };
        const encrypted = this.encrypt(JSON.stringify(item));
        sessionStorage.setItem(key, encrypted);
    }

    getItem(key) {
        const encrypted = sessionStorage.getItem(key);
        if (!encrypted) return null;

        try {
            const decrypted = this.decrypt(encrypted);
            if (!decrypted) return null;

            const item = JSON.parse(decrypted);
            if (Date.now() > item.expiry) {
                sessionStorage.removeItem(key);
                return null;
            }
            return item.value;
        } catch (e) {
            sessionStorage.removeItem(key);
            return null;
        }
    }

    removeItem(key) {
        sessionStorage.removeItem(key);
    }

    clear() {
        sessionStorage.clear();
    }
    
    // CSRF Token methods
    generateCsrfToken() {
        const token = CryptoJS.lib.WordArray.random(32).toString();
        this.setItem('csrfToken', token);
        return token;
    }
    
    getCsrfToken() {
        return this.getItem('csrfToken');
    }
}

// Initialize secure session
const secureSession = new SecureSession();
