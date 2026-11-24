// 감사 로그 관리
const auditLogState = {
    pageSize: '50'
};

document.addEventListener('DOMContentLoaded', function() {
    const pageSizeEl = document.getElementById('pageSize');
    if (pageSizeEl) {
        auditLogState.pageSize = pageSizeEl.value || '50';
    }
    // 페이지 로드 시 로그 불러오기
    loadAuditLogs();

    // 필터 적용 버튼
    const btnApplyFilter = document.getElementById('btnApplyFilter');
    if (btnApplyFilter) {
        btnApplyFilter.addEventListener('click', (e) => {
        e.preventDefault();
        loadAuditLogs(1);
    });
    }

    // 새로고침 버튼
    const btnRefreshLogs = document.getElementById('btnRefreshLogs');
    if (btnRefreshLogs) {
        btnRefreshLogs.addEventListener('click', () => {
            clearFilters();
            loadAuditLogs();
        });
    }

    // CSV 내보내기 버튼
    const btnExportLogs = document.getElementById('btnExportLogs');
    if (btnExportLogs) {
        btnExportLogs.addEventListener('click', exportLogsToCSV);
    }

    // 페이지 크기 변경
    const pageSize = document.getElementById('pageSize');
    if (pageSize) {
        pageSize.addEventListener('change', () => {
            auditLogState.pageSize = pageSize.value || '50';
            loadAuditLogs(1);
        });
    }

    // 사용자 목록 불러오기
    loadUserList();

    // 통계 불러오기
    loadLogStatistics();
});

// 감사 로그 불러오기
function loadAuditLogs(page = 1) {
    const filterUser = document.getElementById('filterUser').value;
    const filterAction = document.getElementById('filterAction').value;
    const filterStartDate = document.getElementById('filterStartDate').value;
    const filterEndDate = document.getElementById('filterEndDate').value;
    const pageSize = auditLogState.pageSize || (document.getElementById('pageSize')?.value || '50');

    const params = new URLSearchParams({
        page: page,
        page_size: pageSize,
        user: filterUser,
        action: filterAction,
        start_date: filterStartDate,
        end_date: filterEndDate
    });

    fetch(`/admin/audit/logs?${params}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                displayLogs(data.logs);
                updatePagination(data.pagination);
                updateLogCount(data.total);
            } else {
                showToastSafe('로그를 불러올 수 없습니다.', 'danger');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            showToastSafe('로그 조회 중 오류가 발생했습니다.', 'danger');
        });
}

// 로그 테이블 표시
function displayLogs(logs) {
    const tbody = document.getElementById('auditLogTable');
    tbody.innerHTML = '';

    if (logs && logs.length > 0) {
        logs.forEach(log => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${log.id}</td>
                <td>${log.created_at}</td>
                <td>${log.username}</td>
                <td><span class="badge ${getActionBadgeClass(log.action)}">${getActionText(log.action)}</span></td>
                <td>${log.resource || '-'}</td>
                <td>${log.details || '-'}</td>
                <td>${log.ip_address}</td>
                <td>
                    <span class="badge ${log.success ? 'bg-success' : 'bg-danger'}">
                        ${log.success ? '성공' : '실패'}
                    </span>
                </td>
            `;
            tbody.appendChild(row);
        });
    } else {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">로그가 없습니다.</td></tr>';
    }
}

// 작업 유형별 배지 클래스
function getActionBadgeClass(action) {
    const classes = {
        'login': 'bg-info',
        'logout': 'bg-secondary',
        'create': 'bg-success',
        'update': 'bg-primary',
        'delete': 'bg-danger',
        'download': 'bg-warning',
        'upload': 'bg-info',
        'config': 'bg-dark'
    };
    return classes[action] || 'bg-secondary';
}

// 작업 유형 텍스트
function getActionText(action) {
    const texts = {
        'login': '로그인',
        'logout': '로그아웃',
        'create': '생성',
        'update': '수정',
        'delete': '삭제',
        'download': '다운로드',
        'upload': '업로드',
        'config': '설정 변경'
    };
    return texts[action] || action;
}

