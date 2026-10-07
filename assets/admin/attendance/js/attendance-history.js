(function (window, document) {
    const BASELINE_DATE = '2026-08-14';
    const ROOT_SELECTOR = '[data-attendance-history]';
    const instances = new WeakMap();
    const tooltipStates = new WeakMap();

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>'"]/g, character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        })[character]);
    }

    function getManilaDateKey(date = new Date()) {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Manila',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(date);
    }

    function dateFromKey(dateKey) {
        const [year, month, day] = dateKey.split('-').map(Number);
        return new Date(Date.UTC(year, month - 1, day));
    }

    function dateKeyFromUtc(date) {
        return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    }

    function addDays(dateKey, days) {
        const date = dateFromKey(dateKey);
        date.setUTCDate(date.getUTCDate() + days);
        return dateKeyFromUtc(date);
    }

    function getManilaUtcBoundary(dateKey) {
        const date = dateFromKey(dateKey);
        return new Date(date.getTime() - 8 * 60 * 60 * 1000).toISOString();
    }

    function getLogDate(log) {
        if (log.local_date) return String(log.local_date).slice(0, 10);
        if (log.scanned_at_local) return String(log.scanned_at_local).slice(0, 10);
        if (log.scanned_at) {
            const parsed = new Date(log.scanned_at);
            if (Number.isNaN(parsed.getTime())) return '';
            return new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Asia/Manila',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }).format(parsed);
        }
        return '';
    }

    function formatShortDate(dateKey) {
        return dateFromKey(dateKey).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            timeZone: 'UTC'
        });
    }

    function getWeekStart(dateKey) {
        const date = dateFromKey(dateKey);
        const day = date.getUTCDay() || 7;
        date.setUTCDate(date.getUTCDate() - day + 1);
        return dateKeyFromUtc(date);
    }

    function getMonthStart(dateKey) {
        return `${dateKey.slice(0, 7)}-01`;
    }

    function getPreviousMonthDate(dateKey) {
        const date = dateFromKey(dateKey);
        date.setUTCMonth(date.getUTCMonth() - 1);
        return dateKeyFromUtc(date);
    }

    function summarizeRows(rows) {
        const summary = rows.reduce((result, row) => {
            result.students += row.students;
            result.attended += row.attended;
            return result;
        }, { students: 0, attended: 0 });
        summary.attendancePercentage = summary.students > 0
            ? Math.round((summary.attended / summary.students) * 1000) / 10
            : null;
        return summary;
    }

    function getComparablePreviousPoint(points, dailyRows, period) {
        if (points.length < 2) return null;
        const current = points[points.length - 1];
        const previous = points[points.length - 2];
        const today = getManilaDateKey();
        const yesterday = addDays(today, -1);

        if (period === 'daily') return previous;

        if (period === 'weekly') {
            const currentWeekFriday = addDays(current.key, 4);
            if (yesterday >= currentWeekFriday) return previous;
            const matchingRows = dailyRows.filter(row =>
                row.date >= addDays(current.key, -7) && row.date <= addDays(current.endDate, -7)
            );
            const summary = summarizeRows(matchingRows);
            return summary.attendancePercentage === null ? null : summary;
        }

        const monthDate = dateFromKey(current.key);
        const lastDay = dateKeyFromUtc(new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0)));
        if (yesterday >= lastDay) return previous;

        const previousMonthStart = getPreviousMonthDate(current.key);
        const previousMonthDate = dateFromKey(previousMonthStart);
        const endDay = Number(current.endDate.slice(-2));
        const previousMonthLastDay = new Date(Date.UTC(
            previousMonthDate.getUTCFullYear(),
            previousMonthDate.getUTCMonth() + 1,
            0
        )).getUTCDate();
        const comparisonEnd = `${previousMonthStart.slice(0, 7)}-${String(Math.min(endDay, previousMonthLastDay)).padStart(2, '0')}`;
        const matchingRows = dailyRows.filter(row => row.date >= previousMonthStart && row.date <= comparisonEnd);
        const summary = summarizeRows(matchingRows);
        return summary.attendancePercentage === null ? null : summary;
    }

    function populateSectionOptions(instance, students) {
        if (!instance.sectionFilter || instance.root.dataset.historyPopulateSections !== 'true') return;

        const previousValue = instance.sectionFilter.value || 'ALL';
        const sections = [...new Set(students.map(student => String(student.section || '').trim()).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b));
        instance.sectionFilter.innerHTML = '<option value="ALL">All Sections</option>' +
            sections.map(section => `<option value="${escapeHtml(section)}">${escapeHtml(section)}</option>`).join('');
        instance.sectionFilter.value = sections.includes(previousValue) ? previousValue : 'ALL';
    }

    function setMessage(root, message, isError = false) {
        const chart = root.querySelector('[data-history-chart]');
        const table = root.querySelector('[data-history-table]');
        const trend = root.querySelector('[data-history-trend]');

        if (chart) chart.innerHTML = '';
        if (table) table.textContent = '';
        if (trend) {
            trend.className = 'attendance-history__trend attendance-history__trend--flat';
            trend.textContent = '';
        }
        root.setAttribute('aria-busy', 'false');
        const messageElement = root.querySelector('[data-history-message]');
        if (messageElement) {
            messageElement.classList.remove('hidden');
            messageElement.classList.toggle('attendance-history__message--error', isError);
            messageElement.textContent = message;
        }
    }

    async function fetchAllRows(buildQuery) {
        const rows = [];
        const pageSize = 1000;
        let page = 0;

        while (true) {
            const response = await buildQuery().range(page * pageSize, (page + 1) * pageSize - 1);
            if (response.error) throw response.error;
            rows.push(...(Array.isArray(response.data) ? response.data : []));
            if (!response.data || response.data.length < pageSize) return rows;
            page++;
        }
    }

    async function fetchAttendanceLogs(client, endDate, studentLrns) {
        const rows = new Map();
        const chunks = [];
        for (let index = 0; index < studentLrns.length; index += 500) {
            chunks.push(studentLrns.slice(index, index + 500));
        }

        const nextDate = addDays(endDate, 1);
        const selectFields = 'student_lrn, session, status, local_date, scanned_at, scanned_at_local';
        for (const chunk of chunks) {
            const [localDateRows, localTimestampRows, utcTimestampRows] = await Promise.all([
                fetchAllRows(() => client
                    .from('attendance_logs')
                    .select(selectFields)
                    .in('student_lrn', chunk)
                    .gte('local_date', BASELINE_DATE)
                    .lte('local_date', endDate)
                    .order('local_date', { ascending: true })
                    .order('scanned_at_local', { ascending: true })),
                fetchAllRows(() => client
                    .from('attendance_logs')
                    .select(selectFields)
                    .in('student_lrn', chunk)
                    .gte('scanned_at_local', `${BASELINE_DATE} 00:00:00`)
                    .lt('scanned_at_local', `${nextDate} 00:00:00`)
                    .order('scanned_at_local', { ascending: true })),
                fetchAllRows(() => client
                    .from('attendance_logs')
                    .select(selectFields)
                    .in('student_lrn', chunk)
                    .gte('scanned_at', getManilaUtcBoundary(BASELINE_DATE))
                    .lt('scanned_at', getManilaUtcBoundary(nextDate))
                    .order('scanned_at', { ascending: true }))
            ]);

            [...localDateRows, ...localTimestampRows, ...utcTimestampRows].forEach((log) => {
                const date = getLogDate(log);
                if (date < BASELINE_DATE || date > endDate) return;
                const key = [
                    String(log.student_lrn || '').trim(),
                    String(log.session || '').trim().toUpperCase(),
                    date,
                    String(log.scanned_at_local || log.scanned_at || ''),
                    String(log.status || '').trim().toUpperCase()
                ].join('|');
                rows.set(key, { ...log, local_date: date });
            });
        }
        return [...rows.values()];
    }

    function getValidSchoolDays(startDate, endDate, suspendedDates, calendarByDate) {
        const dates = [];
        for (let dateKey = startDate; dateKey <= endDate; dateKey = addDays(dateKey, 1)) {
            const date = dateFromKey(dateKey);
            const weekday = date.getUTCDay();
            if (weekday === 0 || weekday === 6 || suspendedDates.has(dateKey) || calendarByDate.get(dateKey) === false) continue;
            dates.push(dateKey);
        }
        return dates;
    }

    function groupHistory(dailyRows, period) {
        const buckets = new Map();
        dailyRows.forEach((row) => {
            let key = row.date;
            if (period === 'weekly') key = getWeekStart(row.date);
            if (period === 'monthly') key = getMonthStart(row.date);

            const bucket = buckets.get(key) || {
                key,
                startDate: row.date,
                endDate: row.date,
                students: 0,
                attended: 0,
                present: 0,
                tardy: 0,
                absent: 0,
                schoolDays: 0
            };

            bucket.startDate = bucket.startDate < row.date ? bucket.startDate : row.date;
            bucket.endDate = bucket.endDate > row.date ? bucket.endDate : row.date;
            bucket.students += row.students;
            bucket.attended += row.attended;
            bucket.present += row.present;
            bucket.tardy += row.tardy;
            bucket.absent += row.absent;
            bucket.schoolDays++;
            buckets.set(key, bucket);
        });

        return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key)).map(bucket => ({
            ...bucket,
            attendancePercentage: bucket.students > 0
                ? Math.round((bucket.attended / bucket.students) * 1000) / 10
                : 0
        }));
    }

    function getPeriodLabel(point, period) {
        if (period === 'daily') return formatShortDate(point.key);
        if (period === 'weekly') return `${formatShortDate(point.startDate)}–${formatShortDate(point.endDate)}`;
        return `${dateFromKey(point.key).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })} ${point.startDate.slice(-2)}–${point.endDate.slice(-2)}`;
    }

    function renderTrend(root, points, period, comparison) {
        const element = root.querySelector('[data-history-trend]');
        if (!element) return;

        if (points.length < 2 || !comparison) {
            element.className = 'attendance-history__trend attendance-history__trend--flat';
            element.textContent = 'No previous equivalent period available for comparison';
            return;
        }

        const current = points[points.length - 1];
        const difference = Math.round((current.attendancePercentage - comparison.attendancePercentage) * 10) / 10;
        const direction = difference > 0 ? 'up' : difference < 0 ? 'down' : 'flat';
        const prefix = difference > 0 ? '↑' : difference < 0 ? '↓' : '→';
        const label = period === 'daily' ? 'previous school day' : `equivalent period last ${period === 'weekly' ? 'week' : 'month'}`;

        element.className = `attendance-history__trend attendance-history__trend--${direction}`;
        element.textContent = `${prefix} ${Math.abs(difference).toFixed(1)} percentage points vs ${label}`;
    }

    function renderTable(root, points, period) {
        const table = root.querySelector('[data-history-table]');
        if (!table) return;

        table.innerHTML = points.map((point) => {
            const label = getPeriodLabel(point, period);
            return `<li>${escapeHtml(label)}: ${point.attendancePercentage.toFixed(1)}% attendance; ${point.present} present, ${point.tardy} tardy, ${point.absent} absent across ${point.schoolDays} school day${point.schoolDays === 1 ? '' : 's'}.</li>`;
        }).join('');
    }

    function positionTooltip(frame, tooltip, clientX, clientY) {
        const frameRect = frame.getBoundingClientRect();
        const tooltipWidth = tooltip.offsetWidth;
        const tooltipHeight = tooltip.offsetHeight;
        const pointerX = clientX - frameRect.left;
        const pointerY = clientY - frameRect.top;
        const showBelow = pointerY < tooltipHeight + 20;
        const left = Math.max(
            tooltipWidth / 2 + 8,
            Math.min(frameRect.width - tooltipWidth / 2 - 8, pointerX)
        );

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${showBelow ? pointerY + 14 : pointerY - 14}px`;
        tooltip.style.transform = showBelow ? 'translate(-50%, 0)' : 'translate(-50%, -100%)';
    }

    function attachTooltipEvents(root) {
        const frame = root.querySelector('.attendance-history__chart-frame');
        if (!frame) return;

        let tooltip = frame.querySelector('.attendance-history__tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.className = 'attendance-history__tooltip';
            tooltip.setAttribute('role', 'tooltip');
            frame.appendChild(tooltip);
        }
        let state = tooltipStates.get(root);
        if (!state) {
            state = { pinnedMark: null };
            tooltipStates.set(root, state);
        }
        state.pinnedMark = null;
        tooltip.dataset.visible = 'false';

        const hideTooltip = () => {
            state.pinnedMark = null;
            tooltip.dataset.visible = 'false';
        };
        const showTooltip = (mark, clientX, clientY) => {
            tooltip.textContent = mark.dataset.tooltipText;
            tooltip.dataset.visible = 'true';
            positionTooltip(frame, tooltip, clientX, clientY);
        };
        const getMark = target => target instanceof Element ? target.closest('[data-tooltip-text]') : null;

        if (root.dataset.historyTooltipListenersAttached === 'true') return;
        root.dataset.historyTooltipListenersAttached = 'true';

        root.addEventListener('pointerover', event => {
            const mark = getMark(event.target);
            if (mark && !state.pinnedMark) showTooltip(mark, event.clientX, event.clientY);
        });
        root.addEventListener('pointermove', event => {
            const mark = getMark(event.target);
            if (mark && !state.pinnedMark) showTooltip(mark, event.clientX, event.clientY);
        });
        root.addEventListener('pointerout', event => {
            if (state.pinnedMark || getMark(event.relatedTarget)) return;
            hideTooltip();
        });
        root.addEventListener('focusin', event => {
            const mark = getMark(event.target);
            if (!mark || state.pinnedMark) return;
            const rect = mark.getBoundingClientRect();
            showTooltip(mark, rect.left + rect.width / 2, rect.top);
        });
        root.addEventListener('focusout', event => {
            if (state.pinnedMark || getMark(event.relatedTarget)) return;
            hideTooltip();
        });
        root.addEventListener('click', event => {
            const mark = getMark(event.target);
            if (!mark) {
                hideTooltip();
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            state.pinnedMark = mark;
            if (event.detail === 0) {
                const rect = mark.getBoundingClientRect();
                showTooltip(mark, rect.left + rect.width / 2, rect.top);
            } else {
                showTooltip(mark, event.clientX, event.clientY);
            }
        });
        document.addEventListener('click', event => {
            if (!root.contains(event.target)) hideTooltip();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && state.pinnedMark) hideTooltip();
        });
    }

    function renderChart(root, points, period, chartType, comparison) {
        const chart = root.querySelector('[data-history-chart]');
        const message = root.querySelector('[data-history-message]');
        if (!chart) return;
        if (message) message.classList.add('hidden');

        if (!points.length) {
            setMessage(root, 'No valid school-day attendance history is available since August 14, 2026.');
            return;
        }

        const width = 960;
        const height = 280;
        const left = 48;
        const right = 16;
        const top = 18;
        const bottom = 44;
        const plotWidth = width - left - right;
        const plotHeight = height - top - bottom;
        const x = index => points.length === 1
            ? left + plotWidth / 2
            : left + (index / (points.length - 1)) * plotWidth;
        const y = value => top + (1 - value / 100) * plotHeight;
        const grid = [0, 25, 50, 75, 100].map(value => `
            <line class="attendance-history__gridline" x1="${left}" y1="${y(value)}" x2="${width - right}" y2="${y(value)}"></line>
            <text class="attendance-history__axis-label" x="${left - 10}" y="${y(value) + 4}" text-anchor="end">${value}%</text>
        `).join('');

        let marks = '';
        if (chartType === 'bar') {
            const slotWidth = plotWidth / points.length;
            const barWidth = Math.max(3, Math.min(36, slotWidth * 0.62));
            marks = points.map((point, index) => {
                const barHeight = plotHeight * point.attendancePercentage / 100;
                const tooltip = `${getPeriodLabel(point, period)}: ${point.attendancePercentage.toFixed(1)}% attendance; ${point.present} present, ${point.tardy} tardy, ${point.absent} absent.`;
                return `<rect class="attendance-history__bar" x="${x(index) - barWidth / 2}" y="${y(point.attendancePercentage)}" width="${barWidth}" height="${barHeight}" rx="3" tabindex="0" data-tooltip-text="${escapeHtml(tooltip)}" aria-label="${escapeHtml(tooltip)}"></rect>`;
            }).join('');
        } else {
            const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(point.attendancePercentage)}`).join(' ');
            marks = `<path class="attendance-history__line" d="${path}"></path>` + points.map((point, index) => {
                const tooltip = `${getPeriodLabel(point, period)}: ${point.attendancePercentage.toFixed(1)}% attendance; ${point.present} present, ${point.tardy} tardy, ${point.absent} absent.`;
                return `<circle class="attendance-history__point" cx="${x(index)}" cy="${y(point.attendancePercentage)}" r="4" tabindex="0" data-tooltip-text="${escapeHtml(tooltip)}" aria-label="${escapeHtml(tooltip)}"></circle>`;
            }).join('');
        }

        const labelStep = Math.max(1, Math.ceil(points.length / 8));
        const labels = points.map((point, index) => {
            if (index % labelStep !== 0 && index !== points.length - 1) return '';
            return `<text class="attendance-history__axis-label" x="${x(index)}" y="${height - 12}" text-anchor="middle">${escapeHtml(getPeriodLabel(point, period))}</text>`;
        }).join('');

        chart.innerHTML = `<svg class="attendance-history__chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${period[0].toUpperCase() + period.slice(1)} attendance-rate history since August 14, 2026">
            ${grid}${marks}${labels}
        </svg>`;
        attachTooltipEvents(root);
        renderTable(root, points, period);
        renderTrend(root, points, period, comparison);
    }

    function renderHistory(root, dailyRows, period, chartType) {
        const points = groupHistory(dailyRows, period);
        const comparison = getComparablePreviousPoint(points, dailyRows, period);
        renderChart(root, points, period, chartType, comparison);
    }

    async function load(instance) {
        const { root, client } = instance;
        const requestId = ++instance.requestId;
        const selectedSection = instance.sectionFilter ? instance.sectionFilter.value : 'ALL';
        const period = root.querySelector('[data-history-period][aria-pressed="true"]')?.dataset.historyPeriod || 'daily';
        const chartType = root.querySelector('[data-history-type][aria-pressed="true"]')?.dataset.historyType || 'bar';
        const endDate = addDays(getManilaDateKey(), -1);
        root.setAttribute('aria-busy', 'true');
        const message = root.querySelector('[data-history-message]');
        if (message) {
            message.classList.remove('hidden', 'attendance-history__message--error');
            message.textContent = 'Loading attendance history…';
        }

        try {
            if (!client) throw new Error('The attendance database connection is not available.');
            if (instance.cachedHistory && instance.cachedHistory.section === selectedSection) {
                renderHistory(root, instance.cachedHistory.dailyRows, period, chartType);
                root.setAttribute('aria-busy', 'false');
                return;
            }

            const studentRows = await fetchAllRows(() => client.from('students').select('lrn, section').order('lrn'));
            if (requestId !== instance.requestId) return;
            populateSectionOptions(instance, studentRows || []);
            const activeSection = instance.sectionFilter ? instance.sectionFilter.value : selectedSection;
            const selectedStudents = (studentRows || []).filter(student =>
                activeSection === 'ALL' || String(student.section || '').trim() === activeSection
            );
            const studentLrns = selectedStudents.map(student => student.lrn).filter(Boolean);
            if (!studentLrns.length) {
                setMessage(root, 'No students are available for this section.');
                return;
            }

            const [logRows, suspendedRows, calendarRows] = await Promise.all([
                fetchAttendanceLogs(client, endDate, studentLrns),
                fetchAllRows(() => client
                    .from('suspended_days')
                    .select('date')
                    .gte('date', BASELINE_DATE)
                    .lte('date', endDate)),
                fetchAllRows(() => client
                    .from('school_calendar')
                    .select('calendar_date, is_school_day')
                    .gte('calendar_date', BASELINE_DATE)
                    .lte('calendar_date', endDate))
            ]);
            if (requestId !== instance.requestId) return;

            const suspendedDates = new Set((suspendedRows || []).map(row => String(row.date).slice(0, 10)));
            const calendarByDate = new Map((calendarRows || []).map(row => [
                String(row.calendar_date).slice(0, 10),
                row.is_school_day !== false
            ]));
            const schoolDays = getValidSchoolDays(BASELINE_DATE, endDate, suspendedDates, calendarByDate);
            const dailyRows = window.AttendanceAggregator.summarizeHistory(logRows, studentLrns, schoolDays);

            if (requestId !== instance.requestId) return;
            instance.cachedHistory = { section: activeSection, dailyRows };
            renderHistory(root, dailyRows, period, chartType);
            root.setAttribute('aria-busy', 'false');
        } catch (error) {
            if (requestId !== instance.requestId) return;
            console.error('Attendance history load failed:', error);
            setMessage(root, `Unable to load attendance history: ${error.message || 'Unknown error'}`, true);
        }
    }

    function init(root) {
        let instance = instances.get(root);
        if (!instance) {
            const sectionFilterSelector = root.dataset.historySectionFilter;
            const sectionFilter = sectionFilterSelector ? document.querySelector(sectionFilterSelector) : null;
            instance = { root, client: window.supabaseClient, sectionFilter, requestId: 0, cachedHistory: null };
            instances.set(root, instance);

            root.querySelectorAll('[data-history-period]').forEach(button => {
                button.addEventListener('click', () => {
                    root.querySelectorAll('[data-history-period]').forEach(option => {
                        const selected = option === button;
                        option.setAttribute('aria-pressed', String(selected));
                    });
                    load(instance);
                });
            });
            root.querySelectorAll('[data-history-type]').forEach(button => {
                button.addEventListener('click', () => {
                    root.querySelectorAll('[data-history-type]').forEach(option => {
                        option.setAttribute('aria-pressed', String(option === button));
                    });
                    load(instance);
                });
            });
            if (sectionFilter) sectionFilter.addEventListener('change', () => load(instance));
        }

        instance.client = window.supabaseClient;
        load(instance);
    }

    function initialize() {
        document.querySelectorAll(ROOT_SELECTOR).forEach(init);
    }

    window.AttendanceHistory = { initialize };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize, { once: true });
    } else {
        initialize();
    }
})(window, document);
