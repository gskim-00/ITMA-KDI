/**
 * Security Settings Handler
 */

function setCheckbox(form, name, value) {
    const el = form.querySelector(`[name="${name}"]`);
    if (el) el.checked = Boolean(value);
}

function setInputValue(form, name, value) {
    const el = form.querySelector(`[name="${name}"]`);
    if (el && value !== undefined && value !== null) el.value = value;
}

function showResult(resultDiv, message, isError = false) {
    if (!resultDiv) return;
    resultDiv.textContent = message;
    resultDiv.className = isError ? 'small text-danger mt-2' : 'small text-muted mt-2';
    resultDiv.style.display = 'block';
}

function hideResult(resultDiv) {
    if (!resultDiv) return;
    resultDiv.style.display = 'none';
    resultDiv.textContent = '';
}

function resolveSecuritySaveButton(triggerButton) {
    if (triggerButton && triggerButton.tagName === 'BUTTON') return triggerButton;
    if (document.activeElement && document.activeElement.tagName === 'BUTTON') return document.activeElement;
    return null;
}

function setSecuritySaveButtonState(button, state) {
    if (!button) return;
    if (!button.dataset.originalHtml) {
        button.dataset.originalHtml = button.innerHTML;
    }

    const restore = () => {
        button.disabled = false;
        button.classList.remove('is-saving', 'is-saved', 'is-save-error');
        button.innerHTML = button.dataset.originalHtml;
    };

    if (state === 'saving') {
        button.disabled = true;
        button.classList.remove('is-saved', 'is-save-error');
        button.classList.add('is-saving');
        button.innerHTML = '<i class="bi bi-hourglass-split"></i> 저장중...';
        return;
    }

    if (state === 'success') {
        button.disabled = false;
        button.classList.remove('is-saving', 'is-save-error');
        button.classList.add('is-saved');
        button.innerHTML = '<i class="bi bi-check-circle"></i> 저장 완료';
        window.setTimeout(restore, 1400);
        return;
    }

    if (state === 'error') {
        button.disabled = false;
        button.classList.remove('is-saving', 'is-saved');
        button.classList.add('is-save-error');
        button.innerHTML = '<i class="bi bi-exclamation-circle"></i> 저장 실패';
        window.setTimeout(restore, 1600);
        return;
    }

    restore();
}

async function loadFailedLoginAlertTemplates(selectedTemplateId) {
    const selectEl = document.getElementById('failedLoginAlertTemplate');
    if (!selectEl) return;

    const defaultOptionHtml = '<option value="">기본 경고 템플릿 사용</option>';
    selectEl.innerHTML = defaultOptionHtml;

    try {
        const response = await fetch('/admin/get_all_templates');
        const data = await response.json();
        if (!data.success || !Array.isArray(data.templates)) {
            return;
        }

        const templates = data.templates.filter((template) => {
            const typeText = String(template.template_type || '').trim().toLowerCase();
            return typeText === '' || typeText === 'failed_login_alert';
        });

        templates.forEach((template) => {
            const option = document.createElement('option');
            option.value = String(template.id);
            const typeLabel = template.template_type ? ` [${template.template_type}]` : '';
            option.textContent = `${template.template_name}${typeLabel}`;
            selectEl.appendChild(option);
        });

        if (selectedTemplateId) {
            selectEl.value = String(selectedTemplateId);
        }
    } catch (error) {
        console.error('Failed to load failed login alert templates:', error);
    }
}

function buildLoginAttemptPayload() {
    const limitForm = document.getElementById('loginAttemptLimitForm');
    const alertForm = document.getElementById('loginAttemptAlertForm');
    if (!limitForm || !alertForm) return null;

    return {
        setting_type: 'login_attempt_limit',
        max_attempts: limitForm.querySelector('[name="max_attempts"]').value,
        lockout_duration: limitForm.querySelector('[name="lockout_duration"]').value,
        time_window: limitForm.querySelector('[name="time_window"]').value,
        enable_failed_login_alert: alertForm.querySelector('[name="enable_failed_login_alert"]').checked,
        failed_login_alert_threshold: alertForm.querySelector('[name="failed_login_alert_threshold"]').value,
        failed_login_alert_include_admin: alertForm.querySelector('[name="failed_login_alert_include_admin"]').checked,
        failed_login_alert_include_attempt_user: alertForm.querySelector('[name="failed_login_alert_include_attempt_user"]').checked,
        failed_login_alert_custom_recipients: alertForm.querySelector('[name="failed_login_alert_custom_recipients"]').value,
        failed_login_alert_template_id: alertForm.querySelector('[name="failed_login_alert_template_id"]').value
    };
}

