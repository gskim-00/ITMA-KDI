/**
 * Email Template Handler - CRUD Operations
 */

let currentTemplateId = null;

document.addEventListener('DOMContentLoaded', function() {
    // 템플릿 탭이 활성화될 때 목록 로드
    const emailTemplateTab = document.getElementById('email-template-tab');
    if (emailTemplateTab) {
        emailTemplateTab.addEventListener('click', function() {
            setTimeout(loadTemplateList, 100);
        });
    }

    // 실시간 미리보기 (debounce로 성능 최적화)
    const templateSubject = document.getElementById('templateSubject');
    const templateBody = document.getElementById('templateBody');
    
    let previewTimeout;
    const debouncedPreview = () => {
        clearTimeout(previewTimeout);
        previewTimeout = setTimeout(updatePreview, 150);
    };
    
    if (templateSubject) {
        templateSubject.addEventListener('input', debouncedPreview);
    }
    if (templateBody) {
        templateBody.addEventListener('input', debouncedPreview);
    }

    const templateType = document.getElementById('templateType');
    if (templateType) {
        templateType.addEventListener('change', handleTemplateTypeChange);
    }
});

/**
 * Toast 알림 표시 헬퍼 함수
 */
function showToastSafe(message, type = 'success') {
    if (typeof window.showToast === 'function') {
        window.showToast(message, type || 'info');
    }
}

function showInlineResult(resultDiv, message, type = 'info') {
    const plainMessage = String(message || '').replace(/<[^>]*>/g, '').trim();
    if (typeof window.showToast === 'function' && plainMessage) {
        window.showToast(plainMessage, type || 'info');
    }
    if (!resultDiv) return;
    resultDiv.textContent = plainMessage;
    resultDiv.className = `small mt-2 text-${type === 'danger' ? 'danger' : type === 'success' ? 'success' : type === 'warning' ? 'warning' : 'muted'}`;
    resultDiv.style.display = plainMessage ? 'block' : 'none';
}

function normalizeTemplateType(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, '_')
        .replace(/[^\w-]/g, '');
}

function setTemplateTypeValue(typeValue) {
    const typeSelect = document.getElementById('templateType');
    const customInput = document.getElementById('templateTypeCustom');
    if (!typeSelect || !customInput) return;

    const value = String(typeValue || '').trim();
    const exists = Array.from(typeSelect.options).some(option => option.value === value);
    if (!value || exists) {
        typeSelect.value = value;
        customInput.value = '';
        customInput.style.display = 'none';
        return;
    }

    typeSelect.value = '__custom__';
    customInput.value = value;
    customInput.style.display = 'block';
}

function getSelectedTemplateType() {
    const typeSelect = document.getElementById('templateType');
    const customInput = document.getElementById('templateTypeCustom');
    if (!typeSelect) return '';
    if (typeSelect.value === '__custom__') {
        return normalizeTemplateType(customInput ? customInput.value : '');
    }
    return typeSelect.value.trim();
}

function handleTemplateTypeChange() {
    const customInput = document.getElementById('templateTypeCustom');
    const typeSelect = document.getElementById('templateType');
    if (!customInput || !typeSelect) return;

    const isCustom = typeSelect.value === '__custom__';
    customInput.style.display = isCustom ? 'block' : 'none';
    if (isCustom) {
        customInput.focus();
    } else {
        customInput.value = '';
    }
}

/**
 * 템플릿 목록 로드
 */
