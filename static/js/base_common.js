const rootEl = document.body;
window.appCsrfToken = rootEl?.dataset?.csrfToken || "";
window.appMaxFileSizeMB = Number(rootEl?.dataset?.maxFileSizeMb || 100);
const profileUrl = rootEl?.dataset?.profileUrl || "/auth/profile";

// 변경 메서드 요청에 CSRF 토큰 자동 첨부
(function () {
    const originalFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
        const options = init ? { ...init } : {};
        const method = String(options.method || "GET").toUpperCase();
        const url = typeof input === "string"
            ? input
            : (input && typeof input.url === "string" ? input.url : "");
        const isMutating = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
        const isSameOrigin = !/^https?:\/\//i.test(url) || url.startsWith(window.location.origin);
        if (isMutating && isSameOrigin) {
            const headers = new Headers(options.headers || {});
            if (!headers.has("X-CSRF-Token")) {
                headers.set("X-CSRF-Token", window.appCsrfToken || "");
            }
            options.headers = headers;
        }
        return originalFetch(input, options).then(function (response) {
            // 세션 만료 시 로그인 화면으로 이동 (자동 새로고침 요청 포함)
            if (isSameOrigin && !window.__appSessionExpiredRedirect) {
                let expired = response.status === 401;
                if (!expired && response.redirected) {
                    try {
                        expired = new URL(response.url).pathname === "/login";
                    } catch (_e) {
                        expired = false;
                    }
                }
                if (expired) {
                    window.__appSessionExpiredRedirect = true;
                    window.location.href = "/login";
                }
            }
            return response;
        });
    };
})();

// 폼 제출 시 csrf_token hidden input 자동 추가
document.addEventListener("DOMContentLoaded", function () {
    const token = window.appCsrfToken || "";
    if (!token) return;
    document.querySelectorAll("form").forEach((form) => {
        const method = (form.getAttribute("method") || "GET").toUpperCase();
        if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return;
        if (form.querySelector('input[name="csrf_token"]')) return;
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = "csrf_token";
        input.value = token;
        form.appendChild(input);
    });
});

function updateProfilePasswordMatchState() {
    const pw = document.getElementById("profileNewPassword");
    const cpw = document.getElementById("profileConfirmPassword");
    const match = document.getElementById("profilePasswordMatchText");
    if (!pw || !cpw || !match) return;

    const p = pw.value || "";
    const c = cpw.value || "";
    if (!c) {
        match.textContent = "비밀번호 일치 여부: -";
        match.className = "text-muted d-block mt-2";
        return;
    }
    if (p === c) {
        match.textContent = "비밀번호가 일치합니다.";
        match.className = "text-success d-block mt-2";
        return;
    }
    match.textContent = "비밀번호가 일치하지 않습니다.";
    match.className = "text-danger d-block mt-2";
}

async function loadMyProfile() {
    const emailInput = document.getElementById("profileEmail");
    if (!emailInput) return;
    try {
        const response = await fetch(profileUrl, {
            headers: { Accept: "application/json" }
        });
        const data = await response.json();
        if (response.ok && data.success) {
            emailInput.value = data.email || "";
        }
    } catch (_error) {
        // ignore
    }
}

document.addEventListener("DOMContentLoaded", function () {
    const profileModalEl = document.getElementById("profileModal");
    const profileForm = document.getElementById("profileUpdateForm");
    const pw = document.getElementById("profileNewPassword");
    const cpw = document.getElementById("profileConfirmPassword");
    const curPw = document.getElementById("profileCurrentPassword");

    if (profileModalEl) {
        profileModalEl.addEventListener("shown.bs.modal", function () {
            loadMyProfile();
            if (pw) pw.value = "";
            if (cpw) cpw.value = "";
            if (curPw) curPw.value = "";
            updateProfilePasswordMatchState();
        });
    }

    if (pw) pw.addEventListener("input", updateProfilePasswordMatchState);
    if (cpw) cpw.addEventListener("input", updateProfilePasswordMatchState);

    if (profileForm) {
        profileForm.addEventListener("submit", function (e) {
            const newPassword = pw ? (pw.value || "") : "";
            const confirmPassword = cpw ? (cpw.value || "") : "";
            const currentPassword = curPw ? (curPw.value || "") : "";
            if (newPassword || confirmPassword) {
                if (!currentPassword) {
                    e.preventDefault();
                    if (typeof window.showToast === "function") {
                        window.showToast("비밀번호 변경 시 현재 비밀번호를 입력해주세요.", "warning");
                    }
                    if (curPw) curPw.focus();
                    return;
                }
                if (newPassword !== confirmPassword) {
                    e.preventDefault();
                    updateProfilePasswordMatchState();
                    if (cpw) cpw.focus();
                }
            }
        });
    }
});
