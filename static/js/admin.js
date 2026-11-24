/**
 * Admin Panel - Main Initialization & Tab Management
 */

document.addEventListener('DOMContentLoaded', function() {
    // 1. 사이드바 메뉴 클릭 처리 및 탭 전환
    initializeSidebarMenu();

    // 2. 대시보드 카드 버튼 클릭 처리
    initializeDashboardCards();

    // 3. 이메일 탭 서브탭 버튼 클릭 처리
    initializeEmailSubTabs();

    // 4. 템플릿 탭 서브탭 버튼 클릭 처리
    initializeTemplateSubTabs();

    // 5. 페이지 로드 시 서브탭 초기화
    initializeSubTabsOnLoad();

    // 6. 관리자 프로필 비밀번호 강도/일치 피드백 (관리자 전용)
    initializeAdminProfilePasswordFeedback();

    // 7. URL 해시 기준 탭 복원
    activateSectionFromHash();

    // 8. 상단 '관리화면' 드롭다운 등으로 해시만 바뀐 경우에도 섹션 전환
    window.addEventListener('hashchange', () => {
        const hash = (window.location.hash || '').replace('#', '').trim();
        const targetPane = hash ? document.getElementById(hash) : null;
        // 사이드바 클릭으로 이미 활성화된 섹션은 중복 초기화하지 않음
        // (초기 화면은 대시보드가 보이면서 user-list가 active 상태이므로 대시보드 표시 여부도 확인)
        const dashboard = document.getElementById('dashboard-section');
        const dashboardVisible = dashboard && dashboard.style.display !== 'none';
        if (targetPane && targetPane.classList.contains('active') && !dashboardVisible) return;
        activateSectionFromHash();
    });
});

/**
 * 사이드바 메뉴 클릭 처리
 */
function initializeSidebarMenu() {
    document.querySelectorAll('.menu-link').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const section = this.getAttribute('data-section');
            activateSection(section, { updateHash: true });
        });
    });
}