async function loadTemplateList() {
    const container = document.getElementById('templateListContainer');
    if (!container) {
        return;
    }
    
    // 로딩 표시 (requestAnimationFrame으로 최적화)
    requestAnimationFrame(() => {
        container.innerHTML = `
            <div class="text-center text-muted py-4">
                <div class="spinner-border spinner-border-sm text-primary" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <p class="mt-2 small">로딩 중...</p>
            </div>
        `;
    });

    try {
        const response = await fetch('/admin/get_all_templates');
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();

        if (data.success && data.templates && data.templates.length > 0) {
            let html = '<div class="list-group" style="max-height: 600px; overflow-y: auto;">';
            
            data.templates.forEach(template => {
                const typeIcon = getTemplateTypeIcon(template.template_type);
                const typeBadge = template.template_type 
                    ? `<span class="badge bg-secondary small">${template.template_type}</span>`
                    : '';

                html += `
                    <a href="#" class="list-group-item list-group-item-action" 
                       onclick="loadTemplate(${template.id}); return false;">
                        <div class="d-flex justify-content-between align-items-start">
                            <div class="flex-grow-1">
                                <div class="d-flex align-items-center gap-2 mb-1">
                                    <i class="bi ${typeIcon}"></i>
                                    <strong>${escapeHtml(template.template_name)}</strong>
                                </div>
                                <small class="text-muted d-block text-truncate" style="max-width: 250px;">${escapeHtml(template.subject)}</small>
                                ${typeBadge}
                            </div>
                            <small class="text-muted">${formatDate(template.created_at)}</small>
                        </div>
                    </a>
                `;
            });
            
            html += '</div>';
            
            // DOM 업데이트
            requestAnimationFrame(() => {
                container.innerHTML = html;
            });
        } else {
            requestAnimationFrame(() => {
                container.innerHTML = `
                    <div class="text-center text-muted py-4">
                        <i class="bi bi-inbox fs-1"></i>
                        <p class="mt-2">템플릿이 없습니다.</p>
                        <button class="btn btn-sm btn-success mt-2" onclick="openNewTemplateModal()">
                            <i class="bi bi-plus-circle"></i> 첫 템플릿 만들기
                        </button>
                    </div>
                `;
            });
        }
    } catch (error) {
        console.error('템플릿 목록 로드 실패:', error);
        requestAnimationFrame(() => {
            container.innerHTML = `
                <div class="small text-danger">
                    <i class="bi bi-exclamation-triangle"></i> 목록을 불러오는데 실패했습니다<br>
                    <small class="text-muted">${error.message}</small>
                </div>
            `;
        });
    }
}

/**
 * 템플릿 로드
 */
async function loadTemplate(templateId) {
    try {
        const response = await fetch(`/admin/get_template/${templateId}`);
        const data = await response.json();

        if (data.success) {
            const template = data.template;
            
            // 편집 폼에 데이터 채우기
            document.getElementById('currentTemplateId').value = template.id;
            document.getElementById('templateName').value = template.template_name;
            setTemplateTypeValue(template.template_type || '');
            document.getElementById('templateSubject').value = template.subject;
            document.getElementById('templateBody').value = template.body;
            
            currentTemplateId = template.id;
            
            // UI 전환 (batch DOM updates)
            requestAnimationFrame(() => {
                document.getElementById('templateEmptyState').style.display = 'none';
                document.getElementById('templateEditContainer').style.display = 'block';
                updatePreview();
            });
        } else {
            showToastSafe('템플릿을 불러오는데 실패했습니다: ' + data.message, 'danger');
        }
    } catch (error) {
        console.error('템플릿 로드 실패:', error);
        showToastSafe('템플릿을 불러오는데 실패했습니다.', 'danger');
    }
}

/**
 * 새 템플릿 모달 열기
 */
function openNewTemplateModal() {
    // 폼 초기화
    document.getElementById('currentTemplateId').value = '';
    document.getElementById('templateName').value = '';
    setTemplateTypeValue('');
    document.getElementById('templateSubject').value = '';
    document.getElementById('templateBody').value = '';
    
    currentTemplateId = null;
    
    // UI 전환 및 미리보기 초기화 (batch DOM updates)
    requestAnimationFrame(() => {
        document.getElementById('templateEmptyState').style.display = 'none';
        document.getElementById('templateEditContainer').style.display = 'block';
        document.getElementById('previewSubject').textContent = '제목을 입력하세요';
        document.getElementById('previewBody').textContent = '본문을 입력하세요';
    });
}

/**
 * 템플릿 저장
 */
async function saveTemplate() {
    const templateName = document.getElementById('templateName').value.trim();
    const templateType = getSelectedTemplateType();
    const subject = document.getElementById('templateSubject').value.trim();
    const body = document.getElementById('templateBody').value.trim();
    const templateId = document.getElementById('currentTemplateId').value;
    
    const resultDiv = document.getElementById('templateSaveResult');
    if (!templateName || !subject || !body) {
        showInlineResult(resultDiv, '템플릿 이름, 제목, 본문은 필수입니다.', 'warning');
        return;
    }
    if (document.getElementById('templateType')?.value === '__custom__' && !templateType) {
        showInlineResult(resultDiv, '새 템플릿 유형을 입력해주세요. 영문, 숫자, 밑줄(_)을 권장합니다.', 'warning');
        return;
    }

    showInlineResult(resultDiv, '저장 중...', 'info');

    let timeoutId;
    try {
        const controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), 15000);
        const response = await fetch('/admin/save_template', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                id: templateId || null,
                template_name: templateName,
                template_type: templateType,
                subject: subject,
                body: body
            })
        });

        let data = null;
        try {
            data = await response.json();
        } catch (e) {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
        }
        if (!response.ok) {
            throw new Error((data && data.message) ? data.message : `HTTP error! status: ${response.status}`);
        }

        if (data && data.success) {
            showInlineResult(resultDiv, data.message, 'success');
            // 목록 새로고침
            loadTemplateList();
            // 현재 템플릿 ID 업데이트 (신규 저장인 경우)
            if (data.template_id) {
                document.getElementById('currentTemplateId').value = data.template_id;
                currentTemplateId = data.template_id;
            }
            if (typeof loadTemplateSelector === 'function') {
                loadTemplateSelector();
            }
        } else {
            showInlineResult(resultDiv, (data && data.message) ? data.message : '저장에 실패했습니다.', 'danger');
        }
    } catch (error) {
        const msg = error.name === 'AbortError' ? '요청 시간이 초과되었습니다.' : error.message;
        showInlineResult(resultDiv, '오류: ' + msg, 'danger');
    } finally {
        clearTimeout(timeoutId);
        setTimeout(() => {
            if (resultDiv) resultDiv.style.display = 'none';
        }, 2000);
    }
}

