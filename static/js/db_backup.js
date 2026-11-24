// 데이터베이스 백업 관리
document.addEventListener('DOMContentLoaded', function() {
    // 백업 생성
    const btnCreateBackup = document.getElementById('btnCreateBackup');
    if (btnCreateBackup) {
        btnCreateBackup.addEventListener('click', createBackup);
    }

    // 백업 복원
    const btnRestoreBackup = document.getElementById('btnRestoreBackup');
    if (btnRestoreBackup) {
        btnRestoreBackup.addEventListener('click', restoreBackup);
    }

    // 자동 백업 설정 저장
    const btnSaveAutoBackup = document.getElementById('btnSaveAutoBackup');
    if (btnSaveAutoBackup) {
        btnSaveAutoBackup.addEventListener('click', saveAutoBackupSettings);
    }

    // 페이지 로드 시 백업 목록 불러오기
    loadBackupHistory();
});

// 백업 생성 함수
function createBackup() {
    const description = document.getElementById('backupDescription').value.trim();
    const btnCreateBackup = document.getElementById('btnCreateBackup');
    const progressContainer = document.getElementById('backupProgress');
    const progressBar = progressContainer ? progressContainer.querySelector('.progress-bar') : null;

    if (!description) {
        showToastSafe('백업 설명을 입력해주세요.', 'warning');
        return;
    }

    // UI 상태 변경
    btnCreateBackup.disabled = true;
    if (progressContainer) {
        progressContainer.style.display = 'block';
    }
    if (progressBar) {
        progressBar.style.width = '0%';
    }

    // 진행률 애니메이션
    let progress = 0;
    const progressInterval = setInterval(() => {
        progress += 10;
        if (progressBar) {
            progressBar.style.width = progress + '%';
        }
        if (progress >= 90) {
            clearInterval(progressInterval);
        }
    }, 200);

    fetch('/admin/backup/create', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ description: description })
    })
    .then(response => response.json())
    .then(data => {
        clearInterval(progressInterval);
        if (progressBar) {
            progressBar.style.width = '100%';
        }

        if (data.success) {
            showToastSafe('백업이 성공적으로 생성되었습니다.', 'success');
            document.getElementById('backupDescription').value = '';
            setTimeout(() => {
                if (progressContainer) {
                    progressContainer.style.display = 'none';
                }
                loadBackupHistory();
            }, 1000);
        } else {
            showToastSafe('백업 생성 실패: ' + data.message, 'danger');
            if (progressContainer) {
                progressContainer.style.display = 'none';
            }
        }
    })
    .catch(error => {
        clearInterval(progressInterval);
        console.error('Error:', error);
        showToastSafe('백업 생성 중 오류가 발생했습니다.', 'danger');
        if (progressContainer) {
            progressContainer.style.display = 'none';
        }
    })
    .finally(() => {
        btnCreateBackup.disabled = false;
    });
}

// 백업 복원 함수
async function restoreBackup() {
    const fileInput = document.getElementById('restoreFile');
    const file = fileInput.files[0];
    const clearBeforeRestore = document.getElementById('clearBeforeRestore')?.checked !== false;

    if (!file) {
        showToastSafe('파일을 선택해주세요.', 'warning');
        return;
    }

    const confirmMessage = clearBeforeRestore
        ? '복원 전에 기존 스키마를 초기화합니다. 진행하시겠습니까?'
        : '복원 전에 기존 스키마를 초기화하지 않습니다. 진행하시겠습니까?';
    if (!(await window.confirmAction(confirmMessage))) {
        return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('clear_before_restore', clearBeforeRestore ? 'true' : 'false');

    const btnRestoreBackup = document.getElementById('btnRestoreBackup');
    btnRestoreBackup.disabled = true;

    fetch('/admin/backup/restore', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showToastSafe('백업이 성공적으로 복원되었습니다. 로그인 페이지로 이동합니다.', 'success');
            setTimeout(() => {
                window.location.href = '/login';
            }, 3000);
        } else {
            showToastSafe('복원 실패: ' + data.message, 'danger');
            btnRestoreBackup.disabled = false;
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showToastSafe('백업 복원 중 오류가 발생했습니다.', 'danger');
        btnRestoreBackup.disabled = false;
    });
}

// 백업 히스토리 불러오기
function loadBackupHistory() {
    fetch('/admin/backup/list')
        .then(response => response.json())
        .then(data => {
            const tbody = document.getElementById('backupHistoryTable');
            tbody.innerHTML = '';

            if (data.backups && data.backups.length > 0) {
                data.backups.forEach(backup => {
                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td>${backup.date}</td>
                        <td>${backup.description || '-'}</td>
                        <td>${formatFileSize(backup.size)}</td>
                        <td>
                            <button class="btn btn-sm btn-outline-primary" onclick="downloadBackup('${backup.filename}')">
                                <i class="bi bi-download"></i>
                            </button>
                            <button class="btn btn-sm btn-outline-danger" onclick="deleteBackup('${backup.filename}')">
                                <i class="bi bi-trash"></i>
                            </button>
                        </td>
                    `;
                    tbody.appendChild(row);
                });
            } else {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">백업 파일이 없습니다.</td></tr>';
            }
        })
        .catch(error => {
            console.error('Error:', error);
            showToastSafe('백업 목록을 불러오는 중 오류가 발생했습니다.', 'danger');
        });
}

// 백업 다운로드
function downloadBackup(filename) {
    window.location.href = `/admin/backup/download/${filename}`;
}

// 백업 삭제
async function deleteBackup(filename) {
    if (!(await window.confirmAction('이 백업 파일을 삭제하시겠습니까?'))) {
        return;
    }

    fetch(`/admin/backup/delete/${filename}`, {
        method: 'DELETE'
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showToastSafe('백업 파일이 삭제되었습니다.', 'success');
            loadBackupHistory();
        } else {
            showToastSafe('백업 파일 삭제 실패: ' + data.message, 'danger');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showToastSafe('백업 파일 삭제 중 오류가 발생했습니다.', 'danger');
    });
}

// 자동 백업 설정 저장
function saveAutoBackupSettings() {
    const autoBackupEnabled = document.getElementById('autoBackupEnabled').checked;
    const backupFrequency = document.getElementById('backupFrequency').value;
    const maxBackups = document.getElementById('maxBackups').value;

    fetch('/admin/backup/settings', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            enabled: autoBackupEnabled,
            frequency: backupFrequency,
            max_backups: parseInt(maxBackups)
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showToastSafe('자동 백업 설정이 저장되었습니다.', 'success');
        } else {
            showToastSafe('설정 저장 실패: ' + data.message, 'danger');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showToastSafe('설정 저장 중 오류가 발생했습니다.', 'danger');
    });
}

// 파일 크기 포맷팅
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Toast 알림 표시 (기존 함수 활용)
function showToastSafe(message, type) {
    if (typeof window.showToast === 'function') {
        window.showToast(message, type || 'info');
    }
}
