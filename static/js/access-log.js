/**
 * Access Log Viewer
 */

const accessLogState = {
    limit: '50',
    keyword: '',
    page: 1,
    totalPages: 0,
};

let accessLogSearchTimer = null;

document.addEventListener('DOMContentLoaded', function() {
    const pageSizeSelect = document.getElementById('accessLogPageSize');
    const refreshBtn = document.getElementById('accessLogRefreshBtn');
    const searchInput = document.getElementById('accessLogSearchInput');
    const resetSearchBtn = document.getElementById('accessLogSearchResetBtn');
    if (!pageSizeSelect) return;

    accessLogState.limit = pageSizeSelect.value || '50';

    pageSizeSelect.addEventListener('change', () => {
        accessLogState.limit = pageSizeSelect.value || '50';
        accessLogState.page = 1;
        loadAccessLogs();
    });

    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            loadAccessLogs();
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            window.clearTimeout(accessLogSearchTimer);
            accessLogSearchTimer = window.setTimeout(() => {
                accessLogState.keyword = searchInput.value || '';
                accessLogState.page = 1;
                loadAccessLogs();
            }, 250);
        });
    }

    if (resetSearchBtn) {
        resetSearchBtn.addEventListener('click', () => {
            if (searchInput) {
                searchInput.value = '';
                searchInput.focus();
            }
            accessLogState.keyword = '';
            accessLogState.page = 1;
            loadAccessLogs();
        });
    }

    loadAccessLogs();
});

async function loadAccessLogs() {
    const tbody = document.getElementById('accessLogTableBody');
    const summary = document.getElementById('accessLogSummary');
    if (!tbody || !summary) return;

    tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">로딩 중...</td></tr>';
    summary.textContent = '로딩 중...';

    try {
        const response = await fetch(
            `/admin/access_logs?limit=${encodeURIComponent(accessLogState.limit)}&page=${encodeURIComponent(accessLogState.page)}&q=${encodeURIComponent(accessLogState.keyword || '')}`,
            { headers: { Accept: 'application/json' } }
        );
        const data = await response.json();

        if (!response.ok || !data.success) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center text-danger">조회에 실패했습니다.</td></tr>';
            summary.textContent = data.message || '조회 실패';
            renderAccessLogPagination(0, 0);
            return;
        }

        accessLogState.page = Number(data.page || 1);
        accessLogState.totalPages = Number(data.total_pages || 0);

        if (!Array.isArray(data.logs) || data.logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">접속 로그가 없습니다.</td></tr>';
            summary.textContent = `표시 0건 / 검색 결과 ${data.total_count || 0}건 / 전체 ${data.overall_total_count || 0}건`;
            renderAccessLogPagination(accessLogState.page, accessLogState.totalPages);
            return;
        }

        tbody.innerHTML = data.logs.map(log => `
            <tr>
                <td>${escapeAccessLogHtml(log.username || '-')}</td>
                <td><small>${escapeAccessLogHtml(log.login_time || '-')}</small></td>
                <td><small>${escapeAccessLogHtml(log.ip_address || '-')}</small></td>
            </tr>
        `).join('');

        summary.textContent = `표시 ${data.shown_count || data.logs.length}건 / 검색 결과 ${data.total_count || data.logs.length}건 / 전체 ${data.overall_total_count || data.logs.length}건`;
        renderAccessLogPagination(accessLogState.page, accessLogState.totalPages);
    } catch (error) {
        console.error('접속 로그 조회 오류:', error);
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-danger">조회 중 오류가 발생했습니다.</td></tr>';
        summary.textContent = '조회 중 오류';
        renderAccessLogPagination(0, 0);
    }
}

function renderAccessLogPagination(currentPage, totalPages) {
    const pagination = document.getElementById('accessLogPagination');
    const wrap = document.getElementById('accessLogPaginationWrap');
    if (!pagination || !wrap) return;

    if (accessLogState.limit === 'all' || totalPages <= 1) {
        pagination.innerHTML = '';
        wrap.classList.add('d-none');
        return;
    }

    wrap.classList.remove('d-none');
    const items = [];
    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, startPage + 4);

    items.push(makePageItem('이전', currentPage - 1, currentPage <= 1));
    for (let pageNum = startPage; pageNum <= endPage; pageNum += 1) {
        items.push(makePageItem(String(pageNum), pageNum, false, pageNum === currentPage));
    }
    items.push(makePageItem('다음', currentPage + 1, currentPage >= totalPages));

    pagination.innerHTML = items.join('');
    pagination.querySelectorAll('button[data-page]').forEach(btn => {
        btn.addEventListener('click', () => {
            const nextPage = Number(btn.dataset.page || currentPage);
            if (!Number.isFinite(nextPage) || nextPage < 1 || nextPage === accessLogState.page) return;
            accessLogState.page = nextPage;
            loadAccessLogs();
        });
    });
}

function makePageItem(label, page, disabled, active = false) {
    const liClass = ['page-item'];
    if (disabled) liClass.push('disabled');
    if (active) liClass.push('active');

    return `
        <li class="${liClass.join(' ')}">
            <button type="button" class="page-link" data-page="${page}" ${disabled ? 'disabled' : ''}>${label}</button>
        </li>
    `;
}

function escapeAccessLogHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
