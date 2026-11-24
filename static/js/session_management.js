// 세션 관리
document.addEventListener('DOMContentLoaded', function() {
    // 페이지 로드 시 세션 목록 불러오기
    loadSessions();
    loadSessionStatistics();

    // 새로고침 버튼
    const btnRefreshSessions = document.getElementById('btnRefreshSessions');
    if (btnRefreshSessions) {
        btnRefreshSessions.addEventListener('click', () => {
            loadSessions();
            loadSessionStatistics();
        });
    }

    // 만료 세션 정리 버튼
    const btnClearExpiredSessions = document.getElementById('btnClearExpiredSessions');
    if (btnClearExpiredSessions) {
        btnClearExpiredSessions.addEventListener('click', clearExpiredSessions);
    }

    // 세션 설정 저장 버튼
    const btnSaveSessionSettings = document.getElementById('btnSaveSessionSettings');
    if (btnSaveSessionSettings) {
        btnSaveSessionSettings.addEventListener('click', saveSessionSettings);
    }

    // 보안 정책 저장 버튼
    const btnSaveSecurityPolicy = document.getElementById('btnSaveSecurityPolicy');
    if (btnSaveSecurityPolicy) {
        btnSaveSecurityPolicy.addEventListener('click', saveSecurityPolicy);
    }

    // 자동 새로고침 (60초마다)
    setInterval(() => {
        loadSessions();
        loadSessionStatistics();
    }, 60000);

    // 기존 설정 불러오기
    loadCurrentSettings();
});

// 세션 목록 불러오기
function loadSessions() {
    fetch('/admin/sessions/list')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                displaySessions(data.sessions);
            } else {
                showToastSafe('세션 목록을 불러올 수 없습니다.', 'danger');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            showToastSafe('세션 조회 중 오류가 발생했습니다.', 'danger');
        });
}

// 세션 테이블 표시
function displaySessions(sessions) {
    const tbody = document.getElementById('sessionsTable');
    tbody.innerHTML = '';

    if (sessions && sessions.length > 0) {
        sessions.forEach(session => {
            const row = document.createElement('tr');
            const isCurrentUser = session.is_current;
            
            row.innerHTML = `
                <td>${session.username}${isCurrentUser ? ' <span class="badge bg-info">현재</span>' : ''}</td>
                <td>${session.real_name}</td>
                <td><span class="badge bg-secondary">${session.role}</span></td>
                <td>${session.login_time}</td>
                <td>${session.session_duration}</td>
                <td>${session.ip_address}</td>
                <td>
                    <span class="badge ${getSessionStatusBadge(session.status)}">
                        ${getSessionStatusText(session.status)}
                    </span>
                </td>
                <td>
                    ${!isCurrentUser ? `
                        <button class="btn btn-sm btn-outline-danger" onclick="terminateSession('${session.session_id}', '${session.username}')">
                            <i class="bi bi-x-circle"></i> 종료
                        </button>
                    ` : '<span class="text-muted">-</span>'}
                </td>
            `;
            tbody.appendChild(row);
        });
    } else {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">활성 세션이 없습니다.</td></tr>';
    }
}

// 세션 상태 배지
function getSessionStatusBadge(status) {
    const badges = {
        'active': 'bg-success',
        'idle': 'bg-warning',
        'expired': 'bg-danger'
    };
    return badges[status] || 'bg-secondary';
}

// 세션 상태 텍스트
function getSessionStatusText(status) {
    const texts = {
        'active': '활성',
        'idle': '유휴',
        'expired': '만료'
    };
    return texts[status] || status;
}

// 세션 강제 종료
async function terminateSession(sessionId, username) {
    if (!(await window.confirmAction(`${username} 사용자의 세션을 강제 종료하시겠습니까?`))) {
        return;
    }

    fetch(`/admin/sessions/terminate/${sessionId}`, {
        method: 'POST'
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showToastSafe('세션이 종료되었습니다.', 'success');
            loadSessions();
            loadSessionStatistics();
        } else {
            showToastSafe('세션 종료 실패: ' + data.message, 'danger');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showToastSafe('세션 종료 중 오류가 발생했습니다.', 'danger');
    });
}

// 만료된 세션 정리
async function clearExpiredSessions() {
    if (!(await window.confirmAction('만료된 모든 세션을 정리하시겠습니까?'))) {
        return;
    }

    fetch('/admin/sessions/clear_expired', {
        method: 'POST'
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showToastSafe(`${data.cleared_count}개의 만료된 세션이 정리되었습니다.`, 'success');
            loadSessions();
            loadSessionStatistics();
        } else {
            showToastSafe('세션 정리 실패: ' + data.message, 'danger');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showToastSafe('세션 정리 중 오류가 발생했습니다.', 'danger');
    });
}

