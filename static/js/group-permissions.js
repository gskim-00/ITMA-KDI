(function() {
    const CATEGORY_LABELS = {
        pc: 'PC',
        printer: '프린터',
        software: '소프트웨어',
        license: '라이선스',
        hardware: '하드웨어',
        network: '네트워크',
        security: '보안',
        server: '서버',
        solution: '솔루션',
        cloud: '클라우드',
        other: '그외'
    };

    let state = {
        groups: [],
        users: [],
        categoryKeys: ['pc', 'printer', 'software', 'license', 'hardware', 'network', 'security', 'server', 'solution', 'cloud', 'other'],
        selectedGroupId: null,
    };

    document.addEventListener('DOMContentLoaded', () => {
        const form = document.getElementById('permissionGroupForm');
        if (!form) return;
        document.getElementById('btnPermissionGroupCreate')?.addEventListener('click', () => resetPermissionGroupForm());
        document.getElementById('btnPermissionGroupReset')?.addEventListener('click', () => resetPermissionGroupForm());
        document.getElementById('btnPermissionGroupDelete')?.addEventListener('click', () => deleteCurrentGroup());
        document.getElementById('permissionTargetRole')?.addEventListener('change', () => {
            renderAssignedUsers();
            syncEditCheckboxState();
        });
        document.getElementById('permissionToggleAllView')?.addEventListener('change', handleToggleAllView);
        document.getElementById('permissionToggleAllEdit')?.addEventListener('change', handleToggleAllEdit);
        form.addEventListener('submit', submitPermissionGroupForm);
        loadPermissionGroups();
    });

    async function loadPermissionGroups() {
        const listEl = document.getElementById('permissionGroupList');
        if (listEl) {
            listEl.innerHTML = '<div class="text-muted small">권한 그룹을 불러오는 중입니다...</div>';
        }
        try {
            const response = await fetch('/admin/permission-groups', {
                headers: { Accept: 'application/json' }
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.message || '권한 그룹 조회 실패');
            }
            state.groups = Array.isArray(data.groups) ? data.groups : [];
            state.users = Array.isArray(data.users) ? data.users : [];
            state.categoryKeys = Array.isArray(data.category_keys) && data.category_keys.length
                ? data.category_keys
                : state.categoryKeys;
            renderPermissionGroupList();
            if (state.selectedGroupId) {
                const selected = state.groups.find((group) => Number(group.id) === Number(state.selectedGroupId));
                if (selected) {
                    populatePermissionGroupForm(selected);
                    return;
                }
            }
            resetPermissionGroupForm();
        } catch (error) {
            if (listEl) {
                listEl.innerHTML = `<div class="text-danger small">${escapeHtml(error.message)}</div>`;
            }
        }
    }

    function renderPermissionGroupList() {
        const listEl = document.getElementById('permissionGroupList');
        if (!listEl) return;
        if (!state.groups.length) {
            listEl.innerHTML = '<div class="text-muted small">등록된 권한 그룹이 없습니다.</div>';
            return;
        }
        listEl.innerHTML = state.groups.map((group) => {
            const activeClass = Number(group.id) === Number(state.selectedGroupId) ? 'active' : '';
            const assignedCount = Array.isArray(group.assigned_users) ? group.assigned_users.length : 0;
            return `
                <button type="button" class="list-group-item list-group-item-action ${activeClass}" data-group-id="${group.id}">
                    <div class="d-flex justify-content-between align-items-start gap-2">
                        <div>
                            <div class="fw-semibold">${escapeHtml(group.group_name)}</div>
                            <div class="text-muted">${escapeHtml(group.target_role)} / 사용자 ${assignedCount}명</div>
                        </div>
                        <span class="badge ${group.is_active ? 'bg-success' : 'bg-secondary'}">${group.is_active ? '활성' : '비활성'}</span>
                    </div>
                </button>
            `;
        }).join('');
        listEl.querySelectorAll('[data-group-id]').forEach((button) => {
            button.addEventListener('click', () => {
                const group = state.groups.find((item) => Number(item.id) === Number(button.dataset.groupId));
                if (group) {
                    populatePermissionGroupForm(group);
                    renderPermissionGroupList();
                }
            });
        });
    }

    function resetPermissionGroupForm() {
        state.selectedGroupId = null;
        setValue('permissionGroupId', '');
        setValue('permissionGroupName', '');
        setValue('permissionGroupDescription', '');
        setValue('permissionTargetRole', 'manager');
        const activeEl = document.getElementById('permissionGroupActive');
        if (activeEl) activeEl.checked = true;
        const titleEl = document.getElementById('permissionGroupFormTitle');
        if (titleEl) titleEl.textContent = '권한 그룹 상세';
        document.getElementById('btnPermissionGroupDelete')?.classList.add('d-none');
        renderPermissionCategoryTable();
        renderAssignedUsers();
        renderPermissionGroupList();
    }

    function populatePermissionGroupForm(group) {
        state.selectedGroupId = Number(group.id);
        setValue('permissionGroupId', String(group.id));
        setValue('permissionGroupName', group.group_name || '');
        setValue('permissionGroupDescription', group.description || '');
        setValue('permissionTargetRole', group.target_role || 'manager');
        const activeEl = document.getElementById('permissionGroupActive');
        if (activeEl) activeEl.checked = group.is_active !== false;
        const titleEl = document.getElementById('permissionGroupFormTitle');
        if (titleEl) titleEl.textContent = `권한 그룹 상세 - ${group.group_name}`;
        document.getElementById('btnPermissionGroupDelete')?.classList.remove('d-none');
        renderPermissionCategoryTable(group.permissions || {});
        renderAssignedUsers(group.assigned_users || []);
    }

    function renderPermissionCategoryTable(permissions = {}) {
        const tbody = document.getElementById('permissionCategoryTableBody');
        if (!tbody) return;
        tbody.innerHTML = state.categoryKeys.map((key) => {
            const config = permissions[key] || {};
            return `
                <tr>
                    <td>${escapeHtml(CATEGORY_LABELS[key] || key)}</td>
                    <td class="text-center permission-view-cell"><input type="checkbox" class="form-check-input permission-view" data-category-key="${key}" ${config.can_view ? 'checked' : ''}></td>
                    <td class="text-center permission-edit-cell"><input type="checkbox" class="form-check-input permission-edit" data-category-key="${key}" ${config.can_edit ? 'checked' : ''}></td>
                </tr>
            `;
        }).join('');
        tbody.querySelectorAll('.permission-view').forEach((checkbox) => {
            checkbox.addEventListener('change', () => {
                if (!checkbox.checked) {
                    const editEl = tbody.querySelector(`.permission-edit[data-category-key="${checkbox.dataset.categoryKey}"]`);
                    if (editEl) editEl.checked = false;
                }
                syncPermissionHeaderState();
            });
        });
        tbody.querySelectorAll('.permission-edit').forEach((checkbox) => {
            checkbox.addEventListener('change', () => {
                const viewEl = tbody.querySelector(`.permission-view[data-category-key="${checkbox.dataset.categoryKey}"]`);
                if (checkbox.checked && viewEl) {
                    viewEl.checked = true;
                }
                syncPermissionHeaderState();
            });
        });
        syncEditCheckboxState();
        syncPermissionHeaderState();
    }

    function handleToggleAllView(event) {
        const checked = event.target.checked;
        document.querySelectorAll('.permission-view').forEach((checkbox) => {
            checkbox.checked = checked;
            if (!checked) {
                const editEl = document.querySelector(`.permission-edit[data-category-key="${checkbox.dataset.categoryKey}"]`);
                if (editEl) editEl.checked = false;
            }
        });
        syncEditCheckboxState();
        syncPermissionHeaderState();
    }

    function handleToggleAllEdit(event) {
        const checked = event.target.checked;
        const role = getValue('permissionTargetRole') || 'manager';
        if (role !== 'manager') {
            event.target.checked = false;
            syncPermissionHeaderState();
            return;
        }
        document.querySelectorAll('.permission-edit').forEach((checkbox) => {
            if (checkbox.disabled) return;
            checkbox.checked = checked;
            const viewEl = document.querySelector(`.permission-view[data-category-key="${checkbox.dataset.categoryKey}"]`);
            if (checked && viewEl) {
                viewEl.checked = true;
            }
        });
        syncEditCheckboxState();
        syncPermissionHeaderState();
    }

    function syncPermissionHeaderState() {
        const viewToggles = Array.from(document.querySelectorAll('.permission-view'));
        const editToggles = Array.from(document.querySelectorAll('.permission-edit'));
        const viewAllEl = document.getElementById('permissionToggleAllView');
        const editAllEl = document.getElementById('permissionToggleAllEdit');
        const enabledEditToggles = editToggles.filter((checkbox) => !checkbox.disabled);
        if (viewAllEl) {
            viewAllEl.checked = viewToggles.length > 0 && viewToggles.every((checkbox) => checkbox.checked);
        }
        if (editAllEl) {
            editAllEl.checked = enabledEditToggles.length > 0 && enabledEditToggles.every((checkbox) => checkbox.checked);
        }
    }

    function renderAssignedUsers(assignedUsers = []) {
        const listEl = document.getElementById('permissionAssignedUsers');
        const countEl = document.getElementById('permissionAssignedUserCount');
        const role = getValue('permissionTargetRole') || 'manager';
        if (!listEl) return;
        const assignedSet = new Set((assignedUsers || []).map((user) => user.username));
        const users = state.users.filter((user) => user.role === role);
        
        // 할당된 사용자 수 업데이트
        const assignedCount = users.filter((u) => assignedSet.has(u.username)).length;
        if (countEl) countEl.textContent = `${assignedCount}명`;
        
        if (!users.length) {
            listEl.innerHTML = '<div class="text-muted small">선택 가능한 사용자가 없습니다.</div>';
            return;
        }
        
        listEl.innerHTML = users.map((user) => {
            const isChecked = assignedSet.has(user.username);
            return `
                <label class="permission-user-check ${isChecked ? 'checked' : ''}">
                    <input type="checkbox" class="form-check-input permission-user-checkbox" value="${escapeHtml(user.username)}" ${isChecked ? 'checked' : ''}>
                    <div class="permission-user-meta">
                        <strong>${escapeHtml(user.real_name || user.username)}</strong>
                        <small>${escapeHtml(user.username)}</small>
                    </div>
                </label>
            `;
        }).join('');
        
        // 체크박스 변경 이벤트 바인딩
        listEl.querySelectorAll('.permission-user-checkbox').forEach((checkbox) => {
            checkbox.addEventListener('change', (e) => {
                const label = e.target.closest('.permission-user-check');
                if (label) {
                    label.classList.toggle('checked', checkbox.checked);
                }
                // 할당 사용자 수 업데이트
                const assignedCount = listEl.querySelectorAll('.permission-user-checkbox:checked').length;
                if (countEl) countEl.textContent = `${assignedCount}명`;
            });
        });
    }

    function syncEditCheckboxState() {
        const role = getValue('permissionTargetRole') || 'manager';
        const tableEl = document.getElementById('permissionCategoryTable');
        const noticeEl = document.getElementById('permissionEditLockNotice');
        const editHeadEl = document.getElementById('permissionEditColumnHead');
        const editAllEl = document.getElementById('permissionToggleAllEdit');
        const isUserRole = role !== 'manager';
        tableEl?.classList.toggle('permission-edit-locked', isUserRole);
        noticeEl?.classList.toggle('d-none', !isUserRole);
        editHeadEl?.classList.toggle('permission-edit-col-locked', isUserRole);
        if (editAllEl) {
            editAllEl.disabled = isUserRole;
            if (isUserRole) editAllEl.checked = false;
        }
        document.querySelectorAll('.permission-edit').forEach((checkbox) => {
            const viewEl = document.querySelector(`.permission-view[data-category-key="${checkbox.dataset.categoryKey}"]`);
            const disabled = isUserRole;
            checkbox.disabled = disabled;
            if (disabled && checkbox.checked) {
                checkbox.checked = false;
            }
            if (viewEl && !viewEl.checked) {
                checkbox.checked = false;
            }
        });
        syncPermissionHeaderState();
    }

    async function submitPermissionGroupForm(event) {
        event.preventDefault();
        const payload = {
            group_id: getValue('permissionGroupId') || null,
            group_name: getValue('permissionGroupName').trim(),
            target_role: getValue('permissionTargetRole').trim(),
            description: getValue('permissionGroupDescription').trim(),
            is_active: document.getElementById('permissionGroupActive')?.checked !== false,
            permissions: collectPermissions(),
            assigned_usernames: getCheckedUsernames(),
        };
        try {
            const response = await fetch('/admin/permission-groups', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-CSRF-Token': window.adminCsrfToken || ''
                },
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.message || '권한 그룹 저장 실패');
            }
            window.showToast?.(data.message || '권한 그룹이 저장되었습니다.', 'success');
            state.selectedGroupId = data.group_id || null;
            await loadPermissionGroups();
        } catch (error) {
            window.showToast?.(error.message || '권한 그룹 저장 실패');
        }
    }

    async function deleteCurrentGroup() {
        const groupId = getValue('permissionGroupId');
        if (!groupId) return;
        const confirmed = await window.confirmAction?.('현재 권한 그룹을 삭제하시겠습니까?');
        if (!confirmed) return;
        try {
            const response = await fetch(`/admin/permission-groups/${encodeURIComponent(groupId)}`, {
                method: 'DELETE',
                headers: {
                    'Accept': 'application/json',
                    'X-CSRF-Token': window.adminCsrfToken || ''
                }
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.message || '권한 그룹 삭제 실패');
            }
            window.showToast?.(data.message || '권한 그룹이 삭제되었습니다.', 'success');
            resetPermissionGroupForm();
            await loadPermissionGroups();
        } catch (error) {
            window.showToast?.(error.message || '권한 그룹 삭제 실패');
        }
    }

    function collectPermissions() {
        const payload = {};
        state.categoryKeys.forEach((key) => {
            const viewEl = document.querySelector(`.permission-view[data-category-key="${key}"]`);
            const editEl = document.querySelector(`.permission-edit[data-category-key="${key}"]`);
            payload[key] = {
                can_view: !!viewEl?.checked,
                can_edit: !!editEl?.checked,
            };
        });
        return payload;
    }

    function getCheckedUsernames() {
        return Array.from(document.querySelectorAll('.permission-user-checkbox:checked')).map((checkbox) => checkbox.value);
    }

    function getValue(id) {
        return document.getElementById(id)?.value || '';
    }

    function setValue(id, value) {
        const el = document.getElementById(id);
        if (el) el.value = value;
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
})();
