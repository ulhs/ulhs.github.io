// Configuration
let masterStudentDatabase = [];
let sectionWorkbooks = {}; // Stores ExcelJS workbook objects indexed by section name
let studentPhotos = new Map(); // lrn -> dataURL (in-memory storage)
let pendingPhotoSync = new Set(); // Track LRNs that need to be uploaded to Supabase
let html5QrCode = null;
let attendanceSession = new Map(); // lrn -> { am: 'P'|'T'|null, pm: 'P'|'T'|'A'|null }
let totalCampusPopulation = 0;
let currentSessionLogs = [];
let isLogsExpanded = false; // Track expansion state of the log table

// Supabase Integration Status
let isCloudSynced = false;
const offlineStore = window.attendanceOfflineStore || null;
let pendingSyncCount = 0;
let isSyncingPendingScans = false;
let syncIntervalId = null;
let appInitialized = false;

function getLocalDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getDayRangeForLocalDate(localDate) {
    const [year, month, day] = localDate.split('-').map(Number);
    const start = new Date(year, month - 1, day, 0, 0, 0, 0);
    const end = new Date(year, month - 1, day, 23, 59, 59, 999);
    return {
        startIso: start.toISOString(),
        endIso: end.toISOString()
    };
}

function normalizeCloudStudent(s) {
    const rawSex = s.sex || s.gender || 'M';
    const gender = (rawSex.toUpperCase().startsWith('F') || rawSex.toLowerCase() === 'female') ? 'female' : 'male';
    const rawGrade = String(s.grade_level || s.grade || s.gradeLevel || '0');
    const gradeNum = parseInt(rawGrade.replace(/\D/g, '')) || 0;
    const sectionLower = (s.section || '').toLowerCase();
    const isSHSTrack = ['humss', 'stem', 'gas', 'tvl', 'ict', 'abm', 'he'].some(track => sectionLower.includes(track));
    const level = (gradeNum >= 11 || isSHSTrack) ? 'SHS' : 'JHS';
    const sLrn = String(s.lrn);
    const photoSource = s.photo_url || `profiles/${sLrn}.webp`;

    if (photoSource) {
        studentPhotos.set(sLrn, photoSource);
    }

    return {
        lrn: sLrn,
        excelName: s.full_name,
        parsedName: (s.full_name || '').toUpperCase(),
        section: s.section,
        gender,
        grade_level: gradeNum || rawGrade,
        level,
        photo_url: photoSource,
        parent_messenger_id: s.parent_messenger_id || null,
        parent_phone: s.parent_phone || null,
        notify_parent: s.notify_parent || false,
        fromCloud: true
    };
}

function mapAttendanceStatusToDbStatus(status) {
    const normalized = String(status || '').toUpperCase();
    if (normalized.includes('ABSENT')) return 'ABSENT';
    if (normalized.includes('TARDY') || normalized.includes('LATE')) return 'TARDY';
    return 'PRESENT';
}

function mapLogStatusToSessionCode(status) {
    const normalized = String(status || '').toUpperCase();
    if (normalized === 'ABSENT') return 'A';
    if (normalized === 'TARDY' || normalized === 'LATE') return 'T';
    return 'P';
}

function buildLogIdentityKey(log) {
    const localDate = log.local_date || getLocalDateKey(new Date(log.scanned_at));
    return `${String(log.student_lrn)}|${log.session}|${localDate}`;
}

function mergeLogsByIdentity(logs) {
    const merged = new Map();

    (logs || []).forEach((log) => {
        const normalizedLog = {
            ...log,
            student_lrn: String(log.student_lrn),
            local_date: log.local_date || getLocalDateKey(new Date(log.scanned_at)),
            sync_status: log.sync_status || 'synced'
        };
        const key = buildLogIdentityKey(normalizedLog);
        const existing = merged.get(key);

        if (!existing) {
            merged.set(key, normalizedLog);
            return;
        }

        const existingPriority = existing.sync_status === 'synced' ? 2 : 1;
        const incomingPriority = normalizedLog.sync_status === 'synced' ? 2 : 1;

        if (incomingPriority > existingPriority) {
            merged.set(key, normalizedLog);
            return;
        }

        if (incomingPriority === existingPriority && new Date(normalizedLog.scanned_at) > new Date(existing.scanned_at)) {
            merged.set(key, normalizedLog);
        }
    });

    return Array.from(merged.values()).sort((a, b) => new Date(b.scanned_at) - new Date(a.scanned_at));
}

function applySessionStateFromLogs(logs) {
    currentSessionLogs = Array.isArray(logs) ? [...logs] : [];
    attendanceSession.clear();

    currentSessionLogs.forEach((log) => {
        const existing = attendanceSession.get(String(log.student_lrn)) || { am: null, pm: null };
        const code = mapLogStatusToSessionCode(log.status);

        if (log.session === 'AM') existing.am = code;
        if (log.session === 'PM') existing.pm = code;

        attendanceSession.set(String(log.student_lrn), existing);
    });

    if (presentCountDisplay) presentCountDisplay.textContent = attendanceSession.size;
    updateSessionLogCounters(currentSessionLogs);
    renderLogTableFromSession(currentSessionLogs);

    if (currentSessionLogs.length > 0) {
        const lastLog = [...currentSessionLogs].sort((a, b) => new Date(b.scanned_at) - new Date(a.scanned_at))[0];
        const lastStudent = masterStudentDatabase.find(s => String(s.lrn) === String(lastLog.student_lrn));
        if (lastStudent) {
            updateDashboard(lastStudent, lastLog.scanned_at);
        }
    }
}

function updateSessionLogCounters(logs) {
    const safeLogs = Array.isArray(logs) ? logs : [];
    const amCount = safeLogs.filter(log => log.session === 'AM').length;
    const pmCount = safeLogs.filter(log => log.session === 'PM').length;

    if (amEntryCountDisplay) amEntryCountDisplay.textContent = amCount;
    if (pmEntryCountDisplay) pmEntryCountDisplay.textContent = pmCount;
}

async function refreshPendingSyncCount() {
    if (!offlineStore) {
        pendingSyncCount = 0;
        updateCloudSyncBadge();
        return 0;
    }

    try {
        pendingSyncCount = await offlineStore.getPendingCount();
    } catch (err) {
        console.error("Pending sync count error:", err);
        pendingSyncCount = 0;
    }

    updateCloudSyncBadge();
    return pendingSyncCount;
}

