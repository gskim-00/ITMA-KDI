/**
 * Bulk User Upload Handler
 * 엑셀 파일을 통한 대규모 사용자 일괄 등록
 */

document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('bulkUserUploadForm');
    if (form) {
        form.addEventListener('submit', handleBulkUpload);
    }
});

/**
 * 엑셀 템플릿 다운로드
 */
window.downloadBulkUserTemplate = function() {
    window.location.href = '/admin/download_bulk_user_template';
};

/**
 * 엑셀 파일 업로드 및 처리
 */
async function handleBulkUpload(e) {
    e.preventDefault();
    
    const fileInput = document.getElementById('bulkUserFile');
    const sendEmail = document.getElementById('sendWelcomeEmail').checked;
    const file = fileInput.files[0];
    
    if (!file) {
        alert('파일을 선택해주세요.');
        return;
    }
    
    // 파일 확장자 검증
    const allowedExtensions = ['xlsx', 'xls', 'csv'];
    const fileExtension = file.name.split('.').pop().toLowerCase();
    
    if (!allowedExtensions.includes(fileExtension)) {
        alert('지원하지 않는 파일 형식입니다. (.xlsx, .xls, .csv만 가능)');
        return;
    }
    
    // 파일 크기 제한 (10MB)
    if (file.size > 10 * 1024 * 1024) {
        alert('파일 크기는 10MB를 초과할 수 없습니다.');
        return;
    }
    
    // 진행 상태 표시
    showProgress(true);
    updateProgress(10, '파일 업로드 중...');
    
    try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('send_email', sendEmail);
        
        updateProgress(30, '엑셀 파일 분석 중...');
        
        const response = await fetch('/admin/bulk_add_users', {
            method: 'POST',
            body: formData
        });
        
        updateProgress(70, '사용자 등록 처리 중...');
        
        const result = await response.json();
        
        updateProgress(100, '완료!');
        
        // 결과 표시
        setTimeout(() => {
            showProgress(false);
            displayResult(result);
            
            // 성공 시 폼 초기화
            if (result.success && result.added_count > 0) {
                fileInput.value = '';
                document.getElementById('sendWelcomeEmail').checked = false;
            }
        }, 1000);
        
    } catch (error) {
        console.error('업로드 오류:', error);
        showProgress(false);
        displayResult({
            success: false,
            message: '업로드 중 오류가 발생했습니다: ' + error.message
        });
    }
}

/**
 * 진행 상태 표시/숨김
 */
function showProgress(show) {
    const progressDiv = document.getElementById('bulkUploadProgress');
    const resultDiv = document.getElementById('bulkUploadResult');
    
    if (show) {
        progressDiv.style.display = 'block';
        resultDiv.style.display = 'none';
        updateProgress(0, '시작 중...');
    } else {
        progressDiv.style.display = 'none';
    }
}

/**
 * 진행률 업데이트
 */
function updateProgress(percent, text) {
    const progressBar = document.getElementById('bulkProgressBar');
    const progressText = document.getElementById('bulkProgressText');
    
    if (progressBar) {
        progressBar.style.width = percent + '%';
        progressBar.textContent = Math.round(percent) + '%';
        
        // 색상 변경
        if (percent === 100) {
            progressBar.classList.remove('progress-bar-animated');
            progressBar.classList.add('bg-success');
        } else {
            progressBar.classList.add('progress-bar-animated');
            progressBar.classList.remove('bg-success');
        }
    }
    
    if (progressText) {
        progressText.textContent = text;
    }
}

/**
 * 결과 표시
 */
function displayResult(result) {
    const resultDiv = document.getElementById('bulkUploadResult');
    
    if (!resultDiv) return;
    
    let html = '';
    
    if (result.success) {
        html = `
            <div class="alert alert-success">
                <h5><i class="bi bi-check-circle"></i> 일괄 등록 완료</h5>
                <hr>
                <div class="row">
                    <div class="col-md-6">
                        <p class="mb-2"><strong>📊 처리 결과:</strong></p>
                        <ul class="mb-0">
                            <li>총 처리: <strong>${result.total_count || 0}명</strong></li>
                            <li>성공: <strong class="text-success">${result.added_count || 0}명</strong></li>
                            <li>실패: <strong class="text-danger">${result.failed_count || 0}명</strong></li>
                            <li>중복: <strong class="text-warning">${result.skipped_count || 0}명</strong></li>
                        </ul>
                    </div>
                    <div class="col-md-6">
                        ${result.email_sent_count > 0 ? `
                        <p class="mb-2"><strong>📧 이메일 발송:</strong></p>
                        <ul class="mb-0">
                            <li>발송 성공: <strong>${result.email_sent_count}명</strong></li>
                        </ul>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
        
        // 실패 상세 정보
        if (result.failed_details && result.failed_details.length > 0) {
            html += `
                <div class="alert alert-warning">
                    <h6><i class="bi bi-exclamation-triangle"></i> 실패 상세 내역 (${result.failed_details.length}건)</h6>
                    <div class="table-responsive" style="max-height: 300px; overflow-y: auto;">
                        <table class="table table-sm table-striped">
                            <thead>
                                <tr>
                                    <th>행</th>
                                    <th>사용자 ID</th>
                                    <th>실패 사유</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${result.failed_details.map(item => `
                                    <tr>
                                        <td>${item.row || '-'}</td>
                                        <td>${item.username || '-'}</td>
                                        <td><small class="text-danger">${item.error}</small></td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        }
        
        // 중복 사용자 목록
        if (result.skipped_users && result.skipped_users.length > 0) {
            html += `
                <div class="alert alert-info">
                    <h6><i class="bi bi-info-circle"></i> 중복으로 건너뛴 사용자 (${result.skipped_users.length}명)</h6>
                    <p class="mb-0"><small>${result.skipped_users.join(', ')}</small></p>
                </div>
            `;
        }
        
    } else {
        html = `
            <div class="alert alert-danger">
                <h5><i class="bi bi-x-circle"></i> 업로드 실패</h5>
                <p class="mb-0">${result.message || '알 수 없는 오류가 발생했습니다.'}</p>
            </div>
        `;
    }
    
    resultDiv.innerHTML = html;
    resultDiv.style.display = 'block';
    
    // 결과가 성공이면 사용자 목록 새로고침
    if (result.success && result.added_count > 0) {
        setTimeout(() => {
            // 사용자 목록 탭으로 이동하고 새로고침
            const userListLink = document.querySelector('[data-section="user-list"]');
            if (userListLink) {
                userListLink.click();
                setTimeout(() => location.reload(), 500);
            }
        }, 3000);
    }
}
