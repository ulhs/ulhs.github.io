// Configuration
let masterStudentDatabase = [];
let sectionWorkbooks = {}; // Stores ExcelJS workbook objects indexed by section name
let studentPhotos = new Map(); // lrn -> dataURL (in-memory storage)
let html5QrCode = null;
let attendanceSession = new Map(); // lrn -> { am: 'P'|'T'|null, pm: 'P'|'T'|'A'|null }
let totalCampusPopulation = 0;

// Supabase Integration Status
let isCloudSynced = false;

// --- SUPABASE INTEGRATION ---
async function initSupabaseSync() {
    // Wait for client to be ready
    if (!window.supabaseClient) {
        console.log("Sync: Waiting for client...");
        setTimeout(initSupabaseSync, 100);
        return;
    }

    try {
        const { data: students, error } = await window.supabaseClient
            .from('students')
            .select('*');

        if (error) throw error;

        if (students && students.length > 0) {
            console.log(`Cloud Sync: ${students.length} students loaded.`);
            
            // Map Supabase data to local format
            const cloudStudents = students.map(s => {
                // Determine gender/sex with flexible naming (gender or sex)
                const rawSex = s.sex || s.gender || 'M';
                const gender = (rawSex.toUpperCase().startsWith('F') || rawSex.toLowerCase() === 'female') ? 'female' : 'male';

                // Robust Grade Level & System (JHS vs SHS) Detection
                const rawGrade = String(s.grade_level || s.grade || s.gradeLevel || '0');
                const gradeNum = parseInt(rawGrade.replace(/\D/g, '')) || 0;
                
                // Fallback: Check section name for SHS tracks if grade number is unclear
                const sectionLower = (s.section || '').toLowerCase();
                const isSHSTrack = ['humss', 'stem', 'gas', 'tvl', 'ict', 'abm', 'he'].some(track => sectionLower.includes(track));
                
                const level = (gradeNum >= 11 || isSHSTrack) ? 'SHS' : 'JHS';

                // Load cloud photo if it exists
                const sLrn = String(s.lrn);
                if (s.photo_url) {
                    studentPhotos.set(sLrn, s.photo_url);
                } else {
                    // Fallback: Store the path for private bucket fetching
                    const manualPath = `profiles/${sLrn}.webp`;
                    studentPhotos.set(sLrn, manualPath);
                }

                return {
                    lrn: sLrn,
                    excelName: s.full_name, 
                    parsedName: s.full_name.toUpperCase(),
                    section: s.section,
                    gender: gender,
                    grade_level: gradeNum || rawGrade,
                    level: level,
                    fromCloud: true
                };
            });

            // Merge with local database (prioritizing cloud)
            masterStudentDatabase = [...cloudStudents];
            isCloudSynced = true;
            
            console.log("Supabase Sync: First 5 students mapping sample:", masterStudentDatabase.slice(0, 5).map(s=>({name:s.excelName, gender:s.gender})));
            
            // Load today's logs to restore session state
            await restoreAttendanceSession();

            // Update UI
            updateUIWithCloudData();
        }
    } catch (err) {
        console.error("Supabase Sync Error:", err.message);
        isCloudSynced = false;
    }
}

async function restoreAttendanceSession() {
    try {
        // Wait for Supabase to be ready
        if (!window.supabaseClient) return;

        const now = new Date();
        // Start of today in local time, converted to ISO
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        
        console.log("Restoring session since:", startOfToday);

        const { data: logs, error } = await window.supabaseClient
            .from('attendance_logs')
            .select('*')
            .gte('scanned_at', startOfToday);

        if (error) {
            console.error("Session Restore Database Error:", error.message);
            return;
        }

        if (logs) {
            attendanceSession.clear(); 
            logs.forEach(log => {
                const existing = attendanceSession.get(log.student_lrn) || { am: null, pm: null };
                // Map database status to UI codes (P/T)
                const statusMap = { 'PRESENT': 'P', 'TARDY': 'T', 'LATE': 'T' };
                const code = statusMap[log.status] || 'P';

                if (log.session === 'AM') existing.am = code;
                if (log.session === 'PM') existing.pm = code;
                attendanceSession.set(log.student_lrn, existing);
            });
            
            console.log(`✅ Session Restored: ${attendanceSession.size} unique students synced.`);
            
            // 1. Update the Big Number on dashboard
            if (presentCountDisplay) presentCountDisplay.textContent = attendanceSession.size;
            
            // 2. Update the Recent Logs Table
            renderLogTableFromSession(logs);
            
            // 3. Update the Cloud Stats panel if it exists
            const logCountEl = document.getElementById('total-logs-count');
            if (logCountEl) logCountEl.textContent = attendanceSession.size;

            // 4. SMART UPDATE: Show the last scanned learner from the logs
            if (logs.length > 0) {
                const sortedLogs = [...logs].sort((a, b) => new Date(b.scanned_at) - new Date(a.scanned_at));
                const lastLog = sortedLogs[0];
                const lastStudent = masterStudentDatabase.find(s => String(s.lrn) === String(lastLog.student_lrn));
                if (lastStudent) {
                    console.log("Auto-updating dashboard with last known log student:", lastStudent.parsedName);
                    updateDashboard(lastStudent, lastLog.scanned_at);
                }
            }
        }
    } catch (err) {
        console.error("Session Restore System Error:", err);
    }
}