function updateCloudSyncBadge() {
    const cloudBadge = document.getElementById('cloud-sync-badge');
    if (!cloudBadge) return;

    if (!navigator.onLine) {
        cloudBadge.innerHTML = `<i class="fa-solid fa-cloud-slash"></i> Offline${pendingSyncCount > 0 ? ` (${pendingSyncCount} Pending)` : ''}`;
        cloudBadge.className = "px-3 py-1 bg-red-100 text-red-500 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-1";
        return;
    }

    if (isSyncingPendingScans) {
        cloudBadge.innerHTML = `<i class="fa-solid fa-rotate"></i> Syncing${pendingSyncCount > 0 ? ` ${pendingSyncCount}` : ''}`;
        cloudBadge.className = "px-3 py-1 bg-blue-100 text-blue-600 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-1";
        return;
    }

    if (pendingSyncCount > 0) {
        cloudBadge.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> ${pendingSyncCount} Pending`;
        cloudBadge.className = "px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-1";
        return;
    }

    cloudBadge.innerHTML = `<i class="fa-solid fa-cloud"></i> ${isCloudSynced ? 'Synced' : 'Online'}`;
    cloudBadge.className = "px-3 py-1 bg-green-100 text-green-600 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-1";
}

function updateUIWithCacheData() {
    if (statusTitle) statusTitle.textContent = "Offline Registry Ready";
    if (statusDesc) statusDesc.textContent = `${masterStudentDatabase.length} cached students available for offline scanning.`;
    if (statusIcon) {
        statusIcon.innerHTML = '<svg class="w-6 h-6 text-yellow-600" fill="currentColor" viewBox="0 0 20 20"><path d="M18 13V7a2 2 0 00-2-2h-1V4a2 2 0 10-4 0v1H9V4a2 2 0 10-4 0v1H4a2 2 0 00-2 2v6a2 2 0 002 2h12a2 2 0 002-2z"></path></svg>';
        statusIcon.className = "w-10 h-10 rounded-full bg-yellow-100 flex items-center justify-center";
    }

    if (startBtn) startBtn.disabled = masterStudentDatabase.length === 0;
    if (exportJhsBtn) exportJhsBtn.classList.remove('hidden');
    if (exportShsBtn) exportShsBtn.classList.remove('hidden');
    if (totalCountDisplay) totalCountDisplay.textContent = masterStudentDatabase.length;

    // Show Admin Tools if admin or has permission
    const userAccess = JSON.parse(sessionStorage.getItem('userAccess') || '{}');
    const userRole = sessionStorage.getItem('userRole');
    if (userRole === 'admin' || userAccess.stats) {
        if (adminTools) adminTools.classList.remove('hidden');
    }

    updateCloudSyncBadge();
}

// --- SUPABASE INTEGRATION ---
async function initSupabaseSync() {
    // Wait for client to be ready
    if (!window.supabaseClient) {
        console.log("Sync: Waiting for client...");
        setTimeout(initSupabaseSync, 100);
        return;
    }

    if (!navigator.onLine) {
        isCloudSynced = false;
        updateCloudSyncBadge();
        return;
    }

    try {
        const { data: students, error } = await window.supabaseClient
            .from('students')
            .select('*');

        if (error) throw error;

        if (students && students.length > 0) {
            console.log(`Cloud Sync: ${students.length} students loaded.`);

            const cloudStudents = students.map(normalizeCloudStudent);
            masterStudentDatabase = [...cloudStudents];
            isCloudSynced = true;

            if (offlineStore) {
                await offlineStore.saveStudents(cloudStudents);
                await offlineStore.saveMeta('last-student-sync-at', new Date().toISOString());
            }

            console.log("Supabase Sync: First 5 students mapping sample:", masterStudentDatabase.slice(0, 5).map(s => ({ name: s.excelName, gender: s.gender })));

            await restoreAttendanceSession();
            updateUIWithCloudData();
        } else if (masterStudentDatabase.length > 0) {
            updateUIWithCacheData();
        }

        await refreshPendingSyncCount();
    } catch (err) {
        console.error("Supabase Sync Error:", err.message);
        isCloudSynced = false;
        if (masterStudentDatabase.length > 0) {
            updateUIWithCacheData();
        }
        updateCloudSyncBadge();
    }
}

async function restoreAttendanceSession() {
    try {
        const todayKey = getLocalDateKey();
        let localLogs = [];

        if (offlineStore) {
            localLogs = await offlineStore.getLogsByDate(todayKey);
        }

        if (window.supabaseClient && navigator.onLine) {
            const { startIso } = getDayRangeForLocalDate(todayKey);
            console.log("Restoring session since:", startIso);

            const { data: logs, error } = await window.supabaseClient
                .from('attendance_logs')
                .select('*')
                .gte('scanned_at', startIso);

            if (error) {
                console.error("Session Restore Database Error:", error.message);
            } else if (logs) {
                const normalizedCloudLogs = logs.map(log => ({
                    ...log,
                    scan_id: `cloud:${log.student_lrn}:${log.session}:${log.scanned_at}`,
                    local_date: getLocalDateKey(new Date(log.scanned_at)),
                    sync_status: 'synced'
                }));

                if (offlineStore) {
                    await offlineStore.upsertLogs(normalizedCloudLogs);
                    localLogs = await offlineStore.getLogsByDate(todayKey);
                } else {
                    localLogs = normalizedCloudLogs;
                }
            }
        }

        const mergedLogs = mergeLogsByIdentity(localLogs);
        applySessionStateFromLogs(mergedLogs);
        console.log(`✅ Session Restored: ${attendanceSession.size} unique students ready.`);
    } catch (err) {
        console.error("Session Restore System Error:", err);
    }
}

async function hydrateFromOfflineCache() {
    if (!offlineStore) {
        updateCloudSyncBadge();
        return;
    }

    try {
        const todayKey = getLocalDateKey();
        const [cachedStudents, cachedLogs] = await Promise.all([
            offlineStore.getStudents(),
            offlineStore.getLogsByDate(todayKey)
        ]);

        if (cachedStudents && cachedStudents.length > 0) {
            masterStudentDatabase = cachedStudents;
            
            // Re-map photos from database records if available
            masterStudentDatabase.forEach(s => {
                if (s.photo_url && (s.photo_url.startsWith('data:') || s.photo_url.startsWith('profiles/'))) {
                    studentPhotos.set(s.lrn, s.photo_url);
                }
            });
            
            updateUIWithCacheData();
        }

        // Load all photos from dedicated store to ensure they're in memory
        // This handles photos that might not be linked to a student record yet
        const allPhotos = await offlineStore.getAllPhotos();
        if (allPhotos && allPhotos.length > 0) {
            allPhotos.forEach(p => {
                if (!studentPhotos.has(p.lrn)) {
                    studentPhotos.set(p.lrn, p.data);
                }
            });
            console.log(`[Offline] Hydrated ${allPhotos.length} photos into memory.`);
        }

        if (cachedLogs && cachedLogs.length > 0) {
            applySessionStateFromLogs(mergeLogsByIdentity(cachedLogs));
        }
    } catch (err) {
        console.error("Offline cache hydration error:", err);
    } finally {
        await refreshPendingSyncCount();
    }
}

function renderLogTableFromSession(logs) {
    const tableBody = document.getElementById('scan-logs-table');
    const emptyMsg = document.getElementById('empty-log-msg');
    const logCount = document.getElementById('log-count');
    const expandContainer = document.getElementById('log-expand-container');
    const expandBtn = document.getElementById('log-expand-btn');

    if (!tableBody) return;

    if (!logs || logs.length === 0) {
        tableBody.innerHTML = '';
        if (emptyMsg) emptyMsg.style.display = 'block';
        if (logCount) logCount.textContent = '0 STUDENTS';
        if (expandContainer) expandContainer.classList.add('hidden');
        return;
    }

    if (emptyMsg) emptyMsg.style.display = 'none';
    if (logCount) logCount.textContent = `${attendanceSession.size} STUDENTS`;

    // Map logs to table rows, sorted by time descending
    const sortedLogs = [...logs].sort((a, b) => new Date(b.scanned_at) - new Date(a.scanned_at));
    
    // Determine which logs to show
    const LOG_LIMIT = 5;
    const logsToShow = isLogsExpanded ? sortedLogs : sortedLogs.slice(0, LOG_LIMIT);

    // Update expand button visibility and text
    if (expandContainer && expandBtn) {
        if (sortedLogs.length > LOG_LIMIT) {
            expandContainer.classList.remove('hidden');
            const btnSpan = expandBtn.querySelector('span');
            const btnIcon = expandBtn.querySelector('i');
            
            if (isLogsExpanded) {
                if (btnSpan) btnSpan.textContent = 'Show Fewer Logs';
                if (btnIcon) btnIcon.classList.add('rotate-180');
            } else {
                if (btnSpan) btnSpan.textContent = `Show All Logs (${sortedLogs.length})`;
                if (btnIcon) btnIcon.classList.remove('rotate-180');
            }
        } else {
            expandContainer.classList.add('hidden');
        }
    }
    
    tableBody.innerHTML = logsToShow.map(log => {
        // Try to find student in master database
        const student = masterStudentDatabase.find(s => String(s.lrn) === String(log.student_lrn));
        const lrnStr = String(log.student_lrn);

        return `
            <tr class="hover:bg-gray-50 transition-colors">
                <td class="px-4 py-3 text-center">
                    <div class="flex justify-center">
                        <img data-secure-lrn="${lrnStr}" class="w-10 h-10 rounded-lg student-photo-display border border-gray-100 shadow-sm" style="display: none">
                        <div class="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-gray-300">
                            <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd"></path></svg>
                        </div>
                    </div>
                </td>
                <td class="px-4 py-3">
                    <p class="font-bold text-gray-900">${log.student_lrn}</p>
                    <p class="text-[10px] text-gray-400 uppercase">${student?.section || 'N/A'}</p>
                </td>
                <td class="px-4 py-3">
                    <p class="font-semibold text-gray-800">${student?.excelName || 'Unknown Learner'}</p>
                </td>
                <td class="px-4 py-3 text-right">
                    <div class="flex flex-col items-end">
                        <span class="text-xs font-bold text-gray-500">${new Date(log.scanned_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}</span>
                        <span class="text-[8px] font-black uppercase tracking-widest ${log.session === 'AM' ? 'text-blue-500' : 'text-orange-500'}">${log.session} SESSION</span>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    // Securely load photos for each row
    tableBody.querySelectorAll('img[data-secure-lrn]').forEach(img => {
        const lrn = img.getAttribute('data-secure-lrn');
        const placeholder = img.nextElementSibling;
        loadStudentPhotoSecurely(lrn, img, placeholder);
    });
}

function updateUIWithCloudData() {
    if (statusTitle) statusTitle.textContent = "Cloud Registry Active";
    if (statusDesc) statusDesc.textContent = `${masterStudentDatabase.length} students synced from Database.`;
    if (statusIcon) {
        statusIcon.innerHTML = '<svg class="w-6 h-6 text-blue-600" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M2 5a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm14 1a1 1 0 11-2 0 1 1 0 012 0zM2 13a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 01-2 2H4a2 2 0 01-2-2v-2zm14 1a1 1 0 11-2 0 1 1 0 012 0z" clip-rule="evenodd"></path></svg>';
        statusIcon.className = "w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center";
    }

    if (startBtn) startBtn.disabled = false;
    if (exportJhsBtn) exportJhsBtn.classList.remove('hidden');
    if (exportShsBtn) exportShsBtn.classList.remove('hidden');
    if (totalCountDisplay) totalCountDisplay.textContent = masterStudentDatabase.length;

    // Show Admin Tools if admin or has permission
    const userAccess = JSON.parse(sessionStorage.getItem('userAccess') || '{}');
    const userRole = sessionStorage.getItem('userRole');
    if (userRole === 'admin' || userAccess.stats) {
        if (adminTools) adminTools.classList.remove('hidden');
    }
    
    updateCloudSyncBadge();
}

// --- DIAGNOSTICS & VERIFICATION ---
async function testSupabaseConnection() {
    console.log("--- STARTING DEEP DIAGNOSTICS ---");
    const btn = document.querySelector('button[onclick="testSupabaseConnection()"]');
    if (btn) { btn.textContent = "Checking Columns..."; btn.disabled = true; }

    try {
        if (!window.supabaseClient) throw new Error("Supabase client not initialized.");

        // 1. Check Students Table & Columns
        const { data: sData, error: sError } = await window.supabaseClient.from('students').select('*').limit(1);
        if (sError) throw new Error(`Students Table: ${sError.message}`);
        console.log("Students Table Columns:", Object.keys(sData[0] || {}));

        // 2. Check Attendance Logs Table & Columns
        const { data: lData, error: lError } = await window.supabaseClient.from('attendance_logs').select('*').limit(1);
        if (lError) throw new Error(`Attendance Logs Table: ${lError.message}`);
        console.log("Attendance Logs Columns:", Object.keys(lData[0] || {}));

        // 3. Check Profiles Table
        const { data: pData, error: pError } = await window.supabaseClient.from('profiles').select('*').limit(1);
        if (pError) throw new Error(`Profiles Table: ${pError.message}`);
        
        alert("Diagnostics Passed!\n\nCheck the Browser Console (F12) to see your table columns. Make sure they match 'lrn', 'full_name', and 'section'.");
        if (btn) { btn.textContent = "Passed"; btn.className = "w-full mt-4 py-2 bg-green-50 text-green-600 rounded-xl border border-green-100"; }
    } catch (err) {
        console.error("❌ Diagnostics Failed:", err.message);
        alert(`Diagnostics Failed: ${err.message}`);
        if (btn) { btn.textContent = "Failed"; btn.className = "w-full mt-4 py-2 bg-red-50 text-red-600 rounded-xl border border-red-100"; }
    } finally {
        setTimeout(() => {
            if (btn) { btn.textContent = "Run System Diagnostics"; btn.className = "w-full mt-4 py-2 bg-gray-50 text-gray-400 rounded-xl border border-gray-100"; btn.disabled = false; }
        }, 5000);
    }
}

// Call init on load
window.addEventListener('load', () => {
    // 1. Setup Export Selectors
    const exportMonth = document.getElementById('export-month');
    const exportYear = document.getElementById('export-year');
    if (exportMonth) exportMonth.value = new Date().getMonth();
    if (exportYear) exportYear.value = new Date().getFullYear();

    // 2. Attach SF2 Export Listeners
    const exportJhsBtn = document.getElementById('export-jhs-btn');
    const exportShsBtn = document.getElementById('export-shs-btn');
    
    if (exportJhsBtn) {
        exportJhsBtn.addEventListener('click', () => {
            console.log("🚀 Export JHS Clicked");
            exportAllSF2('JHS');
        });
    }
    if (exportShsBtn) {
        exportShsBtn.addEventListener('click', () => {
            console.log("🚀 Export SHS Clicked");
            exportAllSF2('SHS');
        });
    }

    // 3. Test Mode & Bulk Import
    const testModeToggle = document.getElementById('test-mode-toggle');
    if (testModeToggle) {
        testModeToggle.addEventListener('change', () => {
            const indicator = document.getElementById('test-mode-indicator');
            if (indicator) indicator.classList.toggle('hidden', !testModeToggle.checked);
        });
    }

    const fileInput = document.getElementById('file-input');
    if (fileInput) {
        fileInput.addEventListener('change', (e) => handleBulkImport(e.target.files));
    }

    // 4. Log Table Expansion
    const expandBtn = document.getElementById('log-expand-btn');
    if (expandBtn) {
        expandBtn.addEventListener('click', () => {
            isLogsExpanded = !isLogsExpanded;
            renderLogTableFromSession(currentSessionLogs);
        });
    }
});

// Camera Management
let isScannerActive = false;
let scannerConfig = null;
let activeCameraId = null;
let isSwitchingCamera = false;  // Prevent scanning during camera switches
let lastScannedLrn = null;      // To prevent rapid double scans
let lastScanTimestamp = 0;      // Timestamp of the last successful scan

// SF2 Mapping Configuration per Level (Indices converted for ExcelJS - 1-based)
const SF2_MAPPINGS = {
    'JHS': {
        template: 'SF2_Blank.xlsx',
        nameCol: 3,    // Col C
        lrnCol: 50,    // Col AX
        maleStartRow: 8,
        femaleStartRow: 25,
        attStartCol: 6, // Col F (Day 1)
        headers: {
            schoolId: 'F3',
            schoolName: 'F4',
            schoolYear: 'M3',
            gradeLevel: 'AA4',
            section: 'AM4',
            month: 'AA3',
            adviser: 'AN78',
            schoolHead: 'AN84'
        },
        summary: {
            startRow: 55,
            maleCol: 44,   // AR
            femaleCol: 45, // AS
            totalCol: 46   // AT
        }
    },
    'SHS': {
        template: 'SF2_Blank_SHS.xlsx',
        nameCol: 3,    // Col C
        lrnCol: 82,    // Col CD
        maleStartRow: 12,
        femaleStartRow: 30,
        attStartCol: 6, // Col F
        headers: {
            schoolId: 'V3',
            schoolName: 'F3',
            district: 'AF3',
            division: 'AM3',
            region: 'AS3',
            schoolYear: 'V5',
            gradeLevel: 'AE5',
            section: 'F7',
            month: 'AQ7',
            adviser: 'AS79',
            schoolHead: 'AS84'
        },
        summary: {
            startRow: 62,
            maleCol: 49,   // AW
            femaleCol: 50, // AX
            totalCol: 51   // AY
        }
    }
};

// UI Elements
const statusTitle = document.getElementById('system-status-title');
const statusDesc = document.getElementById('system-status-desc');
const statusIcon = document.getElementById('status-icon');
const liveClock = document.getElementById('live-clock');
const clockTime = document.getElementById('clock-time');
const clockAmPm = document.getElementById('clock-ampm');
const liveDate = document.getElementById('live-date');
const sessionBadge = document.getElementById('session-badge');
const lastStudentName = document.getElementById('last-student-name');
const lastStudentPhoto = document.getElementById('last-student-photo');
const lastPhotoPlaceholder = document.getElementById('last-photo-placeholder');
const lastScanTime = document.getElementById('last-scan-time');
const lastScannedCard = document.getElementById('last-scanned-card');
const scanStatus = document.getElementById('scan-status');
const scannerPlaceholder = document.getElementById('scanner-placeholder');
const cameraSelectContainer = document.getElementById('camera-select-container');
const cameraSelect = document.getElementById('camera-select');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const totalCountDisplay = document.getElementById('total-count');
const presentCountDisplay = document.getElementById('present-count');
const amEntryCountDisplay = document.getElementById('am-entry-count');
const pmEntryCountDisplay = document.getElementById('pm-entry-count');
const sectionDisplay = document.getElementById('section-name');
const scanLogsTable = document.getElementById('scan-logs-table');
const logCount = document.getElementById('log-count');
const emptyLogMsg = document.getElementById('empty-log-msg');
const scanOverlay = document.getElementById('scan-overlay');
const testModeToggle = document.getElementById('test-mode-toggle');
const testModeIndicator = document.getElementById('test-mode-indicator');
const overlayIconContainer = document.getElementById('overlay-icon-container');
const overlayStatus = document.getElementById('overlay-status');
const overlayName = document.getElementById('overlay-student-name');
const overlayLrn = document.getElementById('overlay-student-lrn');
const overlayPhoto = document.getElementById('overlay-student-photo');
const overlayPhotoPlaceholder = document.getElementById('overlay-photo-placeholder');
const overlayTimeStatus = document.getElementById('overlay-time-status');
const exportBtn = document.getElementById('export-btn');
const exportJhsBtn = document.getElementById('export-jhs-btn');
const exportShsBtn = document.getElementById('export-shs-btn');
const adminTools = document.getElementById('admin-tools-container');

// New Bulk Importer UI Elements
const fileInput = document.getElementById('file-input');
const importStats = document.getElementById('import-stats');
const loadedSectionsCount = document.getElementById('loaded-sections-count');
const totalStudentsCount = document.getElementById('total-students-count');
const totalPhotosCount = document.getElementById('total-photos-count');

// Time Windows Configuration (with 15-minute grace period)
const TIME_CONFIG = {
    AM: {
        late: "07:45",     // Marked LATE after 7:45 (7:30 start + 15m grace)
        absent: "11:45"    // Not accepted as AM session after 11:45
    },
    PM: {
        start: "12:00",    // PM session starts accepting at 12:00
        late: "13:15",     // Marked LATE after 13:15 (13:00 start + 15m grace)
        absent: "16:00"    // Marked ABSENT after 16:00
    }
};

// Update Real-time Clock and Session Badge
function updateClock() {
    const now = new Date();
    
    // Time (12-hour format: h:mm AM/PM)
    const timeOptions = { 
        hour: 'numeric', 
        minute: '2-digit', 
        hour12: true 
    };
    const timeStr = now.toLocaleTimeString('en-PH', timeOptions).toUpperCase();
    
    // Split time and AM/PM for separate styling
    const parts = timeStr.split(' ');
    if (parts.length === 2) {
        if (clockTime) clockTime.textContent = parts[0];
        if (clockAmPm) clockAmPm.textContent = parts[1];
    } else {
        if (liveClock) liveClock.textContent = timeStr;
    }
    
    // Date
    const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateStr = now.toLocaleDateString('en-PH', dateOptions);
    if (liveDate) liveDate.textContent = dateStr;

    // Session Badge
    const timeData = getAttendanceStatus('CLOCK_ONLY');
    if (sessionBadge) {
        sessionBadge.textContent = `${timeData.session} SESSION: ${timeData.status}`;
        sessionBadge.className = "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ";
        
        if (timeData.session === 'BREAK') {
            sessionBadge.classList.add('bg-yellow-100', 'text-yellow-600');
        } else if (timeData.status === 'TARDY') {
            sessionBadge.classList.add('bg-red-100', 'text-red-600');
        } else {
            sessionBadge.classList.add('bg-green-100', 'text-green-600');
        }
    }
}
setInterval(updateClock, 1000);
updateClock();

// --- BULK SF2 & PHOTO ZIP IMPORTER (SESSION-ONLY WORKFLOW) ---
function updateSyncButtonState() {
    const syncPhotosBtn = document.getElementById('sync-photos-btn');
    if (!syncPhotosBtn) {
        console.warn("Sync button not found in DOM");
        return;
    }

    const pendingCount = pendingPhotoSync.size;
    console.log(`[Sync Debug] Updating button state. Pending photos: ${pendingCount}`);
    
    // Explicitly check if the button exists and is accessible
    if (syncPhotosBtn) {
        if (pendingCount > 0) {
            console.log("[Sync Debug] Enabling button...");
            syncPhotosBtn.disabled = false;
            syncPhotosBtn.style.setProperty('background-color', '#2563eb', 'important');
            syncPhotosBtn.style.setProperty('color', '#ffffff', 'important');
            syncPhotosBtn.style.setProperty('cursor', 'pointer', 'important');
            
            syncPhotosBtn.classList.remove('bg-gray-200', 'text-gray-400', 'cursor-not-allowed');
            syncPhotosBtn.classList.add('bg-blue-600', 'text-white', 'shadow-lg', 'hover:bg-blue-700', 'active:scale-95', 'animate-pulse');
            
            syncPhotosBtn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up text-lg"></i> Sync ${pendingCount} Photos to Cloud`;
        } else {
            console.log("[Sync Debug] Disabling button...");
            syncPhotosBtn.disabled = true;
            syncPhotosBtn.style.backgroundColor = ''; 
            syncPhotosBtn.style.color = '';
            syncPhotosBtn.style.cursor = '';
            syncPhotosBtn.classList.add('bg-gray-200', 'text-gray-400', 'cursor-not-allowed');
            syncPhotosBtn.classList.remove('bg-blue-600', 'text-white', 'shadow-lg', 'hover:bg-blue-700', 'active:scale-95', 'animate-pulse');
            syncPhotosBtn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up text-lg"></i> Sync Photos to Cloud`;
        }
    }
}

async function handleBulkImport(files) {
    if (!files || files.length === 0) return;

    console.log(`[Import Debug] Processing ${files.length} files...`);

    // Update UI
    if (statusTitle) statusTitle.textContent = "Processing Files...";
    if (statusIcon) {
        statusIcon.innerHTML = '<svg class="w-6 h-6 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>';
    }
    
    let loadedCount = 0;
    let zipSummary = { new: 0, updated: 0, invalid: 0, total: 0 };
    let hasZip = false;

    for (const file of files) {
        try {
            if (file.name.toLowerCase().endsWith('.xlsx')) {
                console.log(`[Import Debug] Processing Excel: ${file.name}`);
                const buffer = await file.arrayBuffer();
                const workbook = new ExcelJS.Workbook();
                await workbook.xlsx.load(buffer);
                
                const sheetName = detectSheetName(workbook);
                const level = detectLevel(workbook, sheetName);
                const sectionName = file.name.replace(/\.[^/.]+$/, ""); // Remove extension properly

                sectionWorkbooks[sectionName] = {
                    workbook: workbook,
                    info: { section: sectionName, level: level },
                    sheetName: sheetName,
                    fileName: file.name
                };

                masterStudentDatabase = masterStudentDatabase.filter(s => s.section !== sectionName);
                processSectionData(sectionWorkbooks[sectionName]);
                loadedCount++;
            } 
            else if (file.name.toLowerCase().endsWith('.zip')) {
                hasZip = true;
                console.log(`[Import Debug] Processing ZIP: ${file.name}`);
                statusDesc.textContent = "Unpacking Student Photos...";
                const zip = await JSZip.loadAsync(file);

                const zipEntries = Object.entries(zip.files).filter(([_, entry]) => !entry.dir);
                const totalEntries = zipEntries.length;
                let processedInZip = 0;

                for (const [filename, zipEntry] of zipEntries) {
                    const isImage = /\.(webp|jpg|jpeg|png)$/i.test(filename);
                    if (isImage) {
                        console.log(`[Import Debug] Found image: ${filename}`);
                        zipSummary.total++;
                        
                        // Map extension to proper MIME type
                        const ext = filename.split('.').pop().toLowerCase();
                        const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
                        
                        const blob = await zipEntry.async("blob");
                        // Ensure the blob has the correct MIME type
                        const typedBlob = new Blob([blob], { type: mimeType });
                        const dataURL = await blobToDataURL(typedBlob);
                        
                        // Extract LRN (12 digits) from filename
                        const lrnMatch = filename.match(/\d{12}/);
                        const lrn = lrnMatch ? lrnMatch[0] : null;

                        if (!lrn) {
                            console.warn(`[Import Warning] No 12-digit LRN found in filename: ${filename}`);
                            zipSummary.invalid++;
                            continue;
                        }

                        console.log(`[Import Debug] Valid LRN found: ${lrn}`);

                        if (studentPhotos.has(lrn)) {
                            zipSummary.updated++;
                        } else {
                            zipSummary.new++;
                        }
                        
                        studentPhotos.set(lrn, dataURL);
                        pendingPhotoSync.add(lrn); // Queue for Supabase Cloud Sync
                        console.log(`[Import Debug] Added LRN ${lrn} to pendingPhotoSync. Current size: ${pendingPhotoSync.size}`);
                        
                        const student = masterStudentDatabase.find(s => s.lrn === lrn);
                        if (student) {
                            student.photo_url = dataURL;
                        }
                        
                        // Update UI if this student is currently displayed on dashboard
                        const lastStudentName = document.getElementById('last-student-name');
                        if (lastStudentName && student && lastStudentName.textContent === student.parsedName) {
                            const lastStudentPhoto = document.getElementById('last-student-photo');
                            const lastPhotoPlaceholder = document.getElementById('last-photo-placeholder');
                            if (lastStudentPhoto) {
                                lastStudentPhoto.src = dataURL;
                                lastStudentPhoto.style.display = 'block';
                                lastStudentPhoto.classList.remove('hidden');
                            }
                            if (lastPhotoPlaceholder) {
                                lastPhotoPlaceholder.style.display = 'none';
                                lastPhotoPlaceholder.classList.add('hidden');
                            }
                        }

                        if (offlineStore) {
                            await offlineStore.savePhoto(lrn, dataURL);
                        }
                    }
                    processedInZip++;
                    if (processedInZip % 10 === 0 || processedInZip === totalEntries) {
                        statusDesc.textContent = `Unpacking Student Photos: ${processedInZip}/${totalEntries}...`;
                    }
                }
                console.log(`[Import Debug] ZIP processed: ${zipSummary.new} new, ${zipSummary.updated} updated, ${zipSummary.invalid} invalid.`);
            }
        } catch (err) {
            console.error(`[Import Error] Failed to process ${file.name}:`, err);
        }
    }

    if (statusTitle) statusTitle.textContent = "Session Registry Ready";
    
    // Detailed Status Description
    let finalDesc = `Registry: ${masterStudentDatabase.length} students. `;
    if (hasZip) {
        if (zipSummary.total === 0) {
            finalDesc += `<span class="text-red-600 font-bold">Error: No images found in ZIP.</span>`;
        } else if (zipSummary.new === 0 && zipSummary.updated === 0) {
            finalDesc += `<span class="text-red-600 font-bold">Error: ${zipSummary.invalid} photos skipped (No 12-digit LRN in filenames).</span>`;
        } else {
            finalDesc += `ZIP Report: ${zipSummary.new} new, ${zipSummary.updated} updated. `;
            if (zipSummary.invalid > 0) finalDesc += `(${zipSummary.invalid} skipped). `;
            finalDesc += `<span class="text-blue-700 font-black animate-pulse">Action Required: Click 'Sync Photos to Cloud' below to save changes.</span>`;
        }
    } else {
        finalDesc += `Photos: ${studentPhotos.size} loaded.`;
    }
    if (statusDesc) statusDesc.innerHTML = finalDesc;
    if (statusIcon) {
        statusIcon.innerHTML = '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>';
        statusIcon.className = "w-12 h-12 rounded-full bg-green-100 flex items-center justify-center text-green-600";
    }

    // Update UI stats
    if (importStats) importStats.classList.remove('hidden');
    if (loadedSectionsCount) loadedSectionsCount.textContent = Object.keys(sectionWorkbooks).length;
    if (totalStudentsCount) totalStudentsCount.textContent = masterStudentDatabase.length;
    if (totalPhotosCount) totalPhotosCount.textContent = studentPhotos.size;
    if (totalCountDisplay) totalCountDisplay.textContent = masterStudentDatabase.length;
    
    // Update Sync Button state
    updateSyncButtonState();
    
    if (masterStudentDatabase.length > 0 || studentPhotos.size > 0) {
        if (offlineStore && masterStudentDatabase.length > 0) {
            await offlineStore.saveStudents(masterStudentDatabase);
        }
        
        // Always show start button if there are students
        if (masterStudentDatabase.length > 0) {
            if (startBtn) startBtn.disabled = false;
            if (exportBtn) {
                exportBtn.classList.remove('hidden');
                exportBtn.textContent = "Export All (ZIP)";
            }
        }
        
        // Show Admin Tools if admin or has permission
        const userAccess = JSON.parse(sessionStorage.getItem('userAccess') || '{}');
        const userRole = sessionStorage.getItem('userRole');
        if (userRole === 'admin' || userAccess.stats) {
            if (masterStudentDatabase.length > 0) {
                if (exportJhsBtn) exportJhsBtn.classList.remove('hidden');
                if (exportShsBtn) exportShsBtn.classList.remove('hidden');
            }
            if (adminTools) adminTools.classList.remove('hidden');
        }
    }
}

function blobToDataURL(blob) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
    });
}

