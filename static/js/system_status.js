// 시스템 상태 모니터링
document.addEventListener('DOMContentLoaded', function() {
    // 페이지 로드 시 시스템 상태 불러오기
    loadSystemStatus();

    // 새로고침 버튼
    const btnRefreshDbStatus = document.getElementById('btnRefreshDbStatus');
    if (btnRefreshDbStatus) {
        btnRefreshDbStatus.addEventListener('click', loadSystemStatus);
    }

    // DB 연결 테스트 버튼
    const btnTestDbConnection = document.getElementById('btnTestDbConnection');
    if (btnTestDbConnection) {
        btnTestDbConnection.addEventListener('click', testDatabaseConnection);
    }

    // 임계값 설정 저장 버튼
    const btnSaveThresholds = document.getElementById('btnSaveThresholds');
    if (btnSaveThresholds) {
        btnSaveThresholds.addEventListener('click', saveAlertThresholds);
    }

    // 자동 새로고침 (30초마다)
    setInterval(loadSystemStatus, 30000);
});

// 시스템 상태 불러오기
function loadSystemStatus() {
    fetch('/admin/system/status')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                updateStatusCards(data.status);
                updateDatabaseDetails(data.database);
                updateResourceUsage(data.resources);
            } else {
                showToastSafe('시스템 상태를 불러올 수 없습니다.', 'danger');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            showToastSafe('시스템 상태 조회 중 오류가 발생했습니다.', 'danger');
        });
}

// 상태 카드 업데이트
function updateStatusCards(status) {
    // 데이터베이스 상태
    const dbStatus = document.getElementById('dbStatus');
    if (dbStatus) {
        const isHealthy = status.database === 'connected';
        const badgeClass = isHealthy ? 'bg-success' : 'bg-danger';
        dbStatus.innerHTML = `<span class="badge ${badgeClass}">${isHealthy ? '정상' : '오류'}</span>`;
    }

    // 디스크 상태
    const diskUsage = document.getElementById('diskUsage');
    if (diskUsage) {
        const percentage = status.disk_usage || 0;
        diskUsage.textContent = `${percentage}%`;
        const card = diskUsage.closest('.card');
        if (card) {
            if (percentage > 90) {
                card.classList.add('border-danger');
            } else if (percentage > 80) {
                card.classList.add('border-warning');
            } else {
                card.classList.remove('border-danger', 'border-warning');
            }
        }
    }

    // 메모리 사용량
    const memoryUsage = document.getElementById('memoryUsage');
    if (memoryUsage) {
        memoryUsage.textContent = `${status.memory_usage || 0}%`;
    }

    // 서버 상태
    const serverStatus = document.getElementById('serverStatus');
    if (serverStatus) {
        const uptime = status.uptime || '0일 0시간';
        serverStatus.textContent = uptime;
    }

}

// 데이터베이스 상세 정보 업데이트
function updateDatabaseDetails(database) {
    // 연결 상태
    const dbConnectionStatus = document.getElementById('dbConnectionStatus');
    if (dbConnectionStatus) {
        dbConnectionStatus.innerHTML = `
            <span class="badge ${database.connected ? 'bg-success' : 'bg-danger'}">
                ${database.connected ? '연결됨' : '연결 실패'}
            </span>
        `;
    }

    // 데이터베이스 버전
    const dbVersion = document.getElementById('dbVersion');
    if (dbVersion) {
        dbVersion.textContent = database.version || '-';
    }

    // 데이터베이스 크기
    const dbSize = document.getElementById('dbSize');
    if (dbSize) {
        dbSize.textContent = database.size || '-';
    }

    // 활성 연결 수
    const dbConnections = document.getElementById('dbConnections');
    if (dbConnections) {
        dbConnections.textContent = database.active_connections || 0;
    }

    // 테이블 수
    const dbTables = document.getElementById('dbTables');
    if (dbTables) {
        dbTables.textContent = database.table_count || 0;
    }

    // 마지막 백업
    const dbLastBackup = document.getElementById('dbLastBackup');
    if (dbLastBackup) {
        dbLastBackup.textContent = database.last_backup || '없음';
    }
}

// 리소스 사용량 업데이트
function updateResourceUsage(resources) {
    // 디스크 사용량
    const diskBar = document.getElementById('diskProgressBar');
    if (diskBar) {
        const percentage = resources.disk_usage || 0;
        diskBar.style.width = percentage + '%';
        diskBar.textContent = percentage + '%';
        diskBar.className = 'progress-bar ' + getProgressBarClass(percentage);
    }

    const diskSpace = document.getElementById('diskSpace');
    if (diskSpace) {
        diskSpace.textContent = `사용: ${resources.disk_used || '0 GB'} / 전체: ${resources.disk_total || '0 GB'}`;
    }

    // 업로드 폴더 사용량
    const uploadsBar = document.getElementById('uploadsProgressBar');
    if (uploadsBar) {
        const percentage = resources.uploads_usage || 0;
        uploadsBar.style.width = percentage + '%';
        uploadsBar.textContent = `${resources.uploads_used || '0 MB'}`;
        uploadsBar.className = 'progress-bar bg-success';
    }

    const uploadsSize = document.getElementById('uploadsSize');
    if (uploadsSize) {
        uploadsSize.textContent = `사용: ${resources.uploads_used || '0 MB'} / 할당: ${resources.uploads_limit || '0 GB'}`;
    }

    // 서버 가동 시간
    const uptime = document.getElementById('uptime');
    if (uptime) {
        uptime.textContent = resources.uptime || '알 수 없음';
    }
}

// 진행 바 색상 클래스
function getProgressBarClass(percentage) {
    if (percentage >= 90) return 'bg-danger';
    if (percentage >= 80) return 'bg-warning';
    return 'bg-success';
}

// 데이터베이스 연결 테스트
function testDatabaseConnection() {
    const btnTestDbConnection = document.getElementById('btnTestDbConnection');
    btnTestDbConnection.disabled = true;

    fetch('/admin/system/db_test')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showToastSafe(`데이터베이스 연결 성공! (응답 시간: ${data.response_time}ms)`, 'success');
            } else {
                showToastSafe('데이터베이스 연결 실패: ' + data.message, 'danger');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            showToastSafe('데이터베이스 연결 테스트 중 오류가 발생했습니다.', 'danger');
        })
        .finally(() => {
            btnTestDbConnection.disabled = false;
        });
}

// 알림 임계값 저장
function saveAlertThresholds() {
    const diskWarning = document.getElementById('diskWarningThreshold').value;
    const diskDanger = document.getElementById('diskDangerThreshold').value;
    const dbConnections = document.getElementById('dbConnectionThreshold').value;
    const uploadsLimit = document.getElementById('uploadsLimitThreshold').value;

    fetch('/admin/system/thresholds', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            disk_warning: parseInt(diskWarning),
            disk_danger: parseInt(diskDanger),
            db_connections: parseInt(dbConnections),
            uploads_limit: parseInt(uploadsLimit)
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showToastSafe('알림 임계값이 저장되었습니다.', 'success');
        } else {
            showToastSafe('저장 실패: ' + data.message, 'danger');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showToastSafe('임계값 저장 중 오류가 발생했습니다.', 'danger');
    });
}

// Toast 알림 표시
function showToastSafe(message, type) {
    if (typeof window.showToast === 'function') {
        window.showToast(message, type || 'info');
    }
}
