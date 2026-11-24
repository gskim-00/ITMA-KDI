document.addEventListener("DOMContentLoaded", () => {
    const usernameInput = document.getElementById("loginUsername");
    const usernameHint = document.getElementById("loginUsernameHint");
    const passwordInput = document.getElementById("loginPassword");
    const passwordToggleBtn = document.getElementById("toggleLoginPassword");
    const capsHint = document.getElementById("loginPasswordCapsHint");

    const usernamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{2,29}$/;

    const updateUsernameHint = () => {
        if (!usernameInput || !usernameHint) return;
        const raw = String(usernameInput.value || "").trim();
        if (!raw) {
            usernameHint.textContent = "아이디 형식: 영문/숫자 시작, 3~30자, 특수문자 . _ -";
            usernameHint.classList.remove("text-danger");
            usernameHint.classList.add("text-muted");
            return;
        }

        if (usernamePattern.test(raw)) {
            usernameHint.textContent = "사용 가능한 아이디 형식입니다.";
            usernameHint.classList.remove("text-danger");
            usernameHint.classList.add("text-muted");
            return;
        }

        usernameHint.textContent = "아이디 형식이 올바르지 않습니다. (영문/숫자 시작, 3~30자, 특수문자 . _ -)";
        usernameHint.classList.remove("text-muted");
        usernameHint.classList.add("text-danger");
    };

    const setPasswordVisibility = (visible) => {
        if (!passwordInput || !passwordToggleBtn) return;
        passwordInput.type = visible ? "text" : "password";
        const icon = passwordToggleBtn.querySelector("i");
        if (icon) {
            icon.className = visible ? "bi bi-eye-slash" : "bi bi-eye";
        }
    };

    const updateCapsState = (event) => {
        if (!capsHint || !event || typeof event.getModifierState !== "function") return;
        const isCapsOn = event.getModifierState("CapsLock");
        capsHint.classList.toggle("d-none", !isCapsOn);
    };

    usernameInput?.addEventListener("input", updateUsernameHint);
    usernameInput?.addEventListener("blur", () => {
        if (!usernameInput) return;
        usernameInput.value = String(usernameInput.value || "").trim();
        updateUsernameHint();
    });

    passwordToggleBtn?.addEventListener("click", () => {
        if (!passwordInput) return;
        setPasswordVisibility(passwordInput.type === "password");
    });

    passwordInput?.addEventListener("keydown", updateCapsState);
    passwordInput?.addEventListener("keyup", updateCapsState);
    passwordInput?.addEventListener("focus", updateCapsState);
    passwordInput?.addEventListener("blur", () => {
        capsHint?.classList.add("d-none");
    });

    updateUsernameHint();
    setPasswordVisibility(false);
});
