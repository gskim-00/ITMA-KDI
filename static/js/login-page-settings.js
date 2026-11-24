(() => {
    const endpoint = '/admin/login-page-settings';
    const logoEndpoint = '/admin/login-page-logo';

    function showResult(message, isError = false) {
        const result = document.getElementById('loginPageSettingsResult');
        if (!result) return;
        result.textContent = message;
        result.className = isError ? 'small text-danger' : 'small text-success';
    }

    function updateLoginPagePreview() {
        const siteName = document.getElementById('loginSiteName');
        const welcomeMessage = document.getElementById('loginWelcomeMessage');
        const siteNameSize = document.getElementById('loginSiteNameFontSize');
        const welcomeMessageSize = document.getElementById('loginWelcomeMessageFontSize');
        const previewSiteName = document.getElementById('loginPreviewSiteName');
        const previewWelcomeMessage = document.getElementById('loginPreviewWelcomeMessage');
        if (!siteName || !welcomeMessage || !siteNameSize || !welcomeMessageSize || !previewSiteName || !previewWelcomeMessage) return;

        const siteNameText = siteName.value.trim();
        const welcomeMessageText = welcomeMessage.value.trim();
        previewSiteName.textContent = siteNameText;
        previewSiteName.classList.toggle('d-none', !siteNameText);
        previewSiteName.style.fontSize = siteNameSize.value ? `${siteNameSize.value}px` : '';
        previewWelcomeMessage.textContent = welcomeMessageText;
        previewWelcomeMessage.classList.toggle('d-none', !welcomeMessageText);
        previewWelcomeMessage.style.fontSize = welcomeMessageSize.value ? `${welcomeMessageSize.value}px` : '';
    }

    function applyLoginPageSettings(settings) {
        document.getElementById('loginSiteName').value = settings.login_site_name || '';
        document.getElementById('loginWelcomeMessage').value = settings.login_welcome_message || '';
        document.getElementById('loginSiteNameFontSize').value = settings.login_site_name_font_size || '';
        document.getElementById('loginWelcomeMessageFontSize').value = settings.login_welcome_message_font_size || '';
        updateLoginPagePreview();
    }

    function showLogoResult(message, isError = false) {
        const result = document.getElementById('loginLogoResult');
        if (!result) return;
        result.textContent = message;
        result.className = isError ? 'small text-danger mt-2' : 'small text-success mt-2';
    }

    function setPreviewLogo(url) {
        const previewLogo = document.getElementById('loginPreviewLogo');
        if (previewLogo && url) previewLogo.src = url;
    }

    async function loadLoginPageLogo() {
        try {
            const response = await fetch(logoEndpoint);
            const data = await response.json();
            if (!data.success) throw new Error(data.message || '로고 정보를 불러오지 못했습니다.');
            setPreviewLogo(data.logo_url);
            const resetButton = document.getElementById('loginLogoResetButton');
            if (resetButton) resetButton.disabled = !data.has_custom_logo;
        } catch (error) {
            showLogoResult(error.message || '로고 정보를 불러오지 못했습니다.', true);
        }
    }

    async function uploadLoginLogo() {
        const fileInput = document.getElementById('loginLogoFile');
        const button = document.getElementById('loginLogoUploadButton');
        if (!fileInput?.files?.length || !button) {
            showLogoResult('PNG 로고 파일을 선택해주세요.', true);
            return;
        }
        button.disabled = true;
        try {
            const formData = new FormData();
            formData.append('login_logo_file', fileInput.files[0]);
            const response = await fetch(logoEndpoint, { method: 'POST', body: formData });
            const data = await response.json();
            if (!data.success) throw new Error(data.message || '로고를 변경하지 못했습니다.');
            setPreviewLogo(data.logo_url);
            fileInput.value = '';
            const resetButton = document.getElementById('loginLogoResetButton');
            if (resetButton) resetButton.disabled = false;
            showLogoResult(data.message || '로그인 로고를 변경했습니다.');
        } catch (error) {
            showLogoResult(error.message || '로고를 변경하지 못했습니다.', true);
        } finally {
            button.disabled = false;
        }
    }

    async function resetLoginLogo() {
        const button = document.getElementById('loginLogoResetButton');
        if (!button) return;
        button.disabled = true;
        try {
            const response = await fetch(logoEndpoint, { method: 'DELETE' });
            const data = await response.json();
            if (!data.success) throw new Error(data.message || '로고를 초기화하지 못했습니다.');
            setPreviewLogo(data.logo_url);
            showLogoResult(data.message || '기본 로고로 초기화했습니다.');
        } catch (error) {
            showLogoResult(error.message || '로고를 초기화하지 못했습니다.', true);
        } finally {
            button.disabled = false;
        }
    }

    async function loadLoginPageSettings() {
        const form = document.getElementById('loginPageSettingsForm');
        if (!form) return;
        try {
            const response = await fetch(endpoint);
            const data = await response.json();
            if (!data.success || !data.settings) throw new Error(data.message || '설정을 불러오지 못했습니다.');
            applyLoginPageSettings(data.settings);
            await loadLoginPageLogo();
            showResult('');
        } catch (error) {
            showResult(error.message || '설정을 불러오지 못했습니다.', true);
        }
    }

    async function saveLoginPageSettings(event) {
        event.preventDefault();
        const form = document.getElementById('loginPageSettingsForm');
        const button = document.getElementById('loginPageSettingsSaveButton');
        if (!form || !button) return;
        button.disabled = true;
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    login_site_name: document.getElementById('loginSiteName').value.trim(),
                    login_welcome_message: document.getElementById('loginWelcomeMessage').value.trim(),
                    login_site_name_font_size: document.getElementById('loginSiteNameFontSize').value,
                    login_welcome_message_font_size: document.getElementById('loginWelcomeMessageFontSize').value,
                }),
            });
            const data = await response.json();
            if (!data.success) throw new Error(data.message || '저장하지 못했습니다.');
            applyLoginPageSettings(data.settings || {});
            showResult(data.message || '저장했습니다.');
        } catch (error) {
            showResult(error.message || '저장하지 못했습니다.', true);
        } finally {
            button.disabled = false;
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        const form = document.getElementById('loginPageSettingsForm');
        if (!form) return;
        form.addEventListener('submit', saveLoginPageSettings);
        ['loginSiteName', 'loginWelcomeMessage', 'loginSiteNameFontSize', 'loginWelcomeMessageFontSize'].forEach((id) => {
            document.getElementById(id)?.addEventListener('input', updateLoginPagePreview);
        });
        document.getElementById('loginLogoUploadButton')?.addEventListener('click', uploadLoginLogo);
        document.getElementById('loginLogoResetButton')?.addEventListener('click', resetLoginLogo);
        document.getElementById('loginLogoFile')?.addEventListener('change', (event) => {
            const file = event.target.files?.[0];
            if (file) setPreviewLogo(URL.createObjectURL(file));
        });
        updateLoginPagePreview();
    });

    window.loadLoginPageSettings = loadLoginPageSettings;
})();