/**
 * 템플릿 삭제
 */
async function deleteTemplate() {
    const templateId = document.getElementById('currentTemplateId').value;
    
    const resultDiv = document.getElementById('templateSaveResult');
    if (!templateId) {
        showInlineResult(resultDiv, '삭제할 템플릿이 없습니다.', 'warning');
        return;
    }

    if (!(await window.confirmAction('정말로 이 템플릿을 삭제하시겠습니까?'))) {
        return;
    }

    showInlineResult(resultDiv, '삭제 중...', 'info');

    let timeoutId;
    try {
        const controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), 15000);
        const response = await fetch(`/admin/delete_template/${templateId}`, {
            method: 'DELETE',
            signal: controller.signal
        });

        let data = null;
        try {
            data = await response.json();
        } catch (e) {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
        }
        if (!response.ok) {
            throw new Error((data && data.message) ? data.message : `HTTP error! status: ${response.status}`);
        }

        if (data && data.success) {
            showInlineResult(resultDiv, data.message, 'success');
            // UI 초기화 및 목록 새로고침
            requestAnimationFrame(() => {
                currentTemplateId = null;
                document.getElementById('currentTemplateId').value = '';
                document.getElementById('templateName').value = '';
                setTemplateTypeValue('');
                document.getElementById('templateSubject').value = '';
                document.getElementById('templateBody').value = '';

                const previewSubject = document.getElementById('previewSubject');
                const previewBody = document.getElementById('previewBody');
                if (previewSubject) previewSubject.textContent = '제목을 입력하세요';
                if (previewBody) previewBody.textContent = '본문을 입력하세요';

                document.getElementById('templateEditContainer').style.display = 'none';
                document.getElementById('templateEmptyState').style.display = 'block';
                loadTemplateList();
            });
        } else {
            showInlineResult(resultDiv, (data && data.message) ? data.message : '삭제에 실패했습니다.', 'danger');
        }
    } catch (error) {
        const msg = error.name === 'AbortError' ? '요청 시간이 초과되었습니다.' : error.message;
        showInlineResult(resultDiv, '오류: ' + msg, 'danger');
    } finally {
        clearTimeout(timeoutId);
        setTimeout(() => {
            if (resultDiv) resultDiv.style.display = 'none';
        }, 2000);
    }
}

/**
 * 미리보기 업데이트 (최적화: batch DOM updates)
 */
function updatePreview() {
    const subjectInput = document.getElementById('templateSubject');
    const bodyInput = document.getElementById('templateBody');
    const previewSubject = document.getElementById('previewSubject');
    const previewBody = document.getElementById('previewBody');
    
    if (!subjectInput || !bodyInput || !previewSubject || !previewBody) return;
    
    const subject = subjectInput.value || '제목을 입력하세요';
    const body = bodyInput.value || '본문을 입력하세요';
    
    // Batch DOM updates
    requestAnimationFrame(() => {
        previewSubject.textContent = subject;
        previewBody.textContent = body;
    });
}

/**
 * 템플릿 유형별 아이콘
 */
function getTemplateTypeIcon(type) {
    const icons = {
        'welcome_new_user': 'bi-person-plus',
        'project_join': 'bi-door-open',
        'project_complete': 'bi-check-square',
        'notification': 'bi-bell',
        'reminder': 'bi-alarm'
    };
    return icons[type] || 'bi-file-earmark-text';
}

/**
 * 날짜 포맷팅
 */
function formatDate(dateString) {
    if (!dateString) return '';
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString('ko-KR', { 
            year: 'numeric', 
            month: '2-digit', 
            day: '2-digit' 
        });
    } catch (e) {
        return dateString;
    }
}

/**
 * HTML 이스케이프 (XSS 방지)
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