function renderLogTableFromSession(logs) {
    const tableBody = document.getElementById('scan-logs-table');
    const emptyMsg = document.getElementById('empty-log-msg');
    const logCount = document.getElementById('log-count');

    if (!tableBody) return;

    if (!logs || logs.length === 0) {
        tableBody.innerHTML = '';
        if (emptyMsg) emptyMsg.style.display = 'block';
        if (logCount) logCount.textContent = '0 STUDENTS';
        return;
    }

    if (emptyMsg) emptyMsg.style.display = 'none';
    if (logCount) logCount.textContent = `${attendanceSession.size} STUDENTS`;

    // Map logs to table rows, sorted by time descending
    const sortedLogs = [...logs].sort((a, b) => new Date(b.scanned_at) - new Date(a.scanned_at));
    
    tableBody.innerHTML = sortedLogs.map(log => {
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
    if (statusDesc) statusDesc.textContent = `${masterStudentDatabase.length} students synced from Supabase.`;
    if (statusIcon) {
        statusIcon.innerHTML = '<svg class="w-6 h-6 text-blue-600" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M2 5a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm14 1a1 1 0 11-2 0 1 1 0 012 0zM2 13a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 01-2 2H4a2 2 0 01-2-2v-2zm14 1a1 1 0 11-2 0 1 1 0 012 0z" clip-rule="evenodd"></path></svg>';
        statusIcon.className = "w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center";
    }
    
    const cloudBadge = document.getElementById('cloud-sync-badge');
    if (cloudBadge) {
        cloudBadge.innerHTML = '<i class="fa-solid fa-cloud"></i> Synced';
        cloudBadge.className = "px-3 py-1 bg-green-100 text-green-600 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-1";
    }

    if (startBtn) startBtn.disabled = false;
    if (exportJhsBtn) exportJhsBtn.classList.remove('hidden');
    if (exportShsBtn) exportShsBtn.classList.remove('hidden');
    if (totalCountDisplay) totalCountDisplay.textContent = masterStudentDatabase.length;
    
    // Update Cloud Stats Grid
    const studentCountEl = document.getElementById('total-students-count');
    const logCountEl = document.getElementById('total-logs-count');
    if (studentCountEl) studentCountEl.textContent = masterStudentDatabase.length;
    if (logCountEl) logCountEl.textContent = attendanceSession.size;
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
    // 1. Initial Data Sync
    initSupabaseSync();

    // 2. Setup Export Selectors
    const exportMonth = document.getElementById('export-month');
    const exportYear = document.getElementById('export-year');
    if (exportMonth) exportMonth.value = new Date().getMonth();
    if (exportYear) exportYear.value = new Date().getFullYear();

    // 3. Attach SF2 Export Listeners
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

    // 4. Test Mode & Bulk Import
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
async function handleBulkImport(files) {
    if (!files || files.length === 0) return;

    statusTitle.textContent = "Processing Files...";
    statusIcon.innerHTML = '<svg class="w-6 h-6 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>';
    
    let loadedCount = 0;
    // We don't reset everything if user uploads photos separately, but we reset database on SF2 uploads
    const hasExcel = Array.from(files).some(f => f.name.endsWith('.xlsx'));
    if (hasExcel) {
        masterStudentDatabase = [];
        sectionWorkbooks = {};
        attendanceSession.clear();
    }

    for (const file of files) {
        try {
            if (file.name.endsWith('.xlsx')) {
                const buffer = await file.arrayBuffer();
                const workbook = new ExcelJS.Workbook();
                await workbook.xlsx.load(buffer);
                
                const sheetName = detectSheetName(workbook);
                const level = detectLevel(workbook, sheetName);
                const sectionName = file.name.replace('.xlsx', '');

                sectionWorkbooks[sectionName] = {
                    workbook: workbook,
                    info: { section: sectionName, level: level },
                    sheetName: sheetName,
                    fileName: file.name
                };

                processSectionData(sectionWorkbooks[sectionName]);
                loadedCount++;
            } 
            else if (file.name.endsWith('.zip')) {
                statusDesc.textContent = "Unpacking Student Photos...";
                const zip = await JSZip.loadAsync(file);
                let photoCount = 0;

                for (const [filename, zipEntry] of Object.entries(zip.files)) {
                    if (zipEntry.dir) continue;
                    
                    const isImage = /\.(webp|jpg|jpeg|png)$/i.test(filename);
                    if (isImage) {
                        const blob = await zipEntry.async("blob");
                        const dataURL = await blobToDataURL(blob);
                        // Extract LRN from filename (e.g., "123456789012.webp" -> "123456789012")
                        const lrn = filename.split('/').pop().split('.')[0];
                        studentPhotos.set(lrn, dataURL);
                        photoCount++;
                    }
                }
                console.log(`Loaded ${photoCount} photos into memory.`);
            }
        } catch (err) {
            console.error(`Error processing ${file.name}:`, err);
        }
    }

    statusTitle.textContent = "Session Registry Ready";
    statusDesc.textContent = `Registry: ${masterStudentDatabase.length} students. Photos: ${studentPhotos.size} loaded.`;
    statusIcon.innerHTML = '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>';
    statusIcon.className = "w-12 h-12 rounded-full bg-green-100 flex items-center justify-center text-green-600";

    // Update UI stats
    importStats.classList.remove('hidden');
    loadedSectionsCount.textContent = Object.keys(sectionWorkbooks).length;
    totalStudentsCount.textContent = masterStudentDatabase.length;
    totalPhotosCount.textContent = studentPhotos.size;
    totalCountDisplay.textContent = masterStudentDatabase.length;
    
    // Update Sync Button state
    const syncPhotosBtn = document.getElementById('sync-photos-btn');
    if (studentPhotos.size > 0 && syncPhotosBtn) {
        syncPhotosBtn.disabled = false;
        syncPhotosBtn.className = "w-full py-4 bg-blue-600 text-white text-xs font-black uppercase tracking-widest rounded-xl shadow-lg hover:bg-blue-700 transition-all flex items-center justify-center gap-3 active:scale-95";
    }
    
    if (masterStudentDatabase.length > 0) {
        startBtn.disabled = false;
        exportBtn.classList.remove('hidden');
        exportBtn.textContent = "Export All (ZIP)";
        
        // Show SF2 buttons if admin or has permission
        const userAccess = JSON.parse(sessionStorage.getItem('userAccess') || '{}');
        const userRole = sessionStorage.getItem('userRole');
        if (userRole === 'admin' || userAccess.stats) {
            exportJhsBtn.classList.remove('hidden');
            exportShsBtn.classList.remove('hidden');
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
            masterStudentDatabase.push({
                lrn: lrn.replace(/[^0-9]/g, ''),
                excelName: rawName,
                parsedName: parseExcelName(rawName),
                rowIndex: rowNumber,
                gender: isMaleSection ? 'male' : 'female',
                section: sectionObj.info.section,
                level: level
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
    if (!sectionObj) return;

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

async function logAttendanceToSupabase(student, timeData) {
    try {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (!session) throw new Error("No active session.");

        // Real-time Permission Check (DPA Compliance & Security)
        const { data: profile, error: profileError } = await window.supabaseClient
            .from('profiles')
            .select('can_scan, role')
            .eq('id', session.user.id)
            .single();

        if (profileError || (!profile.can_scan && profile.role !== 'admin')) {
            alert("❌ ACCESS REVOKED: You no longer have permission to scan attendance. Please contact the administrator.");
            window.location.href = './login.html';
            return;
        }
        
        const logData = {
            student_lrn: student.lrn,
            session: timeData.session,
            status: (timeData.status === 'P' ? 'PRESENT' : 'TARDY'),
            scanned_at: new Date().toISOString(),
            section: student.section,
            scanned_by: session ? session.user.id : null
        };

        console.log("Pushing log to Supabase:", logData);

        const { data, error } = await window.supabaseClient
            .from('attendance_logs')
            .insert([logData]);

        if (error) {
            // SHOW THE ERROR TO THE USER DIRECTLY
            alert("❌ FAILED TO SAVE TO CLOUD:\n" + error.message);
            throw error;
        }
        
        console.log(`✅ Cloud Log Saved: ${student.parsedName}`);
        await restoreAttendanceSession();
        
    } catch (err) {
        console.error("❌ Cloud Logging Error:", err.message);
    }
}

// --- SCANNER LOGIC ---
function onScanSuccess(decodedText, decodedResult) {
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

        markAttendanceInExcel(student, timeData);
        
        attendanceSession.set(student.lrn, {
            am: timeData.am || (existing ? existing.am : null),
            pm: timeData.pm
        });

        // Async logging to cloud
        logAttendanceToSupabase(student, timeData);

        updateDashboard(student, new Date());
        showScanFeedback(student, "Success!", "green");
        addLog(student.lrn, student.parsedName, student.section);
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
            
            const blobUrl = URL.createObjectURL(data);
            imgElement.src = blobUrl;
            
            // Clean up blob URL after load to prevent memory leaks
            imgElement.onload = () => {
                URL.revokeObjectURL(blobUrl);
                console.log(`✅ Secure photo loaded for LRN ${lrnStr}`);
            };
        } else {
            // PUBLIC OR DATA URL: Standard loading with cache-buster for public URLs
            const finalUrl = dataURL.startsWith('data:') ? dataURL : (dataURL + (dataURL.includes('?') ? '&' : '?') + 't=' + Date.now());
            imgElement.src = finalUrl;
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

function addLog(lrn, name, section) {
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
    const timeStr = new Date().toLocaleTimeString('en-PH', timeOptions);
    const sessionType = getAttendanceStatus(lrnStr).session;
    
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
            <div class="text-[8px] font-black text-blue-500 uppercase tracking-widest mt-0.5">${sessionType} SESSION</div>
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
    if (studentPhotos.size === 0) return;

    const syncBtn = document.getElementById('sync-photos-btn');
    const originalText = syncBtn.innerHTML;
    
    if (!confirm(`Are you sure you want to upload ${studentPhotos.size} photos to the cloud? This will link them to the students' records in Supabase.`)) return;

    try {
        syncBtn.disabled = true;
        syncBtn.innerHTML = '<i class="fa-solid fa-circle-notch animate-spin"></i> Syncing...';
        
        let successCount = 0;
        let failCount = 0;

        for (const [lrn, dataURL] of studentPhotos.entries()) {
            try {
                // 1. Convert DataURL to a clean Image Blob
                const parts = dataURL.split(',');
                const byteString = atob(parts[1]);
                const arrayBuffer = new ArrayBuffer(byteString.length);
                const uint8Array = new Uint8Array(arrayBuffer);
                
                for (let i = 0; i < byteString.length; i++) {
                    uint8Array[i] = byteString.charCodeAt(i);
                }
                
                const blob = new Blob([uint8Array], { type: 'image/webp' });
                const fileName = `${lrn}.webp`;
                const filePath = `profiles/${fileName}`;

                // 2. Upload to Supabase Storage with explicit metadata
                const { data: uploadData, error: uploadError } = await window.supabaseClient
                    .storage
                    .from('student-photos')
                    .upload(filePath, blob, {
                        cacheControl: '0', // Disable cache during testing
                        upsert: true,
                        contentType: 'image/webp'
                    });

                if (uploadError) throw uploadError;

                // 3. Update Students Table with the relative path (Private Bucket compatible)
                const { error: updateError } = await window.supabaseClient
                    .from('students')
                    .update({ photo_url: filePath })
                    .eq('lrn', lrn);

                if (updateError) throw updateError;

                successCount++;
                syncBtn.innerHTML = `<i class="fa-solid fa-circle-notch animate-spin"></i> Syncing (${successCount}/${studentPhotos.size})...`;
            } catch (err) {
                console.error(`Failed to sync photo for LRN ${lrn}:`, err.message);
                failCount++;
            }
        }

        alert(`Sync Complete!\n✅ Success: ${successCount}\n❌ Failed: ${failCount}`);
        
    } catch (err) {
        console.error("Global Sync Error:", err.message);
        alert("An error occurred during sync: " + err.message);
    } finally {
        syncBtn.disabled = false;
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
    
    // Start Supabase Cloud Sync
    initSupabaseSync();
    
    // Attach Sync Listener
    const syncPhotosBtn = document.getElementById('sync-photos-btn');
    if (syncPhotosBtn) {
        syncPhotosBtn.addEventListener('click', syncPhotosToSupabase);
    }

    // Start clock
    setInterval(updateClock, 1000);
    updateClock();
});