// 페이지네이션 업데이트
function updatePagination(pagination) {
    const paginationEl = document.getElementById('logPagination');
    const paginationWrap = paginationEl ? paginationEl.closest('nav') : null;
    if (!paginationEl) return;

    paginationEl.innerHTML = '';

    const { current_page, total_pages } = pagination;

    if (String(auditLogState.pageSize).toLowerCase() === 'all' || total_pages <= 1) {
        if (paginationWrap) paginationWrap.classList.add('d-none');
        return;
    }

    if (paginationWrap) paginationWrap.classList.remove('d-none');

    // 이전 버튼
    const prevLi = document.createElement('li');
    prevLi.className = 'page-item' + (current_page === 1 ? ' disabled' : '');
    prevLi.innerHTML = `<a class="page-link" href="#" data-page="${current_page - 1}">이전</a>`;
    paginationEl.appendChild(prevLi);

    // 페이지 번호
    const startPage = Math.max(1, current_page - 2);
    const endPage = Math.min(total_pages, current_page + 2);

    for (let i = startPage; i <= endPage; i++) {
        const li = document.createElement('li');
        li.className = 'page-item' + (i === current_page ? ' active' : '');
        li.innerHTML = `<a class="page-link" href="#" data-page="${i}">${i}</a>`;
        paginationEl.appendChild(li);
    }

    // 다음 버튼
    const nextLi = document.createElement('li');
    nextLi.className = 'page-item' + (current_page === total_pages ? ' disabled' : '');
    nextLi.innerHTML = `<a class="page-link" href="#" data-page="${current_page + 1}">다음</a>`;
    paginationEl.appendChild(nextLi);

    // 페이지 클릭 이벤트
    paginationEl.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const page = parseInt(link.dataset.page);
            if (page > 0 && page <= total_pages) {
                loadAuditLogs(page);
            }
        });
    });
}

// 로그 개수 업데이트
function updateLogCount(total) {
    const logCount = document.getElementById('logCount');
    if (logCount) {
        logCount.innerHTML = `총 <strong>${total}</strong>개의 로그`;
    }
}

// 사용자 목록 불러오기
function loadUserList() {
    fetch('/admin/users/list')
        .then(response => response.json())
        .then(data => {
            const select = document.getElementById('filterUser');
            if (select && data.users) {
                data.users.forEach(user => {
                    const option = document.createElement('option');
                    option.value = user.username;
                    option.textContent = `${user.real_name} (${user.username})`;
                    select.appendChild(option);
                });
            }
        })
        .catch(error => {
            console.error('Error loading users:', error);
        });
}

// 통계 불러오기
function loadLogStatistics() {
    fetch('/admin/audit/statistics')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                document.getElementById('todayCount').textContent = data.today || 0;
                document.getElementById('weekCount').textContent = data.week || 0;
                document.getElementById('monthCount').textContent = data.month || 0;
            }
        })
        .catch(error => {
            console.error('Error loading statistics:', error);
        });
}

// CSV 내보내기
function exportLogsToCSV() {
    const filterUser = document.getElementById('filterUser').value;
    const filterAction = document.getElementById('filterAction').value;
    const filterStartDate = document.getElementById('filterStartDate').value;
    const filterEndDate = document.getElementById('filterEndDate').value;

    const params = new URLSearchParams({
        user: filterUser,
        action: filterAction,
        start_date: filterStartDate,
        end_date: filterEndDate,
        export: 'csv'
    });

    window.location.href = `/admin/audit/export?${params}`;
    showToastSafe('CSV 파일 다운로드가 시작되었습니다.', 'success');
}

// 필터 초기화
function clearFilters() {
    document.getElementById('filterUser').value = '';
    document.getElementById('filterAction').value = '';
    document.getElementById('filterStartDate').value = '';
    document.getElementById('filterEndDate').value = '';
}

// Toast 알림 표시
function showToastSafe(message, type) {
    if (typeof window.showToast === 'function') {
        window.showToast(message, type || 'info');
    }
}