function activateSection(section, options = {}) {
    if (!section) return;
    const { updateHash = false } = options;

    document.querySelectorAll('.sidebar-menu-link').forEach(m => m.classList.remove('active'));
    const currentLinks = document.querySelectorAll(`.sidebar-menu-link[data-section="${section}"]`);
    currentLinks.forEach((link) => link.classList.add('active'));

    const dashboard = document.getElementById('dashboard-section');
    if (dashboard) {
        dashboard.style.display = 'none';
    }

    document.querySelectorAll('#adminTabContent > .tab-pane').forEach(pane => pane.classList.remove('active'));
    const targetPane = document.getElementById(section);
    if (!targetPane) return;
    targetPane.classList.add('active');

    // 카테고리 관리 진입 시 하위 탭을 즉시 초기화합니다.
    if (section === 'spec-forms') {
        document.querySelectorAll('#categorySettingsTabs [role="tab"]').forEach(tab => {
            const isDefault = tab.id === 'category-management-tab';
            tab.classList.toggle('active', isDefault);
            tab.setAttribute('aria-selected', String(isDefault));
            tab.setAttribute('tabindex', isDefault ? '0' : '-1');
        });
        document.querySelectorAll('#categorySettingsTabContent > .tab-pane').forEach(pane => {
            const isDefault = pane.id === 'category-management-pane';
            pane.classList.toggle('active', isDefault);
            pane.classList.toggle('show', isDefault);
        });
    }

    if (updateHash) {
        window.location.hash = `#${section}`;
    }

    // 이메일 전송 탭 진입 시 이메일 서브탭 초기화 및 최근 이메일 로드
    if (section === 'send-email') {
        setTimeout(() => {
            const firstEmailPane = document.querySelector('#emailSubTabContent .tab-pane:first-child');
            const firstEmailBtn = document.getElementById('send-email-form-tab');
            if (firstEmailPane && firstEmailBtn) {
                document.querySelectorAll('#emailSubTabContent .tab-pane').forEach(pane => {
                    pane.classList.remove('active', 'show');
                });
                document.querySelectorAll('#emailSubTab button').forEach(b => {
                    b.classList.remove('active');
                });
                firstEmailPane.classList.add('active', 'show');
                firstEmailBtn.classList.add('active');
            }
            if (typeof loadRecentEmails === 'function') {
                loadRecentEmails();
            }
        }, 50);
    }

    if (section === 'login-page-settings' && typeof window.loadLoginPageSettings === 'function') {
        window.loadLoginPageSettings();
    }

    // 웹서버 설정 탭 진입 시 도메인 서브탭 초기화
    if (section === 'web-server') {
        setTimeout(() => {
            document.querySelectorAll('#webServerTabContent .tab-pane').forEach(pane => {
                pane.classList.remove('active', 'show');
            });
            document.querySelectorAll('#webServerTabs button').forEach(b => {
                b.classList.remove('active');
            });
            const domainPane = document.getElementById('domain-settings');
            const domainBtn = document.getElementById('domain-tab');
            if (domainPane && domainBtn) {
                domainPane.classList.add('active', 'show');
                domainBtn.classList.add('active');
            }
        }, 50);
    }

    // 사용자 추가 탭 진입 시 단일 사용자 등록 서브탭 초기화
    if (section === 'add-user') {
        setTimeout(() => {
            document.querySelectorAll('#addUserTabContent .tab-pane').forEach(pane => {
                pane.classList.remove('active', 'show');
            });
            document.querySelectorAll('#addUserTabs button').forEach(b => {
                b.classList.remove('active');
            });
            const singleUserPane = document.getElementById('single-user');
            const singleUserBtn = document.getElementById('single-user-tab');
            if (singleUserPane && singleUserBtn) {
                singleUserPane.classList.add('active', 'show');
                singleUserBtn.classList.add('active');
            }
        }, 50);
    }
}

function activateSectionFromHash() {
    const hash = (window.location.hash || '').replace('#', '').trim();
    if (!hash) return;
    const targetPane = document.getElementById(hash);
    if (!targetPane) return;
    activateSection(hash, { updateHash: false });
}

/**
 * 대시보드 카드 버튼 클릭 처리
 */
function initializeDashboardCards() {
    document.querySelectorAll('.stat-card-actions a').forEach(link => {
        link.addEventListener('click', function(e) {
            const section = this.getAttribute('data-section');
            if (section) {
                e.preventDefault();
                const menuLink = document.querySelector(`[data-section="${section}"]`);
                if (menuLink) {
                    menuLink.click();
                }
            }
        });
    });
}

/**
 * 이메일 서브탭 초기화
 */
function initializeEmailSubTabs() {
    document.querySelectorAll('#emailSubTab button').forEach(btn => {
        btn.addEventListener('click', function() {
            const target = this.getAttribute('data-bs-target');
            if (target) {
                const targetPane = document.querySelector(target);
                if (targetPane) {
                    // 모든 pane 비활성화
                    document.querySelectorAll('#emailSubTabContent .tab-pane').forEach(pane => {
                        pane.classList.remove('active', 'show');
                    });
                    // 모든 버튼 비활성화
                    document.querySelectorAll('#emailSubTab button').forEach(b => {
                        b.classList.remove('active');
                    });
                    // 선택된 pane 활성화
                    targetPane.classList.add('active', 'show');
                    this.classList.add('active');
                    
                    // 이메일 템플릿 탭 진입 시 템플릿 목록 로드
                    if (target === '#email-template') {
                        setTimeout(() => {
                            if (typeof loadTemplateList === 'function') {
                                loadTemplateList();
                            }
                        }, 100);
                    }
                }
            }
        });
    });
}

/**
 * 템플릿 서브탭 초기화
 */