function detectLevel(workbook, sheetName) {
    const ws = workbook.getWorksheet(sheetName);
    // Check for CD17 (82) or AX7 (50) to determine if it's SHS or JHS
    const shsLrnCell = ws.getCell(17, 82);
    const jhsLrnCell = ws.getCell(7, 50);
    
    // Heuristic: SHS usually has LRN much further right and lower
    if (shsLrnCell.value && shsLrnCell.value.toString().length >= 10) return 'SHS';
    return 'JHS';
}

function detectSheetName(workbook) {
    // If workbook has only one sheet, return its name immediately
    if (workbook.worksheets.length === 1) {
        return workbook.worksheets[0].name;
    }

    const exportMonth = document.getElementById('export-month');
    const selectedMonthIdx = exportMonth ? parseInt(exportMonth.value) : new Date().getMonth();
    
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const targetMonthName = monthNames[selectedMonthIdx];

    let sheet = workbook.worksheets.find(ws => 
        ws.name.toLowerCase().includes(targetMonthName.toLowerCase())
    );

    return sheet ? sheet.name : workbook.worksheets[0].name;
}

function processSectionData(sectionObj) {
    const worksheet = sectionObj.workbook.getWorksheet(sectionObj.sheetName);
    const level = sectionObj.info.level;
    const mapping = SF2_MAPPINGS[level] || SF2_MAPPINGS['JHS'];
    
    sectionObj.summaryRows = { male: -1, female: -1, total: -1 };
    let isMaleSection = true;

    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber < mapping.startRow) return;

        const rawNameCell = row.getCell(mapping.nameCol);
        const lrnCell = row.getCell(mapping.lrnCol);
        
        const rawName = rawNameCell.value ? rawNameCell.value.toString().trim() : "";
        const lrn = lrnCell.value ? lrnCell.value.toString().trim() : "";

        if (!rawName || rawName.length < 3) return;

        if (rawName.toLowerCase().includes('female') && !rawName.toLowerCase().includes('total')) {
            isMaleSection = false;
        }

        const rowStr = rawName.toLowerCase();
        if (rowStr.includes('total') || rowStr.includes('male') || rowStr.includes('female')) {
            if (rowStr.includes('male') && rowStr.includes('total')) sectionObj.summaryRows.male = rowNumber;
            else if (rowStr.includes('female') && rowStr.includes('total')) sectionObj.summaryRows.female = rowNumber;
            else if (rowStr.includes('combined') || (rowStr.includes('total') && !rowStr.includes('male') && !rowStr.includes('female'))) {
                sectionObj.summaryRows.total = rowNumber;
            }
            return; 
        }

        if (lrn && lrn.length >= 5) {
            const cleanLrn = lrn.replace(/[^0-9]/g, '');
            masterStudentDatabase.push({
                lrn: cleanLrn,
                excelName: rawName,
                parsedName: parseExcelName(rawName),
                rowIndex: rowNumber,
                gender: isMaleSection ? 'male' : 'female',
                section: sectionObj.info.section,
                level: level,
                photo_url: studentPhotos.get(cleanLrn) || null
            });
        }
    });
}

