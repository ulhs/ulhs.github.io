(() => {
    const DB_NAME = 'ulhs-attendance-offline';
    const DB_VERSION = 1;
    const STORES = {
        students: 'students',
        logs: 'logs',
        pending: 'pending_scans',
        photos: 'photos',
        meta: 'meta'
    };

    let dbPromise = null;

    function promisifyRequest(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    function promisifyTransaction(transaction) {
        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted.'));
        });
    }

    function openDatabase() {
        if (dbPromise) return dbPromise;

        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = () => {
                const db = request.result;

                if (!db.objectStoreNames.contains(STORES.students)) {
                    db.createObjectStore(STORES.students, { keyPath: 'lrn' });
                }

                if (!db.objectStoreNames.contains(STORES.logs)) {
                    const logsStore = db.createObjectStore(STORES.logs, { keyPath: 'scan_id' });
                    logsStore.createIndex('by_local_date', 'local_date', { unique: false });
                    logsStore.createIndex('by_student_session_date', ['student_lrn', 'session', 'local_date'], { unique: false });
                    logsStore.createIndex('by_sync_status', 'sync_status', { unique: false });
                }

                if (!db.objectStoreNames.contains(STORES.pending)) {
                    const pendingStore = db.createObjectStore(STORES.pending, { keyPath: 'scan_id' });
                    pendingStore.createIndex('by_created_at', 'created_at', { unique: false });
                }

                if (!db.objectStoreNames.contains(STORES.photos)) {
                    db.createObjectStore(STORES.photos, { keyPath: 'lrn' });
                }

                if (!db.objectStoreNames.contains(STORES.meta)) {
                    db.createObjectStore(STORES.meta, { keyPath: 'key' });
                }
            };

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        return dbPromise;
    }

    async function withStore(storeName, mode, callback) {
        const db = await openDatabase();
        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        const result = await callback(store, transaction);
        await promisifyTransaction(transaction);
        return result;
    }

    async function withStores(storeNames, mode, callback) {
        const db = await openDatabase();
        const transaction = db.transaction(storeNames, mode);
        const stores = Object.fromEntries(storeNames.map((name) => [name, transaction.objectStore(name)]));
        const result = await callback(stores, transaction);
        await promisifyTransaction(transaction);
        return result;
    }

    function toArrayFromCursor(source) {
        return new Promise((resolve, reject) => {
            const results = [];
            const request = source.openCursor();

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (!cursor) {
                    resolve(results);
                    return;
                }
                results.push(cursor.value);
                cursor.continue();
            };

            request.onerror = () => reject(request.error);
        });
    }

    const api = {
        async saveStudents(students) {
            const normalized = Array.isArray(students) ? students : [];
            return withStore(STORES.students, 'readwrite', async (store) => {
                store.clear();
                normalized.forEach((student) => store.put(student));
            });
        },

        async getStudents() {
            return withStore(STORES.students, 'readonly', (store) => promisifyRequest(store.getAll()));
        },

        async upsertLog(log) {
            return withStore(STORES.logs, 'readwrite', async (store) => {
                store.put(log);
            });
        },

        async upsertLogs(logs) {
            const normalized = Array.isArray(logs) ? logs : [];
            return withStore(STORES.logs, 'readwrite', async (store) => {
                normalized.forEach((log) => store.put(log));
            });
        },

        async getLogsByDate(localDate) {
            return withStore(STORES.logs, 'readonly', (store) => {
                const index = store.index('by_local_date');
                return promisifyRequest(index.getAll(localDate));
            });
        },

        async findLogByStudentSessionDate(studentLrn, session, localDate) {
            return withStore(STORES.logs, 'readonly', async (store) => {
                const index = store.index('by_student_session_date');
                const matches = await promisifyRequest(index.getAll([studentLrn, session, localDate]));
                return matches && matches.length ? matches[0] : null;
            });
        },

        async queuePendingScan(log) {
            return withStores([STORES.logs, STORES.pending], 'readwrite', async (stores) => {
                const queuedLog = {
                    ...log,
                    created_at: log.created_at || new Date().toISOString()
                };
                stores[STORES.logs].put(queuedLog);
                stores[STORES.pending].put(queuedLog);
            });
        },

        async getPendingScans() {
            return withStore(STORES.pending, 'readonly', (store) => {
                return promisifyRequest(store.getAll());
            });
        },

        async getPendingCount() {
            return withStore(STORES.pending, 'readonly', (store) => promisifyRequest(store.count()));
        },

        async markScanSynced(scanId, syncedLog) {
            return withStores([STORES.logs, STORES.pending], 'readwrite', async (stores) => {
                if (syncedLog) {
                    stores[STORES.logs].put(syncedLog);
                }
                stores[STORES.pending].delete(scanId);
            });
        },

        async removePendingScan(scanId) {
            return withStore(STORES.pending, 'readwrite', async (store) => {
                store.delete(scanId);
            });
        },

        async savePhoto(lrn, data) {
            return withStore(STORES.photos, 'readwrite', async (store) => {
                store.put({
                    lrn: String(lrn),
                    data,
                    cached_at: new Date().toISOString()
                });
            });
        },

        async getPhoto(lrn) {
            return withStore(STORES.photos, 'readonly', async (store) => {
                const record = await promisifyRequest(store.get(String(lrn)));
                return record ? record.data : null;
            });
        },

        async saveMeta(key, value) {
            return withStore(STORES.meta, 'readwrite', async (store) => {
                store.put({
                    key,
                    value,
                    updated_at: new Date().toISOString()
                });
            });
        },

        async getMeta(key) {
            return withStore(STORES.meta, 'readonly', async (store) => {
                const record = await promisifyRequest(store.get(key));
                return record ? record.value : null;
            });
        },

        async clearAll() {
            return withStores(Object.values(STORES), 'readwrite', async (stores) => {
                Object.values(stores).forEach((store) => store.clear());
            });
        }
    };

    window.attendanceOfflineStore = api;
})();