function initializeTemplateSubTabs() {
    document.querySelectorAll('#templateSubTab button').forEach(btn => {
        btn.addEventListener('click', function() {
            const target = this.getAttribute('data-bs-target');
            if (target) {
                const targetPane = document.querySelector(target);
                if (targetPane) {
                    // 모든 pane 비활성화
                    document.querySelectorAll('#templateSubTabContent .tab-pane').forEach(pane => {
                        pane.classList.remove('active', 'show');
                    });
                    // 모든 버튼 비활성화
                    document.querySelectorAll('#templateSubTab button').forEach(b => {
                        b.classList.remove('active');
                    });
                    // 선택된 pane 활성화
                    targetPane.classList.add('active', 'show');
                    this.classList.add('active');
                }
            }
        });
    });
}

/**
 * 페이지 로드 시 서브탭 초기화
 */
function initializeSubTabsOnLoad() {
    // 이메일 서브탭 초기화
    const emailSubTabContent = document.getElementById('emailSubTabContent');
    if (emailSubTabContent) {
        const firstEmailPane = emailSubTabContent.querySelector('.tab-pane:first-child');
        const firstEmailBtn = document.getElementById('send-email-form-tab');
        if (firstEmailPane && firstEmailBtn) {
            firstEmailPane.classList.add('active', 'show');
            firstEmailBtn.classList.add('active');
        }
    }

    // 템플릿 서브탭 초기화
    const templateSubTabContent = document.getElementById('templateSubTabContent');
    if (templateSubTabContent) {
        const firstTemplatePane = templateSubTabContent.querySelector('.tab-pane:first-child');
        const firstTemplateBtn = document.getElementById('template-welcome-tab');
        if (firstTemplatePane && firstTemplateBtn) {
            firstTemplatePane.classList.add('active', 'show');
            firstTemplateBtn.classList.add('active');
        }
    }

    // 현재 이메일 설정 불러오기
    loadCurrentEmailSettings();
}

/**
 * 현재 이메일 설정 불러오기
 */
async function loadCurrentEmailSettings() {
    try {
        const response = await fetch('/admin/email_settings');
        if (response.ok) {
            const settings = await response.json();
            
            // 현재 설정 화면에 데이터 표시
            document.getElementById('currentSmtpServer').textContent = settings.smtp_server || '-';
            document.getElementById('currentSmtpPort').textContent = settings.smtp_port || '-';
            document.getElementById('currentSmtpUsername').textContent = settings.smtp_username || '-';
            document.getElementById('currentSenderEmail').textContent = settings.sender_email || '-';
            document.getElementById('currentSenderName').textContent = settings.sender_name || '-';
            
            const useTlsBadge = document.getElementById('currentUseTls');
            if (settings.use_tls) {
                useTlsBadge.textContent = '사용';
                useTlsBadge.className = 'badge bg-success';
            } else {
                useTlsBadge.textContent = '미사용';
                useTlsBadge.className = 'badge bg-secondary';
            }
            
            document.getElementById('currentUpdatedAt').textContent = settings.updated_at || '없음';

            // 폼에 값 입력
            const form = document.getElementById('emailSettingsForm');
            if (form) {
                form.smtp_server.value = settings.smtp_server || '';
                form.smtp_port.value = settings.smtp_port || '';
                form.smtp_username.value = settings.smtp_username || '';
                form.sender_email.value = settings.sender_email || '';
                form.sender_name.value = settings.sender_name || '';
                document.getElementById('useTlsCheckbox').checked = settings.use_tls || false;
            }
        }
    } catch (error) {
        console.error('이메일 설정 불러오기 실패:', error);
    }
}

