/**
 * User Manager - User CRUD Operations
 */

document.addEventListener('DOMContentLoaded', function() {
    const editUserForm = document.getElementById('editUserForm');
    if (editUserForm) {
        editUserForm.addEventListener('submit', handleEditUserFormSubmit);
    }
    initializeEditUserButtons();
    const resetPasswordBtn = document.getElementById('btnResetUserPassword');
    if (resetPasswordBtn) {
        resetPasswordBtn.addEventListener('click', handleResetPasswordClick);
    }
    initializeEditUserPasswordFeedback();
    initializeUserListSearch();
    initializeBulkUserDelete();
    initializeUserListSort();
});

window.loadUserData = function(username, realName, email, allowedIpList) {
    document.getElementById('editUsername').value = username;
    document.getElementById('editRealName').value = realName;
    document.getElementById('editEmail').value = email || '';
    document.getElementById('editAllowedIpList').value = allowedIpList || '';
    document.getElementById('editPassword').value = '';

    const confirmInput = document.getElementById('editPasswordConfirm');
    if (confirmInput) {
        confirmInput.value = '';
    }

    if (window.editUserPasswordFeedback && typeof window.editUserPasswordFeedback.refresh === 'function') {
        window.editUserPasswordFeedback.refresh();
    }
};

function initializeEditUserButtons() {
    document.querySelectorAll('[data-edit-user="true"]').forEach((button) => {
        if (button.dataset.boundEditUser === '1') {
            return;
        }

        button.dataset.boundEditUser = '1';
        button.addEventListener('click', () => {
            window.loadUserData(
                button.dataset.username || '',
                button.dataset.realName || '',
                button.dataset.email || '',
                button.dataset.allowedIpList || ''
            );
        });
    });
}

