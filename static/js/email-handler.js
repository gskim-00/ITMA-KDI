/**
 * 이메일 핸들러 - SMTP 설정 및 이메일 발송
 */

document.addEventListener('DOMContentLoaded', function() {
    // Load email config (guarded)
    if (typeof loadEmailConfig === 'function') {
        loadEmailConfig();
    } else if (typeof loadCurrentEmailSettings === 'function') {
        loadCurrentEmailSettings();
    }

    // Save SMTP settings
    const emailSettingsForm = document.getElementById('emailSettingsForm');
    if (emailSettingsForm) {
        emailSettingsForm.addEventListener('submit', handleEmailSettingsSubmit);
    }

    // Test SMTP connection
    const testSmtpBtn = document.getElementById('testSmtpBtn');
    if (testSmtpBtn) {
        testSmtpBtn.addEventListener('click', handleSMTPTest);
    }

    // Send email
    const emailForm = document.getElementById('emailForm');
    if (emailForm) {
        emailForm.addEventListener('submit', handleEmailFormSubmit);
    }

    // Init template selector
    loadTemplateSelector();

    // Auto-fill on template change
    const templateSelector = document.getElementById('templateSelector');
    if (templateSelector) {
        templateSelector.addEventListener('change', handleTemplateSelection);
    }

    const recentEmailsPerPage = document.getElementById('recentEmailsPerPage');
    if (recentEmailsPerPage) {
        recentEmailsPerPage.addEventListener('change', () => loadRecentEmails(1));
    }
});

/**
 * 템플릿 선택 시 템플릿 목록 로드
 */
async function loadTemplateSelector() {
    const selector = document.getElementById('templateSelector');
    if (!selector) return;
    
    try {
        const response = await fetch('/admin/get_all_templates');
        const data = await response.json();
        
        selector.innerHTML = '<option value="">-- 직접 작성 --</option>';
        if (data.success && data.templates.length > 0) {
            // 기본 옵션 유지하고 템플릿 추가
            data.templates.forEach(template => {
                const option = document.createElement('option');
                option.value = template.id;
                option.textContent = template.template_type
                    ? `${template.template_name} [${template.template_type}]`
                    : template.template_name;
                selector.appendChild(option);
            });
        }
    } catch (error) {
            console.error('템플릿 목록 로드 오류:', error);
    }
}

/**
 * 템플릿 선택 시 제목/본문 자동 입력
 */
async function handleTemplateSelection(e) {
    const templateId = e.target.value;
    
    if (!templateId) {
        // "템플릿 선택"이 안된 경우 빈값 처리
            document.querySelector('input[name="subject"]').value = ''; 
            document.querySelector('textarea[name="body"]').value = ''; 
        return;
    }
    
    try {
        const response = await fetch(`/admin/get_template/${templateId}`);
        const data = await response.json();
        
        if (data.success) {
            const template = data.template;
            
                // 제목/본문에 템플릿 데이터 입력
            document.querySelector('input[name="subject"]').value = template.subject;
            document.querySelector('textarea[name="body"]').value = template.body;
            
                // 사용 가능한 변수 힌트 표시
            const bodyTextarea = document.querySelector('textarea[name="body"]');
            if (bodyTextarea && !document.getElementById('templateVariableHint')) {
                const hint = document.createElement('small');
                hint.id = 'templateVariableHint';
                hint.className = 'text-info d-block mt-1';
                hint.innerHTML = '<i class="bi bi-info-circle"></i> 템플릿 변수 {real_name}, {username}, {password}, {role}, {event_type}, {asset_name}, {asset_id}, {event_date}, {details} 사용 가능';
                bodyTextarea.parentNode.appendChild(hint);
            }
        } else {
                alert('템플릿을 불러오는데 실패했습니다.');
        }
    } catch (error) {
            console.error('템플릿 로드 오류:', error);
            alert('템플릿을 불러오는데 오류가 발생했습니다.');
    }
}

// ============================================
// 주소록 관련 함수
// ============================================

// ============================================
// SMTP 설정, 메일 발송 관련 함수
// ============================================