// 세션 통계 불러오기
function loadSessionStatistics() {
    fetch('/admin/sessions/statistics')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                document.getElementById('activeSessionsCount').textContent = data.active_sessions || 0;
                document.getElementById('todayLoginsCount').textContent = data.today_logins || 0;
                document.getElementById('avgSessionTime').textContent = data.avg_session_time || '0분';
                document.getElementById('expiredSessionsCount').textContent = data.expired_sessions || 0;
            }
        })
        .catch(error => {
            console.error('Error loading statistics:', error);
        });
}

// 세션 설정 불러오기
function loadCurrentSettings() {
    fetch('/admin/sessions/settings')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // 세션 설정
                const sessionTimeoutEl = document.getElementById('sessionTimeout');
                const absoluteTimeoutEl = document.getElementById('sessionAbsoluteTimeoutHours');
                const warnBeforeEl = document.getElementById('warnBeforeTimeout');
                const concurrentEl = document.getElementById('concurrentSessions');
                const rememberEl = document.getElementById('rememberMe');
                const cleanupEl = document.getElementById('autoCleanup');

                if (sessionTimeoutEl) sessionTimeoutEl.value = data.session_timeout || 10;
                if (absoluteTimeoutEl) absoluteTimeoutEl.value = data.absolute_timeout_hours || 8;
                if (warnBeforeEl) warnBeforeEl.checked = data.warn_before_timeout !== false;
                if (concurrentEl) concurrentEl.value = data.concurrent_sessions || 3;
                if (rememberEl) rememberEl.checked = data.remember_me !== false;
                if (cleanupEl) cleanupEl.checked = data.auto_cleanup !== false;

                // 보안 정책
                const ipBindingEl = document.getElementById('ipBinding');
                const forceLogoutEl = document.getElementById('forceLogoutOnPasswordChange');
                const suspiciousEl = document.getElementById('suspiciousActivityDetection');

                if (ipBindingEl) ipBindingEl.checked = data.ip_binding === true;
                if (forceLogoutEl) forceLogoutEl.checked = data.force_logout_on_password_change !== false;
                if (suspiciousEl) suspiciousEl.value = data.suspicious_activity_detection || 'alert';
            }
        })
        .catch(error => {
            console.error('Error loading settings:', error);
        });
}

// 세션 설정 저장
function saveSessionSettings() {
    const sessionTimeoutEl = document.getElementById('sessionTimeout');
    const absoluteTimeoutEl = document.getElementById('sessionAbsoluteTimeoutHours');
    const warnBeforeEl = document.getElementById('warnBeforeTimeout');
    const concurrentEl = document.getElementById('concurrentSessions');
    const rememberEl = document.getElementById('rememberMe');
    const cleanupEl = document.getElementById('autoCleanup');

    if (!sessionTimeoutEl || !concurrentEl || !rememberEl || !cleanupEl) return;

    const sessionTimeout = sessionTimeoutEl.value;
    const absoluteTimeoutHours = absoluteTimeoutEl ? absoluteTimeoutEl.value : '8';
    const warnBeforeTimeout = warnBeforeEl ? warnBeforeEl.checked : true;
    const concurrentSessions = concurrentEl.value;
    const rememberMe = rememberEl.checked;
    const autoCleanup = cleanupEl.checked;

    fetch('/admin/sessions/settings', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            session_timeout: parseInt(sessionTimeout),
            absolute_timeout_hours: parseInt(absoluteTimeoutHours),
            warn_before_timeout: warnBeforeTimeout,
            concurrent_sessions: parseInt(concurrentSessions),
            remember_me: rememberMe,
            auto_cleanup: autoCleanup
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showToastSafe('세션 설정이 저장되었습니다.', 'success');
        } else {
            showToastSafe('저장 실패: ' + data.message, 'danger');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showToastSafe('설정 저장 중 오류가 발생했습니다.', 'danger');
    });
}

// 보안 정책 저장
function saveSecurityPolicy() {
    const ipBindingEl = document.getElementById('ipBinding');
    const forceLogoutEl = document.getElementById('forceLogoutOnPasswordChange');
    const suspiciousEl = document.getElementById('suspiciousActivityDetection');
    if (!ipBindingEl || !forceLogoutEl || !suspiciousEl) return;

    const ipBinding = ipBindingEl.checked;
    const forceLogoutOnPasswordChange = forceLogoutEl.checked;
    const suspiciousActivityDetection = suspiciousEl.value;

    fetch('/admin/sessions/security_policy', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            ip_binding: ipBinding,
            force_logout_on_password_change: forceLogoutOnPasswordChange,
            suspicious_activity_detection: suspiciousActivityDetection
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showToastSafe('보안 정책이 저장되었습니다.', 'success');
        } else {
            showToastSafe('저장 실패: ' + data.message, 'danger');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showToastSafe('보안 정책 저장 중 오류가 발생했습니다.', 'danger');
    });
}

// Toast 알림 표시
function showToastSafe(message, type) {
    if (typeof window.showToast === 'function') {
        window.showToast(message, type || 'info');
    }
}