window.deleteUser = async function(username) {
    if (await window.confirmAction(`정말 사용자 '${username}'를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) {
        fetch(`/admin/user/${encodeURIComponent(username)}/delete`, {
            method: 'DELETE',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'application/json',
                'X-CSRF-Token': window.adminCsrfToken || ''
            }
        })
        .then(async (response) => {
            let data = null;
            try {
                data = await response.json();
            } catch (_) {
                data = null;
            }
            if (response.ok && data && data.success) {
                window.showToast(data.message || '사용자가 삭제되었습니다.');
                if (data.redirect_url) {
                    location.href = data.redirect_url;
                    return;
                }
                removeUserRows([username]);
                return;
            }
            window.showToast((data && data.message) ? data.message : '사용자 삭제에 실패했습니다.');
        })
        .catch(error => console.error('오류:', error));
    }
};

async function handleResetPasswordClick() {
    const username = (document.getElementById('editUsername')?.value || '').trim();
    if (!username) {
        window.showToast('초기화할 사용자 ID를 찾을 수 없습니다.');
        return;
    }

    const confirmed = await window.confirmAction(
        `사용자 '${username}' 비밀번호를 123456으로 초기화하시겠습니까?\n초기화 후 해당 사용자는 로그인 시 비밀번호를 반드시 변경해야 합니다.`
    );
    if (!confirmed) return;

    try {
        const response = await fetch(`/admin/user/${encodeURIComponent(username)}/reset-password`, {
            method: 'POST',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'application/json',
                'X-CSRF-Token': window.adminCsrfToken || ''
            }
        });
        const result = await response.json();
        if (response.ok && result?.success) {
            window.showToast(result.message || '비밀번호가 초기화되었습니다.');
            return;
        }
        window.showToast(result?.message || '비밀번호 초기화에 실패했습니다.');
    } catch (error) {
        console.error('오류:', error);
        window.showToast('요청 처리 중 오류가 발생했습니다.');
    }
}

function initializeEditUserPasswordFeedback() {
    const form = document.getElementById('editUserForm');
    const newInput = document.getElementById('editPassword');
    const confirmInput = document.getElementById('editPasswordConfirm');
    if (!form || !newInput || !confirmInput) return;

    if (window.passwordFeedbackUtils && window.passwordFeedbackUtils.attachPasswordFeedback) {
        window.editUserPasswordFeedback = window.passwordFeedbackUtils.attachPasswordFeedback(
            form,
            newInput,
            confirmInput,
            'editUserPassword'
        );
    }
}

async function handleEditUserFormSubmit(e) {
    e.preventDefault();

    const username = document.getElementById('editUsername').value;
    const realName = document.getElementById('editRealName').value;
    const email = document.getElementById('editEmail').value;
    const allowedIpList = document.getElementById('editAllowedIpList').value;
    const newPassword = document.getElementById('editPassword').value;
    const confirmPassword = document.getElementById('editPasswordConfirm')
        ? document.getElementById('editPasswordConfirm').value
        : '';

    if (email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            window.showToast('올바른 이메일 형식을 입력해주세요.');
            return;
        }
    }

    if (newPassword || confirmPassword) {
        if (newPassword !== confirmPassword) {
            window.showToast('비밀번호 확인 값이 일치하지 않습니다.');
            const confirmInput = document.getElementById('editPasswordConfirm');
            if (confirmInput) confirmInput.focus();
            return;
        }

        if (window.passwordFeedbackUtils && window.passwordFeedbackUtils.evaluatePasswordStrength) {
            const strength = window.passwordFeedbackUtils.evaluatePasswordStrength(newPassword);
            if (strength.level === 1) {
                window.showToast('비밀번호 강도가 약합니다. 대문자/소문자/숫자/특수문자를 포함해 주세요.');
                return;
            }
        }
    }

    try {
        const formData = new URLSearchParams();
        formData.append('username', username);
        formData.append('real_name', realName);
        formData.append('email', email);
        formData.append('allowed_ip_list', allowedIpList);
        if (newPassword) {
            formData.append('new_password', newPassword);
        }

        const response = await fetch('/admin/user/update', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: formData
        });

        const result = await response.json();

        if (result.success) {
            window.showToast('사용자 정보가 수정되었습니다.');
            const modal = bootstrap.Modal.getInstance(document.getElementById('editUserModal'));
            if (modal) {
                modal.hide();
            }
            location.reload();
        } else {
            window.showToast('수정 실패: ' + (result.message || '알 수 없는 오류'));
        }
    } catch (error) {
        console.error('오류:', error);
        window.showToast('요청 처리 중 오류가 발생했습니다.');
    }
}

function initializeUserListSearch() {
    const searchInput = document.getElementById('userSearchInput');
    const resetBtn = document.getElementById('userSearchResetBtn');
    const tbody = document.getElementById('userListTableBody');
    const countEl = document.getElementById('userListSearchCount');
    if (!searchInput || !tbody || !countEl) return;

    const applyFilter = () => {
        const term = (searchInput.value || '').trim().toLowerCase();
        const rows = Array.from(tbody.querySelectorAll('tr.user-row'));
        const totalCount = rows.length;
        let visibleCount = 0;

        rows.forEach((row) => {
            const text = (row.textContent || '').toLowerCase();
            const matched = !term || text.includes(term);
            row.style.display = matched ? '' : 'none';
            if (!matched) {
                const checkbox = row.querySelector('.user-select-checkbox');
                if (checkbox) checkbox.checked = false;
            }
            if (matched) visibleCount += 1;
        });

        countEl.textContent = term
            ? `검색 결과 ${visibleCount}명 / 전체 ${totalCount}명`
            : `검색 결과 ${totalCount}명`;

        updateBulkDeleteState();
    };

    searchInput.addEventListener('input', applyFilter);
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            searchInput.value = '';
            applyFilter();
            searchInput.focus();
        });
    }

    applyFilter();
    window.__applyUserListFilter = applyFilter;
}

function getUserCheckboxes() {
    return Array.from(document.querySelectorAll('.user-select-checkbox'));
}

function getVisibleUserCheckboxes() {
    return getUserCheckboxes().filter((checkbox) => {
        const row = checkbox.closest('tr.user-row');
        return row && row.style.display !== 'none';
    });
}

function getCheckedUsernames() {
    return getVisibleUserCheckboxes()
        .filter((checkbox) => checkbox.checked)
        .map((checkbox) => checkbox.value)
        .filter(Boolean);
}

function updateBulkDeleteState() {
    const selectAll = document.getElementById('selectAllUsers');
    const bulkDeleteBtn = document.getElementById('btnBulkDeleteUsers');
    const checkboxes = getUserCheckboxes();
    const visibleCheckboxes = getVisibleUserCheckboxes();

    if (!selectAll || !bulkDeleteBtn) {
        return;
    }

    if (checkboxes.length === 0) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
        bulkDeleteBtn.disabled = true;
        bulkDeleteBtn.innerHTML = '<i class="bi bi-trash"></i> 선택 삭제';
        return;
    }

    const checkedCount = checkboxes.filter((checkbox) => checkbox.checked).length;
    const checkedVisibleCount = visibleCheckboxes.filter((checkbox) => checkbox.checked).length;
    const allChecked = visibleCheckboxes.length > 0 && checkedVisibleCount === visibleCheckboxes.length;

    selectAll.checked = allChecked;
    selectAll.indeterminate = checkedVisibleCount > 0 && checkedVisibleCount < visibleCheckboxes.length;
    bulkDeleteBtn.disabled = checkedCount === 0;
    bulkDeleteBtn.innerHTML = `<i class="bi bi-trash"></i> 선택 삭제${checkedCount > 0 ? ` (${checkedCount})` : ''}`;
}

function initializeBulkUserDelete() {
    const selectAll = document.getElementById('selectAllUsers');
    const bulkDeleteBtn = document.getElementById('btnBulkDeleteUsers');

    if (!selectAll || !bulkDeleteBtn) {
        return;
    }

    selectAll.addEventListener('change', () => {
        const checkboxes = getVisibleUserCheckboxes();
        checkboxes.forEach((checkbox) => {
            checkbox.checked = selectAll.checked;
        });
        updateBulkDeleteState();
    });

    bindUserCheckboxEvents();

    bulkDeleteBtn.addEventListener('click', handleBulkDeleteUsers);
    updateBulkDeleteState();
}

function bindUserCheckboxEvents() {
    getUserCheckboxes().forEach((checkbox) => {
        if (checkbox.dataset.boundBulkDelete === '1') return;
        checkbox.dataset.boundBulkDelete = '1';
        checkbox.addEventListener('change', updateBulkDeleteState);
    });
}

function removeUserRows(usernames) {
    const targets = new Set((usernames || []).map((name) => String(name || '').trim()).filter(Boolean));
    if (targets.size === 0) return;

    const rows = Array.from(document.querySelectorAll('#userListTableBody tr.user-row'));
    rows.forEach((row) => {
        const username = row.getAttribute('data-username') || '';
        if (targets.has(username)) {
            row.remove();
        }
    });

    const totalCountEl = document.getElementById('userTotalCount');
    const totalCount = document.querySelectorAll('#userListTableBody tr.user-row').length;
    if (totalCountEl) {
        totalCountEl.textContent = String(totalCount);
    }

    bindUserCheckboxEvents();
    updateBulkDeleteState();
    if (typeof window.__applyUserListFilter === 'function') {
        window.__applyUserListFilter();
    }
}

async function handleBulkDeleteUsers() {
    const usernames = getCheckedUsernames();
    if (usernames.length === 0) {
        window.showToast('삭제할 사용자를 선택해주세요.', 'warning');
        return;
    }

    const confirmed = await window.confirmAction(
        `선택한 ${usernames.length}명의 사용자를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`,
        { variant: 'danger' }
    );
    if (!confirmed) {
        return;
    }

    try {
        const response = await fetch('/admin/users/bulk-delete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'application/json',
                'X-CSRF-Token': window.adminCsrfToken || ''
            },
            body: JSON.stringify({ usernames })
        });
        const result = await response.json();

        if (response.ok && result && result.success) {
            window.showToast(result.message || `${usernames.length}명의 사용자가 삭제되었습니다.`, 'success');
            if (result.redirect_url) {
                location.href = result.redirect_url;
                return;
            }
            removeUserRows(usernames);
            return;
        }

        window.showToast((result && result.message) ? result.message : '사용자 삭제에 실패했습니다.', 'danger');
    } catch (error) {
        console.error('Error:', error);
        window.showToast('요청 처리 중 오류가 발생했습니다.', 'danger');
    }
}

// ============================================
// 사용자 목록 정렬 기능
// ============================================
window.userListSortState = {
    currentColumn: null,
    sortOrder: 'none' // 'none' (기본) -> 'asc' (오름차순) -> 'desc' (내림차순) -> 'none'
};

function initializeUserListSort() {
    const sortButtons = document.querySelectorAll('.sort-btn');
    sortButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const column = btn.getAttribute('data-column');
            sortUserListByColumn(column);
        });
    });
}

function sortUserListByColumn(columnName) {
    const state = window.userListSortState;
    
    // 3단계 정렬 상태 전환
    if (state.currentColumn === columnName) {
        // 같은 컬럼: 'none' -> 'asc' -> 'desc' -> 'none'
        if (state.sortOrder === 'none') {
            state.sortOrder = 'asc';
        } else if (state.sortOrder === 'asc') {
            state.sortOrder = 'desc';
        } else {
            state.sortOrder = 'none';
        }
    } else {
        // 다른 컬럼: 오름차순으로 시작
        state.currentColumn = columnName;
        state.sortOrder = 'asc';
    }
    
    // 기본 상태일 때는 정렬하지 않고 원본 순서로 복원
    if (state.sortOrder === 'none') {
        // 원본 순서로 복원하거나 페이지 새로고침
        location.reload();
    } else {
        // 사용자 행 정렬
        sortTableRows(columnName, state.sortOrder === 'asc');
    }
    
    // 정렬 아이콘 업데이트
    updateSortIcons(columnName, state.sortOrder);
}

function sortTableRows(columnName, isAscending) {
    const tbody = document.getElementById('userListTableBody');
    if (!tbody) return;
    
    // 모든 행을 배열로 변환
    const rows = Array.from(tbody.querySelectorAll('tr.user-row'));
    
    // 정렬 로직
    rows.sort((rowA, rowB) => {
        let valueA, valueB;
        
        switch (columnName) {
            case 'real_name':
                // 테이블 두 번째 컬럼 (strong 태그 안의 이름)
                valueA = (rowA.cells[1]?.textContent || '').trim();
                valueB = (rowB.cells[1]?.textContent || '').trim();
                break;
            case 'username':
                // 테이블 세 번째 컬럼 (사용자 ID)
                valueA = (rowA.cells[2]?.textContent || '').trim();
                valueB = (rowB.cells[2]?.textContent || '').trim();
                break;
            case 'email':
                // 테이블 네 번째 컬럼 (이메일)
                valueA = (rowA.cells[3]?.textContent || '').trim();
                valueB = (rowB.cells[3]?.textContent || '').trim();
                break;
            case 'role':
                // 테이블 다섯 번째 컬럼 (권한 배지)
                valueA = (rowA.cells[4]?.textContent || '').trim();
                valueB = (rowB.cells[4]?.textContent || '').trim();
                break;
            case 'is_active':
                // 테이블 여섯 번째 컬럼 (활성화 여부)
                // 체크 아이콘이 있으면 활성화(1), 없으면 비활성화(0)
                const iconA = rowA.cells[5]?.querySelector('.text-success') ? 1 : 0;
                const iconB = rowB.cells[5]?.querySelector('.text-success') ? 1 : 0;
                valueA = iconA;
                valueB = iconB;
                break;
            case 'created_at':
                // 데이터 속성에서 가져오기 (테이블 일곱 번째 컬럼 또는 data-created-at)
                valueA = (rowA.getAttribute('data-created-at') || rowA.cells[6]?.textContent || '').trim();
                valueB = (rowB.getAttribute('data-created-at') || rowB.cells[6]?.textContent || '').trim();
                // 날짜 정렬을 위해 ISO 형식 처리
                if (valueA && valueA.length >= 10) valueA = valueA.substring(0, 10);
                if (valueB && valueB.length >= 10) valueB = valueB.substring(0, 10);
                break;
            default:
                return 0;
        }
        
        // 숫자 비교
        if (typeof valueA === 'number' && typeof valueB === 'number') {
            return isAscending ? valueA - valueB : valueB - valueA;
        }
        
        // 문자열 비교 (대소문자 무시, 한글 포함)
        valueA = String(valueA).toLowerCase();
        valueB = String(valueB).toLowerCase();
        
        if (isAscending) {
            return valueA.localeCompare(valueB, 'ko-KR');
        } else {
            return valueB.localeCompare(valueA, 'ko-KR');
        }
    });
    
    // 정렬된 행을 테이블에 다시 추가
    rows.forEach(row => tbody.appendChild(row));
}

function updateSortIcons(activeColumn, sortOrder) {
    // sortOrder: 'none' | 'asc' | 'desc'
    document.querySelectorAll('.sort-btn').forEach(btn => {
        const column = btn.getAttribute('data-column');
        const icon = btn.querySelector('i');
        
        // 모든 클래스 제거
        btn.classList.remove('sort-none', 'sort-asc', 'sort-desc', 'text-secondary', 'fw-bold');
        
        if (column === activeColumn && sortOrder !== 'none') {
            // 활성화된 컬럼
            if (sortOrder === 'asc') {
                icon.className = 'bi bi-sort-up';
                btn.classList.add('sort-asc');
            } else if (sortOrder === 'desc') {
                icon.className = 'bi bi-sort-down';
                btn.classList.add('sort-desc');
            }
        } else {
            // 비활성 또는 기본 상태
            icon.className = 'bi bi-arrow-down-up';
            btn.classList.add('sort-none');
        }
    });
}