function renderEmailResult(targetId, type, message) {
    const el = document.getElementById(targetId);
    if (!el) return;
    el.style.display = 'block';
    const css = type === 'success' ? 'alert-success' : type === 'info' ? 'alert-info' : 'alert-danger';
    el.innerHTML = `<div class="alert ${css}">${message}</div>`;
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function parseApiResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        return response.json();
    }

    const bodyText = await response.text();
    if (response.status === 401 || response.redirected || bodyText.trim().startsWith('<')) {
        throw new Error('세션이 만료되었거나 인증이 필요합니다. 다시 로그인해주세요.');
    }
    throw new Error(`서버 응답 형식 오류 (status: ${response.status})`);
}

/**
 * 최근 이메일 발송 내역 로드
 */
let recentEmailsCurrentPage = 1;

function getRecentEmailsPerPage() {
    const perPageSelector = document.getElementById('recentEmailsPerPage');
    const value = parseInt(perPageSelector ? perPageSelector.value : '10', 10);
    return Number.isFinite(value) ? value : 10;
}

function renderRecentEmailsPager(pagination) {
    const pager = document.getElementById('recentEmailsPager');
    if (!pager) return;

    if (!pagination || pagination.total <= pagination.per_page) {
        pager.style.display = 'none';
        pager.innerHTML = '';
        return;
    }

    const page = Number(pagination.page || 1);
    const totalPages = Number(pagination.total_pages || 1);
    const total = Number(pagination.total || 0);
    const start = total === 0 ? 0 : ((page - 1) * pagination.per_page) + 1;
    const end = Math.min(page * pagination.per_page, total);

    pager.style.display = 'flex';
    pager.innerHTML = `
        <div class="small text-muted">${start}-${end} / 총 ${total}건</div>
        <div class="btn-group btn-group-sm" role="group" aria-label="최근 발송 내역 페이지 이동">
            <button type="button" class="btn btn-outline-secondary" ${pagination.has_prev ? '' : 'disabled'} onclick="loadRecentEmails(${page - 1})">
                <i class="bi bi-chevron-left"></i> 이전
            </button>
            <button type="button" class="btn btn-outline-secondary" disabled>${page} / ${totalPages}</button>
            <button type="button" class="btn btn-outline-secondary" ${pagination.has_next ? '' : 'disabled'} onclick="loadRecentEmails(${page + 1})">
                다음 <i class="bi bi-chevron-right"></i>
            </button>
        </div>
    `;
}

async function loadRecentEmails(page = recentEmailsCurrentPage) {
    const container = document.getElementById('recentEmailsContainer');
    if (!container) return;

    const perPage = getRecentEmailsPerPage();
    recentEmailsCurrentPage = Math.max(parseInt(page, 10) || 1, 1);
    container.innerHTML = '<div class="text-center py-4"><i class="bi bi-hourglass-split"></i> 로딩 중...</div>';

    try {
        const params = new URLSearchParams({
            page: String(recentEmailsCurrentPage),
            per_page: String(perPage)
        });
        const response = await fetch(`/admin/get_recent_emails?${params.toString()}`, {
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'application/json'
            }
        });
        const data = await parseApiResponse(response);

        if (!response.ok || !data.success) {
            const msg = escapeHtml(data?.message || '최근 이메일 내역을 불러오지 못했습니다.');
            container.innerHTML = `<div class="alert alert-danger mb-0">${msg}</div>`;
            renderRecentEmailsPager(null);
            return;
        }

        if (!Array.isArray(data.emails) || data.emails.length === 0) {
            container.innerHTML = `
                <div class="text-center text-muted py-4">
                    <i class="bi bi-inbox fs-1"></i>
                    <p class="mt-2 mb-0">최근 발송 내역이 없습니다.</p>
                </div>
            `;
            renderRecentEmailsPager(data.pagination);
            return;
        }

        const rows = data.emails.map(item => {
            const recipient = escapeHtml(item.recipient);
            const subject = escapeHtml(item.subject || '(제목 없음)');
            const admin = escapeHtml(item.admin || '-');
            const sentAt = escapeHtml(item.sent_at || '-');
            const isSuccess = String(item.status || '').toLowerCase() === 'success';
            const statusBadge = isSuccess
                ? '<span class="badge bg-success">성공</span>'
                : '<span class="badge bg-danger">실패</span>';

            return `
                <div class="list-group-item">
                    <div class="d-flex justify-content-between align-items-start gap-2">
                        <div class="flex-grow-1">
                            <div class="fw-semibold text-break">${subject}</div>
                            <div class="small text-muted text-break">수신: ${recipient}</div>
                            <div class="small text-muted">발송자: ${admin}</div>
                        </div>
                        ${statusBadge}
                    </div>
                    <div class="small text-muted mt-1">${sentAt}</div>
                </div>
            `;
        }).join('');

        container.innerHTML = `<div class="list-group">${rows}</div>`;
        renderRecentEmailsPager(data.pagination);
    } catch (error) {
        console.error('최근 이메일 내역 로드 오류:', error);
        container.innerHTML = '<div class="alert alert-danger mb-0">최근 이메일 내역 로드 중 오류가 발생했습니다.</div>';
        renderRecentEmailsPager(null);
    }
}

