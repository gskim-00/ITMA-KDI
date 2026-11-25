(function () {
    const state = {
        category: "hardware",
        categories: [],
        forms: [],
        selectedId: null,
        categoryOrderSaving: false,
        draggedCategory: null,
    };

    document.addEventListener("DOMContentLoaded", () => {
        const form = document.getElementById("specFormManageForm");
        if (!form) return;
        ["specFormCategoryFilter", "categoryDeleteSelect"].forEach((id) => {
            document.getElementById(id)?.addEventListener("change", async (e) => {
                state.category = String(e.target.value || "");
                state.selectedId = null;
                renderCategoryOptions();
                syncCurrentCategoryLabel();
                await loadSpecForms();
            });
        });
        document.getElementById("btnCategoryDelete")?.addEventListener("click", deleteCurrentCategory);
        const categoryList = document.getElementById("categoryManageList");
        categoryList?.addEventListener("click", handleCategoryListClick);
        categoryList?.addEventListener("dragstart", handleCategoryDragStart);
        categoryList?.addEventListener("dragover", handleCategoryDragOver);
        categoryList?.addEventListener("drop", handleCategoryDrop);
        categoryList?.addEventListener("dragend", clearCategoryDrag);
        document.getElementById("categoryAddForm")?.addEventListener("submit", submitCategoryAdd);
        document.getElementById("btnSpecFormCreate")?.addEventListener("click", () => resetSpecFormEditor());
        document.getElementById("btnSpecFormReset")?.addEventListener("click", () => resetSpecFormEditor());
        document.getElementById("btnSpecFormItemAdd")?.addEventListener("click", () => addEditorItemRow());
        getSpecFormDeleteButtons().forEach((button) => {
            button.addEventListener("click", () => deleteCurrentSpecForm());
        });
        document.getElementById("specFormItemsBody")?.addEventListener("click", handleEditorTableClick);
        form.addEventListener("submit", submitSpecForm);
        loadCategories();
    });

    async function loadCategories(selectedCategoryKey = state.category) {
        const filterEl = document.getElementById("specFormCategoryFilter");
        const deleteSelect = document.getElementById("categoryDeleteSelect");
        if (deleteSelect) deleteSelect.disabled = true;
        const deleteButton = document.getElementById("btnCategoryDelete");
        if (deleteButton) deleteButton.disabled = true;
        if (filterEl) {
            filterEl.disabled = true;
            filterEl.innerHTML = '<option value="">카테고리를 불러오는 중입니다...</option>';
        }
        try {
            const response = await fetch("/itma/categories", { headers: { Accept: "application/json" } });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.message || "카테고리 조회 실패");
            }
            state.categories = Array.isArray(data.categories) ? data.categories : [];
            if (!state.categories.length) {
                state.category = "";
                state.forms = [];
                renderCategoryOptions();
                resetSpecFormEditor();
                return;
            }
            const selected = state.categories.find((category) => category.category_key === selectedCategoryKey)
                || state.categories[0];
            state.category = String(selected.category_key);
            renderCategoryOptions();
            syncCurrentCategoryLabel();
            await loadSpecForms();
        } catch (error) {
            const categoryList = document.getElementById("categoryManageList");
            if (categoryList) categoryList.innerHTML = `<div class="text-danger small p-3">${escapeHtml(error.message)}</div>`;
            if (filterEl) {
                filterEl.innerHTML = `<option value="">${escapeHtml(error.message)}</option>`;
            }
            const listEl = document.getElementById("specFormList");
            if (listEl) {
                listEl.innerHTML = `<div class="text-danger small">${escapeHtml(error.message)}</div>`;
            }
        } finally {
            if (filterEl) filterEl.disabled = !state.categories.length;
            if (deleteSelect) deleteSelect.disabled = !state.categories.length;
            syncCurrentCategoryLabel();
        }
    }

    async function moveCurrentCategory(direction, categoryKey = state.category) {
        if (state.categoryOrderSaving) return;
        const index = state.categories.findIndex((item) => item.category_key === categoryKey);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= state.categories.length) return;
        const reordered = [...state.categories];
        [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
        await saveCategoryOrder(reordered);
    }

    async function saveCategoryOrder(reordered) {
        if (state.categoryOrderSaving) return;
        state.categoryOrderSaving = true;
        renderCategoryList();
        syncCurrentCategoryLabel();
        try {
            const response = await fetch("/itma/categories/reorder", {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json", "X-CSRF-Token": window.adminCsrfToken || "" },
                body: JSON.stringify({ order: reordered.map((item) => item.category_key) }),
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.message || "카테고리 순서 저장 실패");
            state.categories = reordered;
            renderCategoryOptions();
            window.showToast?.("카테고리 순서가 저장되었습니다.", "success");
        } catch (error) {
            window.showToast?.(error.message || "카테고리 순서 저장 실패");
        } finally {
            state.categoryOrderSaving = false;
            renderCategoryList();
            syncCurrentCategoryLabel();
        }
    }

    async function deleteCurrentCategory(categoryKey = state.category) {
        if (state.categoryOrderSaving) return;
        const category = state.categories.find((item) => item.category_key === categoryKey);
        if (!category) return;
        if (!confirm(`"${category.display_name}" 카테고리를 삭제하시겠습니까? 연결된 자산이나 스펙 폼이 있으면 삭제할 수 없습니다.`)) return;
        state.categoryOrderSaving = true;
        renderCategoryList();
        const button = document.getElementById("btnCategoryDelete");
        if (button) button.disabled = true;
        try {
            const response = await fetch(`/itma/categories/${encodeURIComponent(category.category_key)}`, {
                method: "DELETE",
                headers: { Accept: "application/json", "X-CSRF-Token": window.adminCsrfToken || "" },
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.message || "카테고리 삭제 실패");
            state.selectedId = null;
            await loadCategories();
            window.showToast?.("카테고리가 삭제되었습니다.", "success");
        } catch (error) {
            window.showToast?.(error.message || "카테고리 삭제 실패");
        } finally {
            state.categoryOrderSaving = false;
            renderCategoryList();
            syncCurrentCategoryLabel();
        }
    }

    function renderCategoryOptions() {
        const options = state.categories.map((category) => `
            <option value="${escapeHtml(category.category_key || "")}">${escapeHtml(category.display_name || category.category_key || "")}</option>
        `).join("") || '<option value="">카테고리를 추가해주세요.</option>';
        ["specFormCategoryFilter", "categoryDeleteSelect"].forEach((id) => {
            const select = document.getElementById(id);
            if (!select) return;
            select.innerHTML = options;
            select.value = state.category;
        });
        renderCategoryList();
    }

    function renderCategoryList() {
        const list = document.getElementById("categoryManageList");
        if (!list) return;
        const disabled = state.categoryOrderSaving ? "disabled" : "";
        list.innerHTML = state.categories.map((category, index) => {
            const selected = category.category_key === state.category;
            const name = escapeHtml(category.display_name);
            return `<div class="list-group-item category-manage-row ${selected ? "is-selected" : ""}" data-category-key="${escapeHtml(category.category_key)}">
                <span class="category-drag-handle" draggable="${!state.categoryOrderSaving}" title="드래그하여 순서 변경" aria-label="${name} 순서 변경 손잡이"><i class="bi bi-grip-vertical" aria-hidden="true"></i></span>
                <span class="category-order-number">${index + 1}</span>
                <button type="button" class="category-select-button" data-category-action="select" aria-pressed="${selected}" ${disabled}>${name}${selected ? '<span class="badge bg-primary ms-2">선택됨</span>' : ""}</button>
                <div class="category-row-actions">
                    <button type="button" class="btn btn-outline-secondary" data-category-action="up" title="위로 이동" aria-label="${name} 위로 이동" ${index === 0 ? "disabled" : disabled}><i class="bi bi-caret-up-fill" aria-hidden="true"></i></button>
                    <button type="button" class="btn btn-outline-secondary" data-category-action="down" title="아래로 이동" aria-label="${name} 아래로 이동" ${index === state.categories.length - 1 ? "disabled" : disabled}><i class="bi bi-caret-down-fill" aria-hidden="true"></i></button>
                    <button type="button" class="btn btn-outline-danger" data-category-action="delete" title="카테고리 삭제" aria-label="${name} 삭제" ${disabled}><i class="bi bi-trash" aria-hidden="true"></i></button>
                </div>
            </div>`;
        }).join("") || '<div class="text-muted small p-3">등록된 카테고리가 없습니다. 새 카테고리를 생성해주세요.</div>';
        const status = document.getElementById("categoryOrderStatus");
        if (status) status.textContent = state.categoryOrderSaving ? "순서 저장 중..." : `총 ${state.categories.length}개 · 자동 저장`;
    }

    async function handleCategoryListClick(event) {
        const button = event.target.closest("[data-category-action]");
        if (!button || button.disabled || state.categoryOrderSaving) return;
        const key = button.closest("[data-category-key]")?.dataset.categoryKey;
        if (!key) return;
        const action = button.dataset.categoryAction;
        if (action === "up" || action === "down") return moveCurrentCategory(action === "up" ? -1 : 1, key);
        if (action === "delete") return deleteCurrentCategory(key);
        state.category = key;
        state.selectedId = null;
        renderCategoryOptions();
        syncCurrentCategoryLabel();
        await loadSpecForms();
    }

    function handleCategoryDragStart(event) {
        const handle = event.target.closest(".category-drag-handle");
        if (!handle || state.categoryOrderSaving) { event.preventDefault(); return; }
        const row = handle.closest("[data-category-key]");
        state.draggedCategory = row.dataset.categoryKey;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", state.draggedCategory);
        row.classList.add("is-dragging");
    }

    function handleCategoryDragOver(event) {
        const row = event.target.closest("[data-category-key]");
        if (!row || !state.draggedCategory || state.categoryOrderSaving) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        document.querySelectorAll("#categoryManageList .is-drop-target").forEach((element) => element.classList.remove("is-drop-target"));
        row.classList.add("is-drop-target");
    }

    async function handleCategoryDrop(event) {
        const row = event.target.closest("[data-category-key]");
        const sourceKey = state.draggedCategory;
        if (!row || !sourceKey || state.categoryOrderSaving) return;
        event.preventDefault();
        const targetKey = row.dataset.categoryKey;
        const placeAfter = event.clientY >= row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
        clearCategoryDrag();
        if (sourceKey === targetKey) return;
        const moved = state.categories.find((item) => item.category_key === sourceKey);
        const reordered = state.categories.filter((item) => item.category_key !== sourceKey);
        const targetIndex = reordered.findIndex((item) => item.category_key === targetKey);
        if (!moved || targetIndex < 0) return;
        reordered.splice(targetIndex + (placeAfter ? 1 : 0), 0, moved);
        await saveCategoryOrder(reordered);
    }

    function clearCategoryDrag() {
        state.draggedCategory = null;
        document.querySelectorAll("#categoryManageList .is-dragging, #categoryManageList .is-drop-target").forEach((element) => element.classList.remove("is-dragging", "is-drop-target"));
    }

    async function submitCategoryAdd(event) {
        event.preventDefault();
        const input = document.getElementById("categoryAddName");
        const saveButton = document.getElementById("btnCategoryAddSave");
        const displayName = String(input?.value || "").trim();
        if (!displayName) {
            window.showToast?.("카테고리명을 입력해주세요.");
            input?.focus();
            return;
        }
        if (saveButton) saveButton.disabled = true;
        try {
            const response = await fetch("/itma/categories", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "X-CSRF-Token": window.adminCsrfToken || "",
                },
                body: JSON.stringify({ display_name: displayName }),
            });
            const data = await response.json();
            if (!response.ok || !data.success || !data.category?.category_key) {
                throw new Error(data.message || "카테고리 추가 실패");
            }
            document.getElementById("categoryAddForm")?.reset();
            await loadCategories(String(data.category.category_key));
            resetSpecFormEditor();
            window.showToast?.("카테고리가 추가되었습니다.", "success");
        } catch (error) {
            window.showToast?.(error.message || "카테고리 추가 실패");
        } finally {
            if (saveButton) saveButton.disabled = false;
        }
    }

    async function loadSpecForms() {
        const listEl = document.getElementById("specFormList");
        if (listEl) {
            listEl.innerHTML = '<div class="text-muted small">스펙 폼을 불러오는 중입니다...</div>';
        }
        try {
            const response = await fetch(`/itma/spec-forms?category=${encodeURIComponent(state.category)}`, {
                headers: { Accept: "application/json" },
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.message || "스펙 폼 조회 실패");
            }
            state.forms = Array.isArray(data.forms) ? data.forms : [];
            renderSpecFormList();
            if (state.selectedId) {
                const selected = state.forms.find((item) => Number(item.id) === Number(state.selectedId));
                if (selected) {
                    populateEditor(selected);
                    return;
                }
            }
            resetSpecFormEditor(false);
        } catch (error) {
            if (listEl) {
                listEl.innerHTML = `<div class="text-danger small">${escapeHtml(error.message)}</div>`;
            }
        }
    }

    function renderSpecFormList() {
        const listEl = document.getElementById("specFormList");
        if (!listEl) return;
        if (!state.forms.length) {
            listEl.innerHTML = '<div class="text-muted small">등록된 스펙 폼이 없습니다.</div>';
            return;
        }
        listEl.innerHTML = state.forms.map((form) => {
            const activeClass = Number(form.id) === Number(state.selectedId) ? "active" : "";
            return `
                <button type="button" class="list-group-item list-group-item-action ${activeClass}" data-form-id="${form.id}">
                    <div class="fw-semibold">${escapeHtml(form.form_name || "")}</div>
                    <div class="text-muted">${escapeHtml(form.description || "") || "설명 없음"}</div>
                    <div class="small text-muted mt-1">항목 ${Number(form.items_count || 0)}개</div>
                </button>
            `;
        }).join("");
        listEl.querySelectorAll("[data-form-id]").forEach((button) => {
            button.addEventListener("click", () => {
                const form = state.forms.find((item) => Number(item.id) === Number(button.dataset.formId));
                if (!form) return;
                populateEditor(form);
                renderSpecFormList();
            });
        });
    }

    function resetSpecFormEditor(useCurrentCategory = true) {
        state.selectedId = null;
        setValue("specFormId", "");
        setValue("specFormName", "");
        setValue("specFormDescription", "");
        if (useCurrentCategory) syncCurrentCategoryLabel();
        document.getElementById("specFormTitle").textContent = "스펙 폼 상세";
        setSpecFormDeleteVisible(false);
        renderEditorItems([{ label: "", show_in_list: false }]);
        renderSpecFormList();
    }

    function populateEditor(form) {
        state.selectedId = Number(form.id);
        setValue("specFormId", String(form.id));
        state.category = String(form.category_key || state.category || "hardware");
        const filterEl = document.getElementById("specFormCategoryFilter");
        if (filterEl) filterEl.value = state.category;
        syncCurrentCategoryLabel();
        setValue("specFormName", form.form_name || "");
        setValue("specFormDescription", form.description || "");
        document.getElementById("specFormTitle").textContent = `스펙 폼 상세 - ${form.form_name || ""}`;
        setSpecFormDeleteVisible(true);
        renderEditorItems(Array.isArray(form.items) && form.items.length ? form.items : [{ label: "", show_in_list: false }]);
    }

    function renderEditorItems(items) {
        const body = document.getElementById("specFormItemsBody");
        if (!body) return;
        const rows = Array.isArray(items) && items.length ? items : [{ label: "", show_in_list: false }];
        body.innerHTML = rows.map((item, idx) => `
            <tr>
                <td><input type="text" class="form-control form-control-sm spec-form-item-label" data-index="${idx}"${item.id ? ` data-item-id="${Number(item.id)}"` : ""} value="${escapeHtml(item.label || "")}" placeholder="예: CPU"></td>
                <td class="text-center">
                    <div class="form-check d-inline-flex justify-content-center mb-0">
                        <input type="checkbox" class="form-check-input spec-form-item-show-in-list" data-index="${idx}" ${item.show_in_list === true ? "checked" : ""} aria-label="${escapeHtml(item.label || "스펙 항목")} 메인 목록 표시">
                    </div>
                </td>
                <td class="text-center"><button type="button" class="btn btn-sm btn-outline-danger itma-spec-del" data-index="${idx}" aria-label="삭제"><i class="bi bi-x-lg"></i></button></td>
            </tr>
        `).join("");
    }

    function collectEditorItems() {
        return readEditorItems(false);
    }

    function readEditorItems(includeEmpty) {
        const rows = [];
        document.querySelectorAll("#specFormItemsBody tr").forEach((rowEl, idx) => {
            const label = String(rowEl.querySelector(".spec-form-item-label")?.value || "").trim();
            if (!label && !includeEmpty) return;
            const id = rowEl.querySelector(".spec-form-item-label")?.dataset.itemId;
            const showInList = rowEl.querySelector(".spec-form-item-show-in-list")?.checked === true;
            rows.push({
                ...(id ? { id: Number(id) } : {}),
                label,
                value: "",
                display_order: idx,
                show_in_list: showInList,
            });
        });
        return rows;
    }

    function addEditorItemRow() {
        const rows = collectEditorItems();
        rows.push({ label: "", value: "", display_order: rows.length, show_in_list: false });
        renderEditorItems(rows);
    }

    function handleEditorTableClick(event) {
        const delBtn = event.target.closest("#specFormItemsBody .itma-spec-del");
        if (!delBtn) return;
        const index = Number(delBtn.dataset.index || -1);
        const rows = readEditorItems(true).filter((_, idx) => idx !== index);
        renderEditorItems(rows.length ? rows : [{ label: "", show_in_list: false }]);
    }

    async function submitSpecForm(event) {
        event.preventDefault();
        const items = collectEditorItems();
        if (!items.length) {
            window.showToast?.("최소 1개의 스펙 항목을 입력해주세요.");
            return;
        }
        // 기존 항목을 뺀 경우: 그 항목에 입력된 자산 값도 함께 삭제됨을 확인
        const currentForm = state.forms.find((form) => Number(form.id) === Number(getValue("specFormId")));
        const keptIds = new Set(items.map((item) => Number(item.id)).filter(Boolean));
        const removedLabels = (currentForm?.items || []).filter((item) => !keptIds.has(Number(item.id))).map((item) => item.label);
        if (removedLabels.length && !confirm(`삭제한 항목(${removedLabels.join(", ")})에 입력된 자산 값도 함께 삭제되며 되돌릴 수 없습니다.\n저장하시겠습니까?`)) return;
        try {
            const response = await fetch("/itma/spec-forms", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "X-CSRF-Token": window.adminCsrfToken || "",
                },
                body: JSON.stringify({
                    id: getValue("specFormId") || null,
                    category_key: state.category,
                    form_name: getValue("specFormName").trim(),
                    description: getValue("specFormDescription").trim(),
                    items,
                }),
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.message || "스펙 폼 저장 실패");
            }
            state.selectedId = data.form?.id || null;
            document.getElementById("specFormCategoryFilter").value = state.category;
            syncCurrentCategoryLabel();
            window.showToast?.(data.message || "스펙 폼이 저장되었습니다.", "success");
            await loadSpecForms();
        } catch (error) {
            window.showToast?.(error.message || "스펙 폼 저장 실패");
        }
    }

    async function deleteCurrentSpecForm() {
        const formId = getValue("specFormId");
        if (!formId) return;
        if (!confirm("선택한 스펙 폼을 삭제하시겠습니까?\n이 폼 항목에 입력된 자산 값도 함께 삭제되며 되돌릴 수 없습니다.")) return;
        try {
            const response = await fetch(`/itma/spec-forms/${encodeURIComponent(formId)}`, {
                method: "DELETE",
                headers: {
                    "Accept": "application/json",
                    "X-CSRF-Token": window.adminCsrfToken || "",
                },
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.message || "스펙 폼 삭제 실패");
            }
            window.showToast?.(data.message || "스펙 폼이 삭제되었습니다.", "success");
            await loadSpecForms();
        } catch (error) {
            window.showToast?.(error.message || "스펙 폼 삭제 실패");
        }
    }

    function getSpecFormDeleteButtons() {
        return [
            document.getElementById("btnSpecFormDelete"),
            document.getElementById("btnSpecFormDeleteFooter"),
        ].filter(Boolean);
    }

    function setSpecFormDeleteVisible(isVisible) {
        getSpecFormDeleteButtons().forEach((button) => {
            button.classList.toggle("d-none", !isVisible);
        });
    }

    function setValue(id, value) {
        const el = document.getElementById(id);
        if (el) el.value = value;
    }

    function syncCurrentCategoryLabel() {
        const categoryIndex = state.categories.findIndex((item) => item.category_key === state.category);
        const moveUp = document.getElementById("btnCategoryMoveUp");
        const moveDown = document.getElementById("btnCategoryMoveDown");
        if (moveUp) moveUp.disabled = state.categoryOrderSaving || categoryIndex <= 0;
        if (moveDown) moveDown.disabled = state.categoryOrderSaving || categoryIndex < 0 || categoryIndex >= state.categories.length - 1;
        const categorySelect = document.getElementById("categoryDeleteSelect");
        if (categorySelect) categorySelect.disabled = state.categoryOrderSaving || !state.categories.length;
        const addButton = document.getElementById("btnCategoryAddSave");
        if (addButton) addButton.disabled = state.categoryOrderSaving;
        const hasCategory = state.categories.some((item) => item.category_key === state.category);
        const createButton = document.getElementById("btnSpecFormCreate");
        if (createButton) createButton.disabled = !hasCategory;
        const editor = document.getElementById("specFormManageForm");
        editor?.querySelectorAll("input, textarea, button").forEach((element) => { element.disabled = !hasCategory; });
        const deleteButton = document.getElementById("btnCategoryDelete");
        const selectedCategory = state.categories.find((item) => item.category_key === state.category);
        if (deleteButton) {
            deleteButton.disabled = state.categoryOrderSaving || !selectedCategory;
            deleteButton.title = "선택한 카테고리 삭제";
        }
        const labelEl = document.getElementById("specFormCurrentCategoryLabel");
        if (!labelEl) return;
        const category = state.categories.find((item) => item.category_key === state.category);
        labelEl.textContent = category?.display_name || state.category || "-";
    }

    function getValue(id) {
        return String(document.getElementById(id)?.value || "");
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }
})();