function parseExcelName(name) {
    const parts = name.split(',').map(p => p.trim());
    if (parts.length >= 2) {
        return `${parts[1]} ${parts[0]}`.toUpperCase();
    }
    return name.toUpperCase();
}

// --- ATTENDANCE ROUTING (EXCELJS VERSION) ---
function getAttendanceStatus(lrn) {
    const now = new Date();
    const timeStr = now.getHours().toString().padStart(2, '0') + ":" + now.getMinutes().toString().padStart(2, '0');
    const existing = attendanceSession.get(lrn) || { am: null, pm: null };
    
    // Determine Session
    if (timeStr < TIME_CONFIG.AM.absent) {
        // AM Session
        if (timeStr < TIME_CONFIG.AM.late) return { session: 'AM', status: 'PRESENT', code: '', am: 'P' };
        return { session: 'AM', status: 'TARDY', code: 'T', am: 'T' };
    } else if (timeStr >= TIME_CONFIG.PM.start) {
        // PM Session
        if (timeStr < TIME_CONFIG.PM.absent) {
            const isLate = timeStr >= TIME_CONFIG.PM.late;
            const pmType = isLate ? 'T' : 'P';
            
            let code = '';
            let status = 'PRESENT';
            
            if (existing.am === 'T' && isLate) {
                code = 'TT';
                status = 'TARDY (DOUBLE)';
            } else if (existing.am === 'T' || isLate) {
                code = 'T';
                status = 'TARDY';
            } else if (!existing.am) {
                code = '/';
                status = 'AM ABSENT';
            }
            
            return { session: 'PM', status, code, am: existing.am, pm: pmType };
        }
        
        // After 4:00 PM
        return { session: 'PM', status: 'ABSENT (WHOLE DAY)', code: 'X', am: existing.am, pm: 'A' };
    }
    
    return { session: 'BREAK', status: 'WAITING', code: '', am: existing.am, pm: null };
}

function markAttendanceInExcel(student, timeData) {
    const sectionObj = sectionWorkbooks[student.section];
    if (!sectionObj) {
        console.warn(`Workbook for section ${student.section} not found. Skipping Excel update.`);
        return;
    }

    // Guard: Ensure rowIndex exists (Hybrid Mode Check)
    if (student.rowIndex === undefined || student.rowIndex === null) {
        console.info(`Student ${student.lrn} was loaded from Cloud without Excel context. Skipping Excel update.`);
        return;
    }

    const mapping = SF2_MAPPINGS[student.level] || SF2_MAPPINGS['JHS'];
    const worksheet = sectionObj.workbook.getWorksheet(sectionObj.sheetName);
    const today = new Date();
    const dayOfMonth = today.getDate();

    const targetColIndex = mapping.attStartCol + (dayOfMonth - 1);
    const studentRow = worksheet.getRow(student.rowIndex);
    const cell = studentRow.getCell(targetColIndex);
    
    cell.value = timeData.code; 

    const isFirstScan = !attendanceSession.has(student.lrn);
    if (isFirstScan) {
        updateSummaryTable(worksheet, student.gender, targetColIndex, sectionObj.summaryRows);
    }
}

function updateSummaryTable(ws, gender, colIndex, summaryRows) {
    const rowsToUpdate = [];
    if (gender === 'male' && summaryRows.male !== -1) rowsToUpdate.push(summaryRows.male);
    if (gender === 'female' && summaryRows.female !== -1) rowsToUpdate.push(summaryRows.female);
    if (summaryRows.total !== -1) rowsToUpdate.push(summaryRows.total);

    rowsToUpdate.forEach(rowIndex => {
        const row = ws.getRow(rowIndex);
        const cell = row.getCell(colIndex);
        let currentVal = parseInt(cell.value) || 0;
        cell.value = currentVal + 1;
    });
}

async function getCurrentSupabaseSession() {
    if (!window.supabaseClient) return null;

    try {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        return session || null;
    } catch (err) {
        console.error("Session lookup error:", err);
        return null;
    }
}

async function canCurrentUserScan(session) {
    if (!session || !navigator.onLine || !window.supabaseClient) return false;

    const { data: profile, error } = await window.supabaseClient
        .from('profiles')
        .select('can_scan, role')
        .eq('id', session.user.id)
        .single();

    if (error) throw error;
    return !!(profile && (profile.can_scan || profile.role === 'admin'));
}

async function remoteLogExists(log) {
    if (!window.supabaseClient || !navigator.onLine) return false;

    const { startIso, endIso } = getDayRangeForLocalDate(log.local_date || getLocalDateKey(new Date(log.scanned_at)));
    const { data, error } = await window.supabaseClient
        .from('attendance_logs')
        .select('*')
        .eq('student_lrn', log.student_lrn)
        .eq('session', log.session)
        .gte('scanned_at', startIso)
        .lte('scanned_at', endIso)
        .limit(1);

    if (error) throw error;
    return Array.isArray(data) && data.length > 0;
}

async function reconcilePendingScansWithRemote(session = null) {
    if (!offlineStore || !window.supabaseClient || !navigator.onLine) return 0;

    const activeSession = session || await getCurrentSupabaseSession();
    const pendingScans = await offlineStore.getPendingScans();
    let reconciledCount = 0;

    for (const scan of pendingScans) {
        try {
            const exists = await remoteLogExists(scan);
            if (!exists) continue;

            await offlineStore.markScanSynced(scan.scan_id, {
                ...scan,
                scanned_by: scan.scanned_by || activeSession?.user?.id || null,
                sync_status: 'synced',
                synced_at: new Date().toISOString()
            });
            reconciledCount++;
        } catch (err) {
            console.error(`Pending reconciliation failed for ${scan.student_lrn}:`, err.message);
        }
    }

    if (reconciledCount > 0) {
        await refreshPendingSyncCount();
    }

    return reconciledCount;
}

async function syncPendingAttendance(options = {}) {
    const silent = !!options.silent;

    if (!offlineStore || !window.supabaseClient || !navigator.onLine || isSyncingPendingScans) {
        updateCloudSyncBadge();
        return;
    }

    isSyncingPendingScans = true;
    updateCloudSyncBadge();

    try {
        const session = await getCurrentSupabaseSession();
        if (!session) throw new Error("No active session for sync.");

        const hasPermission = await canCurrentUserScan(session);
        if (!hasPermission) {
            throw new Error("Attendance scan permission is no longer available.");
        }

        await reconcilePendingScansWithRemote(session);
        const pendingScans = await offlineStore.getPendingScans();
        let syncedCount = 0;

        for (const scan of pendingScans) {
            try {
                const exists = await remoteLogExists(scan);

                if (!exists) {
                    const { error } = await window.supabaseClient
                        .from('attendance_logs')
                        .insert([{
                            student_lrn: scan.student_lrn,
                            session: scan.session,
                            status: scan.status,
                            scanned_at: scan.scanned_at,
                            section: scan.section,
                            scanned_by: scan.scanned_by || session.user.id
                        }]);

                    if (error) throw error;
                }

                await offlineStore.markScanSynced(scan.scan_id, {
                    ...scan,
                    scanned_by: scan.scanned_by || session.user.id,
                    sync_status: 'synced',
                    synced_at: new Date().toISOString()
                });
                syncedCount++;
            } catch (scanErr) {
                console.error(`Pending scan sync failed for ${scan.student_lrn}:`, scanErr.message);
                await offlineStore.upsertLog({
                    ...scan,
                    sync_status: 'failed',
                    last_error: scanErr.message
                });
            }
        }

        await refreshPendingSyncCount();

        if (syncedCount > 0) {
            if (!silent) {
                console.log(`✅ Synced ${syncedCount} pending attendance record(s).`);
            }
            await restoreAttendanceSession();
        }
    } catch (err) {
        console.error("Pending attendance sync error:", err.message);
    } finally {
        isSyncingPendingScans = false;
        updateCloudSyncBadge();
    }
}

