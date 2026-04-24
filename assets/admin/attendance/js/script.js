// Configuration
let masterStudentDatabase = [];
let sectionWorkbooks = {}; // Stores ExcelJS workbook objects indexed by section name
let studentPhotos = new Map(); // lrn -> dataURL (in-memory storage)
let html5QrCode = null;
let attendanceSession = new Map(); // lrn -> { am: 'P'|'T'|null, pm: 'P'|'T'|'A'|null }
let totalCampusPopulation = 0;

// Camera Management
let isScannerActive = false;
let scannerConfig = null;
let activeCameraId = null;
let isSwitchingCamera = false;  // Prevent scanning during camera switches

// SF2 Mapping Configuration per Level (Indices converted for ExcelJS - 1-based)
const SF2_MAPPINGS = {
    'JHS': {
        nameCol: 3,    // Col C
        lrnCol: 50,    // Col AX
        startRow: 8,   // Row 8
        attStartCol: 6 // Col F (Day 1)
    },
    'SHS': {
        nameCol: 7,    // Col G
        lrnCol: 82,    // Col CD
        startRow: 18,  // Row 18
        attStartCol: 10 // Col J (Day 1)
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
    
    if (masterStudentDatabase.length > 0) {
        startBtn.disabled = false;
        exportBtn.classList.remove('hidden');
        exportBtn.textContent = "Export All (ZIP)";
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
    const now = new Date();
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const currentMonthName = monthNames[now.getMonth()];

    let sheet = workbook.worksheets.find(ws => 
        ws.name.toLowerCase().includes(currentMonthName.toLowerCase())
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

// --- SCANNER LOGIC ---
function onScanSuccess(decodedText, decodedResult) {
    // Critical: Only process scans if scanner is actively running and NOT switching cameras
    if (!isScannerActive || isSwitchingCamera || !html5QrCode || !html5QrCode.isScanning) {
        console.log("Scan ignored: Scanner not active or switching cameras");
        return;
    }
    
    const today = new Date();
    const dayOfWeek = today.getDay(); 
    const isTestMode = testModeToggle && testModeToggle.checked;

    if (!isTestMode && (dayOfWeek === 0 || dayOfWeek === 6)) {
        alert("Attendance cannot be recorded on weekends.");
        return;
    }

    const scannedInput = decodedText.trim().toUpperCase();
    const cleanLRN = scannedInput.replace(/[^0-9]/g, '');
    
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
            return;
        }
        
        if (existing && existing.am && timeData.session === 'AM') {
            showScanFeedback(student, "AM Session Already Scanned", "yellow");
            showScanOverlay(student.parsedName, student.lrn, 'warning', student.section, timeData);
            return;
        }

        markAttendanceInExcel(student, timeData);
        
        attendanceSession.set(student.lrn, {
            am: timeData.am || (existing ? existing.am : null),
            pm: timeData.pm
        });

        updateDashboard(student);
        showScanFeedback(student, "Success!", "green");
        addLog(student.lrn, student.parsedName, student.section);
        showScanOverlay(student.parsedName, student.lrn, 'success', student.section, timeData);
        playBeep('success');
    } else {
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

function updateDashboard(student) {
    lastStudentName.textContent = student.parsedName;
    lastScanTime.textContent = `${new Date().toLocaleTimeString()} (${student.section})`;
    presentCountDisplay.textContent = attendanceSession.size;
    sectionDisplay.textContent = student.section;
    
    // Get Photo from Memory
    const dataURL = studentPhotos.get(student.lrn);
    if (lastStudentPhoto) {
        if (dataURL) {
            lastStudentPhoto.src = dataURL;
            lastStudentPhoto.classList.remove('hidden');
            if (lastPhotoPlaceholder) lastPhotoPlaceholder.classList.add('hidden');
        } else {
            lastStudentPhoto.classList.add('hidden');
            if (lastPhotoPlaceholder) lastPhotoPlaceholder.classList.remove('hidden');
        }
    }

    lastScannedCard.classList.add('bg-blue-50', 'border-blue-200', 'scale-[1.02]');
    setTimeout(() => {
        lastScannedCard.classList.remove('scale-[1.02]');
    }, 200);
}

function showScanFeedback(student, status, color) {
    scanStatus.textContent = `${status}: ${student.parsedName || student.name}`;
    const colors = { green: "bg-green-500 text-white", red: "bg-red-500 text-white", yellow: "bg-yellow-500 text-white" };
    scanStatus.className = `px-3 py-1 ${colors[color]} rounded-full text-[10px] font-black uppercase tracking-widest animate-pulse`;
}

function showScanOverlay(name, lrn, type, section, timeData) {
    overlayName.textContent = name;
    overlayLrn.textContent = `LRN: ${lrn} | ${section}`;
    
    // Get Photo from Memory
    const dataURL = studentPhotos.get(lrn);
    if (dataURL) {
        overlayPhoto.src = dataURL;
        overlayPhoto.classList.remove('hidden');
        overlayPhotoPlaceholder.classList.add('hidden');
    } else {
        overlayPhoto.classList.add('hidden');
        overlayPhotoPlaceholder.classList.remove('hidden');
    }

    overlayTimeStatus.textContent = `${timeData.session} Session: ${timeData.status}`;
    overlayTimeStatus.className = "mt-4 inline-block px-6 py-2 rounded-full font-black text-xl uppercase tracking-widest shadow-lg ";
    
    if (timeData.status === 'LATE' || timeData.status.includes('TARDY')) overlayTimeStatus.classList.add('bg-red-600', 'text-white', 'animate-pulse');
    else if (timeData.status === 'PRESENT') overlayTimeStatus.classList.add('bg-white', 'text-green-600');
    else overlayTimeStatus.classList.add('bg-gray-800', 'text-white');

    scanOverlay.className = "fixed inset-0 z-50 flex items-center justify-center backdrop-blur-md transition-opacity duration-300";
    overlayIconContainer.className = "absolute -bottom-4 -right-4 bg-white rounded-full w-12 h-12 flex items-center justify-center shadow-xl animate-bounce";
    
    if (type === 'success') {
        scanOverlay.classList.add('bg-green-600/90');
        overlayIconContainer.classList.add('text-green-600');
        overlayStatus.textContent = "Access Granted";
        overlayIconContainer.innerHTML = '<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg>';
    } else if (type === 'warning') {
        scanOverlay.classList.add('bg-yellow-500/90');
        overlayIconContainer.classList.add('text-yellow-600');
        overlayStatus.textContent = "Already Scanned";
        overlayIconContainer.innerHTML = '<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>';
    } else {
        scanOverlay.classList.add('bg-red-600/90');
        overlayIconContainer.classList.add('text-red-600');
        overlayStatus.textContent = "Student Not Found";
        overlayIconContainer.innerHTML = '<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 18L18 6M6 6l12 12"></path></svg>';
    }

    scanOverlay.classList.remove('hidden');
    setTimeout(() => scanOverlay.classList.add('hidden'), 3000);
}

function addLog(lrn, name, section) {
    if (emptyLogMsg) emptyLogMsg.classList.add('hidden');
    const row = document.createElement('tr');
    row.className = "hover:bg-gray-50 transition-colors group";
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    row.innerHTML = `
        <td class="px-4 py-3 font-mono text-[10px] text-gray-500">
            ${lrn}<br>
            <span class="text-blue-600 font-black uppercase tracking-tighter text-[9px] bg-blue-50 px-1.5 py-0.5 rounded">${section}</span>
        </td>
        <td class="px-4 py-3 font-black text-gray-900 uppercase text-xs">${name}</td>
        <td class="px-4 py-3 text-right font-bold text-gray-400 text-xs">${timeStr}</td>
    `;
    scanLogsTable.prepend(row);
    logCount.textContent = `${attendanceSession.size} CAMPUS ENTRIES`;
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

// Event Listeners
window.addEventListener('DOMContentLoaded', () => {
    // Drop Zone Events
    const dropZone = document.getElementById('drop-zone');
    
    if (fileInput) {
        fileInput.addEventListener('change', (e) => handleBulkImport(e.target.files));
    }

    if (testModeToggle) {
        testModeToggle.addEventListener('change', () => {
            const isActive = testModeToggle.checked;
            testModeIndicator.classList.toggle('hidden', !isActive);
        });
    }
});

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
        } else if (typeof cameraIdOrFacingMode === 'object' && cameraIdOrFacingMode.facingMode) {
            // FacingMode provided - add it to config
            cameraConfig.videoConstraints.facingMode = cameraIdOrFacingMode.facingMode;
            console.log("Using facing mode:", cameraIdOrFacingMode.facingMode);
        }
        
        // Start with new camera
        await html5QrCode.start(cameraIdOrFacingMode, cameraConfig, onScanSuccess);
        
        // Only update state after successful start
        if (typeof cameraIdOrFacingMode === 'string') {
            activeCameraId = cameraIdOrFacingMode;
            if (cameraSelect && cameraSelect.value !== cameraIdOrFacingMode) {
                cameraSelect.value = cameraIdOrFacingMode;
            }
        } else {
            activeCameraId = null;
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
    
    if (cameraId === activeCameraId) {
        console.log("Same camera selected, skipping switch");
        return;
    }
    
    try {
        console.log("=== Camera Switch Starting ===");
        console.log("Switching from:", activeCameraId, "to:", cameraId);
        
        // Set flag to prevent scanning during switch
        isSwitchingCamera = true;
        isScannerActive = false;
        
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

// Initialize on Load
document.addEventListener('DOMContentLoaded', () => {
    // Check if user is logged in
    if (sessionStorage.getItem('adminLoggedIn') !== 'true') {
        window.location.href = '../admin.html';
        return;
    }
    
    // Start clock
    setInterval(updateClock, 1000);
    updateClock();
});
