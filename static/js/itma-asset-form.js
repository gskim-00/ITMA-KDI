// ONE ITMA 자산 추가/수정 화면 — 저장 버튼으로만 저장한다.
(function () {
    const LIST_URL = "/itma/assets/page";
    const FLASH_KEY = "itmaFlashMessage";

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function toast(message, type) {
        if (window.notify && typeof window.notify[type] === "function") {
            window.notify[type](message);
        } else {
            window.alert(message);
        }
    }

    class ItmaAssetForm {
        constructor() {
            this.page = document.getElementById("itmaAssetFormPage");
            this.form = document.getElementById("itmaAssetForm");
            this.assetId = Number(this.page?.dataset?.assetId || 0) || null;
            this.permissions = window.itmaInitialPermissions || {};
            this.canEdit = true;
            this.saving = false;
            this.initialSnapshot = "";
            this.customColumns = [];
            // 상세 스펙: 카테고리별 스펙 폼 캐시, 입력값(키: 스펙 폼 항목 id)
            this.specFormCache = new Map();
            this.specForms = [];
            this.specValues = {};
            this.savedSpec = {};
            this.selectedSpecFormId = "";
        }

        async init() {
            if (!this.page || !this.form) return;
            this.showStoredFlash();
            document.getElementById("btnItmaFormSave")?.addEventListener("click", () => this.save(false));
            document.getElementById("btnItmaFormSaveList")?.addEventListener("click", () => this.save(true));
            document.getElementById("btnItmaFormCancel")?.addEventListener("click", () => this.leave(LIST_URL));
            document.getElementById("itmaFormBackLink")?.addEventListener("click", (e) => {
                e.preventDefault();
                this.leave(LIST_URL);
            });
            this.form.addEventListener("submit", (e) => {
                e.preventDefault();
                this.save(false);
            });
            this.form.addEventListener("input", (e) => this.clearFieldError(e.target));
            this.field("base", "category")?.addEventListener("change", () => {
                this.loadSpecForms().catch((error) => this.showError(error.message));
            });
            window.addEventListener("beforeunload", (e) => {
                if (!this.isDirty()) return;
                e.preventDefault();
                e.returnValue = "";
            });

            try {
                await this.loadOptions();
                if (this.assetId) {
                    await this.loadAsset();
                } else {
                    this.setUsageDefault();
                }
                await this.loadSpecForms();
            } catch (error) {
                this.showError(error.message || "화면을 불러오지 못했습니다.");
            }
            this.applyEditMode();
            this.initialSnapshot = this.snapshot();
        }

        showStoredFlash() {
            try {
                const message = window.sessionStorage.getItem(FLASH_KEY);
                if (message) {
                    window.sessionStorage.removeItem(FLASH_KEY);
                    toast(message, "success");
                }
            } catch (_e) {
                // 저장소를 사용할 수 없는 환경은 무시
            }
        }

        field(group, name) {
            return this.form.querySelector(`[data-group="${group}"][data-field="${name}"]`);
        }

        async loadOptions() {
            const response = await fetch("/itma/assets/form-options", { headers: { Accept: "application/json" } });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.message || "선택 항목을 불러오지 못했습니다.");

            const categorySelect = this.field("base", "category");
            (data.categories || []).forEach((category) => {
                const option = document.createElement("option");
                option.value = category.display_name;
                option.textContent = category.display_name;
                option.dataset.categoryKey = category.category_key;
                if (!category.can_edit) {
                    option.disabled = true;
                    option.textContent += " (조회만 가능)";
                }
                categorySelect?.appendChild(option);
            });

            const usageSelect = this.field("base", "usage_status");
            (data.usage_status_options || []).forEach((status) => {
                const option = document.createElement("option");
                option.value = status;
                option.textContent = status;
                usageSelect?.appendChild(option);
            });

            const suggestions = data.suggestions || {};
            Object.entries(suggestions).forEach(([column, values]) => {
                const list = document.getElementById(`dl_${column}`);
                if (!list) return;
                list.innerHTML = (values || []).map((value) => `<option value="${escapeHtml(value)}"></option>`).join("");
            });

            this.customColumns = Array.isArray(data.custom_columns) ? data.custom_columns : [];
            this.renderCustomFields();
        }

        renderCustomFields() {
            const section = document.getElementById("itmaFormCustomSection");
            const wrap = document.getElementById("itmaFormCustomFields");
            if (!section || !wrap) return;
            if (!this.customColumns.length) {
                section.classList.add("d-none");
                return;
            }
            section.classList.remove("d-none");
            wrap.innerHTML = this.customColumns.map((column) => `
                <div class="col-md-4">
                    <label class="form-label" for="c_${escapeHtml(column.key)}">${escapeHtml(column.label)}</label>
                    <input class="form-control" id="c_${escapeHtml(column.key)}" data-group="custom" data-field="${escapeHtml(column.key)}">
                </div>
            `).join("");
            const canManage = !!this.permissions.can_manage_columns;
            document.getElementById("itmaFormCustomNotice")?.classList.toggle("d-none", canManage);
            wrap.querySelectorAll("input").forEach((input) => {
                input.disabled = !canManage;
                input.dataset.lockedByPermission = canManage ? "" : "1";
            });
        }

        selectedCategoryKey() {
            const option = this.field("base", "category")?.selectedOptions?.[0];
            return String(option?.dataset?.categoryKey || "").trim();
        }

        captureSpecValues() {
            this.form.querySelectorAll('[data-group="spec"][data-field]').forEach((el) => {
                this.specValues[el.dataset.field] = String(el.value ?? "");
            });
        }

        async loadSpecForms() {
            // 카테고리·스펙 폼을 바꿔도 이미 입력한 값은 항목 id 기준으로 유지
            this.captureSpecValues();
            const categoryKey = this.selectedCategoryKey();
            let forms = [];
            if (categoryKey && !["software", "license"].includes(categoryKey)) {
                if (!this.specFormCache.has(categoryKey)) {
                    const response = await fetch(`/itma/spec-forms?category=${encodeURIComponent(categoryKey)}`, { headers: { Accept: "application/json" } });
                    const data = await response.json();
                    if (!response.ok || !data.success) throw new Error(data.message || "상세 스펙 폼을 불러오지 못했습니다.");
                    this.specFormCache.set(categoryKey, Array.isArray(data.forms) ? data.forms : []);
                }
                forms = this.specFormCache.get(categoryKey).filter((form) => Array.isArray(form.items) && form.items.length);
            }
            this.specForms = forms;
            if (!forms.some((form) => String(form.id) === String(this.selectedSpecFormId))) {
                this.selectedSpecFormId = this.defaultSpecFormId(forms);
            }
            this.renderSpecFields();
        }

        savedSpecFormId(forms) {
            // 저장된 값이 가장 많은 폼 = 이 자산이 사용 중인 폼
            let best = "";
            let bestCount = 0;
            forms.forEach((form) => {
                const count = form.items.filter((item) => String(this.savedSpec[String(item.id)] || "").trim()).length;
                if (count > bestCount) {
                    best = String(form.id);
                    bestCount = count;
                }
            });
            return best;
        }

        defaultSpecFormId(forms) {
            const saved = this.savedSpecFormId(forms);
            if (saved) return saved;
            return forms.length === 1 ? String(forms[0].id) : "";
        }

        renderSpecFields() {
            const section = document.getElementById("itmaFormSpecSection");
            const wrap = document.getElementById("itmaFormSpecFields");
            if (!section || !wrap) return;
            const forms = this.specForms || [];
            section.classList.toggle("d-none", !forms.length);
            const selected = forms.find((form) => String(form.id) === String(this.selectedSpecFormId)) || null;
            const savedFormId = this.savedSpecFormId(forms);
            const hasSavedValues = Object.values(this.savedSpec || {}).some((value) => String(value || "").trim());
            // 다른 폼으로 바꾸면 저장 시 이전 폼 값이 삭제됨을 안내
            const savedForm = forms.find((form) => String(form.id) === savedFormId);
            const showWarning = selected && hasSavedValues && String(selected.id) !== savedFormId;
            const warningText = savedForm
                ? `저장하면 기존 스펙 폼 '${savedForm.form_name || ""}'에 입력된 값은 삭제됩니다.`
                : "저장하면 이 자산에 입력되어 있던 기존 스펙 값은 삭제됩니다.";
            const options = ['<option value="">스펙 폼 선택</option>'].concat(forms.map((form) => (
                `<option value="${escapeHtml(String(form.id))}"${selected && String(form.id) === String(selected.id) ? " selected" : ""}>${escapeHtml(form.form_name || "")}</option>`
            )));
            wrap.innerHTML = `
                <div class="itma-form-spec-toolbar">
                    <label class="form-label mb-0" for="itmaFormSpecFormSelect">스펙 폼</label>
                    <select class="form-select form-select-sm" id="itmaFormSpecFormSelect">${options.join("")}</select>
                </div>
                <div class="alert alert-warning py-1 px-2 small mt-2 mb-0${showWarning ? "" : " d-none"}" role="status"><i class="bi bi-exclamation-triangle"></i> ${escapeHtml(warningText)}</div>
                ${selected ? `
                <div class="row g-3 mt-1">
                    ${selected.items.map((item) => {
                        const id = escapeHtml(String(item.id));
                        return `
                        <div class="col-md-4">
                            <label class="form-label" for="s_${id}">${escapeHtml(item.label)}</label>
                            <input class="form-control" id="s_${id}" data-group="spec" data-field="${id}" maxlength="500" value="${escapeHtml(this.specValues[String(item.id)] ?? "")}" placeholder="${escapeHtml(item.value || "")}">
                        </div>`;
                    }).join("")}
                </div>` : '<p class="small text-muted mt-2 mb-0">사용할 스펙 폼을 선택하면 항목이 표시됩니다.</p>'}
            `;
            const select = document.getElementById("itmaFormSpecFormSelect");
            select?.addEventListener("change", () => {
                this.captureSpecValues();
                this.selectedSpecFormId = select.value;
                this.renderSpecFields();
            });
            if (!this.canEdit) {
                wrap.querySelectorAll("input, select").forEach((el) => { el.disabled = true; });
            }
        }

        setUsageDefault() {
            const usageSelect = this.field("base", "usage_status");
            if (usageSelect && !usageSelect.value) usageSelect.value = "사용";
            const categorySelect = this.field("base", "category");
            const editable = Array.from(categorySelect?.options || []).filter((option) => option.value && !option.disabled);
            if (categorySelect && editable.length === 1) categorySelect.value = editable[0].value;
        }

        async loadAsset() {
            const response = await fetch(`/itma/assets/${this.assetId}/form-data`, { headers: { Accept: "application/json" } });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.message || "자산 정보를 불러오지 못했습니다.");
            const item = data.item || {};
            this.canEdit = !!data.can_edit;

            const categorySelect = this.field("base", "category");
            const currentCategory = String(item.base?.category || "");
            if (categorySelect && currentCategory && !Array.from(categorySelect.options).some((option) => option.value === currentCategory)) {
                const option = document.createElement("option");
                option.value = currentCategory;
                option.textContent = `${currentCategory} (등록되지 않은 카테고리)`;
                categorySelect.appendChild(option);
            }
            Object.entries(item.base || {}).forEach(([name, value]) => {
                const el = this.field("base", name);
                if (el) el.value = value ?? "";
            });
            Object.entries(item.details || {}).forEach(([name, value]) => {
                const el = this.field("details", name);
                if (el) el.value = value ?? "";
            });
            Object.entries(item.custom || {}).forEach(([name, value]) => {
                const el = this.field("custom", name);
                if (el) el.value = value ?? "";
            });
            this.savedSpec = { ...(item.spec || {}) };
            this.specValues = { ...this.savedSpec };
            this.form.querySelectorAll('[data-group="spec"][data-field]').forEach((el) => {
                el.value = this.specValues[el.dataset.field] ?? "";
            });

            const codeBadge = document.getElementById("itmaFormAssetCode");
            if (codeBadge && item.asset_code) {
                codeBadge.textContent = item.asset_code;
                codeBadge.classList.remove("d-none");
            }
            const meta = document.getElementById("itmaFormMeta");
            if (meta) {
                meta.textContent = `등록 ${item.input_at || "-"}  ·  최종 수정 ${item.updated_at || "-"} (${item.updated_by || "-"})`;
            }
        }

        applyEditMode() {
            const readonly = !this.canEdit;
            document.getElementById("itmaFormReadonlyNotice")?.classList.toggle("d-none", !readonly);
            this.form.querySelectorAll("input, select, textarea").forEach((el) => {
                if (readonly) {
                    el.disabled = true;
                } else if (el.dataset.lockedByPermission !== "1") {
                    el.disabled = false;
                }
            });
            ["btnItmaFormSave", "btnItmaFormSaveList"].forEach((id) => {
                document.getElementById(id)?.classList.toggle("d-none", readonly);
            });
            const cancel = document.getElementById("btnItmaFormCancel");
            if (cancel) cancel.textContent = readonly ? "목록으로" : "취소";
            if (readonly) {
                const title = document.getElementById("itmaFormTitle");
                if (title) title.textContent = "자산 조회";
            }
        }

        collect() {
            const payload = { id: this.assetId, base: {}, details: {}, custom: {}, spec: {} };
            this.form.querySelectorAll("[data-group][data-field]").forEach((el) => {
                const group = el.dataset.group;
                if (group === "custom" && el.disabled) return;
                payload[group][el.dataset.field] = String(el.value ?? "").trim();
            });
            payload.spec_form_id = this.specForms.length ? (this.selectedSpecFormId || null) : null;
            return payload;
        }

        snapshot() {
            return JSON.stringify(this.collect());
        }

        isDirty() {
            return !this.saving && this.canEdit && this.initialSnapshot !== "" && this.snapshot() !== this.initialSnapshot;
        }

        async leave(url) {
            if (this.isDirty()) {
                const ok = typeof window.confirmAction === "function"
                    ? await window.confirmAction("저장하지 않은 변경 내용이 있습니다. 저장하지 않고 나가시겠습니까?", { title: "변경 내용 확인", confirmText: "나가기", variant: "warning" })
                    : window.confirm("저장하지 않은 변경 내용이 있습니다. 저장하지 않고 나가시겠습니까?");
                if (!ok) return;
            }
            this.initialSnapshot = "";
            window.location.href = url;
        }

        clearFieldError(el) {
            if (!el?.classList?.contains("is-invalid")) return;
            el.classList.remove("is-invalid");
        }

        markFieldError(fieldName, message) {
            const target = this.field("base", fieldName) || this.field("details", fieldName);
            if (!target) return;
            target.classList.add("is-invalid");
            const feedback = target.parentElement?.querySelector(".invalid-feedback");
            if (feedback) feedback.textContent = message;
            target.focus();
        }

        showError(message) {
            const box = document.getElementById("itmaFormError");
            if (!box) return;
            box.textContent = message;
            box.classList.toggle("d-none", !message);
        }

        setBusy(busy) {
            this.saving = busy;
            ["btnItmaFormSave", "btnItmaFormSaveList"].forEach((id) => {
                const btn = document.getElementById(id);
                if (btn) btn.disabled = busy;
            });
        }

        async save(goToList) {
            if (this.saving || !this.canEdit) return;
            this.showError("");
            this.form.querySelectorAll(".is-invalid").forEach((el) => el.classList.remove("is-invalid"));
            const payload = this.collect();
            if (!payload.base.category) {
                this.markFieldError("category", "카테고리를 선택해주세요.");
                return;
            }
            this.setBusy(true);
            try {
                const response = await fetch("/itma/assets/save", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Accept: "application/json" },
                    body: JSON.stringify(payload),
                });
                const data = await response.json();
                if (!response.ok || !data.success) {
                    if (data.field) this.markFieldError(data.field, data.message || "입력값을 확인해주세요.");
                    throw new Error(data.message || "저장하지 못했습니다.");
                }
                this.initialSnapshot = "";
                const message = data.message || "저장했습니다.";
                if (goToList) {
                    try { window.sessionStorage.setItem(FLASH_KEY, message); } catch (_e) { /* 무시 */ }
                    window.location.href = LIST_URL;
                    return;
                }
                if (data.created) {
                    try { window.sessionStorage.setItem(FLASH_KEY, message); } catch (_e) { /* 무시 */ }
                    window.location.href = `/itma/assets/${data.id}/edit`;
                    return;
                }
                toast(message, "success");
                await this.loadAsset();
                // 저장된 값 기준으로 스펙 영역 다시 표시 (폼 변경 안내 해제)
                this.renderSpecFields();
                this.initialSnapshot = this.snapshot();
            } catch (error) {
                this.showError(error.message);
            } finally {
                this.setBusy(false);
            }
        }
    }

    document.addEventListener("DOMContentLoaded", () => {
        new ItmaAssetForm().init();
    });
})();
