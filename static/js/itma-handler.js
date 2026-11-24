function itmaEscapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}


class ItmaHandler {
    constructor() {
        this.tableBody = document.getElementById("itmaTableBody");
        this.allItems = [];
        this.filteredItems = [];
        this.currentPage = 1;
        this.rowsPerPage = localStorage.getItem("itmaRowsPerPage") || "30";
        this.sortColumn = null;
        this.sortDirection = "asc";
        this.selectedIds = new Set();
        this.currentFilters = {};
        this.filterPanelVisible = false;
        this.currentPageItemIds = [];
        this.dropdownFilterColumns = ["category", "site", "manufacturer", "item_name", "storage_location", "updated_by"];
        // 선택형 필터는 부분 일치가 아닌 정확히 일치로 비교 (예: '사용' 선택 시 '미사용' 제외)
        this.exactFilterColumns = new Set(["category", "site", "manufacturer", "item_name", "storage_location", "updated_by", "usage_status"]);
        this.usageStatusOptions = ["정상", "사용", "미사용", "교체", "폐기"];
        this.siteFilter = "";
        this.siteNoneKey = "__none__";
        this.memoColumns = new Set(["inbound_note", "outbound_note", "detail_note"]);
        this.editableColumns = new Set([
            "category",
            "asset_id",
            "manufacturer",
            "item_name",
            "received_date",
            "inbound_note",
            "released_date",
            "outbound_note",
            "storage_location",
            "detail_note",
            "sales_rep",
            "usage_status",
            "manufacture_month"
        ]);
        this.dateColumns = new Set(["received_date", "released_date"]);
        this.monthColumns = new Set(["manufacture_month"]);
        this.dateSortColumns = new Set(["received_date", "released_date", "manufacture_month", "updated_at", "input_at"]);
        this.serverTimeTimer = null;
        this.durabilityModalAutoShown = false;
        this.durabilityConfig = this.loadDurabilityConfig();
        this.durabilitySnoozeStorageKey = "itmaDurabilitySnoozeUntil";
        this.historyItems = [];
        this.usageStatusMonthMap = this.loadUsageStatusMonthMap();
        this.globalSearchKeyword = "";
        this.detailCurrentAssetId = null;
        this.detailEquipmentChanges = [];
        this.detailSecurityChanges = [];
        this.detailChanges = [];
        this.detailDeliveryChanges = [];
        this.detailSoftwareItems = [];
        this.detailLicenseItems = [];
        this.detailSpecItems = [];
        this.specForms = [];
        this.detailCurrentCategory = "";
        this.currentUsername = this.getCurrentUsername();
        this.columnLegendStorageKey = this.makeUserStorageKey("itma_column_legend_state_v1");
        this.customColumnDefsStorageKey = this.makeUserStorageKey("itma_custom_column_defs_v1");
        this.columnWidthStorageKey = this.makeUserStorageKey("itma_column_width_state_v1");
        // 번호·관리(상세정보/수정 버튼) 컬럼은 항상 맨 앞에 고정
        this.fixedColumnKeys = new Set(["row_no", "actions"]);
        this.requiredVisibleColumnKeys = new Set(["row_no", "actions", "category", "asset_id"]);
        this.columnMinWidthMap = {
            row_no: 70,
            actions: 150,
            site: 110,
            category: 140,
            asset_id: 170,
            manufacturer: 140,
            item_name: 150,
            usage_status: 90,
            updated_at: 150,
            updated_by: 130,
            received_date: 90,
            released_date: 90,
            manufacture_month: 90,
        };
        this.baseColumnDefinitions = [
            { key: "row_no", label: "번호" },
            { key: "actions", label: "관리" },
            { key: "category", label: "카테고리" },
            { key: "site", label: "사업장" },
            { key: "asset_id", label: "자산번호" },
            { key: "manufacturer", label: "제조사" },
            { key: "item_name", label: "품명" },
            { key: "received_date", label: "입고일" },
            { key: "inbound_note", label: "입고 메모" },
            { key: "released_date", label: "출고일" },
            { key: "outbound_note", label: "출고 메모" },
            { key: "storage_location", label: "보관 위치" },
            { key: "detail_note", label: "상세 메모" },
            { key: "sales_rep", label: "담당자" },
            { key: "usage_status", label: "운영상태" },
            { key: "manufacture_month", label: "제조년월" },
            { key: "updated_at", label: "수정 일시" },
            { key: "updated_by", label: "수정자" },
        ];
        this.customColumnDefinitions = this.loadCustomColumnDefinitions();
        this.customColumnValues = this.loadCustomColumnValues();
        this.detailColumnDefinitions = [];
        this.detailColumnValues = {};
        this.specColumnDefinitions = [];
        this.specColumnValues = {};
        this.categories = [];
        this.hasLoadedServerColumnDefinitions = false;
        this.columnLegendState = this.loadColumnLegendState();
        this.columnWidthState = this.loadColumnWidthState();
        this.smartSuggestColumns = new Set(["category", "manufacturer", "item_name", "storage_location", "sales_rep"]);
        this.smartSuggestIndex = {
            category: new Set(),
            manufacturer: new Set(),
            item_name: new Set(),
            storage_location: new Set(),
            sales_rep: new Set(),
        };
        this.smartSuggestPanelEl = null;
        this.smartSuggestActiveInput = null;
        this.smartSuggestItems = [];
        this.smartSuggestFocusIndex = -1;
        this.smartSuggestOpenByKeyboard = false;
        this.smartSuggestPickerContext = null;
        this.permissions = {
            role: "",
            view_categories: [],
            edit_categories: [],
            can_edit_all: false,
            can_manage_columns: false,
            ...(window.itmaInitialPermissions || {}),
        };
    }