async function handleEmailSettingsSubmit(e) {
    e.preventDefault();
    const form = e.target;
    if (!form) return;
    
    const payload = {
        smtp_server: form.smtp_server.value.trim(),
        smtp_port: parseInt(form.smtp_port.value, 10),
        smtp_username: form.smtp_username.value.trim(),
        smtp_password: form.smtp_password.value,
        sender_email: form.sender_email.value.trim(),
        sender_name: form.sender_name.value.trim(),
        use_tls: document.getElementById('useTlsCheckbox').checked
    };
    
    if (!payload.smtp_server || !payload.smtp_port || !payload.smtp_username || !payload.sender_email || !payload.sender_name) {
        renderEmailResult('emailSettingsResult', 'error', '모든 필수 항목을 입력해주세요.');
        return;
    }
    
    renderEmailResult('emailSettingsResult', 'info', '저장 중...');
    
    try {
        const response = await fetch('/admin/update_email_settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        const data = await parseApiResponse(response);
        if (data.success) {
            renderEmailResult('emailSettingsResult', 'success', data.message || '이메일 설정이 저장되었습니다.');
            if (typeof loadCurrentEmailSettings === 'function') {
                loadCurrentEmailSettings();
            }
            form.smtp_password.value = '';
        } else {
            renderEmailResult('emailSettingsResult', 'error', data.message || '저장에 실패했습니다.');
        }
    } catch (error) {
        renderEmailResult('emailSettingsResult', 'error', `오류: ${error.message}`);
    }
}

async function handleSMTPTest() {
    const form = document.getElementById('emailSettingsForm');
    if (!form) return;
    
    const payload = {
        smtp_server: form.smtp_server.value.trim(),
        smtp_port: parseInt(form.smtp_port.value, 10),
        smtp_username: form.smtp_username.value.trim(),
        smtp_password: form.smtp_password.value,
        sender_email: form.sender_email.value.trim(),
        sender_name: form.sender_name.value.trim(),
        use_tls: document.getElementById('useTlsCheckbox').checked
    };
    
    if (!payload.smtp_server || !payload.smtp_port || !payload.smtp_username || !payload.sender_email) {
        renderEmailResult('emailSettingsResult', 'error', '서버/포트/계정/발신자 이메일을 입력해주세요.');
        return;
    }
    
    renderEmailResult('emailSettingsResult', 'info', '연결 테스트 중...');
    
    try {
        const response = await fetch('/admin/test_smtp', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        const data = await parseApiResponse(response);
        if (data.success) {
            renderEmailResult('emailSettingsResult', 'success', data.message || 'SMTP 연결이 성공했습니다.');
        } else {
            renderEmailResult('emailSettingsResult', 'error', data.message || 'SMTP 연결이 실패했습니다.');
        }
    } catch (error) {
        renderEmailResult('emailSettingsResult', 'error', `오류: ${error.message}`);
    }
}

async function handleEmailFormSubmit(e) {
    e.preventDefault();
    const form = e.target;
    if (!form) return;
    
    const payload = {
        recipient: form.recipient.value.trim(),
        subject: form.subject.value.trim(),
        body: form.body.value.trim()
    };
    
    if (!payload.recipient || !payload.subject || !payload.body) {
        renderEmailResult('emailResult', 'error', '모든 필수 항목을 입력해주세요.');
        return;
    }
    
    renderEmailResult('emailResult', 'info', '이메일 전송 중...');
    
    try {
        const response = await fetch('/admin/send_email', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        const data = await parseApiResponse(response);
        if (data.success) {
            renderEmailResult('emailResult', 'success', data.message || '이메일이 성공적으로 전송되었습니다.');
            loadRecentEmails(1);
        } else {
            let msg = data.message || '이메일 전송이 실패했습니다.';
            if (data.failed_details && data.failed_details.length > 0) {
                const details = data.failed_details.map(d => `${d.email}: ${d.error}`).join('<br>');
                msg += `<br>${details}`;
            }
            renderEmailResult('emailResult', 'error', msg);
        }
    } catch (error) {
        renderEmailResult('emailResult', 'error', `오류: ${error.message}`);
    }
}

let selectedEmails = new Set();  // 선택된 메일 수신자 목록

/**
 * 주소록 모달 열기
 */
let isAddressBookLoaded = false;

// 1. 버튼에서 호출되는 함수: 실제로 모달만 띄운다.
function openAddressBook() {
    const modalEl = document.getElementById('addressBookModal');
    if (!modalEl) return;

    // 모달이 여러번 열려도 중복되지 않는다. 상세 설정이나 이벤트 바인딩은 별도 처리
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
}

// 2. 모달 내부 로드 (DOMContentLoaded 이후에만 동작)
document.addEventListener('DOMContentLoaded', function() {
    const addressBookModalEl = document.getElementById('addressBookModal');
    if (!addressBookModalEl) return;

    addressBookModalEl.addEventListener('shown.bs.modal', function() {
        console.log("모달 완전히 열림 - 사용자 목록 데이터 로드 시작");

        // 1. 강제로 '사용자 목록' 탭 활성화 (Bootstrap Tab API 사용)
        const userTabBtn = document.getElementById('user-emails-tab');
        const userTabContent = document.getElementById('user-emails');
        if (userTabBtn) {
            // 버튼이 active여도 실제 탭이 활성화되지 않은 경우가 있어 강제로 처리
            if (userTabContent && !userTabContent.classList.contains('active')) {
                userTabBtn.classList.remove('active');
            }
            bootstrap.Tab.getOrCreateInstance(userTabBtn).show();
        }

        // 2. 사용자 실제 로드
        // '로드 중' 메시지가 있으면 최초 로드임을 확인하고 진행
        const container = document.getElementById('userEmailsContainer');
        
        // 컨테이너가 있고, 실제로 데이터가 로드되지 않은 상태(로드 메시지만 있는 상태)라면 실행
        if (container) {
            console.log("사용자 이메일 로드 함수(loadUserEmails) 호출");
            
            // 실제로 isAddressBookLoaded 체크 필요
            // 실제로 데이터가 list-group-item에 있는지 확인
            const isActuallyEmpty = container.querySelectorAll('.list-group-item').length === 0;

            if (isActuallyEmpty) {
                loadUserEmails()
                    .then(() => {
                        console.log("사용자 이메일 로드 완료");
                        isAddressBookLoaded = true;
                    })
                    .catch(err => {
                        console.error("사용자 이메일 로드 오류:", err);
                        container.innerHTML = '<div class="text-center py-4 text-danger">사용자 이메일을 불러오지 못했습니다</div>';
                    });
            }
        }
    });
});
/**
 * 실제 사용자 이메일 목록 로드
 */
async function loadUserEmails() {
    const container = document.getElementById('userEmailsContainer');
    container.innerHTML = '<div class="text-center py-4"><i class="bi bi-hourglass-split"></i> 로딩 중...</div>';
    
    try {
        const response = await fetch('/admin/get_user_emails');
        const data = await response.json();
        
        if (data.success && data.users.length > 0) {
            let html = '<div class="list-group">';
            
            data.users.forEach(user => {
                const roleClass = user.role === 'admin' ? 'danger' : user.role === 'manager' ? 'warning' : 'secondary';
                html += `
                    <label class="list-group-item d-flex align-items-center">
                        <input type="checkbox" class="form-check-input me-3" value="${user.email}" 
                               onchange="toggleEmailSelection(this)">
                        <div class="flex-grow-1">
                            <div class="d-flex justify-content-between align-items-start">
                                <div>
                                    <strong>${user.real_name || user.username}</strong>
                                    <span class="badge bg-${roleClass} ms-2">${user.role}</span>
                                </div>
                            </div>
                            <small class="text-muted">${user.email}</small>
                        </div>
                    </label>
                `;
            });
            
            html += '</div>';
            container.innerHTML = html;

            // Apply current search filter after render
            const userSearchInput = document.getElementById('userSearchInput');
            if (userSearchInput) {
                filterListItems(container, userSearchInput.value);
            }
        } else {
                container.innerHTML = '<div class="text-center text-muted py-4"><i class="bi bi-inbox"></i><p class="mt-2">등록된 사용자가 없습니다.</p></div>';
        }
    } catch (error) {
            console.error('사용자 이메일 목록 로드 오류:', error);
            container.innerHTML = '<div class="alert alert-danger">로드 오류</div>';
    }
}

/**
 * 저장된 주소록 로드
 */
async function loadSavedAddresses() {
    const container = document.getElementById('savedAddressesContainer');
    container.innerHTML = '<div class="text-center py-4"><i class="bi bi-hourglass-split"></i> 로딩 중...</div>';
    
    try {
        const response = await fetch('/admin/get_address_book');
        const data = await response.json();
        
        if (data.success && data.addresses.length > 0) {
            let html = '<div class="list-group">';
            
            data.addresses.forEach(addr => {
                html += `
                    <label class="list-group-item d-flex align-items-center">
                        <input type="checkbox" class="form-check-input me-3" value="${addr.email}" 
                               onchange="toggleEmailSelection(this)">
                        <div class="flex-grow-1">
                            <div class="d-flex justify-content-between align-items-start">
                                <div>
                                    <strong>${addr.name}</strong>
                                    ${addr.department ? `<span class="text-muted ms-2">${addr.department}</span>` : ''}
                                    ${addr.position ? `<span class="badge bg-info ms-1">${addr.position}</span>` : ''}
                                </div>
                                <button class="btn btn-sm btn-outline-danger" onclick="event.stopPropagation(); deleteAddressEntry(${addr.id}); return false;">
                                    <i class="bi bi-trash"></i>
                                </button>
                            </div>
                            <small class="text-muted">${addr.email}</small>
                            ${addr.notes ? `<div><small class="text-muted fst-italic">${addr.notes}</small></div>` : ''}
                        </div>
                    </label>
                `;
            });
            
            html += '</div>';
            container.innerHTML = html;

            // Apply current search filter after render
            const addressSearchInput = document.getElementById('addressSearchInput');
            if (addressSearchInput) {
                filterListItems(container, addressSearchInput.value);
            }
        } else {
                container.innerHTML = '<div class="text-center text-muted py-4"><i class="bi bi-inbox"></i><p class="mt-2">저장된 주소가 없습니다.</p></div>';
        }
    } catch (error) {
            console.error('주소록 로드 오류:', error);
            container.innerHTML = '<div class="alert alert-danger">로드 오류</div>';
    }
}

/**
 * 메일 선택/해제 토글
 */
function toggleEmailSelection(checkbox) {
    if (checkbox.checked) {
        selectedEmails.add(checkbox.value);
    } else {
        selectedEmails.delete(checkbox.value);
    }
}

/**
 * 선택된 주소를 받는 입력에 적용
 */
function applySelectedAddresses() {
    const recipientInput = document.getElementById('recipientInput');
    
    // 기존 값과 합쳐서 선택된 주소 모두 입력
    const existingEmails = recipientInput.value
        .split(',')
        .map(e => e.trim())
        .filter(e => e);
    
    const allEmails = new Set([...existingEmails, ...selectedEmails]);
    recipientInput.value = Array.from(allEmails).join(', ');
    
    // 모달 닫기
    const modal = bootstrap.Modal.getInstance(document.getElementById('addressBookModal'));
    modal.hide();
    
    selectedEmails.clear();
    const modalEl = document.getElementById('addressBookModal');
    if (modalEl) {
        modalEl.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
            cb.checked = false;
        });
    }
}

/**
 * 새 주소 추가 모달 열기
 */
function openAddAddressModal() {
    document.getElementById('addAddressForm').reset();
    document.getElementById('addAddressResult').style.display = 'none';
    
    const modal = new bootstrap.Modal(document.getElementById('addAddressModal'));
    modal.show();
}

/**
 * 새 주소 저장
 */
async function saveNewAddress() {
    const form = document.getElementById('addAddressForm');
    const formData = new FormData(form);
    
    const addressData = {
        name: formData.get('name'),
        email: formData.get('email'),
        department: formData.get('department') || '',
        position: formData.get('position') || '',
        notes: formData.get('notes') || ''
    };
    
    const resultDiv = document.getElementById('addAddressResult');
    resultDiv.innerHTML = '<div class="alert alert-info"><i class="bi bi-hourglass-split"></i> 저장 중...</div>';
    resultDiv.style.display = 'block';
    
    try {
        const response = await fetch('/admin/save_address', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(addressData)
        });
        
        const data = await response.json();
        
        if (data.success) {
            resultDiv.innerHTML = '<div class="alert alert-success"><i class="bi bi-check-circle"></i> 저장되었습니다.</div>';
            setTimeout(() => {
                const modal = bootstrap.Modal.getInstance(document.getElementById('addAddressModal'));
                modal.hide();
                loadSavedAddresses();  // 주소록 다시 불러오기
            }, 1000);
        } else {
            resultDiv.innerHTML = `<div class="alert alert-danger"><i class="bi bi-exclamation-circle"></i> ${data.message}</div>`;
        }
    } catch (error) {
        console.error('주소록 저장 오류:', error);
        resultDiv.innerHTML = `<div class="alert alert-danger"><i class="bi bi-exclamation-circle"></i> 오류: ${error.message}</div>`;
    }
}