async function logAttendanceToSupabase(student, timeData, scanTime = new Date()) {
    const session = await getCurrentSupabaseSession();
    const scannedAt = scanTime.toISOString();
    const logData = {
        scan_id: `local:${student.lrn}:${timeData.session}:${scanTime.getTime()}`,
        student_lrn: String(student.lrn),
        session: timeData.session,
        status: mapAttendanceStatusToDbStatus(timeData.status),
        scanned_at: scannedAt,
        created_at: scannedAt,
        local_date: getLocalDateKey(scanTime),
        section: student.section,
        scanned_by: session ? session.user.id : null,
        sync_status: 'pending',
        student_name: student.parsedName
    };

    try {
        if (offlineStore) {
            await offlineStore.queuePendingScan(logData);
            await offlineStore.saveMeta('last-local-scan-at', scannedAt);
        } else if (navigator.onLine && window.supabaseClient) {
            const { error } = await window.supabaseClient
                .from('attendance_logs')
                .insert([{
                    student_lrn: logData.student_lrn,
                    session: logData.session,
                    status: logData.status,
                    scanned_at: logData.scanned_at,
                    section: logData.section,
                    scanned_by: logData.scanned_by
                }]);

            if (error) throw error;
            logData.sync_status = 'synced';
        }

        await refreshPendingSyncCount();

        if (navigator.onLine) {
            await syncPendingAttendance({ silent: true });
        }
    } catch (err) {
        console.error("❌ Attendance queue error:", err.message);
    }

    return logData;
}

/**
 * Triggers a parent notification via Supabase Edge Function
 * This is currently optimized for Facebook Messenger integration.
 */
async function triggerParentNotification(student, timeData, scanTime) {
    if (!window.supabaseClient || !navigator.onLine) return;

    try {
        console.log(`[Notification] Triggering alert for ${student.parsedName} to parent ${student.parent_messenger_id}`);
        
        // We call a Supabase Edge Function that handles the Meta Graph API
        // This keeps our Facebook Page Access Token secure on the server side
        const { data, error } = await window.supabaseClient.functions.invoke('send-messenger-alert', {
            body: {
                psid: student.parent_messenger_id,
                studentName: student.parsedName,
                session: timeData.session,
                status: timeData.status,
                time: scanTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                type: timeData.session === 'AM' ? 'arrival' : 'departure'
            }
        });

        if (error) throw error;
        console.log("✅ Parent notification sent successfully.");
    } catch (err) {
        console.warn("⚠️ Notification trigger failed:", err.message);
        // We don't alert the user here as this is a background process
    }
}

// --- SCANNER LOGIC ---
async function onScanSuccess(decodedText, decodedResult) {
    // Critical: Only process scans if scanner is actively running and NOT switching cameras
    if (!isScannerActive || isSwitchingCamera || !html5QrCode || !html5QrCode.isScanning) {
        return;
    }

    const nowTimestamp = Date.now();
    const scannedInput = decodedText.trim().toUpperCase();
    const cleanLRN = scannedInput.replace(/[^0-9]/g, '');

    // 1. SCAN COOLDOWN: Prevent double-scanning same LRN within 5 seconds
    if (cleanLRN === lastScannedLrn && (nowTimestamp - lastScanTimestamp) < 5000) {
        console.log(`Scan ignored: Cooldown active for LRN ${cleanLRN}`);
        return;
    }
    
    const today = new Date();
    const dayOfWeek = today.getDay(); 
    const isTestMode = testModeToggle && testModeToggle.checked;

    if (!isTestMode && (dayOfWeek === 0 || dayOfWeek === 6)) {
        alert("Attendance cannot be recorded on weekends.");
        return;
    }

    let student = masterStudentDatabase.find(s => s.lrn === cleanLRN);

    if (!student) {
        student = masterStudentDatabase.find(s => {
            const excelParts = s.excelName.toUpperCase().split(',').map(p => p.trim());
            if (excelParts.length < 2) return false;
            return scannedInput.includes(excelParts[0]) && scannedInput.includes(excelParts[1]);
        });
    }

    if (student) {
        const timeData = getAttendanceStatus(student.lrn);
        const existing = attendanceSession.get(student.lrn);

        if (existing && existing.pm && timeData.session === 'PM') {
            showScanFeedback(student, "PM Session Already Scanned", "yellow");
            showScanOverlay(student.parsedName, student.lrn, 'warning', student.section, timeData);
            // Even if already scanned, update cooldown to prevent overlay spam
            lastScannedLrn = student.lrn;
            lastScanTimestamp = nowTimestamp;
            return;
        }
        
        if (existing && existing.am && timeData.session === 'AM') {
            showScanFeedback(student, "AM Session Already Scanned", "yellow");
            showScanOverlay(student.parsedName, student.lrn, 'warning', student.section, timeData);
            // Even if already scanned, update cooldown to prevent overlay spam
            lastScannedLrn = student.lrn;
            lastScanTimestamp = nowTimestamp;
            return;
        }

        // Update cooldown tracking
        lastScannedLrn = student.lrn;
        lastScanTimestamp = nowTimestamp;

        const scanTime = new Date();
        markAttendanceInExcel(student, timeData);
        
        attendanceSession.set(student.lrn, {
            am: timeData.am || (existing ? existing.am : null),
            pm: timeData.pm
        });

        // Local-first logging with queued cloud sync
        const savedLog = await logAttendanceToSupabase(student, timeData, scanTime);
        if (savedLog) {
            currentSessionLogs = mergeLogsByIdentity([savedLog, ...currentSessionLogs]);
            updateSessionLogCounters(currentSessionLogs);
            
            // Trigger Parent Notification (Facebook Messenger)
            if (student.notify_parent && student.parent_messenger_id) {
                triggerParentNotification(student, timeData, scanTime);
            }
        }

        updateDashboard(student, scanTime);
        showScanFeedback(student, "Success!", "green");
        addLog(student.lrn, student.parsedName, student.section, scanTime, timeData.session);
        showScanOverlay(student.parsedName, student.lrn, 'success', student.section, timeData);
        playBeep('success');
    } else {
        // Cooldown for unknown scans too
        if (scannedInput === lastScannedLrn && (nowTimestamp - lastScanTimestamp) < 5000) return;
        lastScannedLrn = scannedInput;
        lastScanTimestamp = nowTimestamp;

        showScanOverlay(scannedInput, "NOT FOUND", 'error', "Unknown Section", {status: 'INVALID', session: 'N/A'});
        playBeep('error');
    }
}

function playBeep(type) {
    try {
        const src = type === 'success' 
            ? 'https://assets.mixkit.co/sfx/preview/mixkit-software-interface-start-2574.mp3'
            : 'https://assets.mixkit.co/sfx/preview/mixkit-wrong-answer-fail-notification-946.mp3';
        const audio = new Audio(src);
        audio.play();
    } catch(e) {}
}

/**
 * Securely loads a student photo from multiple sources:
 * 1. In-memory dataURL (from ZIP upload)
 * 2. Supabase Private Storage (using authenticated download)
 * 3. Supabase Public Storage (legacy fallback)
 * 
 * @param {string} lrn - The student's LRN
 * @param {HTMLImageElement} imgElement - The <img> element to populate
 * @param {HTMLElement} placeholderElement - The placeholder <div> to show on error
 */
async function loadStudentPhotoSecurely(lrn, imgElement, placeholderElement) {
    if (!lrn || !imgElement) return;
    
    const lrnStr = String(lrn);
    const student = masterStudentDatabase.find(s => String(s.lrn) === lrnStr);
    
    // PRIORITY 1: In-memory dataURL (from ZIP)
    let dataURL = studentPhotos.get(lrnStr);

    if (!dataURL && offlineStore) {
        dataURL = await offlineStore.getPhoto(lrnStr);
        if (dataURL) {
            studentPhotos.set(lrnStr, dataURL);
        }
    }
    
    // If not in memory, check student object or use default path
    if (!dataURL) {
        dataURL = student?.photo_url || `profiles/${lrnStr}.webp`;
    }

    // Determine if it's a private storage path (doesn't have full URL and not a data URL)
    const isPrivatePath = dataURL && !dataURL.startsWith('http') && !dataURL.startsWith('data:');
    
    // Reset state before loading
    imgElement.style.display = 'block';
    imgElement.classList.remove('hidden');
    if (placeholderElement) {
        placeholderElement.style.display = 'none';
        placeholderElement.classList.add('hidden');
    }

    try {
        if (isPrivatePath && window.supabaseClient) {
            // SECURE FETCH: Authenticated download from private bucket
            const { data, error } = await window.supabaseClient.storage.from('student-photos').download(dataURL);
            if (error) throw error;

            const cachedDataURL = await blobToDataURL(data);
            studentPhotos.set(lrnStr, cachedDataURL);
            if (offlineStore) {
                await offlineStore.savePhoto(lrnStr, cachedDataURL);
            }

            imgElement.src = cachedDataURL;
            console.log(`✅ Secure photo loaded for LRN ${lrnStr}`);
        } else {
            // PUBLIC OR DATA URL: Standard loading with cache-buster for public URLs
            const finalUrl = dataURL.startsWith('data:') ? dataURL : (dataURL + (dataURL.includes('?') ? '&' : '?') + 't=' + Date.now());
            imgElement.src = finalUrl;
            if (dataURL.startsWith('data:') && offlineStore) {
                await offlineStore.savePhoto(lrnStr, dataURL);
            }
        }
    } catch (err) {
        console.error(`❌ Photo load failed for LRN ${lrnStr}:`, err.message);
        imgElement.style.display = 'none';
        imgElement.classList.add('hidden');
        if (placeholderElement) {
            placeholderElement.style.display = 'flex';
            placeholderElement.classList.remove('hidden');
        }
    }
}

function updateDashboard(student, scanTime = null) {
    if (!student) return;

    const lrnStr = String(student.lrn);
    const lastStudentName = document.getElementById('last-student-name');
    const lastStudentPhoto = document.getElementById('last-student-photo');
    const lastPhotoPlaceholder = document.getElementById('last-photo-placeholder');
    const lastScanTime = document.getElementById('last-scan-time');
    const lastScannedCard = document.getElementById('last-scanned-card');
    const presentCountDisplay = document.getElementById('present-count');
    const sectionDisplay = document.getElementById('section-name');
    const statusBadge = document.getElementById('last-scan-status-badge');

    if (lastStudentName) {
        lastStudentName.textContent = student.parsedName;
        lastStudentName.title = student.parsedName;
    }
    
    const displayTime = scanTime ? new Date(scanTime) : new Date();
    if (lastScanTime) lastScanTime.textContent = `${displayTime.toLocaleTimeString()} (${student.section})`;
    if (presentCountDisplay) presentCountDisplay.textContent = attendanceSession.size;
    
    const logCountEl = document.getElementById('total-logs-count');
    if (logCountEl) logCountEl.textContent = attendanceSession.size;

    if (sectionDisplay) sectionDisplay.textContent = student.section;
    
    if (statusBadge) {
        statusBadge.classList.remove('hidden');
        statusBadge.textContent = "SUCCESS";
    }
    
    // Use the new secure loader
    loadStudentPhotoSecurely(lrnStr, lastStudentPhoto, lastPhotoPlaceholder);

    if (lastScannedCard) {
        lastScannedCard.classList.add('scale-[1.05]', 'ring-4', 'ring-blue-400/50');
        setTimeout(() => {
            lastScannedCard.classList.remove('scale-[1.05]', 'ring-4', 'ring-blue-400/50');
        }, 500);
    }
}

function showScanFeedback(student, status, color) {
    if (!scanStatus) return;
    scanStatus.textContent = `${status}: ${student.parsedName || student.name}`;
    const colors = { green: "bg-green-500 text-white", red: "bg-red-500 text-white", yellow: "bg-yellow-500 text-white" };
    scanStatus.className = `px-3 py-1 ${colors[color]} rounded-full text-[10px] font-black uppercase tracking-widest animate-pulse`;
}