    init() {
        if (!this.tableBody) return;


        const rowsPerPageEl = document.getElementById("itmaRowsPerPage");
        if (rowsPerPageEl) rowsPerPageEl.value = this.rowsPerPage;
        const selectPageCheckbox = document.getElementById("itmaSelectPageCheckbox");


        document.getElementById("btnItmaRefresh")?.addEventListener("click", () => this.loadAssets());
        document.getElementById("btnItmaClearFilters")?.addEventListener("click", () => this.clearFilters());
        document.getElementById("btnItmaGlobalSearchApply")?.addEventListener("click", () => this.applyGlobalSearch());
        document.getElementById("btnItmaGlobalSearchReset")?.addEventListener("click", () => this.resetGlobalSearch());
        document.getElementById("itmaGlobalSearchInput")?.addEventListener("keydown", (e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            this.applyGlobalSearch();
        });
        document.getElementById("btnItmaToggleFilters")?.addEventListener("click", () => this.toggleFilterPanel());
        document.getElementById("btnOpenItmaUploadModal")?.addEventListener("click", () => this.openUploadModal());
        document.getElementById("btnItmaUploadConfirm")?.addEventListener("click", () => this.uploadExcel());
        document.getElementById("btnItmaAddRow")?.addEventListener("click", (e) => {
            e.preventDefault();
            if (e.currentTarget.classList.contains("disabled")) return;
            this.createNewRow();
        });
        document.getElementById("btnItmaDeleteSelected")?.addEventListener("click", () => this.deleteSelectedRows());
        document.getElementById("btnItmaSelectAll")?.addEventListener("click", () => this.toggleSelectAllFiltered());
        document.getElementById("btnItmaBulkEdit")?.addEventListener("click", () => this.openBulkEditModal());
        document.getElementById("btnItmaBulkEditApply")?.addEventListener("click", () => this.applyBulkEdit());
        document.getElementById("btnItmaTemplateDownload")?.addEventListener("click", () => {
            window.location.href = "/itma/assets/template-download";
        });
        document.getElementById("btnItmaDownloadAll")?.addEventListener("click", () => {
            window.location.href = "/itma/assets/download";
        });
        document.getElementById("btnItmaDownloadSelected")?.addEventListener("click", () => this.downloadSelected());
        document.getElementById("btnItmaToggleColumnLegend")?.addEventListener("click", () => this.toggleColumnLegendPanel());
        document.getElementById("btnItmaColumnLegendReset")?.addEventListener("click", () => this.resetColumnLegendState());
        document.getElementById("btnItmaColumnShowAll")?.addEventListener("click", () => {
            this.getAllColumnDefinitions().forEach((column) => { this.columnLegendState.visible[column.key] = true; });
            this.saveColumnLegendState(); this.initColumnLegendPanel(); this.applyColumnLayout();
        });
        document.getElementById("btnItmaColumnDefaultView")?.addEventListener("click", () => {
            this.getAllColumnDefinitions().forEach((column) => { this.columnLegendState.visible[column.key] = column.group_key === "base" || this.requiredVisibleColumnKeys.has(column.key); });
            this.saveColumnLegendState(); this.initColumnLegendPanel(); this.applyColumnLayout();
        });
        document.getElementById("itmaColumnLegendSearch")?.addEventListener("input", (event) => {
            const keyword = String(event.target.value || "").trim().toLowerCase();
            document.querySelectorAll(".itma-column-legend-item").forEach((item) => {
                item.style.display = !keyword || item.textContent.toLowerCase().includes(keyword) ? "" : "none";
            });
        });
        document.getElementById("btnItmaColumnAdd")?.addEventListener("click", () => this.openColumnAddModal());
        document.getElementById("btnItmaColumnAddConfirm")?.addEventListener("click", () => this.submitColumnAddModal());
        document.getElementById("itmaNewColumnLabel")?.addEventListener("keydown", (e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            this.submitColumnAddModal();
        });
        document.getElementById("btnOpenItmaDashboard")?.addEventListener("click", () => this.openDashboardModal());
        document.querySelectorAll(".itma-dashboard-open-option").forEach((option) => {
            option.addEventListener("click", (e) => this.handleDashboardOpenOption(e));
        });
        document.getElementById("btnOpenItmaDurability")?.addEventListener("click", () => this.openDurabilityModal(false));
        document.getElementById("btnItmaDurabilityApply")?.addEventListener("click", () => this.applyDurabilityConfigFromModal());
        document.getElementById("btnItmaDurabilitySnooze1d")?.addEventListener("click", () => this.setDurabilitySnoozeDays(1));
        document.getElementById("btnItmaDurabilitySnooze7d")?.addEventListener("click", () => this.setDurabilitySnoozeDays(7));
        document.getElementById("itmaDurabilitySearch")?.addEventListener("input", () => this.refreshDurabilityModalContent());
        document.getElementById("btnOpenItmaHistory")?.addEventListener("click", () => this.openHistoryModal());
        document.getElementById("btnItmaHistoryRefresh")?.addEventListener("click", () => this.loadHistory());
        document.getElementById("itmaHistoryChangedSearch")?.addEventListener("input", () => this.renderHistoryModalContent());
        document.getElementById("itmaHistoryDeletedSearch")?.addEventListener("input", () => this.renderHistoryModalContent());
        document.getElementById("btnItmaAssetDetailSave")?.addEventListener("click", () => this.saveAssetDetails("pc"));
        document.getElementById("btnItmaAssetSoftwareSave")?.addEventListener("click", () => this.saveAssetDetails("software"));
        document.getElementById("btnItmaAssetLicenseSave")?.addEventListener("click", () => this.saveAssetDetails("license"));
        document.getElementById("btnItmaDetailAddEquipment")?.addEventListener("click", () => this.addAssetDetailEquipmentRowFromInputs());
        document.getElementById("btnItmaDetailAddSecurity")?.addEventListener("click", () => this.addAssetDetailSecurityRowFromInputs());
        document.getElementById("btnItmaDetailAddChange")?.addEventListener("click", () => this.addAssetDetailChangeRowFromInputs());
        document.getElementById("btnItmaDetailAddDelivery")?.addEventListener("click", () => this.addAssetDetailDeliveryRowFromInputs());
        document.getElementById("btnItmaDetailAddSoftware")?.addEventListener("click", () => this.addAssetDetailSoftwareRowFromInputs());
        document.getElementById("btnItmaDetailAddLicense")?.addEventListener("click", () => this.addAssetDetailLicenseRowFromInputs());
        document.getElementById("btnItmaSpecRowAdd")?.addEventListener("click", () => this.addSpecItemRow());
        document.getElementById("btnItmaSpecFormApply")?.addEventListener("click", () => this.applySelectedSpecForm());
        document.getElementById("btnItmaSpecFormSave")?.addEventListener("click", () => this.saveCurrentSpecForm());
        document.getElementById("itmaDetailEquipmentStatusInput")?.addEventListener("change", () => this.syncEquipmentStatusDate());
        document.getElementById("itmaDetailMaintenanceStartDate")?.addEventListener("change", () => this.refreshMaintenanceEndDate());
        document.getElementById("itmaDetailMaintenanceMonths")?.addEventListener("input", () => this.refreshMaintenanceEndDate());
        document.getElementById("itmaDetailMaintenanceMonths")?.addEventListener("click", () => this.refreshMaintenanceEndDate());
        document.getElementById("itmaAssetDetailModal")?.addEventListener("click", (e) => this.handleAssetDetailModalClick(e));
        document.querySelectorAll("#itmaAssetDetailTabs [data-bs-toggle=\"pill\"]").forEach((tab) => {
            tab.addEventListener("shown.bs.tab", (e) => {
                e.target?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
                document.querySelector(e.target?.dataset?.bsTarget || "")?.scrollTo?.({ top: 0 });
            });
        });
        document.getElementById("itmaHistoryModal")?.addEventListener("click", (e) => {
            const btn = e.target.closest(".itma-history-restore-btn");
            if (!btn) return;
            const historyId = Number(btn.dataset.historyId || 0);
            if (!historyId) return;
            this.restoreFromHistory(historyId);
        });


        rowsPerPageEl?.addEventListener("change", (e) => {
            this.rowsPerPage = e.target.value;
            localStorage.setItem("itmaRowsPerPage", this.rowsPerPage);
            this.currentPage = 1;
            this.render();
            this.refreshDurabilityModalContent();
            this.renderHistoryModalContent();
        });
        selectPageCheckbox?.addEventListener("change", (e) => this.toggleSelectCurrentPage(e.target.checked));


        document.querySelectorAll(".itma-filter").forEach((input) => {
            input.addEventListener("input", () => this.applyFiltersAndSort());
            input.addEventListener("change", () => this.applyFiltersAndSort());
        });
        this.initHeaderSortControls();


        this.tableBody.addEventListener("change", (e) => this.handleTableChange(e));
        this.tableBody.addEventListener("click", (e) => this.handleTableClick(e));
        this.tableBody.addEventListener("input", (e) => this.handleTableInput(e));
        this.tableBody.addEventListener("focusin", (e) => this.handleSmartSuggestFocusIn(e));
        this.tableBody.addEventListener("keydown", (e) => this.handleSmartSuggestKeydown(e));
        this.tableBody.addEventListener("dblclick", (e) => this.handleSmartSuggestDblClick(e));
        document.addEventListener("click", (e) => this.handleSmartSuggestDocumentClick(e));
        document.addEventListener("click", (e) => {
            const wrap = document.querySelector(".itma-column-legend-wrap");
            const panel = document.getElementById("itmaColumnLegendPanel");
            const btn = document.getElementById("btnItmaToggleColumnLegend");
            if (!wrap || !panel || panel.classList.contains("d-none")) return;
            if (wrap.contains(e.target)) return;
            panel.classList.add("d-none");
            if (btn) {
                btn.classList.remove("btn-secondary");
                btn.classList.add("btn-outline-secondary");
                btn.setAttribute("aria-expanded", "false");
            }
        });
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape") return;
            const panel = document.getElementById("itmaColumnLegendPanel");
            const btn = document.getElementById("btnItmaToggleColumnLegend");
            if (!panel || panel.classList.contains("d-none")) return;
            panel.classList.add("d-none");
            if (btn) {
                btn.classList.remove("btn-secondary");
                btn.classList.add("btn-outline-secondary");
                btn.setAttribute("aria-expanded", "false");
                btn.focus();
            }
        });
        window.addEventListener("resize", () => this.positionColumnLegendPanel());
        window.addEventListener("scroll", () => this.positionColumnLegendPanel(), { passive: true });


        this.applyInitialQueryFilters();
        document.getElementById("itmaSiteTabs")?.addEventListener("click", (e) => {
            const tab = e.target.closest("[data-site]");
            if (!tab) return;
            this.siteFilter = String(tab.dataset.site || "");
            this.applyFiltersAndSort();
        });
        this.showStoredFlashMessage();

        this.setFilterRowVisibility(this.filterPanelVisible);
        this.updateFilterToggleButton();
        this.syncGlobalSearchInput();
        this.ensureCustomColumnsOnTableStructure();
        this.initColumnLegendPanel();
        this.applyColumnLayout();
        this.loadAssets();
        this.startServerTimeSync();
    }

    // 대시보드에서 넘어온 조회 조건 (?site=대전, ?status=사용)
    applyInitialQueryFilters() {
        const params = new URLSearchParams(window.location.search);
        const site = String(params.get("site") || "").trim();
        if (site) this.siteFilter = site === "미지정" ? this.siteNoneKey : site;
        const status = String(params.get("status") || "").trim();
        if (status && this.usageStatusOptions.includes(status)) {
            const select = document.querySelector('select.itma-filter[data-column="usage_status"]');
            if (select) {
                select.value = status;
                this.filterPanelVisible = true;
            }
        }
    }

    // 추가/수정 화면에서 '저장 후 목록'으로 돌아온 경우 안내
    showStoredFlashMessage() {
        try {
            const message = window.sessionStorage.getItem("itmaFlashMessage");
            if (!message) return;
            window.sessionStorage.removeItem("itmaFlashMessage");
            if (window.notify?.success) window.notify.success(message);
        } catch (_error) {
            // 저장소를 사용할 수 없는 환경은 무시
        }
    }

    getItemSiteKey(item) {
        const site = String(item?.site ?? "").trim();
        return site || this.siteNoneKey;
    }

    renderSiteTabs() {
        const wrap = document.getElementById("itmaSiteTabs");
        if (!wrap) return;
        const counts = new Map();
        this.allItems.forEach((item) => {
            const key = this.getItemSiteKey(item);
            counts.set(key, (counts.get(key) || 0) + 1);
        });
        const siteKeys = [...counts.keys()]
            .filter((key) => key !== this.siteNoneKey)
            .sort((a, b) => a.localeCompare(b, "ko"));
        if (counts.has(this.siteNoneKey)) siteKeys.push(this.siteNoneKey);
        if (this.siteFilter && !counts.has(this.siteFilter)) {
            siteKeys.push(this.siteFilter);
            counts.set(this.siteFilter, 0);
        }
        const tab = (key, label, count) => {
            const active = this.siteFilter === key;
            return `<button type="button" class="itma-site-tab${active ? " active" : ""}" data-site="${itmaEscapeHtml(key)}" role="tab" aria-selected="${active ? "true" : "false"}">
                <span>${itmaEscapeHtml(label)}</span><span class="itma-site-tab-count">${count}</span>
            </button>`;
        };
        wrap.innerHTML = [
            tab("", "전체 사업장", this.allItems.length),
            ...siteKeys.map((key) => tab(key, key === this.siteNoneKey ? "미지정" : key, counts.get(key) || 0)),
        ].join("");
    }

    loadColumnLegendState() {
        const columns = this.getAllColumnDefinitions();
        const defaultVisibility = {};
        const defaultOrder = columns.map((column) => column.key);
        columns.forEach((column) => {
            defaultVisibility[column.key] = true;
        });
        try {
            const raw = localStorage.getItem(this.columnLegendStorageKey);
            if (!raw) {
                return { visible: defaultVisibility, order: defaultOrder };
            }
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object") {
                return { visible: defaultVisibility, order: defaultOrder };
            }
            if (parsed.visible && parsed.order) {
                const visible = { ...defaultVisibility };
                const storedVisible = parsed.visible && typeof parsed.visible === "object" ? parsed.visible : {};
                Object.entries(storedVisible).forEach(([key, value]) => {
                    if (typeof value === "boolean") {
                        visible[key] = value;
                    }
                });
                const storedOrder = Array.isArray(parsed.order) ? parsed.order.map((x) => String(x || "").trim()).filter(Boolean) : [];
                const order = [
                    ...storedOrder,
                    ...defaultOrder.filter((key) => !storedOrder.includes(key)),
                ];
                return { visible, order };
            }
            const visible = { ...defaultVisibility };
            columns.forEach((column) => {
                if (typeof parsed[column.key] === "boolean") {
                    visible[column.key] = parsed[column.key];
                }
            });
            return { visible, order: defaultOrder };
        } catch (_error) {
            return { visible: defaultVisibility, order: defaultOrder };
        }
    }

    getCurrentUsername() {
        const raw = String(document.body?.dataset?.username || "").trim();
        if (!raw) return "anonymous";
        return raw.toLowerCase();
    }

    makeUserStorageKey(baseKey) {
        const base = String(baseKey || "").trim();
        const username = this.getCurrentUsername();
        return `${base}:${username}`;
    }

    saveColumnLegendState() {
        try {
            localStorage.setItem(this.columnLegendStorageKey, JSON.stringify(this.columnLegendState));
        } catch (_error) {
            // Ignore localStorage errors.
        }
    }

    loadCustomColumnDefinitions() {
        try {
            const raw = localStorage.getItem(this.customColumnDefsStorageKey);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed
                .map((row) => ({
                    key: String(row?.key || "").trim(),
                    label: String(row?.label || "").trim(),
                }))
                .filter((row) => row.key && row.label);
        } catch (_error) {
            return [];
        }
    }

    saveCustomColumnDefinitions() {
        try {
            localStorage.setItem(this.customColumnDefsStorageKey, JSON.stringify(this.customColumnDefinitions));
        } catch (_error) {
            // Ignore localStorage errors.
        }
    }

    loadCustomColumnValues() {
        return {};
    }

    saveCustomColumnValues() {
        // 사용자 컬럼 값은 서버 API에 저장합니다.
    }

    loadColumnWidthState() {
        try {
            const raw = localStorage.getItem(this.columnWidthStorageKey);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object") return {};
            const out = {};
            Object.entries(parsed).forEach(([key, val]) => {
                const width = Number(val);
                if (!Number.isFinite(width)) return;
                const colKey = String(key);
                out[colKey] = Math.max(this.getColumnMinWidth(colKey), Math.min(900, Math.round(width)));
            });
            return out;
        } catch (_error) {
            return {};
        }
    }

    saveColumnWidthState() {
        try {
            localStorage.setItem(this.columnWidthStorageKey, JSON.stringify(this.columnWidthState || {}));
        } catch (_error) {
            // Ignore localStorage errors.
        }
    }

    getColumnMinWidth(columnKey) {
        const key = String(columnKey || "").trim();
        if (!key) return 90;
        const label = String(this.getColumnLabel(key) || key).trim();
        const textBased = Math.max(72, Math.round((label.length * 14) + 46));
        const mapped = Number.isFinite(this.columnMinWidthMap[key]) ? Number(this.columnMinWidthMap[key]) : 0;
        if (this.isCustomColumn(key)) return Math.max(120, textBased, mapped);
        if (mapped > 0) return Math.max(mapped, textBased);
        return Math.max(90, textBased);
    }

    getAllColumnDefinitions() {
        return [
            ...this.baseColumnDefinitions.map((column) => ({ ...column, group_key: column.group_key || "base" })),
            ...this.detailColumnDefinitions,
            ...this.specColumnDefinitions,
            ...this.customColumnDefinitions.map((column) => ({ ...column, group_key: "custom" })),
        ];
    }

    isCustomColumn(columnKey) {
        return this.customColumnDefinitions.some((column) => column.key === columnKey);
    }

    isDetailColumn(columnKey) {
        return this.detailColumnDefinitions.some((column) => column.key === columnKey);
    }

    isSpecColumn(columnKey) {
        return this.specColumnDefinitions.some((column) => column.key === columnKey);
    }

    getDetailCellValue(assetId, columnKey) {
        return String(this.detailColumnValues?.[String(assetId)]?.[columnKey] ?? "");
    }

    getSpecCellValue(assetId, columnKey) {
        return String(this.specColumnValues?.[String(assetId)]?.[columnKey] ?? "");
    }

    getColumnLabel(columnKey) {
        const column = this.getAllColumnDefinitions().find((x) => x.key === columnKey);
        return column ? column.label : columnKey;
    }

    initColumnLegendPanel() {
        const listEl = document.getElementById("itmaColumnLegendList");
        if (!listEl) return;
        this.normalizeColumnOrder();
        const allColumns = this.getAllColumnDefinitions();
        const columns = this.columnLegendState.order
            .map((key) => allColumns.find((column) => column.key === key))
            .filter(Boolean);
        const groupLabels = { base: "기본 정보", equipment: "장비 정보", device: "장비 상세", spec: "상세 스펙", custom: "사용자 정의" };
        const groups = columns.reduce((result, column) => {
            const key = column.group_key || (this.isCustomColumn(column.key) ? "custom" : "base");
            (result[key] ||= []).push(column);
            return result;
        }, {});
        const renderItem = (column) => {
            const checked = this.columnLegendState.visible[column.key] !== false ? "checked" : "";
            const isFixed = this.fixedColumnKeys.has(column.key);
            // 사용자 정의 컬럼 삭제 버튼은 컬럼 관리 권한(admin, 편집 권한 있는 manager)에게만 표시
            const deleteBtn = this.isCustomColumn(column.key) && this.permissions?.can_manage_columns
                ? `<button type="button" class="btn btn-sm btn-outline-danger py-0 px-1 itma-column-delete-btn" data-column-key="${column.key}" title="컬럼 삭제">x</button>`
                : `<span class="itma-column-fixed-mark" title="기본 컬럼">-</span>`;
            return `<div class="itma-column-legend-item${isFixed ? " itma-column-legend-fixed" : ""}" draggable="${isFixed ? "false" : "true"}" data-column-key="${column.key}">
                <span class="itma-column-drag-handle" title="${isFixed ? "고정 컬럼" : "드래그로 순서 변경"}">${isFixed ? "+" : "⋮⋮"}</span>
                <label class="d-flex align-items-center gap-1 mb-0">
                    <input type="checkbox" class="form-check-input me-1 itma-column-legend-check" data-column-key="${column.key}" ${checked}>
                    <span>${itmaEscapeHtml(column.label)}</span>
                </label>
                <div class="text-end">${deleteBtn}</div>
            </div>`;
        };
        listEl.innerHTML = ["base", "equipment", "device", "spec", "custom"].filter((groupKey) => groups[groupKey]?.length).map((groupKey) => {
            const groupColumns = groups[groupKey];
            const visibleCount = groupColumns.filter((column) => this.columnLegendState.visible[column.key] !== false).length;
            return `<details class="itma-column-legend-group" open><summary class="itma-column-legend-group-summary"><label onclick="event.stopPropagation()"><input type="checkbox" class="form-check-input itma-column-group-check" data-column-group="${groupKey}" ${visibleCount === groupColumns.length ? "checked" : ""}> ${groupLabels[groupKey]}</label><span>${visibleCount}/${groupColumns.length}</span></summary><div class="itma-column-legend-group-actions"><button type="button" class="btn btn-sm btn-outline-secondary itma-column-group-only" data-column-group="${groupKey}">이 영역만 보기</button></div><div class="itma-column-legend-group-items">${groupColumns.map(renderItem).join("")}</div></details>`;
        }).join("");
        listEl.querySelectorAll(".itma-column-legend-check").forEach((checkbox) => {
            checkbox.addEventListener("change", () => {
                const key = String(checkbox.dataset.columnKey || "").trim();
                if (!key) return;
                if (!checkbox.checked && this.requiredVisibleColumnKeys.has(key)) {
                    checkbox.checked = true;
                    alert("번호, 카테고리, 자산번호 컬럼은 항상 표시됩니다.");
                    return;
                }
                this.columnLegendState.visible[key] = checkbox.checked;
                this.saveColumnLegendState();
                this.applyColumnLayout();
                this.refreshTableHorizontalWidth();
            });
        });
        listEl.querySelectorAll(".itma-column-delete-btn").forEach((btn) => {
            btn.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                const key = String(btn.dataset.columnKey || "").trim();
                if (!key) return;
                this.removeCustomColumn(key);
            });
        });
        listEl.querySelectorAll(".itma-column-group-check").forEach((checkbox) => {
            const groupColumns = groups[checkbox.dataset.columnGroup] || [];
            checkbox.indeterminate = groupColumns.some((column) => this.columnLegendState.visible[column.key] !== false) && !checkbox.checked;
            checkbox.addEventListener("change", () => this.setColumnGroupVisibility(checkbox.dataset.columnGroup, checkbox.checked));
        });
        listEl.querySelectorAll(".itma-column-group-only").forEach((button) => button.addEventListener("click", () => this.showOnlyColumnGroup(button.dataset.columnGroup)));
        this.bindColumnLegendDragAndDrop(listEl);
    }

    setColumnGroupVisibility(groupKey, visible) {
        this.getAllColumnDefinitions().filter((column) => column.group_key === groupKey || (groupKey === "custom" && this.isCustomColumn(column.key))).forEach((column) => {
            if (!visible && this.requiredVisibleColumnKeys.has(column.key)) return;
            this.columnLegendState.visible[column.key] = visible;
        });
        this.saveColumnLegendState();
        this.initColumnLegendPanel();
        this.applyColumnLayout();
        this.refreshTableHorizontalWidth();
    }

    showOnlyColumnGroup(groupKey) {
        this.getAllColumnDefinitions().forEach((column) => {
            const belongs = column.group_key === groupKey || (groupKey === "custom" && this.isCustomColumn(column.key));
            this.columnLegendState.visible[column.key] = belongs || this.requiredVisibleColumnKeys.has(column.key);
        });
        this.saveColumnLegendState();
        this.initColumnLegendPanel();
        this.applyColumnLayout();
        this.refreshTableHorizontalWidth();
    }

    bindColumnLegendDragAndDrop(listEl) {
        if (!listEl) return;
        let dragKey = "";
        const clearDragState = () => {
            listEl.querySelectorAll(".itma-column-legend-item").forEach((item) => {
                item.classList.remove("dragging", "drag-over");
            });
        };
        listEl.querySelectorAll(".itma-column-legend-item").forEach((item) => {
            item.addEventListener("dragstart", (event) => {
                dragKey = String(item.dataset.columnKey || "").trim();
                if (this.fixedColumnKeys.has(dragKey)) {
                    dragKey = "";
                    event.preventDefault();
                    return;
                }
                if (!dragKey) return;
                item.classList.add("dragging");
                if (event.dataTransfer) {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", dragKey);
                }
            });
            item.addEventListener("dragend", () => {
                dragKey = "";
                clearDragState();
            });
            item.addEventListener("dragover", (event) => {
                const targetKey = String(item.dataset.columnKey || "").trim();
                if (!dragKey || !targetKey || dragKey === targetKey) return;
                event.preventDefault();
                item.classList.add("drag-over");
            });
            item.addEventListener("dragleave", () => {
                item.classList.remove("drag-over");
            });
            item.addEventListener("drop", (event) => {
                event.preventDefault();
                const targetKey = String(item.dataset.columnKey || "").trim();
                if (!dragKey || !targetKey || dragKey === targetKey || this.fixedColumnKeys.has(dragKey) || this.fixedColumnKeys.has(targetKey)) {
                    clearDragState();
                    return;
                }
                this.normalizeColumnOrder();
                const targetIndex = this.columnLegendState.order.indexOf(targetKey);
                if (targetIndex >= 0) {
                    this.moveColumnOrder(dragKey, targetIndex);
                }
                dragKey = "";
                clearDragState();
            });
        });
    }

    bindHeaderDragAndDrop() {
        const table = document.getElementById("itmaTable");
        const headerRow = table?.querySelector("thead tr:first-child");
        if (!headerRow) return;

        // 기존 바인딩 초기화: 매번 모든 th를 재바인드하도록
        headerRow.querySelectorAll("th[data-column]").forEach((th) => {
            delete th.dataset.columnDragBound;
        });

        let dragKey = "";
        let dropMode = "before";
        const clearDragState = () => {
            if (table) table.classList.remove("itma-dnd-mode");
            headerRow.querySelectorAll("th[data-column]").forEach((th) => {
                th.classList.remove("itma-col-dragging", "itma-col-drag-over", "itma-col-drop-before", "itma-col-drop-after");
            });
            dropMode = "before";
        };

        headerRow.querySelectorAll("th[data-column]").forEach((th) => {
            const key = String(th.dataset.column || "").trim();
            if (!key) return;
            const dragSource = th.querySelector(".itma-col-drag-grip") || th;
            if (this.fixedColumnKeys.has(key)) {
                dragSource.setAttribute("draggable", "false");
                return;
            }
            dragSource.setAttribute("draggable", "true");

            dragSource.addEventListener("dragstart", (event) => {
                if (this.fixedColumnKeys.has(key)) {
                    event.preventDefault();
                    return;
                }
                dragKey = key;
                if (table) table.classList.add("itma-dnd-mode");
                th.classList.add("itma-col-dragging");
                if (event.dataTransfer) {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", key);
                }
            });

            dragSource.addEventListener("dragend", () => {
                dragKey = "";
                clearDragState();
            });

            th.addEventListener("dragover", (event) => {
                const targetKey = String(th.dataset.column || "").trim();
                if (!dragKey || !targetKey || dragKey === targetKey || this.fixedColumnKeys.has(targetKey)) return;
                event.preventDefault();
                const rect = th.getBoundingClientRect();
                dropMode = event.clientX < (rect.left + rect.width / 2) ? "before" : "after";
                th.classList.add("itma-col-drag-over");
                th.classList.toggle("itma-col-drop-before", dropMode === "before");
                th.classList.toggle("itma-col-drop-after", dropMode === "after");
            });

            th.addEventListener("dragleave", () => {
                th.classList.remove("itma-col-drag-over", "itma-col-drop-before", "itma-col-drop-after");
            });

            th.addEventListener("drop", (event) => {
                event.preventDefault();
                const targetKey = String(th.dataset.column || "").trim();
                if (!dragKey || !targetKey || dragKey === targetKey || this.fixedColumnKeys.has(dragKey) || this.fixedColumnKeys.has(targetKey)) {
                    clearDragState();
                    return;
                }
                // 범례 DND와 동일: targetIndex만 사용 (moveColumnOrder가 이미 보정함)
                this.normalizeColumnOrder();
                const targetIndex = this.columnLegendState.order.indexOf(targetKey);
                if (targetIndex >= 0) {
                    this.moveColumnOrder(dragKey, targetIndex);
                }
                dragKey = "";
                clearDragState();
            });
        });
    }

    toggleColumnLegendPanel() {
        const panel = document.getElementById("itmaColumnLegendPanel");
        const btn = document.getElementById("btnItmaToggleColumnLegend");
        if (!panel) return;
        const willShow = panel.classList.contains("d-none");
        if (willShow) {
            // Always refresh legend items and bindings before opening.
            this.initColumnLegendPanel();
        }
        panel.classList.toggle("d-none", !willShow);
        if (btn) {
            btn.classList.toggle("btn-secondary", willShow);
            btn.classList.toggle("btn-outline-secondary", !willShow);
            btn.setAttribute("aria-expanded", willShow ? "true" : "false");
        }
        if (willShow) {
            this.positionColumnLegendPanel();
            panel.focus();
        } else {
            panel.style.removeProperty("top");
            panel.style.removeProperty("left");
            panel.style.removeProperty("right");
        }
    }

    positionColumnLegendPanel() {
        const panel = document.getElementById("itmaColumnLegendPanel");
        const btn = document.getElementById("btnItmaToggleColumnLegend");
        if (!panel || panel.classList.contains("d-none") || !btn) return;
        const rect = btn.getBoundingClientRect();
        const viewportWidth = Math.max(window.innerWidth || 0, 320);
        const desiredWidth = Math.min(Math.floor(viewportWidth * 0.92), 360);
        panel.style.width = `${desiredWidth}px`;
        const panelWidth = panel.offsetWidth || desiredWidth;
        const left = Math.max(8, Math.min(rect.right - panelWidth, viewportWidth - panelWidth - 8));
        panel.style.left = `${left}px`;
        panel.style.top = `${Math.round(rect.bottom + 8)}px`;
        panel.style.right = "auto";
    }

    resetColumnLegendState() {
        const columns = this.getAllColumnDefinitions();
        this.columnLegendState.visible = {};
        columns.forEach((column) => {
            this.columnLegendState.visible[column.key] = true;
        });
        this.columnLegendState.order = columns.map((column) => column.key);
        this.saveColumnLegendState();
        this.initColumnLegendPanel();
        this.applyColumnLayout();
        this.refreshTableHorizontalWidth();
    }

    getVisibleColumnCount() {
        return this.getAllColumnDefinitions().reduce((count, column) => count + (this.columnLegendState.visible[column.key] !== false ? 1 : 0), 0);
    }

    getTableColspan() {
        return 1 + this.getVisibleColumnCount();
    }

    ensureCustomColumnsOnTableStructure() {
        const table = document.getElementById("itmaTable");
        if (!table) return;
        const headerRow = table.querySelector("thead tr:first-child");
        const filterRow = table.querySelector("#itmaFilterRow");
        if (!headerRow || !filterRow) return;
        const baseKeys = new Set(this.baseColumnDefinitions.map((column) => String(column.key || "").trim()));
        const dynamicColumns = [...this.detailColumnDefinitions, ...this.specColumnDefinitions, ...this.customColumnDefinitions];
        const dynamicKeys = new Set(dynamicColumns.map((column) => String(column.key || "").trim()));

        Array.from(filterRow.children).forEach((th) => {
            const field = th.querySelector("[data-column]");
            if (field?.dataset?.column) {
                th.dataset.columnKey = field.dataset.column;
            }
        });

        const existingCustomHeader = new Set(
            Array.from(headerRow.querySelectorAll("th[data-column]"))
                .map((th) => String(th.dataset.column || "").trim())
                .filter((key) => key && !baseKeys.has(key))
        );
        const existingCustomFilter = new Set(
            Array.from(filterRow.querySelectorAll("th[data-column-key]"))
                .map((th) => String(th.dataset.columnKey || "").trim())
                .filter((key) => key && !baseKeys.has(key))
        );
        dynamicColumns.forEach((column) => {
            if (!existingCustomHeader.has(column.key)) {
                const th = document.createElement("th");
                th.className = "itma-custom-col-header itma-sortable";
                th.dataset.column = column.key;
                th.style.cursor = "pointer";
                th.textContent = column.label;
                headerRow.appendChild(th);
            }
            if (!existingCustomFilter.has(column.key)) {
                const th = document.createElement("th");
                th.dataset.columnKey = column.key;
                th.innerHTML = `<input class="form-control form-control-sm itma-filter" data-column="${column.key}" placeholder="필터">`;
                filterRow.appendChild(th);
            }
        });

        headerRow.querySelectorAll("th[data-column]").forEach((th) => {
            const key = String(th.dataset.column || "").trim();
            if (!key || baseKeys.has(key)) return;
            th.classList.add("itma-sortable");
            th.style.cursor = "pointer";
            if (!dynamicKeys.has(key)) th.remove();
        });
        filterRow.querySelectorAll("th[data-column-key]").forEach((th) => {
            const key = String(th.dataset.columnKey || "").trim();
            if (!key || baseKeys.has(key)) return;
            if (!dynamicKeys.has(key)) th.remove();
        });

        this.initHeaderSortControls();
    }

    getColumnOrderIndex(columnKey) {
        const order = Array.isArray(this.columnLegendState.order) ? this.columnLegendState.order : [];
        const idx = order.indexOf(columnKey);
        return idx >= 0 ? idx : order.length;
    }

    normalizeColumnOrder() {
        const keys = this.getAllColumnDefinitions().map((column) => column.key);
        const storedOrder = Array.isArray(this.columnLegendState.order) ? this.columnLegendState.order : [];
        const pendingOrder = this.hasLoadedServerColumnDefinitions
            ? []
            : storedOrder.filter((key) => !keys.includes(key));
        let normalizedOrder = [
            ...storedOrder.filter((key) => keys.includes(key)),
            ...pendingOrder,
        ];
        // 새로 생긴 컬럼(예: 사업장)은 기본 정의상 바로 앞 컬럼 뒤에 끼워 넣는다. (기존 사용자 화면 순서 유지)
        keys.forEach((key, index) => {
            if (normalizedOrder.includes(key)) return;
            const previousKey = keys.slice(0, index).reverse().find((candidate) => normalizedOrder.includes(candidate));
            const insertAt = previousKey ? normalizedOrder.indexOf(previousKey) + 1 : normalizedOrder.length;
            normalizedOrder.splice(insertAt, 0, key);
        });
        const fixedOrder = Array.from(this.fixedColumnKeys).filter((key) => keys.includes(key));
        normalizedOrder = [
            ...fixedOrder,
            ...normalizedOrder.filter((key) => !this.fixedColumnKeys.has(key)),
        ];
        this.columnLegendState.order = normalizedOrder;
        keys.forEach((key) => {
            if (typeof this.columnLegendState.visible[key] !== "boolean") {
                const definition = this.getAllColumnDefinitions().find((column) => column.key === key);
                this.columnLegendState.visible[key] = definition?.default_visible !== false;
            }
        });
        this.requiredVisibleColumnKeys.forEach((key) => {
            if (keys.includes(key)) this.columnLegendState.visible[key] = true;
        });
        if (this.hasLoadedServerColumnDefinitions) {
            this.columnLegendState.visible = Object.fromEntries(
                keys.map((key) => [key, this.columnLegendState.visible[key] !== false])
            );
        }
    }

    async moveColumnOrder(columnKey, targetIndex) {
        this.normalizeColumnOrder();
        if (this.fixedColumnKeys.has(columnKey)) return;
        const order = [...this.columnLegendState.order];
        const fromIndex = order.indexOf(columnKey);
        if (fromIndex < 0) return;
        const fixedCount = Array.from(this.fixedColumnKeys).filter((key) => order.includes(key)).length;
        let toIndex = Number.isFinite(Number(targetIndex)) ? Math.round(Number(targetIndex)) : fromIndex;
        toIndex = Math.max(fixedCount, Math.min(order.length, toIndex));
        order.splice(fromIndex, 1);
        if (fromIndex < toIndex) {
            toIndex -= 1;
        }
        toIndex = Math.max(fixedCount, Math.min(order.length, toIndex));
        order.splice(toIndex, 0, columnKey);
        this.columnLegendState.order = order;
        this.saveColumnLegendState();
        this.initColumnLegendPanel();
        this.applyColumnLayout();
        this.refreshTableHorizontalWidth();
        await this.syncCustomColumnOrderToServer();
    }

    async moveColumnRelative(columnKey, targetKey, place = "before") {
        this.normalizeColumnOrder();
        const dragKey = String(columnKey || "").trim();
        const baseKey = String(targetKey || "").trim();
        const mode = place === "after" ? "after" : "before";
        if (!dragKey || !baseKey || dragKey === baseKey) return;
        if (this.fixedColumnKeys.has(dragKey)) return;

        const order = [...this.columnLegendState.order];
        const fromIndex = order.indexOf(dragKey);
        const baseIndex = order.indexOf(baseKey);
        if (fromIndex < 0 || baseIndex < 0) return;

        const fixedCount = Array.from(this.fixedColumnKeys).filter((key) => order.includes(key)).length;
        order.splice(fromIndex, 1);

        let insertIndex = baseIndex;
        if (fromIndex < baseIndex) {
            insertIndex -= 1;
        }
        if (mode === "after") {
            insertIndex += 1;
        }
        insertIndex = Math.max(fixedCount, Math.min(order.length, insertIndex));

        order.splice(insertIndex, 0, dragKey);
        this.columnLegendState.order = order;
        this.saveColumnLegendState();
        this.initColumnLegendPanel();
        this.applyColumnLayout();
        this.refreshTableHorizontalWidth();
        await this.syncCustomColumnOrderToServer();
    }

    async syncCustomColumnOrderToServer() {
        // 권한이 없으면 화면 순서만 개인 설정으로 저장하고 서버 공용 순서는 바꾸지 않는다.
        if (!this.permissions?.can_manage_columns) return;
        const customOrder = (this.columnLegendState.order || []).filter((key) => this.isCustomColumn(key));
        try {
            const response = await fetch("/itma/custom-columns/reorder", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ order: customOrder }),
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.message || "컬럼 정렬 저장 중 오류가 발생했습니다.");
            }
        } catch (error) {
            alert(`컬럼 정렬 저장 실패: ${error.message}`);
        }
    }

    applyColumnLayout() {
        const table = document.getElementById("itmaTable");
        if (!table) return;
        this.ensureCustomColumnsOnTableStructure();
        this.normalizeColumnOrder();
        const orderedKeys = this.columnLegendState.order;

        const reorderRow = (row, attrName) => {
            if (!row) return;
            orderedKeys.forEach((key) => {
                const cell = Array.from(row.children).find((child) => String(child.dataset?.[attrName] || "") === key);
                if (cell) row.appendChild(cell);
            });
        };

        const headerRow = table.querySelector("thead tr:first-child");
        const filterRow = table.querySelector("#itmaFilterRow");
        reorderRow(headerRow, "column");
        reorderRow(filterRow, "columnKey");

        table.querySelectorAll("tbody tr").forEach((row) => {
            reorderRow(row, "column");
        });

        this.getAllColumnDefinitions().forEach((column) => {
            const isVisible = this.columnLegendState.visible[column.key] !== false;
            table.querySelectorAll(`[data-column="${column.key}"], [data-column-key="${column.key}"]`).forEach((cell) => {
                cell.style.display = isVisible ? "" : "none";
            });
        });
        table.querySelectorAll("tbody tr td[colspan]").forEach((cell) => {
            cell.colSpan = this.getTableColspan();
        });
        this.applyColumnWidths();
        this.bindHeaderDragAndDrop();
    }

    getHeaderLabelMinWidthPx(labelText, referenceEl, columnKey) {
        const key = String(columnKey || "").trim();
        const label = String(labelText || this.getColumnLabel(key) || key).trim();
        if (!label) return key === "row_no" ? 70 : 90;

        let measured = 0;
        try {
            const canvas = this.__itmaMeasureCanvas || (this.__itmaMeasureCanvas = document.createElement("canvas"));
            const ctx = canvas.getContext("2d");
            if (ctx) {
                const style = referenceEl ? window.getComputedStyle(referenceEl) : null;
                const fontWeight = style?.fontWeight || "600";
                const fontSize = style?.fontSize || "13px";
                const fontFamily = style?.fontFamily || "sans-serif";
                ctx.font = `${fontWeight} ${fontSize} ${fontFamily}`;
                measured = Math.ceil(ctx.measureText(label).width);
            }
        } catch (_error) {
            measured = 0;
        }

        if (!measured) {
            const weightedLength = Array.from(label).reduce((acc, ch) => acc + (/[\u0020-\u007E]/.test(ch) ? 1 : 1.7), 0);
            measured = Math.ceil(weightedLength * 8);
        }

        const gripAndPadding = this.fixedColumnKeys.has(key) ? 28 : 48;
        const mappedMin = Number.isFinite(this.columnMinWidthMap[key]) ? Number(this.columnMinWidthMap[key]) : 0;
        return Math.max(key === "row_no" ? 70 : 88, mappedMin, measured + gripAndPadding);
    }

    applyColumnWidths() {
        const table = document.getElementById("itmaTable");
        if (!table) return;
        this.getAllColumnDefinitions().forEach((column) => {
            const key = String(column?.key || "").trim();
            if (!key || this.columnLegendState.visible[key] === false) return;
            table.querySelectorAll(`[data-column="${key}"], [data-column-key="${key}"]`).forEach((cell) => {
                cell.style.removeProperty("min-width");
                cell.style.removeProperty("width");
                cell.style.removeProperty("max-width");
            });
        });
    }

    setColumnWidth(columnKey, width, save = false) {
        const key = String(columnKey || "").trim();
        const widthNum = Number(width);
        if (!key || !Number.isFinite(widthNum)) return;
        const minWidth = this.getColumnMinWidth(key);
        const normalized = Math.max(minWidth, Math.min(900, Math.round(widthNum)));
        this.columnWidthState[key] = normalized;
        const table = document.getElementById("itmaTable");
        if (table) {
            const px = `${normalized}px`;
            table.querySelectorAll(`[data-column="${key}"], [data-column-key="${key}"]`).forEach((cell) => {
                cell.style.width = px;
                cell.style.maxWidth = px;
            });
        }
        if (save) this.saveColumnWidthState();
        this.refreshTableHorizontalWidth();
    }

    clearColumnWidth(columnKey) {
        const key = String(columnKey || "").trim();
        if (!key) return;
        delete this.columnWidthState[key];
        const table = document.getElementById("itmaTable");
        if (table) {
            table.querySelectorAll(`[data-column="${key}"], [data-column-key="${key}"]`).forEach((cell) => {
                cell.style.removeProperty("width");
                cell.style.removeProperty("min-width");
                cell.style.removeProperty("max-width");
            });
        }
        this.saveColumnWidthState();
        this.refreshTableHorizontalWidth();
    }

    bindColumnResizeHandles() {
        const table = document.getElementById("itmaTable");
        const headerRow = table?.querySelector("thead tr:first-child");
        if (!headerRow) return;

        headerRow.querySelectorAll("th[data-column]").forEach((th) => {
            const key = String(th.dataset.column || "").trim();
            if (!key) return;

            let handle = th.querySelector(".itma-col-resizer");
            if (!handle) {
                handle = document.createElement("span");
                handle.className = "itma-col-resizer";
                handle.setAttribute("aria-hidden", "true");
                th.appendChild(handle);
            }

            if (handle.dataset.resizeBound === "true") return;
            handle.dataset.resizeBound = "true";

            handle.addEventListener("mousedown", (event) => {
                event.preventDefault();
                event.stopPropagation();

                const startX = event.clientX;
                const startWidth = th.getBoundingClientRect().width || 120;
                document.body.classList.add("itma-col-resizing");

                const onMouseMove = (moveEvent) => {
                    const nextWidth = startWidth + (moveEvent.clientX - startX);
                    this.setColumnWidth(key, nextWidth, false);
                };

                const onMouseUp = () => {
                    document.body.classList.remove("itma-col-resizing");
                    window.removeEventListener("mousemove", onMouseMove);
                    window.removeEventListener("mouseup", onMouseUp);
                    this.saveColumnWidthState();
                };

                window.addEventListener("mousemove", onMouseMove);
                window.addEventListener("mouseup", onMouseUp);
            });

            handle.addEventListener("dblclick", (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.clearColumnWidth(key);
            });
        });
    }

    addCustomColumn() {
        return this.addCustomColumnWithLabel("");
    }

    async addCustomColumnWithLabel(labelRaw) {
        if (!this.permissions?.can_manage_columns) {
            alert("사용자 컬럼 관리 권한이 없습니다.");
            return;
        }
        const label = String(labelRaw || "").trim();
        if (!label) return;
        if (this.getAllColumnDefinitions().some((column) => column.label === label)) {
            alert("동일한 컬럼명이 이미 존재합니다.");
            return;
        }
        try {
            const response = await fetch("/itma/custom-columns", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ label }),
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.message || "컬럼 추가 중 오류가 발생했습니다.");
            }
            await this.loadAssets();
        } catch (error) {
            alert(`컬럼 추가 실패: ${error.message}`);
        }
    }

    async removeCustomColumn(columnKey) {
        if (!this.permissions?.can_manage_columns) {
            alert("사용자 컬럼 관리 권한이 없습니다.");
            return;
        }
        const target = this.customColumnDefinitions.find((column) => column.key === columnKey);
        if (!target) return;
        const confirmed = window.confirm(`'${target.label}' 컬럼을 삭제하시겠습니까? 저장된 값도 함께 제거됩니다.`);
        if (!confirmed) return;
        try {
            const response = await fetch(`/itma/custom-columns/${encodeURIComponent(columnKey)}`, {
                method: "DELETE",
                headers: { Accept: "application/json" },
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.message || "컬럼 삭제 중 오류가 발생했습니다.");
            }
            delete this.columnLegendState.visible[columnKey];
            this.columnLegendState.order = (this.columnLegendState.order || []).filter((key) => key !== columnKey);
            this.saveColumnLegendState();
            await this.loadAssets();
        } catch (error) {
            alert(`컬럼 삭제 실패: ${error.message}`);
        }
    }

    openColumnAddModal() {
        const modalEl = document.getElementById("itmaColumnAddModal");
        if (!modalEl || typeof bootstrap === "undefined") return;
        const input = document.getElementById("itmaNewColumnLabel");
        const error = document.getElementById("itmaNewColumnError");
        if (input) input.value = "";
        if (error) error.textContent = "";
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
        window.setTimeout(() => input?.focus(), 60);
    }

    submitColumnAddModal() {
        const input = document.getElementById("itmaNewColumnLabel");
        const error = document.getElementById("itmaNewColumnError");
        const label = String(input?.value || "").trim();
        if (!label) {
            if (error) error.textContent = "컬럼명을 입력해주세요.";
            input?.focus();
            return;
        }
        if (this.getAllColumnDefinitions().some((column) => column.label === label)) {
            if (error) error.textContent = "동일한 컬럼명이 이미 존재합니다.";
            input?.focus();
            return;
        }
        this.addCustomColumnWithLabel(label);
        const modalEl = document.getElementById("itmaColumnAddModal");
        if (modalEl && typeof bootstrap !== "undefined") {
            bootstrap.Modal.getOrCreateInstance(modalEl).hide();
        }
    }

    getCustomCellValue(assetId, columnKey) {
        const idKey = String(assetId || "");
        return String(this.customColumnValues?.[idKey]?.[columnKey] ?? "");
    }


    openUploadModal() {
        const modalEl = document.getElementById("itmaUploadModal");
        if (!modalEl || typeof bootstrap === "undefined") return;
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }


    closeUploadModal() {
        const modalEl = document.getElementById("itmaUploadModal");
        if (!modalEl || typeof bootstrap === "undefined") return;
        bootstrap.Modal.getOrCreateInstance(modalEl).hide();
    }


    startServerTimeSync() {
        this.syncServerTime();
        if (this.serverTimeTimer) window.clearInterval(this.serverTimeTimer);
        this.serverTimeTimer = window.setInterval(() => this.syncServerTime(), 30000);
    }


    async syncServerTime() {
        const serverTimeEl = document.getElementById("itmaServerTime");
        if (!serverTimeEl) return;
        try {
            const response = await fetch("/itma/server-time", { headers: { Accept: "application/json" } });
            const data = await response.json();
            if (!response.ok || !data.success) return;
            serverTimeEl.textContent = data.server_time || "-";
        } catch (_error) {
            // Ignore periodic sync failures.
        }
    }


    async loadAssets(searchKeyword = this.globalSearchKeyword) {
        const keyword = String(searchKeyword || "").trim();
        this.globalSearchKeyword = keyword;
        this.tableBody.innerHTML = `<tr><td colspan="${this.getTableColspan()}" class="text-muted py-4">검색 결과를 불러오는 중입니다...</td></tr>`;
        this.applyColumnLayout();
        try {
            const params = new URLSearchParams();
            if (keyword) params.set("q", keyword);
            const url = params.toString() ? `/itma/assets?${params.toString()}` : "/itma/assets";
            const categoryResponse = await fetch("/itma/categories", { headers: { Accept: "application/json" } });
            const categoryData = await categoryResponse.json();
            if (!categoryResponse.ok || !categoryData.success) throw new Error(categoryData.message || "카테고리 조회 실패");
            this.categories = Array.isArray(categoryData.categories) ? categoryData.categories : [];
            const response = await fetch(url, { headers: { Accept: "application/json" } });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.message || "검색 결과를 불러오는 중 오류가 발생했습니다.");
            }

            this.permissions = data.permissions && typeof data.permissions === "object"
                ? data.permissions
                : this.permissions;

            this.allItems = Array.isArray(data.items) ? data.items : [];
            const serverCustomColumns = Array.isArray(data.custom_columns) ? data.custom_columns : [];
            const serverCustomValues = data.custom_column_values && typeof data.custom_column_values === "object"
                ? data.custom_column_values
                : {};
            const serverDetailColumns = Array.isArray(data.detail_columns) ? data.detail_columns : [];
            const serverDetailValues = data.detail_column_values && typeof data.detail_column_values === "object"
                ? data.detail_column_values : {};
            const serverSpecColumns = Array.isArray(data.spec_columns) ? data.spec_columns : [];
            const serverSpecValues = data.spec_column_values && typeof data.spec_column_values === "object"
                ? data.spec_column_values : {};
            this.customColumnDefinitions = serverCustomColumns
                .map((col) => ({
                    key: String(col?.key || "").trim(),
                    label: String(col?.label || "").trim(),
                }))
                .filter((col) => col.key && col.label);
            this.customColumnValues = serverCustomValues;
            this.detailColumnDefinitions = serverDetailColumns
                .map((column) => ({ ...column, key: String(column?.key || "").trim(), label: String(column?.label || "").trim(), group_key: String(column?.group_key || "equipment").trim() || "equipment", default_visible: false }))
                .filter((column) => column.key && column.label);
            this.detailColumnValues = serverDetailValues;
            this.specColumnDefinitions = serverSpecColumns
                .map((column) => ({ ...column, key: String(column?.key || "").trim(), label: String(column?.label || "").trim(), group_key: "spec", default_visible: column?.default_visible !== false }))
                .filter((column) => column.key && column.label);
            this.specColumnValues = serverSpecValues;
            this.hasLoadedServerColumnDefinitions = true;
            // Rebuild legend so newly added custom columns immediately support
            // visibility toggle, delete button, and drag-and-drop ordering.
            this.normalizeColumnOrder();
            this.saveColumnLegendState();
            this.initColumnLegendPanel();
            this.allItems.forEach((item, index) => {
                const serverRowNo = Number(item.row_no);
                item.row_no = Number.isFinite(serverRowNo) && serverRowNo > 0 ? serverRowNo : (index + 1);
                const key = String(item.id || "");
                item.usage_status_changed_month = String(this.usageStatusMonthMap[key] || "");
                this.enrichItem(item);
            });
            const currentIds = new Set(this.allItems.map((item) => String(item.id)));
            this.selectedIds = new Set([...this.selectedIds].filter((id) => currentIds.has(id)));
            this.usageStatusMonthMap = Object.fromEntries(
                Object.entries(this.usageStatusMonthMap).filter(([id]) => currentIds.has(String(id)))
            );
            this.saveUsageStatusMonthMap();
            this.rebuildSmartSuggestIndex();

            this.populateDropdownFilters();

            this.renderTopTimes(data.latest_updated_at, data.latest_input_at, data.server_time);
            this.syncPermissionUI();
            this.applyFiltersAndSort();
            this.renderDashboardIfOpen();
            this.refreshDurabilityModalContent();
            this.maybeShowDurabilityModalOnLoad();
        } catch (error) {
            this.tableBody.innerHTML = `<tr><td colspan="${this.getTableColspan()}" class="text-danger py-4">${itmaEscapeHtml(error.message)}</td></tr>`;
            this.applyColumnLayout();
        }
    }

    syncGlobalSearchInput() {
        const row = document.getElementById("itmaGlobalSearchPanel");
        const input = document.getElementById("itmaGlobalSearchInput");
        if (!row || !input) return;
        row.classList.remove("d-none");
        input.value = this.globalSearchKeyword;
    }

    normalizePermissionCategory(category) {
        const raw = String(category || "").trim().toLowerCase();
        if (!raw) return "other";
        if (raw === "software" || raw === "sw" || raw.includes("소프트")) return "software";
        if (raw === "license" || raw.includes("라이선")) return "license";
        if (raw === "hardware" || raw === "hw" || raw.includes("하드웨어")) return "hardware";
        if (raw === "network" || raw === "nw" || raw === "l2" || raw === "l3" || raw === "l4" || raw === "l7" || raw.includes("네트워크")) return "network";
        if (raw === "security" || raw === "se" || raw.includes("보안")) return "security";
        if (raw === "server" || raw.includes("서버")) return "server";
        if (raw === "solution" || raw.includes("솔루션")) return "solution";
        if (raw === "cloud" || raw.includes("클라우드")) return "cloud";
        if (raw.includes("그외") || raw.includes("기타") || raw === "other") return "other";
        if (raw === "printer" || raw.includes("프린터")) return "printer";
        if (raw === "pc" || raw.includes("pc") || raw.includes("컴퓨터") || raw.includes("노트북")) return "pc";
        const fallback = raw.normalize("NFKC").replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "");
        return fallback || "other";
    }

    canEditCategory(category) {
        if (this.permissions?.can_edit_all) return true;
        const normalized = this.normalizePermissionCategory(category);
        const editable = Array.isArray(this.permissions?.edit_categories) ? this.permissions.edit_categories : [];
        return editable.includes(normalized);
    }

    canEditItem(item) {
        return this.canEditCategory(item?.category);
    }

    syncPermissionUI() {
        const hasAnyEdit = this.permissions?.can_edit_all || (Array.isArray(this.permissions?.edit_categories) && this.permissions.edit_categories.length > 0);
        [
            "btnItmaAddRow",
            "btnItmaBulkEdit",
            "btnItmaDeleteSelected",
            "btnOpenItmaUploadModal",
            "btnItmaTemplateDownload",
            "btnItmaColumnAdd",
            "btnItmaColumnLegendReset",
        ].forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            const isColumnButton = id === "btnItmaColumnAdd" || id === "btnItmaColumnLegendReset";
            const disabled = isColumnButton ? !this.permissions?.can_manage_columns : !hasAnyEdit;
            if (el.tagName === "A") {
                // 링크 버튼(자산 추가)은 disabled 속성이 없으므로 클래스로 처리
                el.classList.toggle("disabled", disabled);
                el.setAttribute("aria-disabled", disabled ? "true" : "false");
                el.tabIndex = disabled ? -1 : 0;
            } else {
                el.disabled = disabled;
            }
        });
    }

    applyGlobalSearch() {
        const input = document.getElementById("itmaGlobalSearchInput");
        this.currentPage = 1;
        this.loadAssets((input?.value || "").trim());
    }

    resetGlobalSearch() {
        const input = document.getElementById("itmaGlobalSearchInput");
        if (input) input.value = "";
        this.currentPage = 1;
        this.loadAssets("");
    }


    renderTopTimes(latestUpdatedAt, latestInputAt, serverTime) {
        const lastUpdatedEl = document.getElementById("itmaLastUpdated");
        const inputAtEl = document.getElementById("itmaInputAt");
        const serverTimeEl = document.getElementById("itmaServerTime");
        if (lastUpdatedEl) lastUpdatedEl.textContent = latestUpdatedAt || "-";
        if (inputAtEl) inputAtEl.textContent = latestInputAt || "-";
        if (serverTimeEl && serverTime) serverTimeEl.textContent = serverTime;
    }


    async uploadExcel() {
        const fileInput = document.getElementById("itmaExcelFile");
        const resultEl = document.getElementById("itmaUploadResult");
        const file = fileInput?.files?.[0];
        if (!file) {
            if (resultEl) resultEl.textContent = "업로드할 파일을 선택해주세요.";
            return;
        }


        const formData = new FormData();
        formData.append("file", file);
        if (resultEl) resultEl.textContent = "파일을 업로드하는 중입니다...";
 
        try {
            const response = await fetch("/itma/assets/upload", {
                method: "POST",
                body: formData
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.message || "파일 업로드 중 오류가 발생했습니다.");
            }


            if (resultEl) {
                const duplicateRows = Array.isArray(data.skipped_duplicate_rows) ? data.skipped_duplicate_rows : [];
                // 서버 메시지에 자산번호/시리얼번호 중복 건수가 포함되어 있어 그대로 표시
                resultEl.textContent = data.message || "파일 업로드가 완료되었습니다.";
                if (duplicateRows.length) {
                    this.showDuplicateUploadModal(duplicateRows, data.inserted || 0, data.message);
                }
            }
            if (fileInput) fileInput.value = "";
            this.closeUploadModal();
            await this.loadAssets();
        } catch (error) {
            if (resultEl) resultEl.textContent = `오류: ${error.message}`;
        }
    }


    showDuplicateUploadModal(duplicateRows, insertedCount = 0, serverMessage = "") {
        const modalEl = document.getElementById("itmaDuplicateUploadModal");
        const summaryEl = document.getElementById("itmaDuplicateUploadSummary");
        const bodyEl = document.getElementById("itmaDuplicateUploadBody");
        if (!modalEl || !summaryEl || !bodyEl || typeof bootstrap === "undefined") return;


        const maxRows = 200;
        const visibleRows = duplicateRows.slice(0, maxRows);
        summaryEl.textContent = serverMessage || `업로드 완료: 추가 ${insertedCount}건 / 중복으로 미업로드 ${duplicateRows.length}건`;


        bodyEl.innerHTML = visibleRows.map((row) => `
            <tr>
                <td>${itmaEscapeHtml(row.row)}</td>
                <td>${itmaEscapeHtml(row.match_column || "시리얼번호")}</td>
                <td>${itmaEscapeHtml(row.target_column || "-")}</td>
                <td>${itmaEscapeHtml(row.match_value || row.serial_number || "-")}</td>
                <td>${itmaEscapeHtml(row.item_name || "-")}</td>
            </tr>
        `).join("");


        if (duplicateRows.length > maxRows) {
            bodyEl.insertAdjacentHTML("beforeend", `
                <tr>
                    <td colspan="5" class="text-muted text-center">${itmaEscapeHtml(duplicateRows.length - maxRows)}개의 중복 항목이 건너뛰어졌습니다.</td>
                </tr>
            `);
        }


        bootstrap.Modal.getOrCreateInstance(modalEl).show();
        this.initDashboardCardInteractions();
    }




    async openDashboardModal() {
        const modalEl = document.getElementById("itmaDashboardModal");
        if (!modalEl || typeof bootstrap === "undefined") return;
        if (!this.allItems.length) {
            await this.loadAssets();
        }
        this.renderDashboard();
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
        this.initDashboardCardInteractions();
    }


    handleDashboardOpenOption(event) {
        event.preventDefault();
        const option = event.currentTarget;
        const mode = String(option?.dataset?.dashboardMode || "modal").toLowerCase();
        if (mode === "window") {
            const refreshMinutes = Number(option?.dataset?.refreshMinutes || 5);
            this.openDashboardWindow(refreshMinutes);
            return;
        }
        this.openDashboardModal();
    }


    openDashboardWindow(refreshMinutes = 5) {
        const safeMinutes = [5, 10, 30, 60].includes(Number(refreshMinutes)) ? Number(refreshMinutes) : 5;
        const features = "popup=yes,width=1440,height=900,menubar=no,toolbar=no,location=yes,status=no,resizable=yes,scrollbars=yes";
        window.open(`/itma/dashboard/open?refresh=${safeMinutes}`, "itma_dashboard_live", features);
    }


    renderDashboardIfOpen() {
        const modalEl = document.getElementById("itmaDashboardModal");
        if (!modalEl || !modalEl.classList.contains("show")) return;
        this.renderDashboard();
    }

    aggregateByColumn(column, sourceItems = this.allItems) {
        const counter = new Map();
        const items = Array.isArray(sourceItems) ? sourceItems : [];
        items.forEach((item) => {
            const key = String(item[column] ?? "").trim() || "미정";
            counter.set(key, (counter.get(key) || 0) + 1);
        });
        const entries = [...counter.entries()]
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko"));
        const total = entries.reduce((sum, row) => sum + row.count, 0);
        return { entries, total };
    }


    setDashboardValue(elementId, value) {
        const el = document.getElementById(elementId);
        if (el) el.textContent = String(value);
    }


    renderSummaryTable(tbodyId, rows, total) {
        const tbody = document.getElementById(tbodyId);
        if (!tbody) return;
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-muted text-center">\uB370\uC774\uD130 \uC5C6\uC74C</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map((row) => {
            const pct = total ? ((row.count / total) * 100).toFixed(1) : "0.0";
            return `<tr><td>${itmaEscapeHtml(row.name)}</td><td class="text-end">${row.count}</td><td class="text-end">${pct}%</td></tr>`;
        }).join("");
    }


    renderDonutChart(donutId, legendId, rows, total, centerLabel = "중앙") {
        const donut = document.getElementById(donutId);
        const legend = document.getElementById(legendId);
        if (!donut) return;

        if (!rows.length || !total) {
            donut.style.background = "conic-gradient(#e9ecef 0 100%)";
            donut.innerHTML = "";
            if (legend) legend.innerHTML = '<div class="text-muted">데이터가 없습니다.</div>';
            return;
        }


        const palette = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#17becf", "#bcbd22", "#e377c2", "#7f7f7f"];
        const chartRows = rows.slice(0, 8);
        const etcCount = rows.slice(8).reduce((sum, row) => sum + row.count, 0);
        if (etcCount > 0) chartRows.push({ name: "\uAE30\uD0C0", count: etcCount });


        const sizeRaw = getComputedStyle(donut).getPropertyValue("--donut-size").trim();
        const size = Number.parseFloat(sizeRaw) || donut.clientWidth || 220;
        const strokeWidth = 30;
        const radius = Math.max(10, (size - strokeWidth) / 2);
        const cx = size / 2;
        const cy = size / 2;
        const circumference = 2 * Math.PI * radius;


        let offset = 0;
        const svgSegments = chartRows.map((row, idx) => {
            if (!row.count || !total) return "";
            const color = palette[idx % palette.length];
            const length = (row.count / total) * circumference;
            const dasharray = `${length} ${circumference - length}`;
            const dashoffset = -offset;
            offset += length;
            return `<circle class="segment" data-index="${idx}" cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-dasharray="${dasharray}" stroke-dashoffset="${dashoffset}" />`;
        }).join("");


        const svg = `<svg viewBox="0 0 ${size} ${size}" aria-hidden="true"><g transform="rotate(-90 ${cx} ${cy})">${svgSegments}</g></svg>`;
        donut.style.background = "";
        donut.innerHTML = `${svg}<div class="itma-donut-center"><div class="donut-label"></div><div class="donut-total"></div></div>`;


        if (legend) {
            legend.innerHTML = chartRows.map((row, idx) => {
                const color = palette[idx % palette.length];
                const pct = total ? ((row.count / total) * 100).toFixed(1) : "0.0";
                return `<div class="legend-item" data-index="${idx}">
                    <span class="legend-color" style="background:${color}"></span>
                    <span>${itmaEscapeHtml(row.name)}</span>
                    <span>${pct}%</span>
                </div>`;
            }).join("");
            this.bindDonutLegendHover(donut, legend);
        }
        this.bindDonutSelection(donut, chartRows, total);
    }


    calculateFilledRate(column, sourceItems = this.allItems) {
        const items = Array.isArray(sourceItems) ? sourceItems : [];
        const total = items.length;
        if (!total) return 0;
        const filled = items.filter((item) => {
            const v = String(item[column] ?? "").trim();
            return v.length > 0;
        }).length;
        return Math.round((filled / total) * 1000) / 10;
    }


    setProgressCard(barId, textId, pct) {
        const bar = document.getElementById(barId);
        const text = document.getElementById(textId);
        const safe = Math.max(0, Math.min(100, Number(pct) || 0));
        if (bar) bar.style.width = `${safe}%`;
        if (text) text.textContent = `${safe.toFixed(1)}%`;
    }


    initDashboardCardInteractions() {
        document.querySelectorAll(".itma-selectable-card").forEach((card) => {
            if (card.dataset.bound === "1") return;
            card.dataset.bound = "1";
            card.addEventListener("click", () => this.activateDashboardCard(card));
        });
    }


    activateDashboardCard(card) {
        if (!card) return;
        document.querySelectorAll(".itma-selectable-card").forEach((el) => el.classList.remove("active"));
        card.classList.add("active");
        const target = String(card.dataset.dashboardTarget || "").trim();
        const tabIdByTarget = {
            category: "itma-tab-category",
            manufacturer: "itma-tab-manufacturer",
            storage: "itma-tab-storage",
        };
        const tabId = tabIdByTarget[target];
        if (!tabId) return;

        const tabButton = document.getElementById(tabId);
        if (!tabButton) return;

        if (typeof bootstrap !== "undefined" && bootstrap.Tab) {
            bootstrap.Tab.getOrCreateInstance(tabButton).show();
            return;
        }

        // bootstrap.Tab 사용이 불가능한 경우를 위한 폴백
        const paneSelector = tabButton.getAttribute("data-bs-target");
        const tabsRoot = document.getElementById("itmaDashboardTabs");
        const tabButtons = tabsRoot ? tabsRoot.querySelectorAll(".nav-link") : [];
        tabButtons.forEach((btn) => btn.classList.remove("active"));
        tabButton.classList.add("active");

        if (!paneSelector) return;
        const currentPane = document.querySelector(paneSelector);
        if (!currentPane) return;
        const panes = currentPane.parentElement ? currentPane.parentElement.querySelectorAll(".tab-pane") : [];
        panes.forEach((pane) => pane.classList.remove("show", "active"));
        currentPane.classList.add("show", "active");
    }


    
    bindDonutLegendHover(donut, legend) {
        if (!donut || !legend) return;
        const items = Array.from(legend.querySelectorAll('.legend-item'));
        const segments = Array.from(donut.querySelectorAll('.segment'));
        const clear = () => items.forEach((el) => el.classList.remove('active'));
        segments.forEach((seg) => {
            const idx = seg.dataset.index;
            seg.addEventListener('mouseenter', () => {
                clear();
                const target = legend.querySelector(`.legend-item[data-index="${idx}"]`);
                if (target) target.classList.add('active');
            });
            seg.addEventListener('mouseleave', clear);
        });
        items.forEach((item) => {
            const idx = item.dataset.index;
            item.addEventListener('mouseenter', () => {
                clear();
                const target = donut.querySelector(`.segment[data-index="${idx}"]`);
                if (target) item.classList.add('active');
            });
            item.addEventListener('mouseleave', clear);
        });
    }




    bindDonutSelection(donut, chartRows, total) {
        if (!donut) return;
        const centerTotal = donut.querySelector(".donut-total");
        const centerLabel = donut.querySelector(".donut-label");


        const setCenter = (row) => {
            if (!centerTotal || !centerLabel || !row) return;
            const pct = total ? ((row.count / total) * 100).toFixed(1) : "0.0";
            centerLabel.textContent = row.name;
            centerTotal.textContent = `${pct}%`;
        };


        if (chartRows.length) setCenter(chartRows[0]);


        donut.querySelectorAll(".segment").forEach((seg) => {
            const idx = Number(seg.dataset.index);
            seg.addEventListener("click", () => setCenter(chartRows[idx]));
        });


    }