/**
 * 주소록에서 항목 삭제
 */
async function deleteAddressEntry(addressId) {
    if (!confirm('정말로 이 주소록을 삭제하시겠습니까?')) {
           return; 
    }
    
    try {
        const response = await fetch(`/admin/delete_address/${addressId}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (data.success) {
              loadSavedAddresses();  // 목록 다시 갱신
        } else {
              alert('삭제에 실패했습니다: ' + data.message);
        }
    } catch (error) {
           console.error('주소 삭제 오류:', error);
           alert('삭제 중 오류가 발생했습니다.');
    }
}

// 검색 필터링 (이벤트 위임 방식)
function filterListItems(container, searchTerm) {
    if (!container) return;
    const items = container.querySelectorAll('.list-group-item');
    const term = (searchTerm || '').trim().toLowerCase();

    items.forEach(item => {
        if (!term) {
            item.classList.remove('d-none');
            return;
        }

        const text = item.textContent.toLowerCase();
        item.classList.toggle('d-none', !text.includes(term));
    });
}


document.addEventListener('DOMContentLoaded', function() {
    // 사용자 검색
    document.addEventListener('input', function(e) {
        if (e.target && e.target.id === 'userSearchInput') {
            const container = document.getElementById('userEmailsContainer');
            filterListItems(container, e.target.value);
        }
        
        // 주소록 검색
        if (e.target && e.target.id === 'addressSearchInput') {
            const container = document.getElementById('savedAddressesContainer');
            filterListItems(container, e.target.value);
        }
    });
    
    // 저장된 주소 탭 클릭 시 주소록 로드
    const savedAddressesTab = document.getElementById('saved-addresses-tab');
    if (savedAddressesTab) {
        savedAddressesTab.addEventListener('click', function() {
            const container = document.getElementById('savedAddressesContainer');
            if (container.querySelector('.text-center')) {
                loadSavedAddresses();
            }
        });
    }
});

