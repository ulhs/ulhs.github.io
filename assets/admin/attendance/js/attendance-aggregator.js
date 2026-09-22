(function (window) {
    function normalizeStatus(value) {
        const status = String(value || '').trim().toUpperCase();

        if (
            status.includes('TARDY') ||
            status.includes('LATE') ||
            status.includes('DELAY') ||
            status.includes('ARRIVE_LATE') ||
            status === 'T'
        ) return 'TARDY';

        if (
            status.includes('PRESENT') ||
            status.includes('ARRIVE') ||
            status.includes('ARRIVED') ||
            status.includes('ON_TIME') ||
            status.includes('LEAVING') ||
            status.includes('OUT') ||
            status === 'P'
        ) return 'PRESENT';

        if (
            status.includes('ABSENT') ||
            status.includes('UNEXCUSED') ||
            status.includes('NO_SHOW') ||
            status === 'A'
        ) return 'ABSENT';

        return status;
    }

    function getLocalDate(log) {
        if (log?.local_date) return String(log.local_date).slice(0, 10);
        if (log?.scanned_at_local) return String(log.scanned_at_local).slice(0, 10);
        if (log?.scanned_at) {
            const parsed = new Date(log.scanned_at);
            if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
        }
        return '';
    }

    function statusPriority(status) {
        if (status === 'ABSENT') return 3;
        if (status === 'TARDY') return 2;
        if (status === 'PRESENT') return 1;
        return 0;
    }

    function logStamp(log) {
        return String(log?.scanned_at_local || log?.scanned_at || '');
    }

    function buildDailyEvidence(logs) {
        const evidence = new Map();

        (logs || []).forEach((log) => {
            const studentLrn = String(log?.student_lrn || '').trim();
            const date = getLocalDate(log);
            const session = String(log?.session || '').trim().toUpperCase();
            const status = normalizeStatus(log?.status);
            if (!studentLrn || !date || !['AM', 'PM'].includes(session) || !status) return;

            const key = `${studentLrn}|${date}|${session}`;
            const candidate = { status, stamp: logStamp(log), log };
            const current = evidence.get(key);

            if (!current || statusPriority(status) > statusPriority(current.status) ||
                (statusPriority(status) === statusPriority(current.status) && candidate.stamp >= current.stamp)) {
                evidence.set(key, candidate);
            }
        });

        return evidence;
    }

    function summarizeStudent(logs, validSchoolDays) {
        const evidence = buildDailyEvidence(logs);
        const validDays = new Set((validSchoolDays || []).map(day => String(day).slice(0, 10)));
        const presentDays = new Set();
        const tardyDays = new Set();
        const absentDays = new Set();

        validDays.forEach((date) => {
            const am = evidence.get(`${String(logs?.[0]?.student_lrn || '')}|${date}|AM`);
            const pm = evidence.get(`${String(logs?.[0]?.student_lrn || '')}|${date}|PM`);
            const dayRecords = [am, pm].filter(Boolean);
            const hasTardy = dayRecords.some(record => record.status === 'TARDY');
            const hasPresent = dayRecords.some(record => record.status === 'PRESENT' || record.status === 'TARDY');

            if (hasTardy) tardyDays.add(date);
            if (hasPresent) presentDays.add(date);
            else absentDays.add(date);
        });

        return {
            totalDays: validDays.size,
            attended: presentDays.size,
            present: Math.max(0, presentDays.size - tardyDays.size),
            tardy: tardyDays.size,
            absent: absentDays.size,
            attendancePercentage: validDays.size > 0 ? Math.round((presentDays.size / validDays.size) * 100) : 0
        };
    }

    window.AttendanceAggregator = {
        normalizeStatus,
        getLocalDate,
        buildDailyEvidence,
        summarizeStudent
    };
})(window);