renderDashboard() {
        const categoryData = this.aggregateByColumn("category");
        const manufacturerData = this.aggregateByColumn("manufacturer");
        const storageData = this.aggregateByColumn("storage_location");
        const usageInUse = this.allItems.filter((item) => ["사용", "정상"].includes(this.normalizeUsageStatus(item.usage_status))).length;
        const usageUnused = this.allItems.filter((item) => this.normalizeUsageStatus(item.usage_status) === "미사용").length;
        const now = new Date();
        const updated30d = this.allItems.filter((item) => {
            if (!item.updated_at) return false;
            const date = new Date(String(item.updated_at).replace(" ", "T"));
            if (Number.isNaN(date.getTime())) return false;
            return (now.getTime() - date.getTime()) <= (30 * 24 * 60 * 60 * 1000);
        }).length;
        const assetIdRate = this.calculateFilledRate("asset_id");
        const qualityScore = (
            this.calculateFilledRate("category")
            + this.calculateFilledRate("manufacturer")
            + this.calculateFilledRate("storage_location")
            + this.calculateFilledRate("serial_number")
            + assetIdRate
        ) / 5;


        this.setDashboardValue("itmaKpiCategoryCount", categoryData.entries.length);
        this.setDashboardValue("itmaKpiManufacturerCount", manufacturerData.entries.length);
        this.setDashboardValue("itmaKpiStorageCount", storageData.entries.length);
        this.setDashboardValue("itmaKpiTotalCount", this.allItems.length);
        this.setDashboardValue("itmaKpiInUseCount", usageInUse);
        this.setDashboardValue("itmaKpiUnusedCount", usageUnused);
        this.setDashboardValue("itmaKpiUpdated30d", updated30d);
        this.setDashboardValue("itmaKpiQualityScore", `${qualityScore.toFixed(1)}점`);


        this.setDashboardValue("itmaCategoryTotalInTab", categoryData.total);
        this.setDashboardValue("itmaManufacturerTotalInTab", manufacturerData.total);
        this.setDashboardValue("itmaStorageTotalInTab", storageData.total);


        this.renderSummaryTable("itmaCategorySummaryBody", categoryData.entries, categoryData.total);
        this.renderSummaryTable("itmaManufacturerSummaryBody", manufacturerData.entries, manufacturerData.total);
        this.renderSummaryTable("itmaStorageSummaryBody", storageData.entries, storageData.total);


        this.renderDonutChart("itmaCategoryDonut", "itmaCategoryLegend", categoryData.entries, categoryData.total, "카테고리");
        this.renderDonutChart("itmaManufacturerDonut", "itmaManufacturerLegend", manufacturerData.entries, manufacturerData.total, "제조사");
        this.renderDonutChart("itmaStorageDonut", "itmaStorageLegend", storageData.entries, storageData.total, "보관위치");


        this.setProgressCard("itmaProgCategoryBar", "itmaProgCategoryText", this.calculateFilledRate("category"));
        this.setProgressCard("itmaProgManufacturerBar", "itmaProgManufacturerText", this.calculateFilledRate("manufacturer"));
        this.setProgressCard("itmaProgStorageBar", "itmaProgStorageText", this.calculateFilledRate("storage_location"));
        this.setProgressCard("itmaProgSerialBar", "itmaProgSerialText", this.calculateFilledRate("serial_number"));
        this.setProgressCard("itmaProgAssetIdBar", "itmaProgAssetIdText", assetIdRate);


        this.initDashboardCardInteractions();
    }


    async createNewRow() {
        // 자산 추가는 전용 화면에서만 (목록에서 빈 행을 바로 만들지 않음)
        window.location.href = "/itma/assets/new";
    }

    async createEmptyRowLegacy() {
        try {
            const response = await fetch("/itma/assets/new-row", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({})
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.message || "새 항목을 생성하는 중 오류가 발생했습니다.");
            }
            await this.loadAssets();
        } catch (error) {
            alert(`새 항목 생성 중 오류: ${error.message}`);
        }
    }


    async deleteSelectedRows() {
        const ids = [...this.selectedIds];
        if (!ids.length) {
            alert("삭제할 항목을 선택해주세요.");
            return;
        }


        const confirmed = window.confirm(`선택한 ${ids.length}개의 항목을 삭제하시겠습니까?`);
        if (!confirmed) return;


        try {
            const response = await fetch("/itma/assets/delete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids })
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.message || "항목 삭제 중 오류가 발생했습니다.");
            }


            this.selectedIds.clear();
            await this.loadAssets();
        } catch (error) {
            alert(`항목 삭제 중 오류: ${error.message}`);
        }
    }


    downloadSelected() {
        if (!this.selectedIds.size) {
            alert("다운로드할 항목을 선택해주세요.");
            return;
        }
        const ids = [...this.selectedIds].join(",");
        window.location.href = `/itma/assets/download-selected?ids=${encodeURIComponent(ids)}`;
    }


    toggleSelectAllFiltered() {
        const filteredIds = this.filteredItems.map((item) => String(item.id));
        if (!filteredIds.length) return;
        const allSelected = filteredIds.every((id) => this.selectedIds.has(id));
        filteredIds.forEach((id) => {
            if (allSelected) {
                this.selectedIds.delete(id);
            } else {
                this.selectedIds.add(id);
            }
        });
        this.render();
        this.updateSelectAllButton();
    }


    toggleSelectCurrentPage(checked) {
        if (!this.currentPageItemIds.length) return;
        this.currentPageItemIds.forEach((id) => {
            if (checked) {
                this.selectedIds.add(id);
            } else {
                this.selectedIds.delete(id);
            }
        });
        this.render();
    }


    updateSelectCurrentPageCheckbox() {
        const checkbox = document.getElementById("itmaSelectPageCheckbox");
        if (!checkbox) return;
        const hasRows = this.currentPageItemIds.length > 0;
        checkbox.disabled = !hasRows;
        if (!hasRows) {
            checkbox.checked = false;
            checkbox.indeterminate = false;
            return;
        }
        const selectedCount = this.currentPageItemIds.filter((id) => this.selectedIds.has(id)).length;
        checkbox.checked = selectedCount === this.currentPageItemIds.length;
        checkbox.indeterminate = selectedCount > 0 && selectedCount < this.currentPageItemIds.length;
    }


    updateSelectAllButton() {
        const btn = document.getElementById("btnItmaSelectAll");
        const bulkBtn = document.getElementById("btnItmaBulkEdit");
        const deleteBtn = document.getElementById("btnItmaDeleteSelected");
        if (!btn) return;
        const hasAnyEdit = this.permissions?.can_edit_all || (Array.isArray(this.permissions?.edit_categories) && this.permissions.edit_categories.length > 0);
        const filteredIds = this.filteredItems.map((item) => String(item.id));
        const hasRows = filteredIds.length > 0;
        const allSelected = hasRows && filteredIds.every((id) => this.selectedIds.has(id));
        btn.disabled = !hasRows;
        if (bulkBtn) bulkBtn.disabled = this.selectedIds.size === 0 || !hasAnyEdit;
        if (deleteBtn) deleteBtn.disabled = this.selectedIds.size === 0 || !hasAnyEdit;
        btn.innerHTML = allSelected
            ? '<i class="bi bi-x-square"></i> 선택 해제'
            : '<i class="bi bi-check2-square"></i> 모두 선택';
    }


    openBulkEditModal() {
        if (!this.selectedIds.size) {
            alert("수정할 항목을 선택해주세요.");
            return;
        }
        const modalEl = document.getElementById("itmaBulkEditModal");
        if (!modalEl || typeof bootstrap === "undefined") return;
        const infoEl = document.getElementById("itmaBulkEditSelectionInfo");
        if (infoEl) infoEl.textContent = `선택된 항목 ${this.selectedIds.size}건`;
        this.clearBulkEditForm();
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }


    clearBulkEditForm() {
        document.querySelectorAll("#itmaBulkEditModal .itma-bulk-field").forEach((el) => {
            el.value = "";
        });
    }


    async applyBulkEdit() {
        const ids = [...this.selectedIds];
        if (!ids.length) {
            alert("수정할 항목을 선택해주세요.");
            return;
        }
        const updates = {};
        document.querySelectorAll("#itmaBulkEditModal .itma-bulk-field").forEach((el) => {
            const column = (el.dataset.column || "").trim();
            if (!column) return;
            const value = (el.value ?? "").trim();
            if (value === "") return;
            updates[column] = value;
        });


        if (!Object.keys(updates).length) {
            alert("수정할 항목을 입력해주세요.");
            return;
        }


        try {
            const response = await fetch("/itma/assets/batch-update", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids, updates })
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.message || "일괄 수정 중 오류가 발생했습니다.");
            }


            const modalEl = document.getElementById("itmaBulkEditModal");
            if (modalEl && typeof bootstrap !== "undefined") {
                bootstrap.Modal.getOrCreateInstance(modalEl).hide();
            }
            this.clearBulkEditForm();
            await this.loadAssets();
            alert(`일괄 수정 완료: ${data.updated_count || 0}건`);
        } catch (error) {
            alert(`일괄 수정 중 오류: ${error.message}`);
        }
    }


    populateDropdownFilters() {
        this.dropdownFilterColumns.forEach((column) => {
            const select = document.querySelector(`select.itma-filter[data-column="${column}"]`);
            if (!select) return;

            const previousValue = select.value || "";
            const uniqueValues = [...new Set(
                this.allItems
                    .map((item) => String(item?.[column] ?? "").trim())
                    .filter((value) => value !== "")
            )].sort((a, b) => a.localeCompare(b, "ko"));

            const optionsHtml = [
                '<option value="">선택 없음</option>',
                ...uniqueValues.map((value) => `<option value="${itmaEscapeHtml(value)}">${itmaEscapeHtml(value)}</option>`)
            ];
            select.innerHTML = optionsHtml.join("");
            select.value = uniqueValues.includes(previousValue) ? previousValue : "";
        });
    }


    clearFilters() {
        this.siteFilter = "";
        const hasGlobalSearch = !!this.globalSearchKeyword;
        document.querySelectorAll(".itma-filter").forEach((input) => {
            input.value = "";
        });
        if (hasGlobalSearch) {
            const globalSearchInput = document.getElementById("itmaGlobalSearchInput");
            if (globalSearchInput) globalSearchInput.value = "";
            this.loadAssets("");
            return;
        }
        this.applyFiltersAndSort();
    }


    toggleFilterPanel() {
        this.filterPanelVisible = !this.filterPanelVisible;
        this.setFilterRowVisibility(this.filterPanelVisible);
        this.updateFilterToggleButton();
        if (!this.filterPanelVisible) {
            this.clearFilters();
        }
    }


    setFilterRowVisibility(visible) {
        const filterRow = document.getElementById("itmaFilterRow");
        if (!filterRow) return;
        filterRow.classList.toggle("d-none", !visible);
    }


    updateFilterToggleButton() {
        const btn = document.getElementById("btnItmaToggleFilters");
        if (!btn) return;
        if (this.filterPanelVisible) {
            btn.classList.remove("btn-outline-secondary");
            btn.classList.add("btn-secondary");
            btn.innerHTML = '<i class="bi bi-funnel-fill"></i> △';
            return;
        }
        btn.classList.remove("btn-secondary");
        btn.classList.add("btn-outline-secondary");
        btn.innerHTML = '<i class="bi bi-funnel"></i> ▽';
    }


    initHeaderSortControls() {
        document.querySelectorAll(".itma-sortable").forEach((th) => {
            const column = th.dataset.column;
            if (!column) return;
            const currentText = th.textContent.trim();
            const isFixed = this.fixedColumnKeys.has(column);
            if (!th.querySelector(".itma-sort-label")) {
                th.textContent = "";
                const headWrap = document.createElement("div");
                headWrap.className = "itma-sort-head";
                const label = document.createElement("span");
                label.className = "itma-sort-label";
                label.textContent = currentText;
                if (!isFixed) {
                    const grip = document.createElement("span");
                    grip.className = "itma-col-drag-grip";
                    grip.title = "드래그로 컬럼 순서 변경";
                    grip.setAttribute("aria-hidden", "true");
                    grip.textContent = "⋮⋮";
                    headWrap.appendChild(grip);
                }
                headWrap.appendChild(label);
                th.appendChild(headWrap);
            }
            if (isFixed) {
                th.querySelector(".itma-col-drag-grip")?.remove();
            }

            if (!th.dataset.sortBound) {
                th.style.cursor = "pointer";
                th.setAttribute("role", "button");
                th.setAttribute("tabindex", "0");
                th.title = "정렬: 오름차순(빨강) -> 내림차순(파랑) -> 기본";
                th.addEventListener("click", (e) => {
                    if (e.target.closest(".itma-filter")) return;
                    this.toggleSortFromHeader(column);
                });
                th.addEventListener("keydown", (e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    this.toggleSortFromHeader(column);
                });
                th.dataset.sortBound = "true";
            }
        });


        this.updateSortIndicators();
    }


    toggleSortFromHeader(column) {
        if (this.sortColumn !== column) {
            this.sortColumn = column;
            this.sortDirection = "asc";
        } else if (this.sortDirection === "asc") {
            this.sortDirection = "desc";
        } else {
            this.sortColumn = null;
            this.sortDirection = "asc";
        }
        this.applyFiltersAndSort();
    }


    updateSortIndicators() {
        document.querySelectorAll(".itma-sortable").forEach((th) => {
            th.classList.remove("itma-sort-asc", "itma-sort-desc");
            if (th.dataset.column === this.sortColumn) {
                th.classList.add(this.sortDirection === "asc" ? "itma-sort-asc" : "itma-sort-desc");
            }
        });
    }

    getSortValue(item, column) {
        if (this.isCustomColumn(column)) {
            return this.getCustomCellValue(item?.id, column);
        }
        if (this.isDetailColumn(column)) {
            return this.getDetailCellValue(item?.id, column);
        }
        if (this.isSpecColumn(column)) {
            return this.getSpecCellValue(item?.id, column);
        }
        return item?.[column];
    }

    parseSortNumberValue(value) {
        const text = String(value ?? "").trim();
        if (!text) return null;
        const normalized = text.replace(/,/g, "");
        if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
        const num = Number(normalized);
        return Number.isFinite(num) ? num : null;
    }


    parseSortDateValue(value) {
        const text = String(value ?? "").trim();
        if (!text) return null;
        const normalized = text.includes("T") ? text : text.replace(" ", "T");
        const ts = Date.parse(normalized);
        return Number.isNaN(ts) ? null : ts;
    }


    updateFilterHighlights(filters = {}) {
        const table = document.getElementById("itmaTable");
        if (!table) return;


        table.querySelectorAll("thead .itma-sortable, thead .itma-filter, thead th").forEach((el) => {
            el.classList.remove("itma-filter-active");
        });
        table.querySelectorAll("tbody td[data-column]").forEach((td) => {
            td.classList.remove("itma-filter-active-cell");
        });


        Object.entries(filters).forEach(([column, keyword]) => {
            if (!keyword) return;
            table.querySelector(`thead .itma-sortable[data-column="${column}"]`)?.classList.add("itma-filter-active");
            const filterInput = table.querySelector(`thead .itma-filter[data-column="${column}"]`);
            if (filterInput) {
                filterInput.classList.add("itma-filter-active");
                filterInput.closest("th")?.classList.add("itma-filter-active");
            }
            table.querySelectorAll(`tbody td[data-column="${column}"]`).forEach((td) => {
                td.classList.add("itma-filter-active-cell");
            });
        });
    }


    normalizeUsageStatus(value) {
        const text = String(value ?? "").replace(/\s+/g, "");
        if (!text) return "";
        if (this.usageStatusOptions.includes(text)) return text;
        const upper = text.toUpperCase();
        if (["X", "N", "NO", "FALSE", "0"].includes(upper)) return "미사용";
        if (["O", "Y", "YES", "TRUE", "1"].includes(upper)) return "사용";
        return "";
    }

    isInactiveUsageStatus(value) {
        return ["미사용", "폐기"].includes(this.normalizeUsageStatus(value));
    }


    formatMonthValue(value) {
        const text = String(value ?? "").trim();
        if (!text) return "";
        const dotMatch = text.match(/^(\d{4})\.(\d{1,2})$/);
        if (dotMatch) return `${dotMatch[1]}-${dotMatch[2].padStart(2, "0")}`;
        const dateMatch = text.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
        if (dateMatch) return `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}`;
        return text;
    }


    monthToDisplay(value) {
        const v = this.formatMonthValue(value);
        if (!v) return "-";
        const [y, m] = v.split("-");
        return `${y}.${m}`;
    }


    formatYearMonthLabel(value) {
        const text = String(value ?? "").trim();
        if (!text) return "-";


        const monthValue = this.formatMonthValue(text);
        const normalized = String(monthValue ?? "").match(/^(\d{4})-(\d{2})$/);
        if (normalized) return `${normalized[1]}년 ${normalized[2]}월`;


        const direct = text.match(/^(\d{4})[.\-/](\d{1,2})/);
        if (direct) return `${direct[1]}년 ${direct[2].padStart(2, "0")}월`;


        const ts = Date.parse(text.replace(" ", "T"));
        if (!Number.isNaN(ts)) {
            const d = new Date(ts);
            return `${d.getFullYear()}년 ${String(d.getMonth() + 1).padStart(2, "0")}월`;
        }
        return "-";
    }


    getCurrentYearMonthLabel() {
        const now = new Date();
        return `${now.getFullYear()}년 ${String(now.getMonth() + 1).padStart(2, "0")}월`;
    }


    loadUsageStatusMonthMap() {
        try {
            const raw = localStorage.getItem("itmaUsageStatusMonthMap");
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return (parsed && typeof parsed === "object") ? parsed : {};
        } catch (_e) {
            return {};
        }
    }


    saveUsageStatusMonthMap() {
        try {
            localStorage.setItem("itmaUsageStatusMonthMap", JSON.stringify(this.usageStatusMonthMap || {}));
        } catch (_e) {
            // Ignore localStorage failures.
        }
    }


    getUsageStatusChangedMonth(item) {
        const key = String(item?.id || "");
        if (!key) return "";
        return String(this.usageStatusMonthMap[key] || "");
    }


    loadDurabilityConfig() {
        try {
            const raw = localStorage.getItem("itmaDurabilityConfig");
            if (!raw) return { y3: 3, y5: 5, y7: 7, y10: 10 };
            const parsed = JSON.parse(raw);
            return {
                y3: Math.max(1, Number(parsed.y3) || 3),
                y5: Math.max(1, Number(parsed.y5) || 5),
                y7: Math.max(1, Number(parsed.y7) || 7),
                y10: Math.max(1, Number(parsed.y10) || 10),
            };
        } catch (_e) {
            return { y3: 3, y5: 5, y7: 7, y10: 10 };
        }
    }

    isDurabilitySnoozed() {
        const raw = String(localStorage.getItem(this.durabilitySnoozeStorageKey) || "").trim();
        if (!raw) return false;
        const untilTs = Date.parse(raw);
        if (Number.isNaN(untilTs)) {
            localStorage.removeItem(this.durabilitySnoozeStorageKey);
            return false;
        }
        if (Date.now() >= untilTs) {
            localStorage.removeItem(this.durabilitySnoozeStorageKey);
            return false;
        }
        return true;
    }

    setDurabilitySnoozeDays(days) {
        const parsedDays = Number(days);
        if (!Number.isFinite(parsedDays) || parsedDays <= 0) return;
        const until = new Date(Date.now() + (parsedDays * 24 * 60 * 60 * 1000));
        localStorage.setItem(this.durabilitySnoozeStorageKey, until.toISOString());
        const modalEl = document.getElementById("itmaDurabilityModal");
        if (modalEl && typeof bootstrap !== "undefined") {
            bootstrap.Modal.getOrCreateInstance(modalEl).hide();
        }
    }


    setDurabilityConfigInputs() {
        const cfg = this.durabilityConfig;
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = String(val); };
        set("itmaDurabilityYear3", cfg.y3);
        set("itmaDurabilityYear5", cfg.y5);
        set("itmaDurabilityYear7", cfg.y7);
        set("itmaDurabilityYear10", cfg.y10);
    }


    applyDurabilityConfigFromModal() {
        const y3 = Number(document.getElementById("itmaDurabilityYear3")?.value || 3);
        const y5 = Number(document.getElementById("itmaDurabilityYear5")?.value || 5);
        const y7 = Number(document.getElementById("itmaDurabilityYear7")?.value || 7);
        const y10 = Number(document.getElementById("itmaDurabilityYear10")?.value || 10);
        this.durabilityConfig = {
            y3: Math.max(1, y3),
            y5: Math.max(Math.max(1, y3), y5),
            y7: Math.max(Math.max(Math.max(1, y3), y5), y7),
            y10: Math.max(Math.max(Math.max(Math.max(1, y3), y5), y7), y10),
        };
        localStorage.setItem("itmaDurabilityConfig", JSON.stringify(this.durabilityConfig));
        this.allItems.forEach((item) => this.enrichItem(item));
        this.applyFiltersAndSort();
        this.refreshDurabilityModalContent();
        this.flashDurabilityApplyButton();
    }


    flashDurabilityApplyButton() {
        const btn = document.getElementById("btnItmaDurabilityApply");
        if (!btn) return;
        const prevText = btn.textContent;
        btn.disabled = true;
        btn.textContent = "적용 완료";
        window.setTimeout(() => {
            btn.disabled = false;
            btn.textContent = prevText || "적용";
        }, 900);
    }


    getDurabilityAlarm(item) {
        const deliveryMonth = this.formatMonthValue(item?.delivery_month);
        const manufactureMonth = this.formatMonthValue(item?.manufacture_month);
        const baseMonthValue = deliveryMonth || manufactureMonth;
        if (!baseMonthValue) {
            return { years: 0, label: "기준년월 없음", level: "none", threshold: 0, isDue: false, baseMonth: "" };
        }

        const [y, m] = baseMonthValue.split("-").map((v) => Number(v));
        if (!y || !m) {
            return { years: 0, label: "기준년월 없음", level: "none", threshold: 0, isDue: false, baseMonth: "" };
        }

        const now = new Date();
        const currentMonth = now.getFullYear() * 12 + (now.getMonth() + 1);
        const baseMonth = y * 12 + m;
        const months = Math.max(0, currentMonth - baseMonth);
        const years = months / 12;

        const rawLife = Number.parseInt(String(item?.durability_life_years ?? item?.durability_years ?? "").trim(), 10);
        const customLife = Number.isFinite(rawLife) && rawLife > 0 ? rawLife : null;
        if (customLife) {
            const isDue = years >= customLife;
            return {
                years,
                label: `${customLife}년 기준`,
                level: isDue ? "custom_due" : "custom_ok",
                threshold: customLife,
                isDue,
                baseMonth: baseMonthValue,
            };
        }

        const cfg = this.durabilityConfig;
        if (years >= cfg.y10) return { years, label: `${cfg.y10}년 이상`, level: "critical", threshold: cfg.y10, isDue: true, baseMonth: baseMonthValue };
        if (years >= cfg.y7) return { years, label: `${cfg.y7}년 이상`, level: "danger", threshold: cfg.y7, isDue: true, baseMonth: baseMonthValue };
        if (years >= cfg.y5) return { years, label: `${cfg.y5}년 이상`, level: "warning", threshold: cfg.y5, isDue: true, baseMonth: baseMonthValue };
        if (years >= cfg.y3) return { years, label: `${cfg.y3}년 이상`, level: "notice", threshold: cfg.y3, isDue: true, baseMonth: baseMonthValue };
        return { years, label: `${cfg.y3}년 미만`, level: "ok", threshold: cfg.y3, isDue: false, baseMonth: baseMonthValue };
    }


    enrichItem(item) {
        item.usage_status = this.normalizeUsageStatus(item.usage_status);
        item.manufacture_month = this.formatMonthValue(item.manufacture_month);
        item.delivery_month = this.formatMonthValue(item.delivery_month);
        const lifeRaw = Number.parseInt(String(item.durability_years || "").trim(), 10);
        item.durability_life_years = Number.isFinite(lifeRaw) && lifeRaw > 0 ? lifeRaw : "";
        const alarm = this.getDurabilityAlarm(item);
        item.durability_alert_text = alarm.label;
        item.durability_elapsed_years = alarm.years;
        item.durability_level = alarm.level;
        item.durability_threshold_years = alarm.threshold;
        item.durability_is_due = Boolean(alarm.isDue);
        item.durability_base_month = alarm.baseMonth;
    }


    getDurabilityAlertItems() {
        return this.allItems
            .filter((item) => Boolean(item.durability_is_due))
            .sort((a, b) => Number(b.durability_elapsed_years || 0) - Number(a.durability_elapsed_years || 0));
    }


    refreshDurabilityModalContent() {
        this.setDurabilityConfigInputs();
        const cfg = this.durabilityConfig;
        const body = document.getElementById("itmaDurabilityBody");
        const summary = document.getElementById("itmaDurabilitySummary");
        if (!body || !summary) return;


        const rows = this.getDurabilityAlertItems();
        const keyword = this.getSearchKeyword("itmaDurabilitySearch");
        const filteredRows = !keyword ? rows : rows.filter((item) => {
            const blob = [
                item.manufacturer || "",
                item.item_name || "",
                item.serial_number || "",
                this.monthToDisplay(item.delivery_month),
                this.monthToDisplay(item.manufacture_month),
                this.monthToDisplay(item.durability_base_month),
                item.durability_threshold_years ? `${Number(item.durability_threshold_years)}년` : "",
                `${Number(item.durability_elapsed_years || 0).toFixed(1)}년`,
            ].join(" ").toLowerCase();
            return blob.includes(keyword);
        });


        if (!rows.length) {
            summary.textContent = `선택한 ${cfg.y3}/${cfg.y5}/${cfg.y7}/${cfg.y10} 기준에 해당하는 항목이 없습니다.`;
            body.innerHTML = '<tr><td colspan="7" class="text-muted text-center">해당하는 항목이 없습니다.</td></tr>';
            return;
        }

        if (!filteredRows.length) {
            summary.textContent = `선택한 ${cfg.y3}/${cfg.y5}/${cfg.y7}/${cfg.y10} 기준에 해당하는 항목이 없습니다. (총 ${rows.length}개)`;
            body.innerHTML = '<tr><td colspan="7" class="text-muted text-center">해당하는 항목이 없습니다.</td></tr>';
            return;
        }


        const limit = this.getModalRowsLimit();
        const visibleRows = filteredRows.slice(0, limit);
        summary.textContent = `선택한 ${cfg.y3}/${cfg.y5}/${cfg.y7}/${cfg.y10} 기준에 해당하는 항목이 있습니다. (총 ${rows.length}개, 필터링된 ${filteredRows.length}개, 표시된 ${visibleRows.length}개)`;
        body.innerHTML = visibleRows.map((item) => {
            const years = Number(item.durability_elapsed_years || 0);
            const threshold = Number(item.durability_threshold_years || 0);
            const overdueYears = Math.max(0, years - threshold);
            const manufacturer = itmaEscapeHtml(item.manufacturer || "-");
            const itemName = itmaEscapeHtml(item.item_name || "-");
            const serial = itmaEscapeHtml(item.serial_number || "-");
            const month = itmaEscapeHtml(this.monthToDisplay(item.durability_base_month));
            const lifeText = threshold > 0 ? `${threshold}년` : "-";
            const yearsText = `${years.toFixed(1)}년`;
            const overdueText = `${overdueYears.toFixed(1)}년`;
            return `<tr><td title="${manufacturer}">${manufacturer}</td><td title="${itemName}">${itemName}</td><td title="${serial}">${serial}</td><td title="${month}">${month}</td><td class="text-end" title="${itmaEscapeHtml(lifeText)}">${itmaEscapeHtml(lifeText)}</td><td class="text-end" title="${itmaEscapeHtml(yearsText)}">${itmaEscapeHtml(yearsText)}</td><td class="text-end" title="${itmaEscapeHtml(overdueText)}">${itmaEscapeHtml(overdueText)}</td></tr>`;
        }).join("");
    }


    maybeShowDurabilityModalOnLoad() {
        if (this.durabilityModalAutoShown) return;
        if (this.isDurabilitySnoozed()) return;
        if (!this.getDurabilityAlertItems().length) return;
        this.durabilityModalAutoShown = true;
        this.openDurabilityModal(true);
    }


    openDurabilityModal(_auto = false) {
        const modalEl = document.getElementById("itmaDurabilityModal");
        if (!modalEl || typeof bootstrap === "undefined") return;
        this.refreshDurabilityModalContent();
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }


    async openHistoryModal() {
        const modalEl = document.getElementById("itmaHistoryModal");
        if (!modalEl || typeof bootstrap === "undefined") return;
        await this.loadHistory();
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }


    historyText(value) {
        const text = String(value ?? "").trim();
        return text ? itmaEscapeHtml(text) : "-";
    }


    historyRawText(value) {
        const text = String(value ?? "").trim();
        return text || "-";
    }


    getModalRowsLimit() {
        if (this.rowsPerPage === "all") return Number.POSITIVE_INFINITY;
        const n = Number.parseInt(this.rowsPerPage, 10);
        return Number.isFinite(n) && n > 0 ? n : 30;
    }


    getSearchKeyword(id) {
        return String(document.getElementById(id)?.value || "").trim().toLowerCase();
    }


    getHistoryDisplayRowNo(item) {
        // 이력에는 화면 순번(필터에 따라 바뀜)이나 DB 내부 번호 대신 자산번호(asset_code)를 표시한다.
        const code = String(item?.asset_code || item?.snapshot?.asset_code || "").trim();
        if (code) return code;
        const id = String(item?.asset_id || "");
        if (!id) return "-";
        const target = this.allItems.find((x) => String(x.id) === id);
        return String(target?.asset_code || `#${id}`);
    }


    getHistoryDisplayItemName(item) {
        const snapName = String(item?.snapshot?.item_name || "").trim();
        if (snapName) return snapName;
        const id = String(item?.asset_id || "");
        if (!id) return "-";
        const target = this.allItems.find((x) => String(x.id) === id);
        return String(target?.item_name || "-");
    }


    getHistoryColumnLabel(column) {
        const map = {
            category: "카테고리",
            manufacturer: "제조사",
            item_name: "품명",
            serial_number: "시리얼 번호",
            received_date: "입고일",
            inbound_note: "입고 메모",
            released_date: "출고일",
            outbound_note: "출고 메모",
            storage_location: "보관 위치",
            detail_note: "상세 메모",
            sales_rep: "담당자",
            usage_status: "운영상태",
            manufacture_month: "제조년월",
            site: "사업장",
            asset_id: "자산번호",
            asset_details: "자산 세부 정보",
        };
        const key = String(column ?? "").trim();
        if (!key) return "";
        return map[key] || key;
    }


    getMemoColumnLabel(column) {
        const map = {
            inbound_note: "입고 메모",
            outbound_note: "출고 메모",
            detail_note: "상세 메모",
        };
        const key = String(column ?? "").trim();
        return map[key] || key || "메모";
    }


    ensureMemoPopupModal() {
        let modalEl = document.getElementById("itmaMemoPopupModal");
        if (modalEl) return modalEl;

        const wrapper = document.createElement("div");
        wrapper.innerHTML = `
            <div class="modal fade" id="itmaMemoPopupModal" tabindex="-1" aria-labelledby="itmaMemoPopupTitle" aria-hidden="true">
                <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="itmaMemoPopupTitle">메모</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="닫기"></button>
                        </div>
                        <div class="modal-body">
                            <pre id="itmaMemoPopupContent" class="mb-0 fw-bold" style="white-space: pre-wrap; word-break: break-word;"></pre>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">닫기</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        const created = wrapper.firstElementChild;
        if (!created) return null;
        document.body.appendChild(created);
        return document.getElementById("itmaMemoPopupModal");
    }


    showMemoPopup(column, value) {
        const text = String(value ?? "");
        if (!text.trim()) return;

        if (typeof bootstrap === "undefined") {
            alert(text);
            return;
        }

        const modalEl = this.ensureMemoPopupModal();
        if (!modalEl) return;
        const titleEl = modalEl.querySelector("#itmaMemoPopupTitle");
        const contentEl = modalEl.querySelector("#itmaMemoPopupContent");
        if (titleEl) titleEl.textContent = `${this.getMemoColumnLabel(column)} 메모`;
        if (contentEl) contentEl.textContent = text;
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }

    getAssetDetailValue(field, details = {}) {
        const value = details?.[field];
        if (typeof value === "boolean") return value;
        if (field === "purchase_datetime") {
            const raw = String(value ?? "").trim();
            if (!raw) return "";
            const normalized = raw.replace(" ", "T");
            if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized)) return normalized;
            if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(normalized)) return normalized.slice(0, 16);
            return normalized;
        }
        return String(value ?? "");
    }


    renderAssetDetailEmptyRow(colspan, message = "등록된 항목이 없습니다.") {
        return `<tr><td colspan="${colspan}" class="text-muted text-center py-3">${itmaEscapeHtml(message)}</td></tr>`;
    }


    renderAssetDetailDeleteButton(className, index, label = "항목 삭제") {
        return `<button type="button" class="btn btn-sm btn-outline-danger itma-detail-delete-btn ${className}" data-index="${index}" aria-label="${itmaEscapeHtml(label)}"><i class="bi bi-x-lg" aria-hidden="true"></i></button>`;
    }


    setAssetDetailTabLabel(tabId, label) {
        const labelEl = document.querySelector(`#${tabId} .itma-detail-tab-label`);
        const tabEl = document.getElementById(tabId);
        if (labelEl) {
            labelEl.textContent = label;
        } else if (tabEl) {
            tabEl.textContent = label;
        }
    }


    setAssetDetailTabBadge(tabId, value) {
        const badge = document.querySelector(`#${tabId} .itma-detail-tab-badge`);
        if (!badge) return;
        const text = value === null || value === undefined || value === "" || Number(value) <= 0 ? "" : String(value);
        badge.textContent = text;
        badge.classList.toggle("d-none", !text);
    }


    updateAssetDetailTabBadges() {
        this.setAssetDetailTabBadge("itmaDetailTabStatus", this.detailEquipmentChanges.length);
        this.setAssetDetailTabBadge("itmaDetailTabHistory", this.detailChanges.length);
        this.setAssetDetailTabBadge("itmaDetailTabDelivery", this.detailDeliveryChanges.length);
        this.setAssetDetailTabBadge("itmaDetailTabSecurity", this.detailSecurityChanges.length);
        this.setAssetDetailTabBadge("itmaDetailTabEquipment", this.detailCurrentCategory === "software"
            ? this.detailSoftwareItems.length
            : this.detailCurrentCategory === "license"
                ? this.detailLicenseItems.length
                : "");
        const hasDurability = Boolean(
            document.querySelector("#itmaAssetDetailModal .itma-detail-field[data-field=\"delivery_month\"]")?.value
            || document.querySelector("#itmaAssetDetailModal .itma-detail-field[data-field=\"durability_years\"]")?.value
        );
        this.setAssetDetailTabBadge("itmaDetailTabDurability", hasDurability ? "입력" : "");
    }


    showAssetDetailFeedback(message, type = "info") {
        const el = document.getElementById("itmaAssetDetailFeedback");
        if (!el) return;
        el.textContent = message || "";
        el.className = `itma-detail-feedback alert alert-${type}${message ? "" : " d-none"}`;
    }


    clearAssetDetailValidation() {
        const modalEl = document.getElementById("itmaAssetDetailModal");
        if (!modalEl) return;
        modalEl.querySelectorAll(".itma-detail-field.is-invalid").forEach((el) => {
            el.classList.remove("is-invalid");
            el.removeAttribute("aria-invalid");
        });
        modalEl.querySelectorAll(".itma-detail-inline-error").forEach((el) => el.remove());
    }


    markAssetDetailFieldInvalid(field, message) {
        const el = document.querySelector(`#itmaAssetDetailModal .itma-detail-field[data-field="${field}"]`);
        if (!el) return null;
        el.classList.add("is-invalid");
        el.setAttribute("aria-invalid", "true");
        const wrapper = el.closest(".col-md-1, .col-md-2, .col-md-3, .col-md-4, .col-md-6, .col-6") || el.parentElement;
        if (wrapper && !wrapper.querySelector(".itma-detail-inline-error")) {
            const errorEl = document.createElement("div");
            errorEl.className = "itma-detail-inline-error";
            errorEl.textContent = message;
            wrapper.appendChild(errorEl);
        }
        return el;
    }


    setAssetDetailSaveBusy(isBusy) {
        const btn = document.getElementById("btnItmaAssetDetailSave");
        if (!btn) return;
        if (isBusy) {
            if (!btn.dataset.originalHtml) btn.dataset.originalHtml = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>저장 중';
            return;
        }
        btn.disabled = false;
        if (btn.dataset.originalHtml) btn.innerHTML = btn.dataset.originalHtml;
    }


    renderAssetDetailEquipmentChanges() {
        const body = document.getElementById("itmaDetailEquipmentBody");
        if (!body) return;
        if (!this.detailEquipmentChanges.length) {
            body.innerHTML = this.renderAssetDetailEmptyRow(3);
            this.updateAssetDetailTabBadges();
            return;
        }
        body.innerHTML = this.detailEquipmentChanges.map((row, idx) => `
            <tr>
                <td>${itmaEscapeHtml(row.status_date || "")}</td>
                <td>${itmaEscapeHtml(row.equipment_status || "")}</td>
                <td class="text-center">${this.renderAssetDetailDeleteButton("itma-detail-equipment-del", idx, "장비상태 이력 삭제")}</td>
            </tr>
        `).join("");
        this.updateAssetDetailTabBadges();
    }


    syncCurrentEquipmentSummary() {
        let latest = {};
        if (this.detailEquipmentChanges.length) {
            latest = this.detailEquipmentChanges.reduce((picked, row) => {
                const pickedTs = Date.parse((picked?.status_date || "") + "T00:00:00");
                const rowTs = Date.parse((row?.status_date || "") + "T00:00:00");
                if (Number.isNaN(pickedTs) && !Number.isNaN(rowTs)) return row;
                if (!Number.isNaN(pickedTs) && Number.isNaN(rowTs)) return picked;
                if (!Number.isNaN(rowTs) && rowTs >= pickedTs) return row;
                return picked;
            }, this.detailEquipmentChanges[0]);
        }
        const setValue = (field, value) => {
            const el = document.querySelector(`#itmaAssetDetailModal .itma-detail-field[data-field="${field}"]`);
            if (el) el.value = value || "";
        };
        setValue("equipment_status", latest.equipment_status || "");
        setValue("equipment_status_date", latest.status_date || "");
    }


    addAssetDetailEquipmentRowFromInputs() {
        const dateEl = document.getElementById("itmaDetailEquipmentStatusDateInput");
        const statusEl = document.getElementById("itmaDetailEquipmentStatusInput");
        if (!dateEl || !statusEl) return;
        const row = {
            status_date: String(dateEl.value || "").trim(),
            equipment_status: String(statusEl.value || "").trim(),
        };
        if (!row.status_date && !row.equipment_status) return;
        this.detailEquipmentChanges.push(row);
        this.renderAssetDetailEquipmentChanges();
        this.syncCurrentEquipmentSummary();
        dateEl.value = "";
        statusEl.value = "";
    }


    renderAssetDetailSecurityChanges() {
        const body = document.getElementById("itmaDetailSecurityBody");
        if (!body) return;
        if (!this.detailSecurityChanges.length) {
            body.innerHTML = this.renderAssetDetailEmptyRow(7);
            this.updateAssetDetailTabBadges();
            return;
        }
        body.innerHTML = this.detailSecurityChanges.map((row, idx) => `
            <tr>
                <td>${itmaEscapeHtml(row.change_date || "")}</td>
                <td>${itmaEscapeHtml(row.pre_auth_type || "")}</td>
                <td>${itmaEscapeHtml(row.auth_completion_status || "")}</td>
                <td>${itmaEscapeHtml(row.auth_number || "")}</td>
                <td>${itmaEscapeHtml(row.auth_date || "")}</td>
                <td>${itmaEscapeHtml(row.crypto_verification_number || "")}</td>
                <td class="text-center">${this.renderAssetDetailDeleteButton("itma-detail-security-del", idx, "보안인증 이력 삭제")}</td>
            </tr>
        `).join("");
        this.updateAssetDetailTabBadges();
    }


    syncCurrentSecuritySummary() {
        let latest = {};
        if (this.detailSecurityChanges.length) {
            latest = this.detailSecurityChanges.reduce((picked, row) => {
                const pickedTs = Date.parse((picked?.change_date || "") + "T00:00:00");
                const rowTs = Date.parse((row?.change_date || "") + "T00:00:00");
                if (Number.isNaN(pickedTs) && !Number.isNaN(rowTs)) return row;
                if (!Number.isNaN(pickedTs) && Number.isNaN(rowTs)) return picked;
                if (!Number.isNaN(rowTs) && rowTs >= pickedTs) return row;
                return picked;
            }, this.detailSecurityChanges[0]);
        }
        const setValue = (field, value) => {
            const el = document.querySelector(`#itmaAssetDetailModal .itma-detail-field[data-field="${field}"]`);
            if (el) el.value = value || "";
        };
        setValue("pre_auth_type", latest.pre_auth_type || "");
        setValue("auth_completion_status", latest.auth_completion_status || "");
        setValue("auth_number", latest.auth_number || "");
        setValue("auth_date", latest.auth_date || "");
        setValue("crypto_verification_number", latest.crypto_verification_number || "");
    }


    addAssetDetailSecurityRowFromInputs() {
        const changeDateEl = document.getElementById("itmaDetailSecurityChangeDate");
        const preAuthTypeEl = document.getElementById("itmaDetailSecurityPreAuthType");
        const completionEl = document.getElementById("itmaDetailSecurityCompletionStatus");
        const authNumberEl = document.getElementById("itmaDetailSecurityAuthNumber");
        const authDateEl = document.getElementById("itmaDetailSecurityAuthDate");
        const cryptoEl = document.getElementById("itmaDetailSecurityCryptoNumber");
        if (!changeDateEl || !preAuthTypeEl || !completionEl || !authNumberEl || !authDateEl || !cryptoEl) return;

        const row = {
            change_date: String(changeDateEl.value || "").trim(),
            pre_auth_type: String(preAuthTypeEl.value || "").trim(),
            auth_completion_status: String(completionEl.value || "").trim(),
            auth_number: String(authNumberEl.value || "").trim(),
            auth_date: String(authDateEl.value || "").trim(),
            crypto_verification_number: String(cryptoEl.value || "").trim(),
        };
        if (!row.change_date && !row.pre_auth_type && !row.auth_completion_status && !row.auth_number && !row.auth_date && !row.crypto_verification_number) return;

        this.detailSecurityChanges.push(row);
        this.renderAssetDetailSecurityChanges();
        this.syncCurrentSecuritySummary();

        changeDateEl.value = "";
        preAuthTypeEl.value = "";
        completionEl.value = "";
        authNumberEl.value = "";
        authDateEl.value = "";
        cryptoEl.value = "";
    }


    renderAssetDetailChanges() {
        const body = document.getElementById("itmaDetailChangeBody");
        if (!body) return;
        if (!this.detailChanges.length) {
            body.innerHTML = this.renderAssetDetailEmptyRow(4);
            this.updateAssetDetailTabBadges();
            return;
        }
        body.innerHTML = this.detailChanges.map((row, idx) => `
            <tr>
                <td>${itmaEscapeHtml(row.change_date || "")}</td>
                <td>${itmaEscapeHtml(row.change_type || "")}</td>
                <td>${itmaEscapeHtml(row.change_note || "")}</td>
                <td class="text-center">${this.renderAssetDetailDeleteButton("itma-detail-change-del", idx, "변경이력 삭제")}</td>
            </tr>
        `).join("");
        this.updateAssetDetailTabBadges();
    }


    addAssetDetailChangeRowFromInputs() {
        const dateEl = document.getElementById("itmaDetailChangeDate");
        const typeEl = document.getElementById("itmaDetailChangeType");
        const noteEl = document.getElementById("itmaDetailChangeNote");
        if (!dateEl || !typeEl || !noteEl) return;
        const row = {
            change_date: String(dateEl.value || "").trim(),
            change_type: String(typeEl.value || "").trim(),
            change_note: String(noteEl.value || "").trim(),
        };
        if (!row.change_date && !row.change_type && !row.change_note) return;
        this.detailChanges.push(row);
        this.renderAssetDetailChanges();
        dateEl.value = "";
        typeEl.value = "";
        noteEl.value = "";
    }


    renderAssetDetailDeliveryChanges() {
        const body = document.getElementById("itmaDetailDeliveryBody");
        if (!body) return;
        if (!this.detailDeliveryChanges.length) {
            body.innerHTML = this.renderAssetDetailEmptyRow(9);
            this.updateAssetDetailTabBadges();
            return;
        }
        body.innerHTML = this.detailDeliveryChanges.map((row, idx) => `
            <tr>
                <td>${itmaEscapeHtml(row.change_date || "")}</td>
                <td>${itmaEscapeHtml(row.vendor_name || "")}</td>
                <td>${itmaEscapeHtml(row.vendor_contact || "")}</td>
                <td>${itmaEscapeHtml(row.vendor_phone || "")}</td>
                <td>${itmaEscapeHtml(row.vendor_mail || "")}</td>
                <td>${itmaEscapeHtml(row.maintenance_start_date || "")}</td>
                <td>${itmaEscapeHtml(row.maintenance_months || "")}</td>
                <td>${itmaEscapeHtml(row.maintenance_end_date || "")}</td>
                <td class="text-center">${this.renderAssetDetailDeleteButton("itma-detail-delivery-del", idx, "유지보수 이력 삭제")}</td>
            </tr>
        `).join("");
        this.updateAssetDetailTabBadges();
    }


    syncCurrentDeliverySummary() {
        let latest = {};
        if (this.detailDeliveryChanges.length) {
            latest = this.detailDeliveryChanges.reduce((picked, row) => {
                const pickedTs = Date.parse((picked?.change_date || "") + "T00:00:00");
                const rowTs = Date.parse((row?.change_date || "") + "T00:00:00");
                if (Number.isNaN(pickedTs) && !Number.isNaN(rowTs)) return row;
                if (!Number.isNaN(pickedTs) && Number.isNaN(rowTs)) return picked;
                if (!Number.isNaN(rowTs) && rowTs >= pickedTs) return row;
                return picked;
            }, this.detailDeliveryChanges[0]);
        }
        const summaryFieldIds = {
            vendor_name: "itmaDetailCurrentVendorName",
            maintenance_start_date: "itmaDetailCurrentMaintenanceStartDate",
            maintenance_months: "itmaDetailCurrentMaintenanceMonths",
            maintenance_end_date: "itmaDetailCurrentMaintenanceEndDate",
            vendor_contact: "itmaDetailCurrentVendorContact",
            vendor_phone: "itmaDetailCurrentVendorPhone",
            vendor_mail: "itmaDetailCurrentVendorMail",
        };
        const setValue = (field, value) => {
            const el = document.getElementById(summaryFieldIds[field]);
            if (el) el.value = value || "";
        };
        setValue("vendor_name", latest.vendor_name || "");
        setValue("maintenance_start_date", latest.maintenance_start_date || "");
        setValue("maintenance_months", latest.maintenance_months || "");
        setValue("maintenance_end_date", latest.maintenance_end_date || "");
        setValue("vendor_contact", latest.vendor_contact || "");
        setValue("vendor_phone", latest.vendor_phone || "");
        setValue("vendor_mail", latest.vendor_mail || "");
    }


    addAssetDetailDeliveryRowFromInputs() {
        const dateEl = document.getElementById("itmaDetailDeliveryDate");
        const vendorEl = document.getElementById("itmaDetailDeliveryVendorName");
        const startEl = document.getElementById("itmaDetailMaintenanceStartDate");
        const monthsEl = document.getElementById("itmaDetailMaintenanceMonths");
        const endEl = document.getElementById("itmaDetailMaintenanceEndDate");
        const contactEl = document.getElementById("itmaDetailDeliveryVendorContact");
        const phoneEl = document.getElementById("itmaDetailDeliveryVendorPhone");
        const mailEl = document.getElementById("itmaDetailDeliveryVendormail");
        if (!dateEl || !vendorEl || !startEl || !monthsEl || !endEl || !contactEl || !phoneEl || !mailEl) return;

        const row = {
            change_date: String(dateEl.value || "").trim(),
            vendor_name: String(vendorEl.value || "").trim(),
            maintenance_start_date: String(startEl.value || "").trim(),
            maintenance_months: String(monthsEl.value || "").trim(),
            maintenance_end_date: String(endEl.value || "").trim(),
            vendor_contact: String(contactEl.value || "").trim(),
            vendor_phone: String(phoneEl.value || "").trim(),
            vendor_mail: String(mailEl.value || "").trim(),
            change_note: "",
        };
        if (!row.change_date && !row.vendor_name && !row.vendor_contact && !row.vendor_phone && !row.vendor_mail && !row.maintenance_start_date && !row.maintenance_months) return;

        this.detailDeliveryChanges.push(row);
        this.renderAssetDetailDeliveryChanges();
        this.syncCurrentDeliverySummary();

        dateEl.value = "";
        vendorEl.value = "";
        startEl.value = "";
        monthsEl.value = "";
        endEl.value = "";
        contactEl.value = "";
        phoneEl.value = "";
        mailEl.value = "";
    }

    renderAssetDetailSoftwareItems() {
        const body = document.getElementById("itmaDetailSoftwareBody");
        if (!body) return;
        if (!this.detailSoftwareItems.length) {
            body.innerHTML = this.renderAssetDetailEmptyRow(8);
            this.updateAssetDetailTabBadges();
            return;
        }
        body.innerHTML = this.detailSoftwareItems.map((row, idx) => `
            <tr>
                <td>${itmaEscapeHtml(row.software_name || "")}</td>
                <td>${itmaEscapeHtml(row.version || "")}</td>
                <td>${itmaEscapeHtml(row.install_date || "")}</td>
                <td>${itmaEscapeHtml(row.expiry_date || "")}</td>
                <td>${itmaEscapeHtml(row.quantity || row.installed_quantity || "")}</td>
                <td>${itmaEscapeHtml(row.network_type || row.deployment_target || "")}</td>
                <td>${itmaEscapeHtml(row.note || row.change_note || "")}</td>
                <td class="text-center">${this.renderAssetDetailDeleteButton("itma-detail-software-del", idx, "소프트웨어 항목 삭제")}</td>
            </tr>
        `).join("");
        this.updateAssetDetailTabBadges();
    }

    addAssetDetailSoftwareRowFromInputs() {
        const nameEl = document.getElementById("itmaDetailSoftwareName");
        const versionEl = document.getElementById("itmaDetailSoftwareVersion");
        const installDateEl = document.getElementById("itmaDetailSoftwareInstallDate");
        const expiryDateEl = document.getElementById("itmaDetailSoftwareExpiryDate");
        const quantityEl = document.getElementById("itmaDetailSoftwareInstalledQuantity");
        const targetEl = document.getElementById("itmaDetailSoftwareDeploymentTarget");
        const noteEl = document.getElementById("itmaDetailSoftwareChangeNote");
        if (!nameEl || !versionEl || !installDateEl || !expiryDateEl || !quantityEl || !targetEl || !noteEl) return;

        const row = {
            software_name: String(nameEl.value || "").trim(),
            version: String(versionEl.value || "").trim(),
            install_date: String(installDateEl.value || "").trim(),
            expiry_date: String(expiryDateEl.value || "").trim(),
            installed_quantity: String(quantityEl.value || "").trim(),
            quantity: String(quantityEl.value || "").trim(),
            deployment_target: String(targetEl.value || "").trim(),
            network_type: String(targetEl.value || "").trim(),
            change_note: String(noteEl.value || "").trim(),
            note: String(noteEl.value || "").trim(),
        };
        if (!row.software_name && !row.version && !row.install_date && !row.expiry_date && !row.installed_quantity && !row.deployment_target && !row.change_note) return;
        this.detailSoftwareItems.push(row);
        this.renderAssetDetailSoftwareItems();

        nameEl.value = "";
        versionEl.value = "";
        installDateEl.value = "";
        expiryDateEl.value = "";
        quantityEl.value = "";
        targetEl.value = "";
        noteEl.value = "";
    }

    renderAssetDetailLicenseItems() {
        const body = document.getElementById("itmaDetailLicenseBody");
        if (!body) return;
        if (!this.detailLicenseItems.length) {
            body.innerHTML = this.renderAssetDetailEmptyRow(8);
            this.updateAssetDetailTabBadges();
            return;
        }
        body.innerHTML = this.detailLicenseItems.map((row, idx) => `
            <tr>
                <td>${itmaEscapeHtml(row.license_name || "")}</td>
                <td>${itmaEscapeHtml(row.version || "")}</td>
                <td>${itmaEscapeHtml(row.install_date || "")}</td>
                <td>${itmaEscapeHtml(row.expiry_date || "")}</td>
                <td>${itmaEscapeHtml(row.quantity || row.license_quantity || "")}</td>
                <td>${itmaEscapeHtml(row.network_type || row.vendor_name || "")}</td>
                <td>${itmaEscapeHtml(row.note || row.change_note || "")}</td>
                <td class="text-center">${this.renderAssetDetailDeleteButton("itma-detail-license-del", idx, "라이선스 항목 삭제")}</td>
            </tr>
        `).join("");
        this.updateAssetDetailTabBadges();
    }

    addAssetDetailLicenseRowFromInputs() {
        const nameEl = document.getElementById("itmaDetailLicenseName");
        const versionEl = document.getElementById("itmaDetailLicenseVersion");
        const installEl = document.getElementById("itmaDetailLicenseInstallDate");
        const quantityEl = document.getElementById("itmaDetailLicenseQuantity");
        const expiryEl = document.getElementById("itmaDetailLicenseExpiryDate");
        const networkEl = document.getElementById("itmaDetailLicenseNetworkType");
        const noteEl = document.getElementById("itmaDetailLicenseChangeNote");
        if (!nameEl || !versionEl || !installEl || !quantityEl || !expiryEl || !networkEl || !noteEl) return;

        const row = {
            license_name: String(nameEl.value || "").trim(),
            version: String(versionEl.value || "").trim(),
            install_date: String(installEl.value || "").trim(),
            license_quantity: String(quantityEl.value || "").trim(),
            quantity: String(quantityEl.value || "").trim(),
            expiry_date: String(expiryEl.value || "").trim(),
            network_type: String(networkEl.value || "").trim(),
            vendor_name: String(networkEl.value || "").trim(),
            change_note: String(noteEl.value || "").trim(),
            note: String(noteEl.value || "").trim(),
        };
        if (!row.license_name && !row.version && !row.install_date && !row.license_quantity && !row.expiry_date && !row.network_type && !row.change_note) return;
        this.detailLicenseItems.push(row);
        this.renderAssetDetailLicenseItems();

        nameEl.value = "";
        versionEl.value = "";
        installEl.value = "";
        quantityEl.value = "";
        expiryEl.value = "";
        networkEl.value = "";
        noteEl.value = "";
    }


    syncEquipmentStatusDate() {
        const statusEl = document.getElementById("itmaDetailEquipmentStatusInput");
        const dateEl = document.getElementById("itmaDetailEquipmentStatusDateInput");
        if (!statusEl || !dateEl) return;
        if (!statusEl.value || dateEl.value) return;
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, "0");
        const d = String(now.getDate()).padStart(2, "0");
        dateEl.value = `${y}-${m}-${d}`;
    }


    refreshMaintenanceEndDate() {
        const startEl = document.getElementById("itmaDetailMaintenanceStartDate");
        const monthsEl = document.getElementById("itmaDetailMaintenanceMonths");
        const endEl = document.getElementById("itmaDetailMaintenanceEndDate");
        if (!startEl || !monthsEl || !endEl) return;
        const start = String(startEl.value || "").trim();
        const monthsRaw = String(monthsEl.value || "").trim();
        const months = Number.parseInt(monthsRaw, 10);
        if (!start || !Number.isFinite(months) || months < 0) {
            endEl.value = "";
            return;
        }
        const dt = new Date(`${start}T00:00:00`);
        if (Number.isNaN(dt.getTime())) {
            endEl.value = "";
            return;
        }
        dt.setMonth(dt.getMonth() + months);
        const y = dt.getFullYear();
        const m = String(dt.getMonth() + 1).padStart(2, "0");
        const d = String(dt.getDate()).padStart(2, "0");
        endEl.value = `${y}-${m}-${d}`;
    }


    handleAssetDetailModalClick(e) {
        const specDelBtn = e.target.closest(".itma-spec-del");
        if (specDelBtn) {
            this.removeSpecItemRow(Number.parseInt(specDelBtn.dataset.index || "", 10));
            return;
        }
        const equipmentDelBtn = e.target.closest(".itma-detail-equipment-del");
        if (equipmentDelBtn) {
            const idx = Number.parseInt(equipmentDelBtn.dataset.index || "", 10);
            if (!Number.isInteger(idx) || idx < 0 || idx >= this.detailEquipmentChanges.length) return;
            this.detailEquipmentChanges.splice(idx, 1);
            this.renderAssetDetailEquipmentChanges();
            this.syncCurrentEquipmentSummary();
            return;
        }
        const securityDelBtn = e.target.closest(".itma-detail-security-del");
        if (securityDelBtn) {
            const idx = Number.parseInt(securityDelBtn.dataset.index || "", 10);
            if (!Number.isInteger(idx) || idx < 0 || idx >= this.detailSecurityChanges.length) return;
            this.detailSecurityChanges.splice(idx, 1);
            this.renderAssetDetailSecurityChanges();
            this.syncCurrentSecuritySummary();
            return;
        }
        const changeDelBtn = e.target.closest(".itma-detail-change-del");
        if (changeDelBtn) {
            const idx = Number.parseInt(changeDelBtn.dataset.index || "", 10);
            if (!Number.isInteger(idx) || idx < 0 || idx >= this.detailChanges.length) return;
            this.detailChanges.splice(idx, 1);
            this.renderAssetDetailChanges();
            return;
        }
        const deliveryDelBtn = e.target.closest(".itma-detail-delivery-del");
        if (deliveryDelBtn) {
            const idx = Number.parseInt(deliveryDelBtn.dataset.index || "", 10);
            if (!Number.isInteger(idx) || idx < 0 || idx >= this.detailDeliveryChanges.length) return;
            this.detailDeliveryChanges.splice(idx, 1);
            this.renderAssetDetailDeliveryChanges();
            this.syncCurrentDeliverySummary();
            return;
        }
        const softwareDelBtn = e.target.closest(".itma-detail-software-del");
        if (softwareDelBtn) {
            const idx = Number.parseInt(softwareDelBtn.dataset.index || "", 10);
            if (!Number.isInteger(idx) || idx < 0 || idx >= this.detailSoftwareItems.length) return;
            this.detailSoftwareItems.splice(idx, 1);
            this.renderAssetDetailSoftwareItems();
            return;
        }
        const licenseDelBtn = e.target.closest(".itma-detail-license-del");
        if (licenseDelBtn) {
            const idx = Number.parseInt(licenseDelBtn.dataset.index || "", 10);
            if (!Number.isInteger(idx) || idx < 0 || idx >= this.detailLicenseItems.length) return;
            this.detailLicenseItems.splice(idx, 1);
            this.renderAssetDetailLicenseItems();
            return;
        }
    }

    applyDetailModalMode(category) {
        const tabEquipment = document.getElementById("itmaDetailTabEquipment");
        const tabStatus = document.getElementById("itmaDetailTabStatus");
        const tabHistory = document.getElementById("itmaDetailTabHistory");
        const tabDelivery = document.getElementById("itmaDetailTabDelivery");
        const tabDurability = document.getElementById("itmaDetailTabDurability");
        const tabSecurity = document.getElementById("itmaDetailTabSecurity");
        const secEquipment = document.getElementById("itmaDetailEquipmentSection");
        const secEquipmentStatus = document.getElementById("itmaDetailPaneStatus");
        const secSoftware = document.getElementById("itmaDetailSoftwareSection");
        const secLicense = document.getElementById("itmaDetailLicenseSection");
        const paneDurability = document.getElementById("itmaDetailPaneDurability");
        const btnPcSave = document.getElementById("btnItmaAssetDetailSave");
        const btnSoftwareSave = document.getElementById("btnItmaAssetSoftwareSave");
        const btnLicenseSave = document.getElementById("btnItmaAssetLicenseSave");

        const isSoftware = category === "software";
        const isLicense = category === "license";
        const isPcStyle = !isSoftware && !isLicense;

        this.setAssetDetailTabLabel("itmaDetailTabEquipment", isSoftware ? "소프트웨어" : isLicense ? "라이선스" : "장비");
        if (tabStatus) tabStatus.classList.toggle("d-none", isSoftware || isLicense);
        if (tabHistory) tabHistory.classList.remove("d-none");
        if (tabDelivery) tabDelivery.classList.remove("d-none");
        if (tabDurability) tabDurability.classList.toggle("d-none", !isPcStyle);
        if (tabSecurity) tabSecurity.classList.toggle("d-none", !isPcStyle);
        if (paneDurability) paneDurability.classList.toggle("d-none", !isPcStyle);
        if (secEquipment) secEquipment.classList.toggle("d-none", !isPcStyle);
        if (secEquipmentStatus) secEquipmentStatus.classList.toggle("d-none", isSoftware || isLicense);
        if (secSoftware) secSoftware.classList.toggle("d-none", !isSoftware);
        if (secLicense) secLicense.classList.toggle("d-none", !isLicense);
        if (btnPcSave) btnPcSave.classList.toggle("d-none", !isPcStyle);
        if (btnSoftwareSave) btnSoftwareSave.classList.toggle("d-none", !isSoftware);
        if (btnLicenseSave) btnLicenseSave.classList.toggle("d-none", !isLicense);

        if (tabEquipment && typeof bootstrap !== "undefined") {
            bootstrap.Tab.getOrCreateInstance(tabEquipment).show();
        }
        this.updateAssetDetailTabBadges();
    }

    normalizeDetailCategory(category) {
        return this.normalizePermissionCategory(category);
    }

    supportsDynamicSpecForms(category) {
        const normalized = String(category || "").trim();
        return normalized !== "" && !["software", "license"].includes(normalized);
    }

    ensureSpecItemRows() {
        if (!Array.isArray(this.detailSpecItems) || !this.detailSpecItems.length) {
            this.detailSpecItems = [{ label: "", value: "", display_order: 0 }];
        }
    }

    renderSpecItems() {
        const body = document.getElementById("itmaSpecItemsBody");
        if (!body) return;
        this.ensureSpecItemRows();
        body.innerHTML = this.detailSpecItems.map((row, idx) => `
            <tr>
                <td><input type="text" class="form-control form-control-sm itma-spec-label" data-index="${idx}" data-source-form-item-id="${Number(row.source_form_item_id) || ""}" value="${itmaEscapeHtml(row.label || "")}" placeholder="예: CPU" ${row.source_form_item_id ? "readonly" : ""}></td>
                <td><input type="text" class="form-control form-control-sm itma-spec-value" data-index="${idx}" value="${itmaEscapeHtml(row.value || "")}" placeholder="예: Intel Xeon"></td>
                <td class="text-center"><button type="button" class="btn btn-sm btn-outline-danger itma-spec-del" data-index="${idx}" aria-label="삭제"><i class="bi bi-x-lg"></i></button></td>
            </tr>
        `).join("");
    }

    collectSpecItemsFromDom() {
        const rows = [];
        document.querySelectorAll("#itmaSpecItemsBody tr").forEach((rowEl, idx) => {
            const label = String(rowEl.querySelector(".itma-spec-label")?.value || "").trim();
            const value = String(rowEl.querySelector(".itma-spec-value")?.value || "").trim();
            if (!label) return;
            const sourceId = rowEl.querySelector(".itma-spec-label")?.dataset.sourceFormItemId;
            rows.push({ label, value, display_order: idx, ...(sourceId ? { source_form_item_id: Number(sourceId) } : {}) });
        });
        this.detailSpecItems = rows.length ? rows : [{ label: "", value: "", display_order: 0 }];
        return rows;
    }

    addSpecItemRow() {
        this.collectSpecItemsFromDom();
        this.detailSpecItems.push({ label: "", value: "", display_order: this.detailSpecItems.length });
        this.renderSpecItems();
    }

    removeSpecItemRow(index) {
        this.collectSpecItemsFromDom();
        this.detailSpecItems = this.detailSpecItems.filter((_, idx) => idx !== Number(index));
        this.ensureSpecItemRows();
        this.detailSpecItems = this.detailSpecItems.map((item, idx) => ({ ...item, display_order: idx }));
        this.renderSpecItems();
    }

    renderSpecFormOptions() {
        const selectEl = document.getElementById("itmaSpecFormSelect");
        if (!selectEl) return;
        const selectedId = selectEl.value;
        const options = ['<option value="">저장된 스펙 폼 선택</option>'];
        this.specForms.forEach((form) => {
            options.push(`<option value="${itmaEscapeHtml(String(form.id))}">${itmaEscapeHtml(form.form_name || "")}</option>`);
        });
        selectEl.innerHTML = options.join("");
        if (this.specForms.some((form) => String(form.id) === selectedId)) selectEl.value = selectedId;
    }

    async loadSpecFormsForCurrentCategory() {
        if (!this.supportsDynamicSpecForms(this.detailCurrentCategory)) {
            this.specForms = [];
            this.renderSpecFormOptions();
            return;
        }
        const response = await fetch(`/itma/spec-forms?category=${encodeURIComponent(this.detailCurrentCategory)}`, { headers: { Accept: "application/json" } });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || "스펙 폼 조회 실패");
        }
        this.specForms = Array.isArray(data.forms) ? data.forms : [];
        this.renderSpecFormOptions();
    }

    async applySelectedSpecForm() {
        const formId = document.getElementById("itmaSpecFormSelect")?.value || "";
        if (!formId) {
            alert("불러올 스펙 폼을 선택해주세요.");
            return;
        }
        const targetForm = this.specForms.find((form) => String(form.id) === String(formId));
        if (!targetForm) {
            alert("대상 스펙 폼을 찾을 수 없습니다.");
            return;
        }
        if (!confirm("현재 추가 스펙 항목을 선택한 폼 내용으로 교체하시겠습니까?")) return;
        const currentItems = this.collectSpecItemsFromDom();
        this.detailSpecItems = Array.isArray(targetForm.items) && targetForm.items.length
            ? targetForm.items.map((item, idx) => ({
                label: String(item.label || ""),
                value: currentItems.find((row) => Number(row.source_form_item_id) === Number(item.id))?.value || "",
                display_order: idx,
                source_form_item_id: Number(item.id) || null,
            }))
            : [{ label: "", value: "", display_order: 0 }];
        this.renderSpecItems();
    }

    async saveCurrentSpecForm() {
        if (!this.supportsDynamicSpecForms(this.detailCurrentCategory)) return;
        if (!this.canEditCategory(this.detailCurrentCategory)) {
            alert("스펙 폼 저장 권한이 없습니다.");
            return;
        }
        const selectedId = document.getElementById("itmaSpecFormSelect")?.value;
        const selectedForm = this.specForms.find((form) => String(form.id) === String(selectedId));
        const formName = selectedForm?.form_name || String(window.prompt("저장할 스펙 폼 이름을 입력해주세요.") || "").trim();
        if (!formName) return;
        const items = this.collectSpecItemsFromDom();
        if (!items.length) {
            alert("저장할 스펙 항목을 입력해주세요.");
            return;
        }
        const existing = selectedForm || this.specForms.find((form) => String(form.form_name || "").trim() === formName);
        if (existing && !confirm(`"${formName}" 폼이 이미 있습니다. 덮어쓰시겠습니까?`)) return;
        const response = await fetch("/itma/spec-forms", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                id: existing?.id || null,
                category_key: this.detailCurrentCategory,
                form_name: formName,
                description: existing?.description || "",
                items: items.map((item, idx) => ({
                    id: existing?.items?.find((row) => Number(row.id) === Number(item.source_form_item_id))?.id
                        || existing?.items?.find((row) => row.label === item.label)?.id || null,
                    show_in_list: existing?.items?.find((row) => Number(row.id) === Number(item.source_form_item_id) || row.label === item.label)?.show_in_list === true,
                    label: String(item.label || "").trim(),
                    value: "",
                    display_order: idx,
                })),
            }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || "스펙 폼 저장 실패");
        }
        this.detailSpecItems = items.map((item, idx) => ({
            ...item,
            source_form_item_id: Number(data.form?.items?.[idx]?.id) || null,
        }));
        this.renderSpecItems();
        await this.loadSpecFormsForCurrentCategory();
        const selectEl = document.getElementById("itmaSpecFormSelect");
        if (selectEl && data.form?.id) {
            selectEl.value = String(data.form.id);
        }
        alert("스펙 폼이 저장되었습니다.");
    }

    applyPcPrinterFieldVisibility(category) {
        const isPcOrPrinter = category === "pc" || category === "printer";
        const showPcUser = category === "pc";
        const showPrinterGroup = category === "printer" || category === "pc" || category === "hardware" || category === "network" || category === "server";
        const isOther = category === "other" || category === "hardware" || category === "network" || category === "security" || category === "server" || category === "solution" || category === "cloud";
        const specRow = document.querySelector("#itmaAssetDetailModal .itma-spec-row");
        const legacySpecRow = document.getElementById("itmaLegacySpecRow");
        const specFormSection = document.getElementById("itmaSpecFormSection");
        document.querySelectorAll("#itmaAssetDetailModal .itma-pc-only").forEach((el) => {
            el.classList.toggle("d-none", !showPcUser || isOther);
        });
        document.querySelectorAll("#itmaAssetDetailModal .itma-printer-only").forEach((el) => {
            el.classList.toggle("d-none", !showPrinterGroup || isOther);
        });
        if (legacySpecRow) legacySpecRow.classList.add("d-none");
        if (specRow) specRow.classList.toggle("d-none", !this.supportsDynamicSpecForms(category));
        if (specFormSection) {
            specFormSection.classList.toggle("d-none", !this.supportsDynamicSpecForms(category));
        }

        const securityTabBtn = document.getElementById("itmaDetailTabSecurity");
        const securityPane = document.getElementById("itmaDetailPaneSecurity");
        const isAltMode = category === "software" || category === "license";
        if (isAltMode) return;
        if (securityTabBtn) {
            securityTabBtn.classList.toggle("d-none", isPcOrPrinter);
        }
        if (securityPane) {
            securityPane.classList.toggle("d-none", isPcOrPrinter);
            if (isPcOrPrinter && securityPane.classList.contains("active")) {
                const equipTabBtn = document.getElementById("itmaDetailTabEquipment");
                if (equipTabBtn && typeof bootstrap !== "undefined") {
                    bootstrap.Tab.getOrCreateInstance(equipTabBtn).show();
                }
            }
        }
    }

    buildAssetDetailTargetText(item) {
        const rowNo = item?.row_no || "-";
        const assetIdText = item?.asset_id || "-";
        const itemName = item?.item_name || "-";
        return `행 번호 ${rowNo} / 자산번호 ${assetIdText} / 품명 ${itemName}`;
    }


    buildAssetDetailTargetHtml(item, category) {
        const categoryText = item?.category || category || "-";
        const rowNo = item?.row_no || "-";
        const assetIdText = item?.asset_id || "-";
        const itemName = item?.item_name || "-";
        const parts = [
            ["구분", categoryText],
            ["행", rowNo],
            ["자산번호", assetIdText],
            ["품명", itemName],
        ];
        return parts.map(([label, value], idx) => `
            ${idx ? '<span class="itma-detail-summary-divider" aria-hidden="true">/</span>' : ""}
            <span class="itma-detail-summary-item">
                <span class="itma-detail-summary-label">${itmaEscapeHtml(label)}</span>
                <span class="itma-detail-summary-value">${itmaEscapeHtml(value)}</span>
            </span>
        `).join("");
    }

    async loadAssetDetailState(assetId) {
        this.detailCurrentAssetId = String(assetId);
        this.detailEquipmentChanges = [];
        this.detailSecurityChanges = [];
        this.detailChanges = [];
        this.detailDeliveryChanges = [];
        this.detailSoftwareItems = [];
        this.detailLicenseItems = [];
        this.detailSpecItems = [];
        this.populateAssetDetailForm({});
        await this.loadSpecFormsForCurrentCategory();
        const response = await fetch(`/itma/assets/${assetId}/details`, { headers: { Accept: "application/json" } });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || "자산 세부 정보 조회 실패");
        }
        this.populateAssetDetailForm(data.details || {});
        const linkedIds = this.detailSpecItems.map((item) => Number(item.source_form_item_id)).filter(Boolean);
        const linkedForm = this.specForms.find((form) => linkedIds.length && linkedIds.every((id) => form.items.some((item) => Number(item.id) === id)))
            || (this.specForms.length === 1 ? this.specForms[0] : null);
        if (linkedForm) {
            const previousItems = this.detailSpecItems;
            const matchedItems = new Set();
            this.detailSpecItems = linkedForm.items.map((item, idx) => {
                const previous = previousItems.find((row) => Number(row.source_form_item_id) === Number(item.id))
                    || previousItems.find((row) => !row.source_form_item_id && row.label === item.label);
                if (previous) matchedItems.add(previous);
                return { label: item.label, value: previous?.value || "", display_order: idx, source_form_item_id: Number(item.id) };
            });
            this.detailSpecItems.push(...previousItems.filter((row) => !matchedItems.has(row) && !row.source_form_item_id && row.label));
            const selectEl = document.getElementById("itmaSpecFormSelect");
            if (selectEl) selectEl.value = String(linkedForm.id);
            this.renderSpecItems();
        }
    }


    populateAssetDetailForm(details = {}) {
        document.querySelectorAll("#itmaAssetDetailModal .itma-detail-field").forEach((el) => {
            const field = el.dataset.field;
            if (!field) return;
            if (el.type === "checkbox") {
                el.checked = Boolean(details[field]);
                return;
            }
            el.value = this.getAssetDetailValue(field, details);
        });
        this.detailEquipmentChanges = Array.isArray(details.equipment_changes) ? details.equipment_changes.map((x) => ({
            status_date: String(x?.status_date || ""),
            equipment_status: String(x?.equipment_status || ""),
        })) : [];
        this.renderAssetDetailEquipmentChanges();
        if (this.detailEquipmentChanges.length) {
            this.syncCurrentEquipmentSummary();
        }
        this.detailSecurityChanges = Array.isArray(details.security_changes) ? details.security_changes.map((x) => ({
            change_date: String(x?.change_date || ""),
            pre_auth_type: String(x?.pre_auth_type || ""),
            auth_completion_status: String(x?.auth_completion_status || ""),
            auth_number: String(x?.auth_number || ""),
            auth_date: String(x?.auth_date || ""),
            crypto_verification_number: String(x?.crypto_verification_number || ""),
        })) : [];
        this.renderAssetDetailSecurityChanges();
        if (this.detailSecurityChanges.length) {
            this.syncCurrentSecuritySummary();
        }
        this.detailChanges = Array.isArray(details.detail_changes) ? details.detail_changes.map((x) => ({
            change_date: String(x?.change_date || ""),
            change_type: String(x?.change_type || ""),
            change_note: String(x?.change_note || ""),
        })) : [];
        this.renderAssetDetailChanges();
        this.detailDeliveryChanges = Array.isArray(details.delivery_changes) ? details.delivery_changes.map((x) => ({
            change_date: String(x?.change_date || ""),
            vendor_name: String(x?.vendor_name || ""),
            maintenance_start_date: String(x?.maintenance_start_date || ""),
            maintenance_months: String(x?.maintenance_months || ""),
            maintenance_end_date: String(x?.maintenance_end_date || ""),
            vendor_contact: String(x?.vendor_contact || ""),
            vendor_phone: String(x?.vendor_phone || ""),
            vendor_mail: String(x?.vendor_mail || ""),
            change_note: String(x?.change_note || ""),
        })) : [];
        this.renderAssetDetailDeliveryChanges();
        this.syncCurrentDeliverySummary();
        this.detailSoftwareItems = Array.isArray(details.software_items) ? details.software_items.map((x) => ({
            software_name: String(x?.software_name || ""),
            version: String(x?.version || ""),
            install_date: String(x?.install_date || ""),
            installed_quantity: String(x?.installed_quantity || ""),
            deployment_target: String(x?.deployment_target || ""),
            status: String(x?.status || ""),
            change_note: String(x?.change_note || ""),
        })) : [];
        this.renderAssetDetailSoftwareItems();
        this.detailLicenseItems = Array.isArray(details.license_items) ? details.license_items.map((x) => ({
            license_name: String(x?.license_name || ""),
            license_quantity: String(x?.license_quantity || ""),
            vendor_name: String(x?.vendor_name || ""),
            expiry_date: String(x?.expiry_date || ""),
            compliance_status: String(x?.compliance_status || ""),
            change_note: String(x?.change_note || ""),
        })) : [];
        this.renderAssetDetailLicenseItems();
        this.detailSpecItems = Array.isArray(details.spec_items) && details.spec_items.length ? details.spec_items.map((x, idx) => ({
            label: String(x?.label || x?.spec_label || ""),
            value: String(x?.value || x?.spec_value || ""),
            display_order: Number.isFinite(Number(x?.display_order)) ? Number(x.display_order) : idx,
            source_form_item_id: Number(x?.source_form_item_id) || null,
        })) : [{ label: "", value: "", display_order: 0 }];
        this.renderSpecItems();
        this.refreshMaintenanceEndDate();

        const updatedInfoEl = document.getElementById("itmaAssetDetailUpdatedInfo");
        const softwareUpdatedInfoEl = document.getElementById("itmaAssetSoftwareUpdatedInfo");
        const licenseUpdatedInfoEl = document.getElementById("itmaAssetLicenseUpdatedInfo");
        const updatedAt = String(details.updated_at || "").trim();
        const updatedBy = String(details.updated_by || "").trim();
        const updatedText = updatedAt ? `최종 수정: ${updatedAt}${updatedBy ? ` (${updatedBy})` : ""}` : "최종 수정: -";
        if (updatedInfoEl) {
            updatedInfoEl.textContent = updatedText;
        }
        if (softwareUpdatedInfoEl) softwareUpdatedInfoEl.textContent = updatedText;
        if (licenseUpdatedInfoEl) licenseUpdatedInfoEl.textContent = updatedText;
        this.updateAssetDetailTabBadges();
    }


    collectAssetDetailForm() {
        const payload = {};
        document.querySelectorAll("#itmaAssetDetailModal .itma-detail-field").forEach((el) => {
            const field = el.dataset.field;
            if (!field) return;
            payload[field] = el.type === "checkbox" ? Boolean(el.checked) : (el.value || "").trim();
        });
        payload.equipment_changes = this.detailEquipmentChanges.map((x) => ({
            status_date: String(x.status_date || "").trim(),
            equipment_status: String(x.equipment_status || "").trim(),
        }));
        payload.security_changes = this.detailSecurityChanges.map((x) => ({
            change_date: String(x.change_date || "").trim(),
            pre_auth_type: String(x.pre_auth_type || "").trim(),
            auth_completion_status: String(x.auth_completion_status || "").trim(),
            auth_number: String(x.auth_number || "").trim(),
            auth_date: String(x.auth_date || "").trim(),
            crypto_verification_number: String(x.crypto_verification_number || "").trim(),
        }));
        payload.detail_changes = this.detailChanges.map((x) => ({
            change_date: String(x.change_date || "").trim(),
            change_type: String(x.change_type || "").trim(),
            change_note: String(x.change_note || "").trim(),
        }));
        payload.delivery_changes = this.detailDeliveryChanges.map((x) => ({
            change_date: String(x.change_date || "").trim(),
            vendor_name: String(x.vendor_name || "").trim(),
            maintenance_start_date: String(x.maintenance_start_date || "").trim(),
            maintenance_months: String(x.maintenance_months || "").trim(),
            maintenance_end_date: String(x.maintenance_end_date || "").trim(),
            vendor_contact: String(x.vendor_contact || "").trim(),
            vendor_phone: String(x.vendor_phone || "").trim(),
            vendor_mail: String(x.vendor_mail || "").trim(),
            change_note: String(x.change_note || "").trim(),
        }));
        payload.software_items = this.detailSoftwareItems.map((x) => ({
            software_name: String(x.software_name || "").trim(),
            version: String(x.version || "").trim(),
            install_date: String(x.install_date || "").trim(),
            installed_quantity: String(x.installed_quantity || "").trim(),
            deployment_target: String(x.deployment_target || "").trim(),
            status: String(x.status || "").trim(),
            change_note: String(x.change_note || "").trim(),
        }));
        payload.license_items = this.detailLicenseItems.map((x) => ({
            license_name: String(x.license_name || "").trim(),
            license_quantity: String(x.license_quantity || "").trim(),
            vendor_name: String(x.vendor_name || "").trim(),
            expiry_date: String(x.expiry_date || "").trim(),
            compliance_status: String(x.compliance_status || "").trim(),
            change_note: String(x.change_note || "").trim(),
        }));
        payload.spec_items = this.collectSpecItemsFromDom();
        return payload;
    }


    async openAssetDetailModal(assetId) {
        if (!assetId || typeof bootstrap === "undefined") return;
        const item = this.allItems.find((x) => String(x.id) === String(assetId));
        const normalizedCategory = this.normalizeDetailCategory(item?.category);
        if (normalizedCategory === "") {
            alert("카테고리를 입력한 후 다시 시도해주세요.");
            return;
        }
        this.detailCurrentCategory = normalizedCategory;

        const detailTitleEl = document.getElementById("itmaAssetDetailModalLabel");
        const detailModalHeader = document.querySelector("#itmaAssetDetailModal .modal-header");
        const pcTargetEl = document.getElementById("itmaAssetDetailTarget");
        const manufactureMonthRefEl = document.getElementById("itmaDetailManufactureMonthRef");
        this.showAssetDetailFeedback("");
        this.clearAssetDetailValidation();
        if (pcTargetEl) pcTargetEl.innerHTML = this.buildAssetDetailTargetHtml(item, normalizedCategory);
        if (manufactureMonthRefEl) manufactureMonthRefEl.value = this.monthToDisplay(item?.manufacture_month || "");
        if (detailTitleEl) {
            if (normalizedCategory === "pc") detailTitleEl.innerHTML = '<i class="bi bi-card-list"></i> PC 상세 정보';
            else if (normalizedCategory === "printer") detailTitleEl.innerHTML = '<i class="bi bi-printer"></i> 프린터 상세 정보';
            else if (normalizedCategory === "hardware") detailTitleEl.innerHTML = '<i class="bi bi-cpu"></i> 하드웨어 상세 정보';
            else if (normalizedCategory === "network") detailTitleEl.innerHTML = '<i class="bi bi-diagram-3"></i> 네트워크 상세 정보';
            else if (normalizedCategory === "security") detailTitleEl.innerHTML = '<i class="bi bi-shield-lock"></i> 보안 상세 정보';
            else if (normalizedCategory === "server") detailTitleEl.innerHTML = '<i class="bi bi-server"></i> 서버 상세 정보';
            else if (normalizedCategory === "solution") detailTitleEl.innerHTML = '<i class="bi bi-boxes"></i> 솔루션 상세 정보';
            else if (normalizedCategory === "cloud") detailTitleEl.innerHTML = '<i class="bi bi-cloud"></i> 클라우드 상세 정보';
            else if (normalizedCategory === "software") detailTitleEl.innerHTML = '<i class="bi bi-window-stack"></i> 소프트웨어 상세 정보';
            else if (normalizedCategory === "license") detailTitleEl.innerHTML = '<i class="bi bi-keyboard"></i> 라이선스 상세 정보';
            else detailTitleEl.innerHTML = '<i class="bi bi-card-list"></i> 자산 상세 정보';
        }
        if (detailModalHeader) {
            detailModalHeader.classList.remove(
                "itma-modal-tone-other",
                "itma-modal-tone-grey",
                "itma-modal-tone-software",
                "itma-modal-tone-license",
                "itma-modal-tone-pc",
                "itma-modal-tone-printer",
                "itma-modal-tone-hardware",
                "itma-modal-tone-network",
                "itma-modal-tone-security",
                "itma-modal-tone-server",
                "itma-modal-tone-solution",
                "itma-modal-tone-cloud",
            );
            // 카테고리별 고유 색상 클래스 적용
            const categoryToneMap = {
                "pc": "itma-modal-tone-pc",
                "printer": "itma-modal-tone-printer",
                "software": "itma-modal-tone-software",
                "license": "itma-modal-tone-license",
                "hardware": "itma-modal-tone-hardware",
                "network": "itma-modal-tone-network",
                "security": "itma-modal-tone-security",
                "server": "itma-modal-tone-server",
                "solution": "itma-modal-tone-solution",
                "cloud": "itma-modal-tone-cloud",
            };
            const toneClass = categoryToneMap[normalizedCategory] || "itma-modal-tone-other";
            detailModalHeader.classList.add(toneClass);
        }
        this.applyDetailModalMode(normalizedCategory);

        try {
            await this.loadAssetDetailState(assetId);
        } catch (error) {
            alert(`자산 세부 정보 조회 실패: ${error.message}`);
            return;
        }

        const modalEl = document.getElementById("itmaAssetDetailModal");
        this.applyPcPrinterFieldVisibility(normalizedCategory);
        const canEdit = this.canEditCategory(normalizedCategory);
        document.getElementById("btnItmaAssetDetailSave")?.classList.toggle("d-none", !canEdit);
        document.getElementById("btnItmaAssetSoftwareSave")?.classList.toggle("d-none", !canEdit && normalizedCategory === "software");
        document.getElementById("btnItmaAssetLicenseSave")?.classList.toggle("d-none", !canEdit && normalizedCategory === "license");
        modalEl?.querySelectorAll("input, select, textarea, button").forEach((el) => {
            if (
                String(el.id || "").startsWith("btnItmaAsset")
                || String(el.id || "").startsWith("btnItmaDetailAdd")
                || String(el.id || "").startsWith("btnItmaSpec")
            ) {
                if (!canEdit && !String(el.id || "").includes("Save")) {
                    el.disabled = true;
                } else if (canEdit) {
                    el.disabled = false;
                }
            }
        });
        modalEl?.querySelectorAll("#itmaSpecItemsBody input").forEach((el) => {
            el.disabled = !canEdit;
        });
        if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }


    async saveAssetDetails(scope = "pc") {
        const assetId = this.detailCurrentAssetId;
        if (!assetId) return;
        this.clearAssetDetailValidation();
        this.showAssetDetailFeedback("");
        const payload = this.collectAssetDetailForm();
        const category = this.detailCurrentCategory;
        let effectiveScope = scope;
        if (scope === "pc") {
            effectiveScope = ["pc", "printer"].includes(category) ? "pc" : "other";
        }
        if (effectiveScope === "pc") {
            const isPrinter = category === "printer";
            const usedUserValue = String(payload.used_user || "").trim();
            const usedGroupValue = String(payload.used_group || "").trim();
            const ipValue = String(payload.ip_address || "").trim();
            const invalidFields = [];
            if (!ipValue) {
                invalidFields.push(["ip_address", "IP정보는 필수입니다."]);
            }
            if (isPrinter && !usedGroupValue) {
                invalidFields.push(["used_group", "사용그룹은 필수입니다."]);
            }
            if (!isPrinter && !usedUserValue) {
                invalidFields.push(["used_user", "사용자는 필수입니다."]);
            }
            if (invalidFields.length) {
                let firstInvalid = null;
                invalidFields.forEach(([field, message]) => {
                    const target = this.markAssetDetailFieldInvalid(field, message);
                    if (!firstInvalid && target) firstInvalid = target;
                });
                this.showAssetDetailFeedback(invalidFields[0][1], "danger");
                firstInvalid?.focus();
                return;
            }
        }
        payload.detail_scope = effectiveScope;
        this.setAssetDetailSaveBusy(true);
        try {
            const response = await fetch(`/itma/assets/${assetId}/details`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.message || "자산 세부 정보 저장 실패");
            }
            this.populateAssetDetailForm(data.details || payload);
            await this.loadAssets(this.globalSearchKeyword);
            this.showAssetDetailFeedback("자산 세부 정보가 저장되었습니다.", "success");
        } catch (error) {
            this.showAssetDetailFeedback(`자산 세부 정보 저장 실패: ${error.message}`, "danger");
        } finally {
            this.setAssetDetailSaveBusy(false);
        }
    }


    syncMemoFieldState(input) {
        if (!input) return;
        const value = String(input.value ?? "");
        input.title = value;
        input.classList.toggle("itma-note-overflow", value.trim().length > 10);
    }

    isSmartSuggestColumn(column) {
        const key = String(column || "").trim();
        if (!key) return false;
        return this.smartSuggestColumns.has(key);
    }

    normalizeSuggestText(text) {
        return String(text || "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
    }

    toChoseong(text) {
        const CHO = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
        const src = String(text || "");
        let out = "";
        for (const ch of src) {
            const code = ch.charCodeAt(0);
            if (code >= 0xac00 && code <= 0xd7a3) {
                const choIndex = Math.floor((code - 0xac00) / 588);
                out += CHO[choIndex] || "";
            } else if ((code >= 0x3131 && code <= 0x314e) || /[a-z0-9]/i.test(ch)) {
                out += ch.toLowerCase();
            }
        }
        return out;
    }

    rebuildSmartSuggestIndex() {
        this.smartSuggestColumns.forEach((column) => {
            this.smartSuggestIndex[column] = new Set();
        });
        this.allItems.forEach((item) => {
            this.smartSuggestColumns.forEach((column) => {
                const value = String(item?.[column] ?? "").trim();
                if (!value) return;
                this.smartSuggestIndex[column].add(value);
            });
        });
    }

    updateSmartSuggestSource(column, value) {
        const key = String(column || "").trim();
        if (!this.isSmartSuggestColumn(key)) return;
        const text = String(value || "").trim();
        if (!text) return;
        if (!this.smartSuggestIndex[key]) this.smartSuggestIndex[key] = new Set();
        this.smartSuggestIndex[key].add(text);
    }

    getSmartSuggestCandidates(column, keyword = "", limit = 10) {
        const key = String(column || "").trim();
        if (!this.isSmartSuggestColumn(key)) return [];
        const source = Array.from(this.smartSuggestIndex[key] || []).filter((v) => String(v || "").trim() !== "");
        if (!source.length) return [];

        const normalizedKeyword = this.normalizeSuggestText(keyword);
        const normalizedKeywordNoSpace = normalizedKeyword.replace(/\s+/g, "");
        const keywordChoseong = this.toChoseong(normalizedKeywordNoSpace);
        const items = source.map((raw) => String(raw));

        if (!normalizedKeyword) {
            return items
                .sort((a, b) => a.localeCompare(b, "ko"))
                .slice(0, limit);
        }

        const ranked = [];
        items.forEach((raw) => {
            const normalizedRaw = this.normalizeSuggestText(raw);
            const normalizedRawNoSpace = normalizedRaw.replace(/\s+/g, "");
            const rawChoseong = this.toChoseong(normalizedRawNoSpace);
            let rank = 99;

            if (normalizedRaw === normalizedKeyword) rank = 0;
            else if (normalizedRaw.startsWith(normalizedKeyword)) rank = 1;
            else if (normalizedRaw.includes(normalizedKeyword)) rank = 2;
            else if (keywordChoseong && rawChoseong.startsWith(keywordChoseong)) rank = 3;
            else if (keywordChoseong && rawChoseong.includes(keywordChoseong)) rank = 4;
            else return;

            ranked.push({ raw, rank, len: raw.length });
        });

        return ranked
            .sort((a, b) => {
                if (a.rank !== b.rank) return a.rank - b.rank;
                if (a.len !== b.len) return a.len - b.len;
                return a.raw.localeCompare(b.raw, "ko");
            })
            .slice(0, limit)
            .map((x) => x.raw);
    }

    ensureSmartSuggestPanel() {
        if (this.smartSuggestPanelEl) return this.smartSuggestPanelEl;
        const panel = document.createElement("div");
        panel.className = "itma-smart-suggest-panel";
        panel.style.display = "none";
        panel.innerHTML = '<ul class="itma-smart-suggest-list"></ul>';
        panel.addEventListener("mousedown", (e) => {
            const item = e.target.closest(".itma-smart-suggest-item");
            if (!item) return;
            e.preventDefault();
            const index = Number.parseInt(item.dataset.index || "", 10);
            if (Number.isNaN(index) || index < 0 || index >= this.smartSuggestItems.length) return;
            const value = this.smartSuggestItems[index];
            this.applySmartSuggestValue(value, { triggerSave: true });
        });
        document.body.appendChild(panel);
        this.smartSuggestPanelEl = panel;
        return panel;
    }

    positionSmartSuggestPanel(input) {
        if (!input || !this.smartSuggestPanelEl) return;
        const rect = input.getBoundingClientRect();
        const panel = this.smartSuggestPanelEl;
        panel.style.left = `${Math.round(window.scrollX + rect.left)}px`;
        panel.style.top = `${Math.round(window.scrollY + rect.bottom + 4)}px`;
        panel.style.width = `${Math.max(220, Math.round(rect.width))}px`;
    }

    renderSmartSuggestPanel() {
        if (!this.smartSuggestPanelEl) return;
        const list = this.smartSuggestPanelEl.querySelector(".itma-smart-suggest-list");
        if (!list) return;
        if (!this.smartSuggestItems.length) {
            list.innerHTML = '<li class="itma-smart-suggest-empty">추천 항목이 없습니다.</li>';
            return;
        }
        list.innerHTML = this.smartSuggestItems.map((text, index) => {
            const activeClass = index === this.smartSuggestFocusIndex ? " active" : "";
            return `<li class="itma-smart-suggest-item${activeClass}" data-index="${index}" title="${itmaEscapeHtml(text)}">${itmaEscapeHtml(text)}</li>`;
        }).join("");
    }

    showSmartSuggestPanel(input, column, keyword = "", options = {}) {
        if (!input || !this.isSmartSuggestColumn(column)) {
            this.hideSmartSuggestPanel();
            return;
        }
        const { forceOpen = false, openByKeyboard = false } = options;
        const panel = this.ensureSmartSuggestPanel();
        const items = this.getSmartSuggestCandidates(column, keyword, 10);
        if (!items.length && !forceOpen) {
            this.hideSmartSuggestPanel(false);
            return;
        }
        this.smartSuggestActiveInput = input;
        this.smartSuggestItems = items;
        this.smartSuggestFocusIndex = items.length ? 0 : -1;
        this.smartSuggestOpenByKeyboard = Boolean(openByKeyboard);
        this.renderSmartSuggestPanel();
        this.positionSmartSuggestPanel(input);
        panel.style.display = "block";
    }

    hideSmartSuggestPanel(clearInput = true) {
        if (this.smartSuggestPanelEl) this.smartSuggestPanelEl.style.display = "none";
        this.smartSuggestItems = [];
        this.smartSuggestFocusIndex = -1;
        this.smartSuggestOpenByKeyboard = false;
        if (clearInput) this.smartSuggestActiveInput = null;
    }

    applySmartSuggestValue(value, options = {}) {
        const input = this.smartSuggestActiveInput;
        if (!input) return;
        const { triggerSave = false } = options;
        input.value = value;
        if (input.matches(".itma-inline-note-scroll")) {
            this.syncMemoFieldState(input);
            this.refreshTableHorizontalWidth();
        }
        this.hideSmartSuggestPanel(false);
        if (triggerSave) {
            input.dispatchEvent(new Event("change", { bubbles: true }));
        }
        input.focus();
    }

    ensureSmartSuggestPickerModal() {
        let modalEl = document.getElementById("itmaSmartSuggestModal");
        if (modalEl) return modalEl;
        const wrapper = document.createElement("div");
        wrapper.innerHTML = `
            <div class="modal fade" id="itmaSmartSuggestModal" tabindex="-1" aria-hidden="true">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">추천 값 선택</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body">
                            <input type="text" id="itmaSmartSuggestSearch" class="form-control form-control-sm mb-2" placeholder="검색 또는 초성 입력">
                            <div class="itma-smart-picker-list" id="itmaSmartSuggestList"></div>
                        </div>
                    </div>
                </div>
            </div>
        `.trim();
        document.body.appendChild(wrapper.firstElementChild);
        modalEl = document.getElementById("itmaSmartSuggestModal");
        const searchEl = document.getElementById("itmaSmartSuggestSearch");
        const listEl = document.getElementById("itmaSmartSuggestList");
        searchEl?.addEventListener("input", () => {
            if (!this.smartSuggestPickerContext) return;
            this.renderSmartSuggestPickerList(this.smartSuggestPickerContext.column, searchEl.value || "");
        });
        listEl?.addEventListener("click", (e) => {
            const btn = e.target.closest(".itma-smart-picker-item");
            if (!btn || !this.smartSuggestPickerContext) return;
            const value = btn.dataset.value || "";
            const targetInput = this.smartSuggestPickerContext.input;
            if (targetInput) {
                targetInput.value = value;
                targetInput.dispatchEvent(new Event("change", { bubbles: true }));
                targetInput.focus();
            }
            bootstrap.Modal.getOrCreateInstance(modalEl).hide();
        });
        modalEl.addEventListener("hidden.bs.modal", () => {
            this.smartSuggestPickerContext = null;
            if (searchEl) searchEl.value = "";
            if (listEl) listEl.innerHTML = "";
        });
        return modalEl;
    }

    renderSmartSuggestPickerList(column, keyword = "") {
        const listEl = document.getElementById("itmaSmartSuggestList");
        if (!listEl) return;
        const items = this.getSmartSuggestCandidates(column, keyword, 200);
        if (!items.length) {
            listEl.innerHTML = '<div class="itma-smart-picker-empty">추천 항목이 없습니다.</div>';
            return;
        }
        listEl.innerHTML = items.map((text) => (
            `<button type="button" class="itma-smart-picker-item" data-value="${itmaEscapeHtml(text)}">${itmaEscapeHtml(text)}</button>`
        )).join("");
    }

    openSmartSuggestPicker(input, column) {
        if (!input || !this.isSmartSuggestColumn(column) || typeof bootstrap === "undefined") return;
        const modalEl = this.ensureSmartSuggestPickerModal();
        const searchEl = document.getElementById("itmaSmartSuggestSearch");
        this.smartSuggestPickerContext = { input, column };
        if (searchEl) searchEl.value = input.value || "";
        this.renderSmartSuggestPickerList(column, searchEl?.value || "");
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
        window.setTimeout(() => {
            searchEl?.focus();
            searchEl?.select();
        }, 0);
    }

    handleSmartSuggestFocusIn(e) {
        const input = e.target.closest(".itma-inline-text");
        if (!input) return;
        const column = input.dataset.column || "";
        if (!this.isSmartSuggestColumn(column)) {
            this.hideSmartSuggestPanel();
            return;
        }
        this.showSmartSuggestPanel(input, column, input.value || "");
    }

    handleSmartSuggestKeydown(e) {
        const input = e.target.closest(".itma-inline-text");
        if (!input) return;
        const column = input.dataset.column || "";
        if (!this.isSmartSuggestColumn(column)) return;
        const panelVisible = this.smartSuggestPanelEl && this.smartSuggestPanelEl.style.display !== "none";

        if (e.altKey && e.key === "ArrowDown") {
            e.preventDefault();
            this.openSmartSuggestPicker(input, column);
            return;
        }
        if (e.key === "ArrowDown") {
            if (!panelVisible) {
                this.showSmartSuggestPanel(input, column, input.value || "", { forceOpen: true, openByKeyboard: true });
                return;
            }
            e.preventDefault();
            if (!this.smartSuggestItems.length) return;
            this.smartSuggestFocusIndex = (this.smartSuggestFocusIndex + 1) % this.smartSuggestItems.length;
            this.renderSmartSuggestPanel();
            return;
        }
        if (e.key === "ArrowUp" && panelVisible) {
            e.preventDefault();
            if (!this.smartSuggestItems.length) return;
            this.smartSuggestFocusIndex = (this.smartSuggestFocusIndex - 1 + this.smartSuggestItems.length) % this.smartSuggestItems.length;
            this.renderSmartSuggestPanel();
            return;
        }
        if (e.key === "Enter" && panelVisible && this.smartSuggestFocusIndex >= 0) {
            e.preventDefault();
            const value = this.smartSuggestItems[this.smartSuggestFocusIndex];
            this.applySmartSuggestValue(value, { triggerSave: true });
            return;
        }
        if (e.key === "Escape" && panelVisible) {
            e.preventDefault();
            this.hideSmartSuggestPanel();
        }
    }

    handleSmartSuggestDblClick(e) {
        const input = e.target.closest(".itma-inline-text");
        if (!input) return;
        const column = input.dataset.column || "";
        if (!this.isSmartSuggestColumn(column)) return;
        this.openSmartSuggestPicker(input, column);
    }

    handleSmartSuggestDocumentClick(e) {
        const target = e.target;
        if (this.smartSuggestPanelEl?.contains(target)) return;
        if (this.smartSuggestActiveInput && this.smartSuggestActiveInput.contains(target)) return;
        this.hideSmartSuggestPanel();
    }


    refreshTableHorizontalWidth() {
        const table = document.getElementById("itmaTable");
        if (!table) return;
        const columns = ["inbound_note", "outbound_note", "detail_note"];
        let totalExtraPx = 0;

        columns.forEach((column) => {
            let columnMaxExtra = 0;
            table.querySelectorAll(`.itma-inline-note-scroll[data-column="${column}"]`).forEach((input) => {
                const extra = Math.max(0, input.scrollWidth - input.clientWidth);
                if (extra > columnMaxExtra) columnMaxExtra = extra;
            });
            totalExtraPx += columnMaxExtra;
        });

        const cappedExtra = Math.min(1200, Math.round(totalExtraPx));
        table.style.minWidth = `calc(100% + ${cappedExtra}px)`;
    }


    renderHistoryModalContent() {
        const changedBody = document.getElementById("itmaHistoryChangedBody");
        const deletedBody = document.getElementById("itmaHistoryDeletedBody");
        if (!changedBody || !deletedBody) return;


        const changedRows = this.historyItems.filter((item) => item.action === "update" || item.action === "restore");
        const deletedRows = this.historyItems.filter((item) => item.action === "delete");
        const changedKeyword = this.getSearchKeyword("itmaHistoryChangedSearch");
        const deletedKeyword = this.getSearchKeyword("itmaHistoryDeletedSearch");


        const filteredChangedRows = !changedKeyword ? changedRows : changedRows.filter((item) => {
            const rowNo = this.historyRawText(this.getHistoryDisplayRowNo(item));
            const itemName = this.historyRawText(this.getHistoryDisplayItemName(item));
            const blob = [
                item.created_at || "",
                item.action || "",
                rowNo,
                itemName,
                this.getHistoryColumnLabel(item.changed_column),
                item.before_value || "",
                item.after_value || "",
                item.actor || "",
            ].join(" ").toLowerCase();
            return blob.includes(changedKeyword);
        });


        const filteredDeletedRows = !deletedKeyword ? deletedRows : deletedRows.filter((item) => {
            const snap = item.snapshot || {};
            const blob = [
                item.created_at || "",
                this.getHistoryDisplayRowNo(item),
                snap.manufacturer || "",
                snap.item_name || "",
                snap.serial_number || "",
                item.actor || "",
            ].join(" ").toLowerCase();
            return blob.includes(deletedKeyword);
        });


        const limit = this.getModalRowsLimit();
        const visibleChangedRows = filteredChangedRows.slice(0, limit);
        const visibleDeletedRows = filteredDeletedRows.slice(0, limit);


        if (!filteredChangedRows.length) {
            changedBody.innerHTML = '<tr><td colspan="9" class="text-center text-muted">해당하는 항목이 없습니다.</td></tr>';
        } else {
            changedBody.innerHTML = visibleChangedRows.map((item) => {
                const canRestore = !item.restored && (item.action === "update" || item.action === "delete");
                const actionLabel = item.action === "restore" ? "복원" : "수정";
                const rowNo = this.historyRawText(this.getHistoryDisplayRowNo(item));
                const itemName = this.historyRawText(this.getHistoryDisplayItemName(item));
                const changedCol = this.historyRawText(this.getHistoryColumnLabel(item.changed_column));
                const isUsage = item.changed_column === "usage_status";
                const beforeVal = this.historyRawText(isUsage ? (this.normalizeUsageStatus(item.before_value) || item.before_value) : item.before_value);
                const afterVal = this.historyRawText(isUsage ? (this.normalizeUsageStatus(item.after_value) || item.after_value) : item.after_value);
                return `<tr>
                    <td title="${this.historyText(item.created_at)}">${this.historyText(item.created_at)}</td>
                    <td title="${this.historyText(actionLabel)}">${this.historyText(actionLabel)}</td>
                    <td title="${itmaEscapeHtml(rowNo)}">${itmaEscapeHtml(rowNo)}</td>
                    <td title="${itmaEscapeHtml(itemName)}">${itmaEscapeHtml(itemName)}</td>
                    <td title="${itmaEscapeHtml(changedCol)}">${itmaEscapeHtml(changedCol)}</td>
                    <td title="${itmaEscapeHtml(beforeVal)}">${itmaEscapeHtml(beforeVal)}</td>
                    <td title="${itmaEscapeHtml(afterVal)}">${itmaEscapeHtml(afterVal)}</td>
                    <td title="${this.historyText(item.actor)}">${this.historyText(item.actor)}</td>
                    <td class="text-center">${canRestore ? `<button type="button" class="btn btn-sm btn-outline-primary itma-history-restore-btn" data-history-id="${item.id}">복원</button>` : '<span class="text-muted small">복원 불가</span>'}</td>
                </tr>`;
            }).join("");
        }

        if (!filteredDeletedRows.length) {
            deletedBody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">해당하는 항목이 없습니다.</td></tr>';
            return;
        }


        deletedBody.innerHTML = visibleDeletedRows.map((item) => {
            const snap = item.snapshot || {};
            const canRestore = !item.restored;
            const manufacturer = this.historyRawText(snap.manufacturer || "");
            const itemName = this.historyRawText(snap.item_name || "");
            const serial = this.historyRawText(snap.serial_number || "");
            const assetCode = this.historyRawText(this.getHistoryDisplayRowNo(item));
            return `<tr>
                <td title="${this.historyText(item.created_at)}">${this.historyText(item.created_at)}</td>
                <td title="${itmaEscapeHtml(assetCode)}">${itmaEscapeHtml(assetCode)}</td>
                <td title="${itmaEscapeHtml(manufacturer)}">${itmaEscapeHtml(manufacturer)}</td>
                <td title="${itmaEscapeHtml(itemName)}">${itmaEscapeHtml(itemName)}</td>
                <td title="${itmaEscapeHtml(serial)}">${itmaEscapeHtml(serial)}</td>
                <td title="${this.historyText(item.actor)}">${this.historyText(item.actor)}</td>
                <td class="text-center">${canRestore ? `<button type="button" class="btn btn-sm btn-outline-danger itma-history-restore-btn" data-history-id="${item.id}">복원</button>` : '<span class="text-muted small">복원 불가</span>'}</td>
            </tr>`;
        }).join("");
    }


    async loadHistory() {
        try {
            const response = await fetch("/itma/history?limit=300", { headers: { Accept: "application/json" } });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.message || "히스토리 조회 실패");
            }
            this.historyItems = Array.isArray(data.items) ? data.items : [];
            this.renderHistoryModalContent();
        } catch (error) {
            alert(`히스토리 조회 실패: ${error.message}`);
        }
    }


    async restoreFromHistory(historyId) {
        const confirmed = window.confirm("정말로 복원하시겠습니까?");
        if (!confirmed) return;
        try {
            const response = await fetch(`/itma/history/${historyId}/restore`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({})
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.message || "복원 실패");
            }
            if (data.message) alert(data.message);
            await this.loadAssets();
            await this.loadHistory();
        } catch (error) {
            alert(`복원 실패: ${error.message}`);
        }
    }


    applyFiltersAndSort() {
        const filters = {};
        document.querySelectorAll(".itma-filter").forEach((input) => {
            filters[input.dataset.column] = (input.value || "").trim().toLowerCase();
        });
        this.currentFilters = filters;


        this.filteredItems = this.allItems.filter((item) => {
            if (this.siteFilter && this.getItemSiteKey(item) !== this.siteFilter) return false;
            return Object.entries(filters).every(([column, keyword]) => {
                if (!keyword) return true;
                const rawValue = this.getSortValue(item, column);
                const text = String(rawValue ?? "").trim().toLowerCase();
                if (this.exactFilterColumns.has(column)) return text === keyword;
                return text.includes(keyword);
            });
        });


        if (this.sortColumn) {
            const column = this.sortColumn;
            const direction = this.sortDirection === "asc" ? 1 : -1;
            this.filteredItems.sort((a, b) => {
                if (column === "row_no") {
                    const an = Number(a.row_no ?? 0);
                    const bn = Number(b.row_no ?? 0);
                    if (an < bn) return -1 * direction;
                    if (an > bn) return 1 * direction;
                    return 0;
                }
                if (this.dateSortColumns.has(column)) {
                    const at = this.parseSortDateValue(a[column]);
                    const bt = this.parseSortDateValue(b[column]);
                    if (at === null && bt === null) return 0;
                    if (at === null) return 1;
                    if (bt === null) return -1;
                    if (at < bt) return -1 * direction;
                    if (at > bt) return 1 * direction;
                    return 0;
                }

                const avRaw = this.getSortValue(a, column);
                const bvRaw = this.getSortValue(b, column);

                if (this.isCustomColumn(column)) {
                    const an = this.parseSortNumberValue(avRaw);
                    const bn = this.parseSortNumberValue(bvRaw);
                    if (an !== null && bn !== null) {
                        if (an < bn) return -1 * direction;
                        if (an > bn) return 1 * direction;
                        return 0;
                    }

                    const at = this.parseSortDateValue(avRaw);
                    const bt = this.parseSortDateValue(bvRaw);
                    if (at !== null && bt !== null) {
                        if (at < bt) return -1 * direction;
                        if (at > bt) return 1 * direction;
                        return 0;
                    }
                }

                const av = String(avRaw ?? "").trim();
                const bv = String(bvRaw ?? "").trim();
                const compared = av.localeCompare(bv, "ko-KR", { sensitivity: "base" });
                if (compared < 0) return -1 * direction;
                if (compared > 0) return 1 * direction;
                return 0;
            });
        }


        this.updateSortIndicators();
        this.renderSiteTabs();
        this.currentPage = 1;
        this.render();
    }


    render() {
        this.hideSmartSuggestPanel();
        if (!this.filteredItems.length) {
            this.currentPageItemIds = [];
            this.tableBody.innerHTML = `<tr><td colspan="${this.getTableColspan()}" class="text-muted py-4">${this.getEmptyMessage()}</td></tr>`;
            this.renderPaginationInfo(0, 0, 0);
            this.renderPaginationControls(0);
            this.updateSelectAllButton();
            this.updateSelectCurrentPageCheckbox();
            this.updateFilterHighlights(this.currentFilters);
            this.applyColumnLayout();
            return;
        }


        let pageItems = this.filteredItems;
        let start = 1;
        let end = this.filteredItems.length;
        const total = this.filteredItems.length;


        if (this.rowsPerPage !== "all") {
            const pageSize = parseInt(this.rowsPerPage, 10) || 30;
            const totalPages = Math.ceil(total / pageSize);
            if (this.currentPage > totalPages) this.currentPage = totalPages;
            const startIndex = (this.currentPage - 1) * pageSize;
            const endIndex = startIndex + pageSize;
            pageItems = this.filteredItems.slice(startIndex, endIndex);
            start = startIndex + 1;
            end = Math.min(endIndex, total);
            this.renderPaginationControls(totalPages);
        } else {
            this.renderPaginationControls(1);
        }


        const rowsHtml = pageItems.map((item, index) => {
            // 번호는 현재 필터·정렬 결과 기준 순번 (자산 고유 번호는 '자산번호' 컬럼)
            const rowNo = start + index;
            const itemId = String(item.id);
            const isChecked = this.selectedIds.has(itemId);
            return `
                <tr data-asset-id="${item.id}" class="${this.isInactiveUsageStatus(item.usage_status) ? "itma-row-unused" : ""}">
                    <td class="itma-select-cell" style="cursor: pointer;">
                        <label class="d-flex justify-content-center align-items-center m-0 p-1" style="cursor: pointer;">
                            <input type="checkbox" class="form-check-input mt-0 itma-row-checkbox" style="width: 1rem; height: 1rem; border-radius: 0.15rem;" value="${item.id}" ${isChecked ? "checked" : ""}>
                        </label>
                    </td>
                    <td class="itma-row-no-cell" data-column="row_no">${rowNo}</td>
                    ${this.renderActionCell(item)}
                    ${this.renderReadonlyCell(item, "category")}
                    ${this.renderReadonlyCell(item, "site")}
                    ${this.renderReadonlyCell(item, "asset_id")}
                    ${this.renderReadonlyCell(item, "manufacturer")}
                    ${this.renderReadonlyCell(item, "item_name")}
                    ${this.renderReadonlyCell(item, "received_date")}
                    ${this.renderReadonlyCell(item, "inbound_note")}
                    ${this.renderReadonlyCell(item, "released_date")}
                    ${this.renderReadonlyCell(item, "outbound_note")}
                    ${this.renderReadonlyCell(item, "storage_location")}
                    ${this.renderReadonlyCell(item, "detail_note")}
                    ${this.renderReadonlyCell(item, "sales_rep")}
                    ${this.renderReadonlyCell(item, "usage_status")}
                    ${this.renderReadonlyCell(item, "manufacture_month")}
                    <td data-column="updated_at">${itmaEscapeHtml(item.updated_at)}</td>
                    <td data-column="updated_by">${itmaEscapeHtml(item.updated_by)}</td>
                    ${this.renderReadonlyColumnCells(item, this.detailColumnDefinitions)}
                    ${this.renderReadonlyColumnCells(item, this.specColumnDefinitions)}
                    ${this.renderCustomColumnCells(item)}
                </tr>
            `;
        }).join("");


        this.currentPageItemIds = pageItems.map((item) => String(item.id));
        this.tableBody.innerHTML = rowsHtml;
        this.applyColumnLayout();
        this.refreshTableHorizontalWidth();
        this.renderPaginationInfo(start, end, total);
        this.updateSelectAllButton();
        this.updateSelectCurrentPageCheckbox();
        this.updateFilterHighlights(this.currentFilters);
    }

    renderCustomColumnCells(item) {
        // 목록은 읽기 전용: 사용자 정의 컬럼 값은 추가/수정 화면에서 권한 확인 후 수정
        const assetId = String(item?.id || "");
        return this.customColumnDefinitions.map((column) => {
            const value = this.getCustomCellValue(assetId, column.key);
            return `<td data-column="${column.key}" class="itma-readonly-column-cell">${itmaEscapeHtml(value || "—")}</td>`;
        }).join("");
    }

    renderActionCell(item) {
        const editLabel = this.canEditItem(item) ? "수정" : "보기";
        const editIcon = this.canEditItem(item) ? "bi-pencil-square" : "bi-eye";
        return `<td data-column="actions" class="itma-action-cell">
            <div class="itma-action-buttons">
                <button type="button" class="btn btn-sm btn-outline-primary itma-row-detail-btn" title="상세정보 조회/수정">
                    <i class="bi bi-card-list" aria-hidden="true"></i> 상세정보
                </button>
                <a href="/itma/assets/${encodeURIComponent(item.id)}/edit" class="btn btn-sm btn-outline-secondary itma-row-edit-btn" title="기본·장비 정보 ${editLabel}">
                    <i class="bi ${editIcon}" aria-hidden="true"></i> ${editLabel}
                </a>
            </div>
        </td>`;
    }

    renderReadonlyCell(item, column) {
        const raw = column === "usage_status"
            ? this.normalizeUsageStatus(item?.[column])
            : String(item?.[column] ?? "").trim();
        if (column === "usage_status") {
            if (!raw) return `<td data-column="${column}" class="text-muted">—</td>`;
            const statusClass = {
                "정상": "status-normal",
                "사용": "status-inuse",
                "미사용": "status-unused",
                "교체": "status-replace",
                "폐기": "status-disposed",
            }[raw] || "";
            return `<td data-column="${column}"><span class="itma-status-badge ${statusClass}">${itmaEscapeHtml(raw)}</span></td>`;
        }
        if (this.memoColumns.has(column) && raw) {
            const shortText = raw.length > 14 ? `${raw.slice(0, 14)}…` : raw;
            return `<td data-column="${column}" class="itma-memo-cell" data-memo="${itmaEscapeHtml(raw)}" title="${itmaEscapeHtml(raw)}">${itmaEscapeHtml(shortText)}</td>`;
        }
        return `<td data-column="${column}"${raw ? "" : ' class="text-muted"'}>${itmaEscapeHtml(raw || "—")}</td>`;
    }

    renderReadonlyColumnCells(item, columns) {
        return columns.map((column) => {
            const value = this.isDetailColumn(column.key)
                ? this.getDetailCellValue(item?.id, column.key)
                : this.getSpecCellValue(item?.id, column.key);
            return `<td data-column="${column.key}" class="itma-readonly-column-cell">${itmaEscapeHtml(value || "—")}</td>`;
        }).join("");
    }

    renderSpecColumnCells(item) {
        return this.specColumnDefinitions.map((column) => {
            const value = this.getSpecCellValue(item.id, column.key);
            const canEdit = this.canEditItem(item) && this.normalizePermissionCategory(item.category) === column.category_key;
            if (!canEdit) return `<td data-column="${column.key}" class="itma-readonly-column-cell">${itmaEscapeHtml(value || "—")}</td>`;
            return `<td data-column="${column.key}"><input type="text" class="form-control form-control-sm itma-inline-spec-field" data-form-item-id="${Number(column.form_item_id)}" value="${itmaEscapeHtml(value)}" data-original="${itmaEscapeHtml(value)}" aria-label="${itmaEscapeHtml(column.label)}"></td>`;
        }).join("");
    }

    renderDetailColumnCells(item) {
        const assetId = String(item?.id || "");
        const canEdit = this.canEditItem(item);
        return this.detailColumnDefinitions.map((column) => {
            const value = this.getDetailCellValue(assetId, column.key);
            if (!canEdit) {
                return `<td data-column="${column.key}" class="itma-readonly-column-cell">${itmaEscapeHtml(value || "—")}</td>`;
            }
            return `<td data-column="${column.key}"><input type="text" class="form-control form-control-sm itma-inline-detail-field" data-detail-field="${itmaEscapeHtml(column.key.replace(/^detail_/, ""))}" value="${itmaEscapeHtml(value)}" data-original="${itmaEscapeHtml(value)}"></td>`;
        }).join("");
    }


    getEmptyMessage() {
        if (this.globalSearchKeyword) {
            return "DB 검색 결과가 없습니다.";
        }
        return "전체 항목이 없습니다.";
    }


    renderEditableCell(item, column) {
        const value = item[column] ?? "";
        const canEdit = this.canEditItem(item);
        const disabledAttr = canEdit ? "" : "disabled";
        const readonlyClass = canEdit ? "" : " itma-inline-readonly";
        if (column === "category") {
            const options = this.categories.filter((category) => this.canEditCategory(category.category_key));
            const current = options.find((category) => category.category_key === this.normalizePermissionCategory(value));
            const placeholder = current ? "" : `<option value="${itmaEscapeHtml(value)}" selected disabled>${itmaEscapeHtml(value || "카테고리 선택")}</option>`;
            return `<td data-column="category"><select class="form-select form-select-sm itma-inline-text${readonlyClass}" data-column="category" data-original="${itmaEscapeHtml(value)}" aria-label="카테고리" ${disabledAttr}>${placeholder}${options.map((category) => `<option value="${itmaEscapeHtml(category.display_name)}" ${current?.category_key === category.category_key ? "selected" : ""}>${itmaEscapeHtml(category.display_name)}</option>`).join("")}</select></td>`;
        }

        if (this.isCustomColumn(column)) {
            const assetId = String(item?.id || "");
            const customValue = this.getCustomCellValue(assetId, column);
            return `
                <td data-column="${column}">
                    <input
                        type="text"
                        class="form-control form-control-sm itma-inline-text${readonlyClass}"
                        data-column="${column}"
                        value="${itmaEscapeHtml(customValue)}"
                        data-original="${itmaEscapeHtml(customValue)}"
                        ${disabledAttr}
                    >
                </td>
            `;
        }


        if (column === "usage_status") {
            const normalized = this.normalizeUsageStatus(value);
            const checked = normalized === "O" ? "checked" : "";
            return `
                <td data-column="${column}" class="itma-usage-cell">
                    <label class="itma-usage-toggle form-check form-switch">
                        <input
                            type="checkbox"
                        class="form-check-input itma-inline-usage"
                        data-column="${column}"
                        data-original="${normalized}"
                        ${checked}
                        ${disabledAttr}
                    >
                </label>
            </td>
        `;
        }


        if (this.monthColumns.has(column)) {
            const monthValue = this.formatMonthValue(value);
            return `
                <td data-column="${column}">
                    <input
                        type="month"
                        class="form-control form-control-sm itma-inline-month${readonlyClass}"
                        data-column="${column}"
                        value="${itmaEscapeHtml(monthValue)}"
                        data-original="${itmaEscapeHtml(monthValue)}"
                        ${disabledAttr}
                    >
                </td>
            `;
        }


        if (this.dateColumns.has(column)) {
            return `
                <td data-column="${column}">
                    <input
                        type="date"
                        class="form-control form-control-sm itma-inline-date${readonlyClass}"
                        data-column="${column}"
                        value="${itmaEscapeHtml(value)}"
                        data-original="${itmaEscapeHtml(value)}"
                        ${disabledAttr}
                    >
                </td>
            `;
        }

        if (this.memoColumns.has(column)) {
            const memoText = String(value ?? "");
            return `
                <td data-column="${column}">
                    <input
                        type="text"
                        class="form-control form-control-sm itma-inline-text itma-inline-note-scroll ${memoText.trim().length > 10 ? "itma-note-overflow" : ""}${readonlyClass}"
                        data-column="${column}"
                        value="${itmaEscapeHtml(value)}"
                        data-original="${itmaEscapeHtml(value)}"
                        title="${itmaEscapeHtml(value)}"
                        ${disabledAttr}
                    >
                </td>
            `;
        }


        return `
            <td data-column="${column}">
                <input
                    type="text"
                    class="form-control form-control-sm itma-inline-text${readonlyClass}"
                    data-column="${column}"
                    value="${itmaEscapeHtml(value)}"
                    data-original="${itmaEscapeHtml(value)}"
                    ${disabledAttr}
                >
            </td>
        `;
    }


    renderPaginationInfo(start, end, total) {
        const infoEl = document.getElementById("itmaPaginationInfo");
        if (!infoEl) return;
        if (total === 0) {
            infoEl.textContent = "0건";
            return;
        }
        infoEl.textContent = `${start}-${end} / 전체 ${total}건`;
    }


    renderPaginationControls(totalPages) {
        const controls = document.getElementById("itmaPaginationControls");
        if (!controls) return;
        if (this.rowsPerPage === "all" || totalPages <= 1) {
            controls.innerHTML = "";
            return;
        }


        const current = this.currentPage;
        let html = "";
        html += `<li class="page-item ${current === 1 ? "disabled" : ""}"><a class="page-link" href="#" data-page="${current - 1}">이전</a></li>`;
        for (let page = 1; page <= totalPages; page += 1) {
            html += `<li class="page-item ${page === current ? "active" : ""}"><a class="page-link" href="#" data-page="${page}">${page}</a></li>`;
        }
        html += `<li class="page-item ${current === totalPages ? "disabled" : ""}"><a class="page-link" href="#" data-page="${current + 1}">다음</a></li>`;
        controls.innerHTML = html;


        controls.querySelectorAll("a[data-page]").forEach((link) => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                const page = parseInt(link.dataset.page, 10);
                if (Number.isNaN(page)) return;
                if (page < 1 || page > totalPages) return;
                this.currentPage = page;
                this.render();
            });
        });
    }


    handleTableClick(e) {
        const detailBtn = e.target.closest(".itma-row-detail-btn");
        if (detailBtn) {
            const row = detailBtn.closest("tr[data-asset-id]");
            if (row) this.openAssetDetailModal(row.dataset.assetId);
            return;
        }
        const memoCell = e.target.closest(".itma-memo-cell");
        if (memoCell) {
            this.showMemoPopup(memoCell.dataset.column, memoCell.dataset.memo || "");
            return;
        }
        const memoInput = e.target.closest(".itma-inline-note-scroll");
        if (memoInput) {
            const text = String(memoInput.value || "");
            if (text.trim().length > 0) {
                e.preventDefault();
                memoInput.blur();
                this.showMemoPopup(memoInput.dataset.column, text);
                return;
            }
            memoInput.focus();
            return;
        }

        const selectCell = e.target.closest(".itma-select-cell");
        if (selectCell && !e.target.matches(".itma-row-checkbox")) {
            const row = selectCell.closest("tr");
            const checkbox = row?.querySelector(".itma-row-checkbox");
            if (checkbox) {
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event("change", { bubbles: true }));
            }
            return;
        }


    }


    handleTableInput(e) {
        const input = e.target;
        if (!input?.matches(".itma-inline-text")) return;
        if (input.matches(".itma-inline-note-scroll")) {
            this.syncMemoFieldState(input);
            this.refreshTableHorizontalWidth();
        }
        const column = String(input.dataset.column || "").trim();
        if (!this.isSmartSuggestColumn(column)) return;
        this.showSmartSuggestPanel(input, column, input.value || "");
    }


    handleTableChange(e) {
        if (e.target.matches(".itma-inline-spec-field")) {
            const input = e.target;
            const row = input.closest("tr");
            const value = String(input.value || "").trim();
            if (row && value !== String(input.dataset.original || "")) {
                this.updateAssetSpecCell(row.dataset.assetId, input.dataset.formItemId, value, input);
            }
            return;
        }
        if (e.target.matches(".itma-row-checkbox")) {
            const id = String(e.target.value);
            if (e.target.checked) {
                this.selectedIds.add(id);
            } else {
                this.selectedIds.delete(id);
            }
            this.updateSelectAllButton();
            this.updateSelectCurrentPageCheckbox();
            return;
        }

        if (e.target.matches(".itma-inline-detail-field")) {
            const input = e.target;
            const row = input.closest("tr");
            if (!row) return;
            const value = String(input.value || "").trim();
            if (value === String(input.dataset.original || "").trim()) return;
            this.updateAssetDetailCell(row.dataset.assetId, input.dataset.detailField, value, input);
            return;
        }


        if (e.target.matches(".itma-inline-usage")) {
            const input = e.target;
            const row = input.closest("tr");
            if (!row) return;
            const assetId = row.dataset.assetId;
            const column = input.dataset.column;
            const value = input.checked ? "O" : "X";
            const original = (input.dataset.original || "").trim();
            if (value === original) return;
            this.updateAssetCell(assetId, column, value, row, input);
            return;
        }


        if (e.target.matches(".itma-inline-month")) {
            const input = e.target;
            const row = input.closest("tr");
            if (!row) return;
            const assetId = row.dataset.assetId;
            const column = input.dataset.column;
            const value = this.formatMonthValue((input.value || "").trim());
            const original = (input.dataset.original || "").trim();
            if (value === original) return;
            this.updateAssetCell(assetId, column, value, row, input);
            return;
        }


        if (e.target.matches(".itma-inline-date")) {
            const input = e.target;
            const row = input.closest("tr");
            if (!row) return;
            const assetId = row.dataset.assetId;
            const column = input.dataset.column;
            this.updateAssetCell(assetId, column, input.value || "", row, input);
            return;
        }


        if (e.target.matches(".itma-inline-text")) {
            const input = e.target;
            const row = input.closest("tr");
            if (!row) return;
            const assetId = row.dataset.assetId;
            const column = input.dataset.column;
            const value = (input.value || "").trim();
            const original = (input.dataset.original || "").trim();
            if (value === original) return;
            if (this.memoColumns.has(column)) {
                this.syncMemoFieldState(input);
            }
            this.updateAssetCell(assetId, column, value, row, input);
        }
    }


    async updateAssetCell(assetId, column, value, row, targetElement) {
        if (!assetId) return;
        if (this.isCustomColumn(column)) {
            try {
                const response = await fetch("/itma/custom-columns/value", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        asset_id: Number(assetId),
                        column_key: column,
                        value,
                    }),
                });
                const data = await response.json();
                if (!response.ok || !data.success) {
                    throw new Error(data.message || "사용자 컬럼 저장 실패");
                }
                const idKey = String(assetId);
                if (!this.customColumnValues[idKey]) this.customColumnValues[idKey] = {};
                if (String(value || "").trim() === "") {
                    delete this.customColumnValues[idKey][column];
                } else {
                    this.customColumnValues[idKey][column] = value;
                }
                if (targetElement?.matches(".itma-inline-date, .itma-inline-text, .itma-inline-month")) {
                    targetElement.dataset.original = value;
                }
                this.updateSmartSuggestSource(column, value);
            } catch (error) {
                alert(`업데이트 실패: ${error.message}`);
                if (targetElement?.matches(".itma-inline-date, .itma-inline-text, .itma-inline-month")) {
                    targetElement.value = targetElement.dataset.original || "";
                }
            }
            return;
        }
        if (!this.editableColumns.has(column)) return;


        try {
            const response = await fetch(`/itma/assets/${assetId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ column, value })
            });
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.message || "업데이트 실패");
            }


            const item = this.allItems.find((x) => String(x.id) === String(assetId));
            if (item) {
                item[column] = value;
                this.enrichItem(item);
                item.updated_at = data.updated_at || item.updated_at;
                item.updated_by = data.updated_by || item.updated_by || "";
            }


            if (targetElement?.matches(".itma-inline-date, .itma-inline-text, .itma-inline-month")) {
                targetElement.dataset.original = value;
            }
            this.updateSmartSuggestSource(column, value);
            if (targetElement?.matches(".itma-inline-usage")) {
                targetElement.dataset.original = value;
            }


            row.classList.toggle("itma-row-unused", this.normalizeUsageStatus(item?.usage_status) === "X");
            const updatedCell = row.querySelector('td[data-column="updated_at"]');
            if (updatedCell) updatedCell.textContent = data.updated_at || "";
            const updatedByCell = row.querySelector('td[data-column="updated_by"]');
            if (updatedByCell) updatedByCell.textContent = data.updated_by || "";
            this.renderTopTimes(data.updated_at || "", document.getElementById("itmaInputAt")?.textContent || "", "");
            if (column === "category") await this.loadAssets();
        } catch (error) {
            alert(`업데이트 실패: ${error.message}`);
            if (targetElement?.matches(".itma-inline-date, .itma-inline-text, .itma-inline-month")) {
                targetElement.value = targetElement.dataset.original || "";
            }
            if (targetElement?.matches(".itma-inline-usage")) {
                targetElement.checked = (targetElement.dataset.original || "") === "O";
            }
        }
    }

    async updateAssetSpecCell(assetId, formItemId, value, targetElement) {
        targetElement.disabled = true;
        try {
            const response = await fetch(`/itma/assets/${assetId}/spec-items/${formItemId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ value }),
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.message || "스펙 저장 실패");
            const values = this.specColumnValues[String(assetId)] || (this.specColumnValues[String(assetId)] = {});
            values[`spec_${formItemId}`] = data.value;
            targetElement.dataset.original = data.value;
        } catch (error) {
            alert(`스펙 저장 실패: ${error.message}`);
            targetElement.value = targetElement.dataset.original || "";
        } finally {
            targetElement.disabled = false;
        }
    }

    async updateAssetDetailCell(assetId, field, value, targetElement) {
        if (!assetId || !field) return;
        try {
            const response = await fetch(`/itma/assets/${assetId}/details/field`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ field, value }),
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.message || "상세 정보 저장 실패");
            const key = `detail_${field}`;
            const itemValues = this.detailColumnValues[String(assetId)] || (this.detailColumnValues[String(assetId)] = {});
            itemValues[key] = data.value || "";
            targetElement.dataset.original = data.value || "";
        } catch (error) {
            alert(`상세 정보 저장 실패: ${error.message}`);
            targetElement.value = targetElement.dataset.original || "";
        }
    }
}


document.addEventListener("DOMContentLoaded", () => {
    const handler = new ItmaHandler();
    handler.init();
});


