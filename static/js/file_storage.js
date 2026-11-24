/**
 * 파일 스토리지 관리 JavaScript
 */

document.addEventListener('DOMContentLoaded', function() {
    loadStorageInfo();

    const btnRefresh = document.getElementById('btnRefreshStorage');
    if (btnRefresh) btnRefresh.addEventListener('click', loadStorageInfo);

    const btnCheckOld = document.getElementById('btnCheckOldFiles');
    if (btnCheckOld) btnCheckOld.addEventListener('click', checkOldFiles);

    const btnCleanTemp = document.getElementById('btnCleanTemp');
    if (btnCleanTemp) btnCleanTemp.addEventListener('click', cleanTempFiles);
});

async function loadStorageInfo() {
    try {
        const response = await fetch('/admin/storage/info');
        const data = await response.json();

        if (!data.success) {
            console.error('스토리지 정보 로드 실패:', data.message);
            return;
        }

        document.getElementById('totalStorageSize').textContent = data.total_size;
        document.getElementById('totalFileCount').textContent = data.total_files.toLocaleString();
        document.getElementById('totalFolderCount').textContent = data.folder_count;
        updateFolderTable(data.folders || []);
    } catch (error) {
        console.error('스토리지 정보 로드 실패:', error);
        alert('스토리지 정보를 불러오지 못했습니다.');
    }
}

function updateFolderTable(folders) {
    const tbody = document.getElementById('folderStorageTable');
    tbody.innerHTML = '';

    if (!folders.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">표시할 폴더가 없습니다.</td></tr>';
        return;
    }

    folders.forEach(folder => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${folder.name}</td>
            <td>${folder.file_count}</td>
            <td><strong>${folder.size}</strong></td>
            <td>
                <div class="progress" style="height: 20px;">
                    <div class="progress-bar ${getProgressColor(folder.percentage)}"
                         role="progressbar"
                         style="width: ${folder.percentage}%"
                         aria-valuenow="${folder.percentage}"
                         aria-valuemin="0"
                         aria-valuemax="100">
                        ${folder.percentage}%
                    </div>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function getProgressColor(percentage) {
    if (percentage >= 30) return 'bg-danger';
    if (percentage >= 15) return 'bg-warning';
    return 'bg-success';
}

async function checkOldFiles() {
    const days = document.getElementById('cleanupDays').value;

    try {
        const response = await fetch(`/admin/storage/check-old-files?days=${days}`);
        const data = await response.json();

        if (data.success) {
            showOldFilesModal(data, days);
        } else {
            alert('파일 확인 실패: ' + data.message);
        }
    } catch (error) {
        alert('파일 확인 실패: ' + error.message);
    }
}

function showOldFilesModal(data, days) {
    let html = `
        <div class="alert alert-info">
            <strong>${days}일 이상 된 파일:</strong> ${data.file_count}개 (${data.total_size})
        </div>
    `;

    if (data.files.length > 0) {
        html += '<div class="table-responsive"><table class="table table-sm">';
        html += '<thead><tr><th>파일명</th><th>크기</th><th>마지막 수정</th></tr></thead><tbody>';

        data.files.forEach(file => {
            html += `<tr>
                <td><small>${file.name}</small></td>
                <td><span class="badge bg-secondary">${file.size}</span></td>
                <td><small>${file.modified}</small></td>
            </tr>`;
        });

        html += '</tbody></table></div>';
        html += `<button type="button" class="btn btn-danger mt-3" onclick="deleteOldFiles(${days})">
            <i class="bi bi-trash"></i> 오래된 파일 삭제
        </button>`;
    } else {
        html += '<p class="text-success">정리할 오래된 파일이 없습니다.</p>';
    }

    document.getElementById('cleanupResultContent').innerHTML = html;
    new bootstrap.Modal(document.getElementById('cleanupResultModal')).show();
}

async function deleteOldFiles(days) {
    if (!confirm(`정말로 ${days}일 이상 된 파일을 삭제하시겠습니까?\n\n이 작업은 취소할 수 없습니다.`)) {
        return;
    }

    try {
        const response = await fetch('/admin/storage/delete-old-files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ days: parseInt(days, 10) })
        });

        const data = await response.json();

        if (data.success) {
            alert(`파일 정리 완료\n\n삭제 파일: ${data.deleted_count}개\n확보 용량: ${data.freed_space}`);
            location.reload();
        } else {
            alert('파일 삭제 실패: ' + data.message);
        }
    } catch (error) {
        alert('파일 삭제 실패: ' + error.message);
    }
}

async function cleanTempFiles() {
    if (!confirm('임시 파일을 정리하시겠습니까?')) return;

    try {
        const response = await fetch('/admin/storage/clean-temp', { method: 'POST' });
        const data = await response.json();

        if (data.success) {
            alert(`임시 파일 정리 완료\n\n삭제 파일: ${data.deleted_count}개\n확보 용량: ${data.freed_space}`);
            loadStorageInfo();
        } else {
            alert('임시 파일 정리 실패: ' + data.message);
        }
    } catch (error) {
        alert('임시 파일 정리 실패: ' + error.message);
    }
}
