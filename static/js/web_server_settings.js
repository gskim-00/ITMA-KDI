/**
 * 웹 서버 설정 JavaScript
 * HTTP/HTTPS 설정, SSL 인증서/키 파일 업로드, 강제 HTTPS 리다이렉트 등의 기능을 관리합니다.
 */

document.addEventListener('DOMContentLoaded', function() {
    const serverNameInput = document.getElementById('serverName');
    const urlSchemeSelect = document.getElementById('urlScheme');
    const urlPreview = document.getElementById('urlPreview');

    const sslCertPathInput = document.getElementById('sslCertPath');
    const sslKeyPathInput = document.getElementById('sslKeyPath');
    const sslCertFileInput = document.getElementById('sslCertFile');
    const sslKeyFileInput = document.getElementById('sslKeyFile');
    const btnUploadSslFiles = document.getElementById('btnUploadSslFiles');

    const sslInputModeUpload = document.getElementById('sslInputModeUpload');
    const sslInputModePath = document.getElementById('sslInputModePath');
    const sslUploadArea = document.getElementById('sslUploadArea');
    const sslPathArea = document.getElementById('sslPathArea');
    const sslUploadStatus = document.getElementById('sslUploadStatus');
    const sslUploadStatusText = document.getElementById('sslUploadStatusText');

    const forceHttpsRedirectInput = document.getElementById('forceHttpsRedirect');

    if (!serverNameInput || !urlSchemeSelect || !urlPreview) {
        return;
    }

    function updatePreview() {
        const serverName = serverNameInput.value.trim() || '127.0.0.1:8008';
        const scheme = urlSchemeSelect.value;
        urlPreview.textContent = `${scheme}://${serverName}/itma/assets/download`;
    }

    function isHttpsSelected() {
        return urlSchemeSelect.value === 'https';
    }

    function isUploadMode() {
        return !!(sslInputModeUpload && sslInputModeUpload.checked);
    }

    function hasSslPaths() {
        const certPath = sslCertPathInput ? sslCertPathInput.value.trim() : '';
        const keyPath = sslKeyPathInput ? sslKeyPathInput.value.trim() : '';
        return !!(certPath && keyPath);
    }

    function setUploadStatus(ok, text) {
        if (sslUploadStatus) {
            sslUploadStatus.className = ok ? 'badge bg-success' : 'badge bg-secondary';
            sslUploadStatus.textContent = ok ? '성공' : '실패';
        }
        if (sslUploadStatusText) {
            sslUploadStatusText.textContent = text;
        }
    }

    function updateSslModeUI() {
        const uploadMode = isUploadMode();

        if (sslUploadArea) sslUploadArea.style.display = uploadMode ? '' : 'none';
        if (sslPathArea) sslPathArea.style.display = uploadMode ? 'none' : '';

        // SSL 경로 입력 필드 읽기 전용 설정
        if (sslCertPathInput) sslCertPathInput.readOnly = uploadMode;
        if (sslKeyPathInput) sslKeyPathInput.readOnly = uploadMode;

        if (isHttpsSelected()) {
            if (hasSslPaths()) {
                setUploadStatus(true, 'SSL 경로가 올바르게 설정되었습니다.');
            } else if (uploadMode) {
                setUploadStatus(false, 'SSL 파일을 업로드해야 합니다.');
            } else {
                setUploadStatus(false, 'SSL 경로가 올바르지 않습니다.');

            }
        } else {
            setUploadStatus(false, 'HTTP 모드에서는 SSL 설정이 필요하지 않습니다. HTTPS 모드에서만 SSL 설정이 필요합니다.');
        }
    }

    function validateSslInputs() {
        if (!isHttpsSelected()) return true;

        if (isUploadMode() && !hasSslPaths()) {
            alert('HTTPS 모드에서는 SSL 파일을 업로드해야 합니다.');
            return false;
        }

        if (!isUploadMode() && !hasSslPaths()) {
            alert('HTTPS 모드에서는 SSL 경로를 올바르게 설정해야 합니다.');
            return false;
        }

        return true;
    }

    serverNameInput.addEventListener('input', updatePreview);
    urlSchemeSelect.addEventListener('change', function() {
        updatePreview();
        updateSslModeUI();
    });

    if (sslInputModeUpload) {
        sslInputModeUpload.addEventListener('change', updateSslModeUI);
    }
    if (sslInputModePath) {
        sslInputModePath.addEventListener('change', updateSslModeUI);
    }

    if (sslCertPathInput) sslCertPathInput.addEventListener('input', updateSslModeUI);
    if (sslKeyPathInput) sslKeyPathInput.addEventListener('input', updateSslModeUI);

    if (btnUploadSslFiles) {
        btnUploadSslFiles.addEventListener('click', async function() {
            const certFile = sslCertFileInput && sslCertFileInput.files ? sslCertFileInput.files[0] : null;
            const keyFile = sslKeyFileInput && sslKeyFileInput.files ? sslKeyFileInput.files[0] : null;

            if (!certFile && !keyFile) {
                alert('업로드할 SSL 파일을 선택하세요.');
                return;
            }

            const formData = new FormData();
            if (certFile) formData.append('ssl_cert_file', certFile);
            if (keyFile) formData.append('ssl_key_file', keyFile);

            try {
                btnUploadSslFiles.disabled = true;
                btnUploadSslFiles.textContent = '업로드 중...';

                const response = await fetch('/admin/web_server/upload_ssl', {
                    method: 'POST',
                    body: formData
                });
                const result = await response.json();

                if (!response.ok || !result.success) {
                    alert('SSL 파일 업로드 중 오류 발생: ' + (result.message || '알 수 없는 오류'));
                    return;
                }

                if (result.cert_path && sslCertPathInput) {
                    sslCertPathInput.value = result.cert_path;
                }
                if (result.key_path && sslKeyPathInput) {
                    sslKeyPathInput.value = result.key_path;
                }

                if (sslCertFileInput) sslCertFileInput.value = '';
                if (sslKeyFileInput) sslKeyFileInput.value = '';

                updateSslModeUI();
                alert('SSL 파일이 성공적으로 업로드되었습니다. 경로가 업데이트되었습니다.');
            } catch (error) {
                alert('SSL 파일 업로드 중 오류 발생: ' + error.message);
            } finally {
                btnUploadSslFiles.disabled = false;
                btnUploadSslFiles.innerHTML = '<i class="bi bi-upload me-1"></i> SSL 파일 업로드';
            }
        });
    }

    const webServerForm = document.getElementById('webServerForm');
    if (webServerForm) {
        webServerForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            if (!validateSslInputs()) {
                return;
            }

            const formData = {
                server_name: serverNameInput.value.trim(),
                url_scheme: urlSchemeSelect.value,
                allowed_extensions: document.getElementById('allowedExtensions').value.trim(),
                max_file_size: document.getElementById('maxFileSize').value.trim(),
                ssl_cert_path: sslCertPathInput ? sslCertPathInput.value.trim() : '',
                ssl_key_path: sslKeyPathInput ? sslKeyPathInput.value.trim() : '',
                force_https_redirect: forceHttpsRedirectInput ? forceHttpsRedirectInput.checked : false
            };

            try {
                const response = await fetch('/admin/web_server/update', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(formData)
                });

                const result = await response.json();

                if (response.ok) {
                    alert('웹 서버 설정이 성공적으로 업데이트되었습니다. 페이지를 새로고침합니다.');
                    location.reload();
                } else {
                    alert('웹 서버 설정 업데이트 중 오류 발생: ' + (result.message || '알 수 없는 오류'));
                }
            } catch (error) {
                alert('웹 서버 설정 업데이트 중 오류 발생: ' + error.message);
            }
        });
    }

    const btnReset = document.getElementById('btnResetWebServer');
    if (btnReset) {
        btnReset.addEventListener('click', function() {
            if (confirm('웹 서버 설정을 초기화하시겠습니까?')) {
                serverNameInput.value = '';
                urlSchemeSelect.value = 'http';
                if (sslCertPathInput) sslCertPathInput.value = '';
                if (sslKeyPathInput) sslKeyPathInput.value = '';
                if (sslCertFileInput) sslCertFileInput.value = '';
                if (sslKeyFileInput) sslKeyFileInput.value = '';
                if (forceHttpsRedirectInput) forceHttpsRedirectInput.checked = false;
                if (sslInputModeUpload) sslInputModeUpload.checked = true;
                updatePreview();
                updateSslModeUI();
            }
        });
    }

    const btnTest = document.getElementById('btnTestUrl');
    if (btnTest) {
        btnTest.addEventListener('click', async function() {
            const serverName = serverNameInput.value.trim();
            const scheme = urlSchemeSelect.value;

            if (!serverName) {
                alert('테스트할 서버 이름을 입력하세요.');
                return;
            }

            const testUrl = `${scheme}://${serverName}`;

            try {
                const result = confirm(`테스트할 URL을 열겠습니까?\n\n${testUrl}`);
                if (result) {
                    window.open(testUrl, '_blank');
                }
            } catch (error) {
                alert('테스트 URL 열기 중 오류 발생: ' + error.message);
            }
        });
    }

    // SSL 경로가 있는 경우 경로 모드 선택
    if (sslInputModePath && hasSslPaths()) {
        // 경로 모드 선택
        sslInputModePath.checked = true;
    }
    updatePreview();
    updateSslModeUI();
});