function showScanOverlay(name, lrn, type, section, timeData) {
    if (!scanOverlay) return;

    const lrnStr = String(lrn);
    overlayName.textContent = name;
    overlayLrn.textContent = `LRN: ${lrnStr} | ${section}`;
    
    // Use the secure loader for the overlay photo
    loadStudentPhotoSecurely(lrnStr, overlayPhoto, overlayPhotoPlaceholder);

    overlayTimeStatus.textContent = `${timeData.session} Session: ${timeData.status}`;
    overlayTimeStatus.className = "mt-4 inline-block px-6 py-2 rounded-full font-black text-xl uppercase tracking-widest shadow-lg ";
    
    // Reset overlay classes
    scanOverlay.className = "fixed inset-0 z-50 flex items-center justify-center backdrop-blur-md transition-opacity duration-300";
    
    if (type === 'success') {
        scanOverlay.classList.add('bg-green-600/90');
        overlayIconContainer.classList.add('text-green-600');
        overlayStatus.textContent = "Access Granted";
        overlayIconContainer.innerHTML = '<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg>';
        overlayTimeStatus.classList.add('bg-white', 'text-green-600');
    } else if (type === 'warning') {
        scanOverlay.classList.add('bg-yellow-500/90');
        overlayIconContainer.classList.add('text-yellow-600');
        overlayStatus.textContent = "Already Scanned";
        overlayIconContainer.innerHTML = '<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>';
        overlayTimeStatus.classList.add('bg-gray-800', 'text-white');
    } else {
        scanOverlay.classList.add('bg-red-600/90');
        overlayIconContainer.classList.add('text-red-600');
        overlayStatus.textContent = "Student Not Found";
        overlayIconContainer.innerHTML = '<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 18L18 6M6 6l12 12"></path></svg>';
        overlayTimeStatus.classList.add('bg-red-800', 'text-white', 'animate-pulse');
    }

    scanOverlay.classList.remove('hidden');
    
    if (window.overlayTimeout) clearTimeout(window.overlayTimeout);
    window.overlayTimeout = setTimeout(() => {
        scanOverlay.classList.add('hidden');
    }, 3000);
}

function addLog(lrn, name, section, scanTime = new Date(), sessionType = null) {
    if (emptyLogMsg) emptyLogMsg.classList.add('hidden');
    const lrnStr = String(lrn);

    // PREVENT DOUBLE UI ENTRIES: Check if this LRN already exists in the table as the very first row
    // (This handles the rapid double-fire UI glitch)
    const firstRow = scanLogsTable.querySelector('tr');
    if (firstRow) {
        const firstLrnElement = firstRow.querySelector('.font-mono');
        if (firstLrnElement && firstLrnElement.textContent.trim() === lrnStr) {
            console.log(`UI Log ignored: LRN ${lrnStr} already at top of table.`);
            return;
        }
    }

    const row = document.createElement('tr');
    row.className = "hover:bg-gray-50 transition-colors group border-b border-gray-100 last:border-0";
    
    const timeOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true };
    const displayTime = scanTime instanceof Date ? scanTime : new Date(scanTime);
    const timeStr = displayTime.toLocaleTimeString('en-PH', timeOptions);
    const resolvedSessionType = sessionType || getAttendanceStatus(lrnStr).session;
    
    const photoHTML = `
        <div class="flex justify-center">
            <img data-secure-lrn="${lrnStr}" class="w-10 h-10 rounded-lg student-photo-display border border-gray-100 shadow-sm" style="display: none">
            <div class="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-gray-300">
                <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd"></path></svg>
            </div>
        </div>`;

    row.innerHTML = `
        <td class="px-4 py-3 text-center">
            ${photoHTML}
        </td>
        <td class="px-4 py-3">
            <div class="font-mono text-[11px] font-black text-gray-900">${lrnStr}</div>
            <div class="text-blue-600 font-black uppercase tracking-tighter text-[9px] bg-blue-50 px-1.5 py-0.5 rounded inline-block mt-1">${section}</div>
        </td>
        <td class="px-4 py-3 font-black text-gray-900 uppercase text-xs tracking-tight">${name}</td>
        <td class="px-4 py-3 text-right">
            <div class="font-black text-gray-900 text-xs tabular-nums">${timeStr}</div>
            <div class="text-[8px] font-black text-blue-500 uppercase tracking-widest mt-0.5">${resolvedSessionType} SESSION</div>
        </td>
    `;
    scanLogsTable.prepend(row);
    
    // Securely load the photo for the new row
    const newImg = row.querySelector('img[data-secure-lrn]');
    const placeholder = newImg.nextElementSibling;
    loadStudentPhotoSecurely(lrnStr, newImg, placeholder);

    if (logCount) logCount.textContent = `${attendanceSession.size} STUDENTS`;
}

// --- EXPORT (ZIP VERSION) ---
async function exportAllAsZip() {
    const zip = new JSZip();
    const sectionsWithData = Object.values(sectionWorkbooks);
    
    if (sectionsWithData.length === 0) return;

    statusTitle.textContent = "Generating ZIP...";
    statusIcon.classList.add('animate-spin');

    for (const section of sectionsWithData) {
        const buffer = await section.workbook.xlsx.writeBuffer();
        zip.file(`Attendance_${section.info.section}.xlsx`, buffer);
    }

    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, `ULHS_Attendance_Reports_${new Date().toISOString().split('T')[0]}.zip`);
    
    statusTitle.textContent = "Export Complete";
    setTimeout(() => statusTitle.textContent = "Campus Session Ready", 3000);
}

