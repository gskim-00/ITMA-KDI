(function () {
    function normalizeType(type) {
        const raw = String(type || "info").toLowerCase();
        if (raw === "error") return "danger";
        if (["success", "danger", "warning", "info"].includes(raw)) return raw;
        return "info";
    }

    function ensureToastElements() {
        let container = document.getElementById("globalToastContainer");
        if (!container) {
            container = document.createElement("div");
            container.id = "globalToastContainer";
            container.className = "toast-container position-fixed top-0 end-0 p-3 app-toast-container";
            container.setAttribute("aria-live", "polite");
            container.setAttribute("aria-atomic", "true");
            document.body.appendChild(container);
        }

        let toast = document.getElementById("globalToast");
        if (!toast) {
            toast = document.createElement("div");
            toast.id = "globalToast";
            toast.className = "toast align-items-center border-0";
            toast.setAttribute("role", "alert");
            toast.setAttribute("aria-live", "assertive");
            toast.setAttribute("aria-atomic", "true");
            toast.innerHTML = `
                <div class="d-flex">
                    <div class="toast-body">
                        <i class="toast-icon"></i>
                        <span class="toast-message"></span>
                    </div>
                    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
                </div>
            `;
            container.appendChild(toast);
        }

        return { container, toast };
    }

    function ensureConfirmElements() {
        let modal = document.getElementById("globalConfirmModal");
        if (!modal) {
            modal = document.createElement("div");
            modal.id = "globalConfirmModal";
            modal.className = "modal fade";
            modal.tabIndex = -1;
            modal.setAttribute("aria-hidden", "true");
            modal.innerHTML = `
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content app-confirm-modal">
                        <div class="modal-header">
                            <h5 class="modal-title d-flex align-items-center gap-2" id="globalConfirmTitle">
                                <i id="globalConfirmIcon" class="bi bi-question-circle-fill text-primary"></i>
                                <span id="globalConfirmTitleText">확인</span>
                            </h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="닫기"></button>
                        </div>
                        <div class="modal-body">
                            <p id="globalConfirmMessage" class="mb-0"></p>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-role="cancel">취소</button>
                            <button type="button" class="btn btn-danger" data-role="confirm">확인</button>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }
        return modal;
    }

    function normalizeConfirmVariant(value, message) {
        const raw = String(value || "").toLowerCase().trim();
        if (["danger", "warning", "primary", "success"].includes(raw)) return raw;
        const text = String(message || "");
        if (/(삭제|초기화|원복|종료|정리|제거|실행)/.test(text)) return "danger";
        return "primary";
    }

    function showToast(message, type, options) {
        const text = String(message || "").trim();
        if (!text) return;

        const normalizedType = normalizeType(type);
        const duration = Number(options && options.duration_ms) > 0 ? Number(options.duration_ms) : 5000;
        const iconMap = {
            success: "bi bi-check-circle-fill",
            danger: "bi bi-exclamation-triangle-fill",
            warning: "bi bi-exclamation-circle-fill",
            info: "bi bi-info-circle-fill",
        };
        const bgMap = {
            success: "bg-success",
            danger: "bg-danger",
            warning: "bg-warning",
            info: "bg-info",
        };

        const { toast } = ensureToastElements();
        const toastIcon = toast.querySelector(".toast-icon");
        const toastMessage = toast.querySelector(".toast-message");

        toast.classList.remove("bg-success", "bg-danger", "bg-warning", "bg-info", "text-dark", "text-white", "toast-drop-in");
        toast.classList.add(bgMap[normalizedType], normalizedType === "warning" ? "text-dark" : "text-white");
        if (toastIcon) toastIcon.className = `toast-icon ${iconMap[normalizedType]}`;
        if (toastMessage) toastMessage.textContent = text;

        // Replay drop-down animation every time
        void toast.offsetWidth;
        toast.classList.add("toast-drop-in");

        if (typeof bootstrap !== "undefined" && bootstrap.Toast) {
            bootstrap.Toast.getOrCreateInstance(toast, { delay: duration, autohide: true }).show();
        } else {
            // Fallback without Bootstrap JS
            toast.style.display = "block";
            window.setTimeout(function () {
                toast.style.display = "none";
            }, duration);
        }
    }

    window.showToast = showToast;
    window.notify = {
        success: function (message, options) { showToast(message, "success", options); },
        info: function (message, options) { showToast(message, "info", options); },
        warning: function (message, options) { showToast(message, "warning", options); },
        error: function (message, options) { showToast(message, "danger", options); },
    };

    if (!window.__nativeConfirm) {
        window.__nativeConfirm = window.confirm ? window.confirm.bind(window) : function () { return true; };
    }

    window.confirmAction = function (message, options) {
        const text = String(message || "").trim();
        const opts = options || {};
        const titleText = String(opts.title || "확인");
        const confirmText = String(opts.confirmText || "확인");
        const cancelText = String(opts.cancelText || "취소");
        const variant = normalizeConfirmVariant(opts.variant, text);

        if (typeof bootstrap === "undefined" || !bootstrap.Modal) {
            return Promise.resolve(window.__nativeConfirm(text));
        }

        const modal = ensureConfirmElements();
        const titleEl = modal.querySelector("#globalConfirmTitleText");
        const titleWrap = modal.querySelector("#globalConfirmTitle");
        const iconEl = modal.querySelector("#globalConfirmIcon");
        const msgEl = modal.querySelector("#globalConfirmMessage");
        const btnConfirm = modal.querySelector("[data-role='confirm']");
        const btnCancel = modal.querySelector("[data-role='cancel']");
        const variantMap = {
            danger: { icon: "bi bi-exclamation-triangle-fill text-danger", btn: "btn btn-danger", header: "app-confirm-header-danger" },
            warning: { icon: "bi bi-exclamation-circle-fill text-warning", btn: "btn btn-warning", header: "app-confirm-header-warning" },
            primary: { icon: "bi bi-question-circle-fill text-primary", btn: "btn btn-primary", header: "app-confirm-header-primary" },
            success: { icon: "bi bi-check-circle-fill text-success", btn: "btn btn-success", header: "app-confirm-header-success" },
        };
        const meta = variantMap[variant] || variantMap.primary;

        if (titleEl) titleEl.textContent = titleText;
        if (iconEl) iconEl.className = meta.icon;
        if (titleWrap) {
            titleWrap.classList.remove("app-confirm-header-danger", "app-confirm-header-warning", "app-confirm-header-primary", "app-confirm-header-success");
            titleWrap.classList.add(meta.header);
        }
        if (msgEl) msgEl.textContent = text;
        if (btnConfirm) {
            btnConfirm.textContent = confirmText;
            btnConfirm.className = meta.btn;
        }
        if (btnCancel) btnCancel.textContent = cancelText;

        return new Promise(function (resolve) {
            const modalInstance = bootstrap.Modal.getOrCreateInstance(modal);
            let resolved = false;

            function cleanup() {
                modal.removeEventListener("hidden.bs.modal", onHidden);
                if (btnConfirm) btnConfirm.removeEventListener("click", onConfirm);
                if (btnCancel) btnCancel.removeEventListener("click", onCancel);
            }

            function settle(value) {
                if (resolved) return;
                resolved = true;
                cleanup();
                resolve(value);
            }

            function onConfirm() {
                settle(true);
                modalInstance.hide();
            }

            function onCancel() {
                settle(false);
                modalInstance.hide();
            }

            function onHidden() {
                settle(false);
            }

            if (btnConfirm) btnConfirm.addEventListener("click", onConfirm);
            if (btnCancel) btnCancel.addEventListener("click", onCancel);
            modal.addEventListener("hidden.bs.modal", onHidden);
            modalInstance.show();
        });
    };

    function flushServerFlashToasts() {
        const root = document.getElementById("flashToastData");
        if (!root) return;
        const items = root.querySelectorAll("[data-flash-message]");
        items.forEach(function (item, idx) {
            const msg = item.getAttribute("data-flash-message") || "";
            const type = item.getAttribute("data-flash-type") || "info";
            if (!msg.trim()) return;
            window.setTimeout(function () {
                showToast(msg, type, { duration_ms: 5000 });
            }, idx * 160);
        });
        root.remove();
    }

    // Compatibility shim: legacy alert() -> toast
    if (!window.__nativeAlert) {
        window.__nativeAlert = window.alert ? window.alert.bind(window) : function () {};
        window.alert = function (message) {
            showToast(message, "warning", { duration_ms: 5000 });
        };
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", flushServerFlashToasts);
    } else {
        flushServerFlashToasts();
    }
})();