function evaluatePasswordStrength(password) {
    let score = 0;
    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSpecial = /[^A-Za-z0-9]/.test(password);

    if (password.length >= 8) score += 1;
    if (password.length >= 12) score += 1;
    if (hasUpper) score += 1;
    if (hasLower) score += 1;
    if (hasNumber) score += 1;
    if (hasSpecial) score += 1;

    if (!password) return { level: 0, text: '-', percent: 0, barClass: 'bg-secondary' };
    if (score <= 2) return { level: 1, text: '약함', percent: 25, barClass: 'bg-danger' };
    if (score <= 4) return { level: 2, text: '보통', percent: 50, barClass: 'bg-warning' };
    if (score === 5) return { level: 3, text: '강함', percent: 75, barClass: 'bg-info' };
    return { level: 4, text: '매우 강함', percent: 100, barClass: 'bg-success' };
}

function attachPasswordFeedback(form, newInput, confirmInput, keyPrefix) {
    if (!form || !newInput || !confirmInput) return null;

    const barId = `${keyPrefix}StrengthBar`;
    const textId = `${keyPrefix}StrengthText`;
    const matchId = `${keyPrefix}MatchText`;

    let strengthBar = document.getElementById(barId);
    let strengthText = document.getElementById(textId);
    if (!strengthBar || !strengthText) {
        const wrap = document.createElement('div');
        wrap.className = 'mt-2';
        wrap.innerHTML = `
            <div class="progress" style="height: 8px;">
                <div id="${barId}" class="progress-bar" role="progressbar" style="width: 0%"></div>
            </div>
            <small id="${textId}" class="text-muted">비밀번호 강도: -</small>
        `;
        newInput.insertAdjacentElement('afterend', wrap);
        strengthBar = document.getElementById(barId);
        strengthText = document.getElementById(textId);
    }

    let matchText = document.getElementById(matchId);
    if (!matchText) {
        matchText = document.createElement('small');
        matchText.id = matchId;
        matchText.className = 'text-muted d-block mt-2';
        matchText.textContent = '비밀번호 일치 여부: -';
        confirmInput.insertAdjacentElement('afterend', matchText);
    }

    const update = () => {
        const pw = newInput.value || '';
        const cpw = confirmInput.value || '';
        const strength = evaluatePasswordStrength(pw);

        strengthBar.style.width = `${strength.percent}%`;
        strengthBar.className = `progress-bar ${strength.barClass}`;
        strengthText.textContent = `비밀번호 강도: ${strength.text}`;

        if (!cpw) {
            matchText.textContent = '비밀번호 일치 여부: -';
            matchText.className = 'text-muted d-block mt-2';
        } else if (pw === cpw) {
            matchText.textContent = '비밀번호가 일치합니다.';
            matchText.className = 'text-success d-block mt-2';
        } else {
            matchText.textContent = '비밀번호가 일치하지 않습니다.';
            matchText.className = 'text-danger d-block mt-2';
        }
    };

    newInput.addEventListener('input', update);
    confirmInput.addEventListener('input', update);
    update();

    return {
        isValid() {
            if (newInput.value !== confirmInput.value) {
                matchText.textContent = '비밀번호가 일치하지 않습니다.';
                matchText.className = 'text-danger d-block mt-2';
                confirmInput.focus();
                return false;
            }
            if (newInput.value && evaluatePasswordStrength(newInput.value).level === 1) {
                alert('비밀번호 강도가 약합니다. 대문자/소문자/숫자/특수문자를 포함해주세요.');
                return false;
            }
            return true;
        },
        refresh: update
    };
}

function initializeAdminProfilePasswordFeedback() {
    const form = document.querySelector('form[action$="/admin/update_admin"]');
    if (!form) return;

    const newInput = form.querySelector('input[name="new_password"]');
    const confirmInput = form.querySelector('input[name="confirm_password"]');
    const feedback = attachPasswordFeedback(form, newInput, confirmInput, 'adminProfilePassword');
    if (!feedback) return;

    form.addEventListener('submit', function(e) {
        if (!feedback.isValid()) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    });
}

window.passwordFeedbackUtils = {
    evaluatePasswordStrength,
    attachPasswordFeedback
};