// --- EXPORT SF2 FROM TEMPLATE ---
async function exportAllSF2(levelFilter = null) {
    if (masterStudentDatabase.length === 0) return;
    
    // Filter database by level if filter provided
    const filteredDatabase = levelFilter 
        ? masterStudentDatabase.filter(s => s.level === levelFilter)
        : masterStudentDatabase;

    if (filteredDatabase.length === 0) {
        alert(`No students found for ${levelFilter || 'any level'}.`);
        return;
    }

    statusTitle.textContent = levelFilter ? `Exporting SF2 (${levelFilter})...` : "Fetching Data...";
    statusIcon.classList.add('animate-spin');

    try {
        // 1. Fetch Logs & School Info for Targeted Date
        const exportMonth = document.getElementById('export-month');
        const exportYear = document.getElementById('export-year');
        
        const targetMonth = exportMonth ? parseInt(exportMonth.value) : new Date().getMonth();
        const targetYear = exportYear ? parseInt(exportYear.value) : new Date().getFullYear();
        
        const startOfMonth = new Date(targetYear, targetMonth, 1).toISOString();
        const endOfMonth = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59).toISOString();
        
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const monthName = monthNames[targetMonth];
        
        // Parallel fetch for speed
        const [logsRes, schoolRes, headRes, profilesRes] = await Promise.all([
            window.supabaseClient.from('attendance_logs').select('*').gte('scanned_at', startOfMonth).lte('scanned_at', endOfMonth),
            window.supabaseClient.from('school_info').select('*'), // Fetch all to be safe
            window.supabaseClient.from('profiles').select('full_name').eq('role', 'school_head').maybeSingle(),
            window.supabaseClient.from('profiles').select('full_name, section_assigned').not('section_assigned', 'is', null)
        ]);

        // Check for critical errors
        if (logsRes.error) {
            console.error("Logs Fetch Error:", logsRes.error);
            throw new Error("Could not fetch attendance logs.");
        }
        
        const monthLogs = logsRes.data || [];
        const schoolInfo = (schoolRes.data && schoolRes.data.length > 0) ? schoolRes.data[0] : {};
        const schoolHead = headRes.data?.full_name || schoolInfo.school_head || schoolInfo.schoolHead || '';
        
        console.log("SF2 Export - School Info Loaded:", schoolInfo);
        if (Object.keys(schoolInfo).length === 0) {
            console.warn("⚠️ SF2 Export: school_info table is empty or inaccessible. Headers will not be filled.");
        }
        
        // Map section names to adviser names from profiles
        const adviserMap = {};
        if (profilesRes.data) {
            profilesRes.data.forEach(p => {
                if (p.section_assigned) adviserMap[p.section_assigned.toUpperCase()] = p.full_name;
            });
        } else if (profilesRes.error) {
            console.warn("⚠️ Could not fetch Adviser mappings. Ensure 'section_assigned' column exists in 'profiles' table.", profilesRes.error);
        }

        // 2. Determine Required Templates
        const zip = new JSZip();
        const sections = [...new Set(filteredDatabase.map(s => s.section))];
        const levelsRequired = [...new Set(filteredDatabase.map(s => s.level))];
        
        statusTitle.textContent = "Loading Templates...";
        const templates = {};
        await Promise.all(levelsRequired.map(async (lvl) => {
            const fileName = SF2_MAPPINGS[lvl]?.template || 'SF2_Blank.xlsx';
            const res = await fetch(`../../assets/admin/attendance/templates/${fileName}`);
            templates[lvl] = await res.arrayBuffer();
        }));

        for (const sectionName of sections) {
            statusTitle.textContent = `Processing ${sectionName}...`;
            
            const studentsInSection = filteredDatabase.filter(s => s.section === sectionName);
            const level = studentsInSection[0].level;
            const mapping = SF2_MAPPINGS[level] || SF2_MAPPINGS['JHS'];

            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(templates[level]);
            
            const sheetName = detectSheetName(workbook);
            const worksheet = workbook.getWorksheet(sheetName);

            // 3. Fill School Header Info
            const hasSchoolInfo = schoolInfo && Object.keys(schoolInfo).length > 0;
            if (hasSchoolInfo) {
                const h = mapping.headers;
                // Handle both snake_case, camelCase, and direct keys from database
                const sId = schoolInfo.school_id || schoolInfo.schoolId || schoolInfo.school_ID || '';
                const sName = schoolInfo.school_name || schoolInfo.schoolName || schoolInfo.school_Name || '';
                const sYear = schoolInfo.school_year || schoolInfo.schoolYear || schoolInfo.school_Year || '';
                const sDist = schoolInfo.district || schoolInfo.District || '';
                const sDiv = schoolInfo.division || schoolInfo.Division || '';
                const sReg = schoolInfo.region || schoolInfo.Region || '';
                const sAdv = schoolInfo.adviser || schoolInfo.adviser_name || schoolInfo.Adviser || '';

                if (h.schoolId && sId) worksheet.getCell(h.schoolId).value = String(sId);
                if (h.schoolName && sName) worksheet.getCell(h.schoolName).value = String(sName);
                if (h.district && sDist) worksheet.getCell(h.district).value = String(sDist);
                if (h.division && sDiv) worksheet.getCell(h.division).value = String(sDiv);
                if (h.region && sReg) worksheet.getCell(h.region).value = String(sReg);
                if (h.schoolYear && sYear) worksheet.getCell(h.schoolYear).value = String(sYear);
                
                // Static headers from session/calculated data
                const gLevel = studentsInSection[0].grade_level || '';
                const formattedGrade = gLevel ? (String(gLevel).toLowerCase().includes('grade') ? gLevel : `Grade ${gLevel}`) : '';

                if (h.gradeLevel) worksheet.getCell(h.gradeLevel).value = String(formattedGrade);
                if (h.section) worksheet.getCell(h.section).value = String(sectionName);
                if (h.month) worksheet.getCell(h.month).value = String(monthName);
                
                if (h.adviser) {
                    const assignedAdviser = adviserMap[sectionName.toUpperCase()];
                    const adviserToFill = assignedAdviser || sAdv;
                    if (adviserToFill) worksheet.getCell(h.adviser).value = String(adviserToFill).toUpperCase();
                }
                if (h.schoolHead && schoolHead) worksheet.getCell(h.schoolHead).value = String(schoolHead);
                
                console.log(`✅ Filled headers for ${sectionName} using:`, { sId, sName, sYear, schoolHead, grade: formattedGrade });
            } else {
                console.error("❌ school_info is empty. Check Supabase table and RLS policies.");
                alert("Warning: School Information could not be loaded from the database. Headers will be empty.");
            }

            // Sort students: Male first, then Female (alphabetical)
            // Ensure gender is matched exactly as 'male' or 'female'
            const sortedStudents = [
                ...studentsInSection.filter(s => s.gender === 'male').sort((a, b) => a.parsedName.localeCompare(b.parsedName)),
                ...studentsInSection.filter(s => s.gender === 'female').sort((a, b) => a.parsedName.localeCompare(b.parsedName))
            ];

            if (sortedStudents.length === 0) {
                console.warn(`No students found for section ${sectionName} with valid gender.`, studentsInSection);
            }

            // Get weekday of the 1st day of the TARGET month (0=Sun, 1=Mon, ..., 6=Sat)
            const firstDayOfMonth = new Date(targetYear, targetMonth, 1);
            const firstWeekday = firstDayOfMonth.getDay();

            // SF2 Column Mapping (F, H-L, N-R, T-V, X, Z, AB-AE, AF-AK)
            const SF2_ATT_COLS = [6, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 20, 21, 22, 24, 26, 28, 29, 30, 31, 32, 33, 35, 36, 37];

            // 4.1 Fill Date Headers & Weekdays (Row 6/5 for JHS, Row 10/9 for SHS)
            const weekdayInitialsMap = { 1: 'M', 2: 'T', 3: 'W', 4: 'TH', 5: 'F' };
            const lastDayInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
            
            const dayRowNumber = level === 'SHS' ? 10 : 6;
            const initialRowNumber = level === 'SHS' ? 9 : 5;
            const initialRow = worksheet.getRow(initialRowNumber);
            const dayRow = worksheet.getRow(dayRowNumber);

            for (let d = 1; d <= lastDayInMonth; d++) {
                const date = new Date(targetYear, targetMonth, d);
                const w = date.getDay();
                if (w === 0 || w === 6) continue; // Skip weekends

                // Use the same formula as the logs to find the correct column
                const daysSinceGridStart = (d - 1) + (firstWeekday === 0 ? 1 : (firstWeekday === 6 ? 2 : firstWeekday - 1));
                const fullWeeks = Math.floor(daysSinceGridStart / 7);
                const remainingDays = daysSinceGridStart % 7;
                const colOffset = (fullWeeks * 5) + remainingDays;

                if (colOffset >= 0 && colOffset < SF2_ATT_COLS.length) {
                    const colIndex = SF2_ATT_COLS[colOffset];
                    initialRow.getCell(colIndex).value = weekdayInitialsMap[w];
                    dayRow.getCell(colIndex).value = d;
                    
                    // Basic formatting to match SF2 style
                    [initialRow, dayRow].forEach(r => {
                        const cell = r.getCell(colIndex);
                        cell.alignment = { horizontal: 'center', vertical: 'middle' };
                        cell.font = { name: 'Arial', size: 8, bold: true };
                    });
                }
            }

            // 4. Fill Student Data & Logs
            const dailySummary = {}; // To store totals per day
            let maleIdx = 0;
            let femaleIdx = 0;

            // For summary calculations
            const schoolDays = [];
            for (let d = 1; d <= lastDayInMonth; d++) {
                const date = new Date(targetYear, targetMonth, d);
                if (date.getDay() !== 0 && date.getDay() !== 6) schoolDays.push(d);
            }

            const consecutiveAbsences = { male: 0, female: 0 };

            // Log gender grouping for debugging
            const males = sortedStudents.filter(s => s.gender === 'male');
            const females = sortedStudents.filter(s => s.gender === 'female');
            console.log(`Section ${sectionName} Grouping: ${males.length} Males, ${females.length} Females`);

            sortedStudents.forEach((student) => {
                let currentRow;
                if (student.gender === 'male') {
                    currentRow = (mapping.maleStartRow || mapping.startRow) + maleIdx;
                    maleIdx++;
                } else {
                    currentRow = (mapping.femaleStartRow || (mapping.startRow + maleIdx)) + femaleIdx;
                    femaleIdx++;
                }

                const row = worksheet.getRow(currentRow);
                row.getCell(mapping.nameCol).value = student.excelName;

                // Fill Logs for this student
                const studentLogs = monthLogs.filter(l => String(l.student_lrn) === String(student.lrn));

                // Track absences/presence for this student
                let studentPresentDays = 0;
                let studentAbsentDays = 0;
                let currentConsecutive = 0;
                let maxConsecutive = 0;

                schoolDays.forEach(day => {
                    // Find AM and PM logs for this day
                    const dayLogs = studentLogs.filter(l => new Date(l.scanned_at).getDate() === day);
                    const amLog = dayLogs.find(l => l.session === 'AM');
                    const pmLog = dayLogs.find(l => l.session === 'PM');
                    
                    let code = '';
                    const isAbsent = !amLog && !pmLog;

                    if (isAbsent) {
                        code = 'X';
                        studentAbsentDays++;
                        currentConsecutive++;
                        if (currentConsecutive > maxConsecutive) maxConsecutive = currentConsecutive;
                    } else {
                        studentPresentDays++;
                        currentConsecutive = 0;

                        // Tardy Morning: Late in AM OR Missing AM but has PM
                        if ((amLog && amLog.status !== 'PRESENT') || (!amLog && pmLog)) {
                            code += '/';
                        }
                        // Tardy Afternoon: Late in PM OR Has AM but missing PM
                        if ((pmLog && pmLog.status !== 'PRESENT') || (amLog && !pmLog)) {
                            code += '\\';
                        }

                        // Track daily summary (if student is not absent)
                        if (!dailySummary[day]) dailySummary[day] = { male: 0, female: 0 };
                        if (student.gender === 'male') dailySummary[day].male++;
                        else dailySummary[day].female++;
                    }

                    // Calculate Column for this day
                    const date = new Date(targetYear, targetMonth, day);
                    const firstWeekday = new Date(targetYear, targetMonth, 1).getDay();
                    const daysSinceGridStart = (day - 1) + (firstWeekday === 0 ? 1 : (firstWeekday === 6 ? 2 : firstWeekday - 1));
                    const fullWeeks = Math.floor(daysSinceGridStart / 7);
                    const remainingDays = daysSinceGridStart % 7;
                    const colOffset = (fullWeeks * 5) + remainingDays;
                    
                    if (colOffset >= 0 && colOffset < SF2_ATT_COLS.length) {
                        const colIndex = SF2_ATT_COLS[colOffset];
                        const cell = row.getCell(colIndex);
                        cell.value = code;
                        cell.alignment = { horizontal: 'center' };
                        // If it's a Tardy marking, make it look clean
                        if (code === '/' || code === '\\' || code === '/\\') {
                            cell.font = { name: 'Arial', size: 9, bold: true };
                        }
                    }
                });

                // Fill Per-Student Totals (AM = Col 39, AO = Col 41)
                row.getCell(39).value = studentAbsentDays || ''; // Total Absent
                row.getCell(41).value = studentPresentDays || ''; // Total Present
                [39, 41].forEach(c => row.getCell(c).alignment = { horizontal: 'center' });

                if (maxConsecutive >= 5) {
                    if (student.gender === 'male') consecutiveAbsences.male++;
                    else consecutiveAbsences.female++;
                }
            });

            // 5. Fill Attendance Summary Tables (Daily & Monthly)
            const maleDailyRow = worksheet.getRow(level === 'SHS' ? 29 : 24);
            const femaleDailyRow = worksheet.getRow(level === 'SHS' ? 57 : 51);
            const totalDailyRow = worksheet.getRow(level === 'SHS' ? 58 : 52);

            let totalMaleAttendance = 0;
            let totalFemaleAttendance = 0;

            schoolDays.forEach(day => {
                const data = dailySummary[day] || { male: 0, female: 0 };
                totalMaleAttendance += data.male;
                totalFemaleAttendance += data.female;

                // Find the column for this day again
                const firstWeekday = new Date(targetYear, targetMonth, 1).getDay();
                const daysSinceGridStart = (day - 1) + (firstWeekday === 0 ? 1 : (firstWeekday === 6 ? 2 : firstWeekday - 1));
                const fullWeeks = Math.floor(daysSinceGridStart / 7);
                const remainingDays = daysSinceGridStart % 7;
                const colOffset = (fullWeeks * 5) + remainingDays;

                if (colOffset >= 0 && colOffset < SF2_ATT_COLS.length) {
                    const colIndex = SF2_ATT_COLS[colOffset];
                    maleDailyRow.getCell(colIndex).value = data.male || '';
                    femaleDailyRow.getCell(colIndex).value = data.female || '';
                    totalDailyRow.getCell(colIndex).value = (data.male + data.female) || '';
                    
                    [maleDailyRow, femaleDailyRow, totalDailyRow].forEach(r => {
                        r.getCell(colIndex).alignment = { horizontal: 'center' };
                    });
                }
            });

            // Monthly Summary Totals
            const avgMale = schoolDays.length > 0 ? (totalMaleAttendance / schoolDays.length) : 0;
            const avgFemale = schoolDays.length > 0 ? (totalFemaleAttendance / schoolDays.length) : 0;
            const percMale = males.length > 0 ? ((avgMale / males.length) * 100) : 0;
            const percFemale = females.length > 0 ? ((avgFemale / females.length) * 100) : 0;

            if (level === 'JHS') {
                worksheet.getCell('AR55').value = males.length;
                worksheet.getCell('AS55').value = females.length;
                worksheet.getCell('AR65').value = parseFloat(avgMale.toFixed(2));
                worksheet.getCell('AS65').value = parseFloat(avgFemale.toFixed(2));
                worksheet.getCell('AR67').value = parseFloat(percMale.toFixed(2));
                worksheet.getCell('AS67').value = parseFloat(percFemale.toFixed(2));
                worksheet.getCell('AR68').value = consecutiveAbsences.male;
                worksheet.getCell('AS68').value = consecutiveAbsences.female;
            } else {
                worksheet.getCell('AR62').value = males.length;
                worksheet.getCell('AS62').value = females.length;
                worksheet.getCell('AR66').value = parseFloat(avgMale.toFixed(2));
                worksheet.getCell('AS66').value = parseFloat(avgFemale.toFixed(2));
                worksheet.getCell('AR67').value = parseFloat(percMale.toFixed(2));
                worksheet.getCell('AS67').value = parseFloat(percFemale.toFixed(2));
                worksheet.getCell('AR68').value = consecutiveAbsences.male;
                worksheet.getCell('AS68').value = consecutiveAbsences.female;
            }

            // 6. Finalize Workbook
            const buffer = await workbook.xlsx.writeBuffer();
            zip.file(`SF2_${sectionName}.xlsx`, buffer);
        }

        statusTitle.textContent = "Finalizing ZIP...";
        const zipContent = await zip.generateAsync({ type: "blob" });
        const fileNamePrefix = levelFilter ? `SF2_${levelFilter}_` : "SF2_Reports_";
        saveAs(zipContent, `${fileNamePrefix}${targetYear}_${targetMonth + 1}.zip`);
        
        statusTitle.textContent = "Export Complete";
        statusIcon.classList.remove('animate-spin');
    } catch (err) {
        console.error("Export Error:", err);
        statusTitle.textContent = "Export Failed";
        statusIcon.classList.remove('animate-spin');
    }
}

// --- CAMERA INITIALIZATION & SWITCHING ---
const initScannerConfig = () => {
    return {
        fps: 15,  // Reduced for stability
        qrbox: (viewfinderWidth, viewfinderHeight) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            const boxSize = Math.floor(minEdge * 0.8);
            return { width: boxSize, height: boxSize };
        },
        aspectRatio: 1.0,
        experimentalFeatures: {
            useBarCodeDetectorIfSupported: true
        },
        videoConstraints: {
            // More flexible constraints for laptop built-in cameras
            width: { min: 320, ideal: 640, max: 1280 },
            height: { min: 240, ideal: 480, max: 720 }
            // Don't specify facingMode here - it will be set when starting with specific camera ID
        }
    };
};

// Properly release camera and video stream
const releaseCameraStream = async () => {
    if (!html5QrCode) return;
    
    try {
        // Stop scanning if running
        if (html5QrCode.isScanning) {
            await html5QrCode.stop();
            console.log("Scanner stopped");
        }
    } catch (err) {
        console.error("Error stopping scanner:", err);
    }
    
    try {
        // Get the video element and stop all tracks
        const videoElement = document.querySelector('#reader video');
        if (videoElement && videoElement.srcObject) {
            const stream = videoElement.srcObject;
            // Stop all media tracks
            stream.getTracks().forEach(track => {
                track.stop();
                console.log("Stopped track:", track.kind);
            });
            videoElement.srcObject = null;
        }
    } catch (err) {
        console.error("Error releasing video stream:", err);
    }
    
    // Clear the instance
    html5QrCode = null;
};