window.loadSecuritySettings = async function() {
    try {
        const response = await fetch('/admin/get_security_settings');
        const data = await response.json();
        if (!data.success || !data.settings) return;

        const s = data.settings;

        const passwordForm = document.getElementById('passwordPolicyForm');
        if (passwordForm) {
            setInputValue(passwordForm, 'min_length', s.password_min_length);
            setCheckbox(passwordForm, 'require_uppercase', s.password_require_uppercase);
            setCheckbox(passwordForm, 'require_lowercase', s.password_require_lowercase);
            setCheckbox(passwordForm, 'require_number', s.password_require_number);
            setCheckbox(passwordForm, 'require_special', s.password_require_special);
            setInputValue(passwordForm, 'expiry_days', s.password_expiry_days);
        }

        const sessionForm = document.getElementById('sessionTimeoutForm');
        if (sessionForm) {
            setInputValue(sessionForm, 'timeout_minutes', s.session_timeout_minutes);
            setInputValue(sessionForm, 'absolute_timeout_hours', s.session_absolute_timeout_hours);
            setCheckbox(sessionForm, 'warn_before_timeout', s.session_warn_before_timeout);
            setInputValue(sessionForm, 'concurrent_sessions', s.concurrent_sessions);
            setCheckbox(sessionForm, 'remember_me', s.remember_me);
            setCheckbox(sessionForm, 'auto_cleanup', s.auto_cleanup);
        }

        const loginAttemptLimitForm = document.getElementById('loginAttemptLimitForm');
        const loginAttemptAlertForm = document.getElementById('loginAttemptAlertForm');
        if (loginAttemptLimitForm && loginAttemptAlertForm) {
            setInputValue(loginAttemptLimitForm, 'max_attempts', s.login_max_attempts);
            setInputValue(loginAttemptLimitForm, 'lockout_duration', s.login_lockout_duration_minutes);
            setInputValue(loginAttemptLimitForm, 'time_window', s.login_time_window_minutes);
            setCheckbox(loginAttemptAlertForm, 'enable_failed_login_alert', s.enable_failed_login_alert);
            setInputValue(loginAttemptAlertForm, 'failed_login_alert_threshold', s.failed_login_alert_threshold || s.login_max_attempts || 5);
            setCheckbox(loginAttemptAlertForm, 'failed_login_alert_include_admin', s.failed_login_alert_include_admin);
            setCheckbox(loginAttemptAlertForm, 'failed_login_alert_include_attempt_user', s.failed_login_alert_include_attempt_user);
            setInputValue(loginAttemptAlertForm, 'failed_login_alert_custom_recipients', s.failed_login_alert_custom_recipients || '');
            await loadFailedLoginAlertTemplates(s.failed_login_alert_template_id || '');
        }

        const ipFilterForm = document.getElementById('ipFilterForm');
        if (ipFilterForm) {
            const type = s.ip_filter_type === 'whitelist' ? 'whitelist' : 'blacklist';
            const typeRadio = ipFilterForm.querySelector(`[name="ip_filter_type"][value="${type}"]`);
            if (typeRadio) typeRadio.checked = true;
            setInputValue(ipFilterForm, 'ip_list', s.ip_filter_list);
            setCheckbox(ipFilterForm, 'enable_ip_filter', s.ip_filter_enabled);
        }
    } catch (error) {
        console.error('Failed to load security settings:', error);
    }
};