const startScannerWithCamera = async (cameraIdOrFacingMode) => {
    try {
        console.log("Starting scanner with camera:", cameraIdOrFacingMode);
        
        // Completely release any existing camera first
        await releaseCameraStream();
        
        // Wait to ensure camera is fully released by OS
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Create completely new instance
        html5QrCode = new Html5Qrcode("reader");
        
        if (!scannerConfig) {
            scannerConfig = initScannerConfig();
        }
        
        // Create a config copy for this specific camera
        const cameraConfig = JSON.parse(JSON.stringify(scannerConfig));
        
        // If using a specific camera ID, remove any facingMode constraint
        if (typeof cameraIdOrFacingMode === 'string') {
            // Camera ID provided - device-specific
            console.log("Using specific camera ID:", cameraIdOrFacingMode);
        } else if (typeof cameraIdOrFacingMode === 'object') {
            // FacingMode provided - add it to config
            if (cameraIdOrFacingMode.facingMode) {
                cameraConfig.videoConstraints.facingMode = cameraIdOrFacingMode.facingMode;
                console.log("Using facing mode:", cameraIdOrFacingMode.facingMode);
            }
        }
        
        // Start with new camera
        await html5QrCode.start(cameraIdOrFacingMode, cameraConfig, onScanSuccess);
        
        // Update state after successful start
        if (typeof cameraIdOrFacingMode === 'string') {
            activeCameraId = cameraIdOrFacingMode;
            if (cameraSelect && cameraSelect.value !== cameraIdOrFacingMode) {
                cameraSelect.value = cameraIdOrFacingMode;
            }
        } else {
            // If started via facingMode, try to find the actual ID from the scanner
            activeCameraId = html5QrCode.getRunningTrack()?.getSettings()?.deviceId || null;
            if (activeCameraId && cameraSelect) {
                cameraSelect.value = activeCameraId;
            }
        }
        
        isScannerActive = true;
        startBtn.classList.add('hidden');
        stopBtn.classList.remove('hidden');
        scannerPlaceholder.classList.add('hidden');
        scanStatus.textContent = "CAMPUS SCANNING ACTIVE";
        scanStatus.className = "px-3 py-1 bg-blue-600 text-white rounded-full text-[10px] font-black uppercase tracking-widest animate-pulse";
        
        console.log("Scanner successfully started with camera:", cameraIdOrFacingMode);
    } catch (err) {
        console.error("Failed to start scanner:", err);
        await releaseCameraStream();
        throw err;
    }
};

const switchCamera = async (cameraId) => {
    // Only switch if actively scanning and switching to a different camera
    if (!isScannerActive) {
        console.log("Scanner not active, cannot switch");
        return;
    }
    
    // Check if the target is actually different
    if (cameraId === activeCameraId) {
        console.log("Same camera selected, skipping switch");
        return;
    }
    
    try {
        console.log("=== Camera Switch Starting ===");
        console.log("Switching from:", activeCameraId, "to:", cameraId);
        
        // Set flag to prevent scanning during switch
        isSwitchingCamera = true;
        
        // Properly release the current camera and all video streams
        await releaseCameraStream();
        console.log("Camera stream released");
        
        // Extended wait to ensure OS completely releases hardware
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Start new camera
        console.log("Starting new camera...");
        await startScannerWithCamera(cameraId);
        
        console.log("=== Camera Switch Complete ===");
        
    } catch (err) {
        console.error("Camera switch failed:", err);
        isScannerActive = false;
        await releaseCameraStream();
        alert("Camera switch failed: " + err.message);
    } finally {
        // Always clear the switching flag
        isSwitchingCamera = false;
    }
};

// Set up camera selection listener (attached once globally)
cameraSelect.addEventListener('change', async (e) => {
    await switchCamera(e.target.value);
});

exportBtn.addEventListener('click', exportAllAsZip);

startBtn.addEventListener('click', async () => {
    try {
        console.log("=== Launch Scanner ===");
        const cameras = await Html5Qrcode.getCameras();
        console.log("Available cameras:", cameras);
        
        if (cameras && cameras.length > 0) {
            cameraSelectContainer.classList.remove('hidden');
            cameraSelect.innerHTML = cameras.map(cam => `<option value="${cam.id}">${cam.label || `Camera ${cam.id.substring(0,5)}`}</option>`).join('');
            
            // Try each camera in sequence using their IDs (no facingMode)
            let cameraStarted = false;
            let lastError = null;
            
            for (const camera of cameras) {
                try {
                    console.log("Attempting to start camera:", camera.label || camera.id);
                    await startScannerWithCamera(camera.id);
                    cameraStarted = true;
                    console.log("Camera started successfully!");
                    break;
                } catch (err) {
                    console.error("Failed to start camera:", camera.label, err);
                    lastError = err;
                    // Wait a bit before trying the next camera
                    await new Promise(resolve => setTimeout(resolve, 300));
                    continue;
                }
            }
            
            if (!cameraStarted) {
                console.error("No camera devices worked, trying fallback facing modes");
                // Fallback to facing modes only if no device worked
                try {
                    console.log("Trying environment facing mode...");
                    await startScannerWithCamera({ facingMode: "environment" });
                    cameraStarted = true;
                } catch (err) {
                    console.error("Environment mode failed:", err);
                    lastError = err;
                    try {
                        console.log("Trying user facing mode...");
                        await startScannerWithCamera({ facingMode: "user" });
                        cameraStarted = true;
                    } catch (err2) {
                        console.error("User mode failed:", err2);
                        lastError = err2;
                    }
                }
            }
            
            if (!cameraStarted) {
                console.error("All camera methods failed:", lastError);
                alert("Camera Error: Could not start any camera.\n\n" + lastError);
                return;
            }
        } else {
            // No cameras detected via enumeration, try facing modes
            console.log("No cameras detected via enumeration, trying fallback facing modes");
            let started = false;
            try {
                console.log("Trying environment facing mode (fallback)...");
                await startScannerWithCamera({ facingMode: "environment" });
                started = true;
            } catch (err) {
                console.error("Environment mode failed:", err);
                try {
                    console.log("Trying user facing mode (fallback)...");
                    await startScannerWithCamera({ facingMode: "user" });
                    started = true;
                } catch (err2) {
                    console.error("User mode failed:", err2);
                    alert("Camera Error: Could not access any camera.\n\n" + err2);
                    return;
                }
            }
        }
    } catch (err) {
        console.error("Camera initialization error:", err);
        alert("Camera Error: " + err);
    }
});

stopBtn.addEventListener('click', async () => {
    console.log("Stop button clicked");
    try {
        // Properly release camera and stream
        await releaseCameraStream();
        console.log("Camera fully released");
    } catch (err) {
        console.error("Error stopping scanner:", err);
    } finally {
        isScannerActive = false;
        isSwitchingCamera = false;
        activeCameraId = null;
        startBtn.classList.remove('hidden');
        stopBtn.classList.add('hidden');
        scannerPlaceholder.classList.remove('hidden');
        scanStatus.textContent = "SCANNER STOPPED";
    }
});

// Cloud Sync: Upload Photos to Supabase Storage & Update Database
async function syncPhotosToSupabase() {
    if (pendingPhotoSync.size === 0) {
        alert("No new or updated photos found to sync. Upload a ZIP file first.");
        return;
    }

    const syncBtn = document.getElementById('sync-photos-btn');
    const originalText = syncBtn.innerHTML;
    
    if (!confirm(`Are you sure you want to upload ${pendingPhotoSync.size} photos to the cloud? This will link them to the students' records in Supabase.`)) return;

    try {
        syncBtn.disabled = true;
        syncBtn.innerHTML = '<i class="fa-solid fa-circle-notch animate-spin"></i> Syncing...';
        
        let successCount = 0;
        let failCount = 0;
        const totalToSync = pendingPhotoSync.size;

        const pendingLrns = Array.from(pendingPhotoSync);
        const CHUNK_SIZE = 5; // Process 5 photos at a time
        
        for (let i = 0; i < pendingLrns.length; i += CHUNK_SIZE) {
            const chunk = pendingLrns.slice(i, i + CHUNK_SIZE);
            
            await Promise.all(chunk.map(async (lrn) => {
                const dataURL = studentPhotos.get(lrn);
                if (!dataURL) return;

                try {
                    // 1. Convert DataURL to a clean Image Blob
                    const parts = dataURL.split(',');
                    const mimeMatch = parts[0].match(/:(.*?);/);
                    let mimeType = mimeMatch ? mimeMatch[1] : 'image/webp';
                    
                    // Fallback for generic octet-stream - default to webp since we know it's a student photo
                    if (mimeType === 'application/octet-stream') {
                        mimeType = 'image/webp';
                    }
                    
                    const extension = mimeType.split('/')[1] || 'webp';
                    const cleanExtension = extension === 'jpeg' ? 'jpg' : extension;
                    
                    const byteString = atob(parts[1]);
                    const arrayBuffer = new ArrayBuffer(byteString.length);
                    const uint8Array = new Uint8Array(arrayBuffer);
                    
                    for (let j = 0; j < byteString.length; j++) {
                        uint8Array[j] = byteString.charCodeAt(j);
                    }
                    
                    const blob = new Blob([uint8Array], { type: mimeType });
                    const fileName = `${lrn}.${cleanExtension}`;
                    const filePath = `profiles/${fileName}`;

                    // 2. Upload to Supabase Storage
                    const { error: uploadError } = await window.supabaseClient
                        .storage
                        .from('student-photos')
                        .upload(filePath, blob, {
                            cacheControl: '3600',
                            upsert: true,
                            contentType: mimeType
                        });

                    if (uploadError) throw uploadError;

                    // 3. Update Students Table
                    const { error: updateError } = await window.supabaseClient
                        .from('students')
                        .update({ photo_url: filePath })
                        .eq('lrn', lrn);

                    if (updateError) throw updateError;

                    successCount++;
                    pendingPhotoSync.delete(lrn);
                } catch (err) {
                    console.error(`Failed to sync photo for LRN ${lrn}:`, err.message);
                    failCount++;
                }
            }));

            syncBtn.innerHTML = `<i class="fa-solid fa-circle-notch animate-spin"></i> Syncing (${successCount}/${totalToSync})...`;
        }

        alert(`Sync Complete!\n✅ Success: ${successCount}\n❌ Failed: ${failCount}`);
        
        // Reset button state via centralized function
        updateSyncButtonState();
        
    } catch (err) {
        console.error("Global Sync Error:", err.message);
        alert("An error occurred during sync: " + err.message);
    } finally {
        syncBtn.disabled = pendingPhotoSync.size === 0;
        syncBtn.innerHTML = originalText;
    }
}

// --- SECURITY: SESSION TIMEOUT ---
let inactivityTimer;
const INACTIVITY_LIMIT = 30 * 60 * 1000; // 30 minutes in milliseconds

function resetInactivityTimer() {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(logoutDueToInactivity, INACTIVITY_LIMIT);
}

function logoutDueToInactivity() {
    console.warn("Security: Logging out due to 30 minutes of inactivity.");
    sessionStorage.removeItem('adminLoggedIn');
    alert("You have been logged out due to inactivity for security purposes.");
    window.location.href = '../admin.html';
}

async function initializeAttendanceApp() {
    if (appInitialized) return;
    appInitialized = true;

    await hydrateFromOfflineCache();
    await initSupabaseSync();
    await refreshPendingSyncCount();
    
    // Initial sync button state
    updateSyncButtonState();

    if (navigator.onLine) {
        await reconcilePendingScansWithRemote();
        await syncPendingAttendance({ silent: true });
    }

    if (syncIntervalId) clearInterval(syncIntervalId);
    syncIntervalId = setInterval(() => {
        if (navigator.onLine) {
            syncPendingAttendance({ silent: true });
        }
    }, 30000);
}

window.addEventListener('online', async () => {
    updateCloudSyncBadge();
    await initSupabaseSync();
    await reconcilePendingScansWithRemote();
    await syncPendingAttendance({ silent: true });
});

window.addEventListener('offline', () => {
    isCloudSynced = false;
    if (masterStudentDatabase.length > 0) {
        updateUIWithCacheData();
    } else {
        updateCloudSyncBadge();
    }
});

// Attach inactivity listeners
['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'].forEach(evt => {
    document.addEventListener(evt, resetInactivityTimer, true);
});

// Initialize on Load
document.addEventListener('DOMContentLoaded', () => {
    // Check if user is logged in
    if (sessionStorage.getItem('adminLoggedIn') !== 'true') {
        window.location.href = '../admin.html';
        return;
    }
    
    // Start inactivity timer immediately
    resetInactivityTimer();
    
    // Start offline-first attendance data flow
    initializeAttendanceApp();
    
    // Attach Sync Listener
    const syncPhotosBtn = document.getElementById('sync-photos-btn');
    if (syncPhotosBtn) {
        syncPhotosBtn.addEventListener('click', syncPhotosToSupabase);
    }

    updateCloudSyncBadge();
});