window.saveSecuritySettings = async function(settingType, triggerButton) {
    let formData = {};
    let resultDiv = null;
    const saveButton = resolveSecuritySaveButton(triggerButton);

    if (settingType === 'password') {
        const form = document.getElementById('passwordPolicyForm');
        formData = {
            setting_type: 'password',
            min_length: form.querySelector('[name="min_length"]').value,
            require_uppercase: form.querySelector('[name="require_uppercase"]').checked,
            require_lowercase: form.querySelector('[name="require_lowercase"]').checked,
            require_number: form.querySelector('[name="require_number"]').checked,
            require_special: form.querySelector('[name="require_special"]').checked,
            expiry_days: form.querySelector('[name="expiry_days"]').value
        };
        resultDiv = document.getElementById('passwordPolicyResult');
    } else if (settingType === 'session') {
        const form = document.getElementById('sessionTimeoutForm');
        formData = {
            setting_type: 'session',
            timeout_minutes: form.querySelector('[name="timeout_minutes"]').value,
            absolute_timeout_hours: form.querySelector('[name="absolute_timeout_hours"]').value,
            warn_before_timeout: form.querySelector('[name="warn_before_timeout"]').checked,
            concurrent_sessions: form.querySelector('[name="concurrent_sessions"]').value,
            remember_me: form.querySelector('[name="remember_me"]').checked,
            auto_cleanup: form.querySelector('[name="auto_cleanup"]').checked
        };
        resultDiv = document.getElementById('sessionTimeoutResult');
    } else if (settingType === 'login_attempt_limit_tab' || settingType === 'login_attempt_alert_tab') {
        formData = buildLoginAttemptPayload();
        resultDiv = settingType === 'login_attempt_limit_tab'
            ? document.getElementById('loginAttemptLimitResult')
            : document.getElementById('loginAttemptAlertResult');
    } else if (settingType === 'ip_filter') {
        const form = document.getElementById('ipFilterForm');
        formData = {
            setting_type: 'ip_filter',
            filter_type: form.querySelector('[name="ip_filter_type"]:checked').value,
            ip_list: form.querySelector('[name="ip_list"]').value,
            enabled: form.querySelector('[name="enable_ip_filter"]').checked
        };
        resultDiv = document.getElementById('ipFilterResult');
    }

    if (!resultDiv) return;
    if (!formData) {
        showResult(resultDiv, '로그인 시도 설정 폼을 찾을 수 없습니다.', true);
        setSecuritySaveButtonState(saveButton, 'error');
        return;
    }

    showResult(resultDiv, '설정 저장 중...');
    setSecuritySaveButtonState(saveButton, 'saving');

    try {
        const response = await fetch('/admin/update_security_settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });

        const data = await response.json();

        if (data.success) {
            if (typeof window.showToast === 'function') {
                window.showToast(data.message || '설정이 저장되었습니다.', 'success');
            }
            showResult(resultDiv, data.message || '설정이 저장되었습니다.');
            setSecuritySaveButtonState(saveButton, 'success');
            setTimeout(() => hideResult(resultDiv), 2000);
            return;
        }

        if (typeof window.showToast === 'function') {
            window.showToast(data.message || '설정 저장에 실패했습니다.', 'danger');
        }
        setSecuritySaveButtonState(saveButton, 'error');
        showResult(resultDiv, data.message || '설정 저장에 실패했습니다.', true);
    } catch (error) {
        if (typeof window.showToast === 'function') {
            window.showToast(`오류: ${error.message}`, 'danger');
        }
        setSecuritySaveButtonState(saveButton, 'error');
        showResult(resultDiv, `오류: ${error.message}`, true);
    }
};

window.activateSecurityPasswordTab = function() {
    const tabBtn = document.getElementById('security-password-tab');
    const pane = document.getElementById('security-password-pane');
    const tabs = document.querySelectorAll('#securitySettingsTabs .nav-link');
    const panes = document.querySelectorAll('#securitySettingsTabContent .tab-pane');
    if (tabBtn && pane) {
        tabs.forEach((btn) => {
            btn.classList.remove('active');
            btn.setAttribute('aria-selected', 'false');
        });
        panes.forEach((tabPane) => {
            tabPane.classList.remove('show', 'active');
        });
        tabBtn.classList.add('active');
        tabBtn.setAttribute('aria-selected', 'true');
        pane.classList.add('show', 'active');
    }
    if (!tabBtn || typeof bootstrap === 'undefined') return;
    bootstrap.Tab.getOrCreateInstance(tabBtn).show();
};

document.addEventListener('DOMContentLoaded', () => {
    loadSecuritySettings();
    document.querySelectorAll('.menu-link[data-section="security-settings"]').forEach((menu) => {
        menu.addEventListener('click', () => {
            window.setTimeout(() => {
                if (typeof window.activateSecurityPasswordTab === 'function') {
                    window.activateSecurityPasswordTab();
                }
            }, 80);
        });
    });
});
