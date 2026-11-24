(function () {
    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    class ItmaDashboardLive {
        constructor() {
            this.token = document.body?.dataset?.dashboardToken || "";
            this.defaultRefresh = Number(document.body?.dataset?.dashboardRefresh || 5);
            this.timer = null;
        }

        init() {
            if (!this.token) return;
            const refreshSelect = document.getElementById("liveRefreshInterval");
            if (refreshSelect) {
                const safeDefault = [5, 10, 30, 60].includes(this.defaultRefresh) ? this.defaultRefresh : 5;
                refreshSelect.value = String(safeDefault);
            }
            document.getElementById("btnLiveRefreshNow")?.addEventListener("click", () => this.loadAndRender());
            document.getElementById("liveRefreshInterval")?.addEventListener("change", () => this.resetAutoRefresh());
            this.loadAndRender();
            this.resetAutoRefresh();
        }

        resetAutoRefresh() {
            if (this.timer) window.clearInterval(this.timer);
            const minutes = Number(document.getElementById("liveRefreshInterval")?.value || 5);
            const safeMinutes = [5, 10, 30, 60].includes(minutes) ? minutes : 5;
            this.timer = window.setInterval(() => this.loadAndRender(), safeMinutes * 60 * 1000);
        }

        async loadAndRender() {
            try {
                const response = await fetch(`/itma/dashboard/data?token=${encodeURIComponent(this.token)}`, {
                    headers: { Accept: "application/json" }
                });
                const data = await response.json();
                if (!response.ok || !data.success) {
                    throw new Error(data.message || "대시보드 데이터를 불러오지 못했습니다.");
                }
                this.render(data);
                const now = new Date();
                const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
                this.setText("liveLastRefreshed", stamp);
                this.setText("liveServerTime", data.server_time || "-");
            } catch (error) {
                this.setText("liveServerTime", `오류: ${error.message}`);
            }
        }

        setText(id, value) {
            const el = document.getElementById(id);
            if (el) el.textContent = String(value);
        }

        setProgress(barId, textId, pct) {
            const safe = Math.max(0, Math.min(100, Number(pct) || 0));
            const bar = document.getElementById(barId);
            const text = document.getElementById(textId);
            if (bar) bar.style.width = `${safe}%`;
            if (text) text.textContent = `${safe.toFixed(1)}%`;
        }

        renderTable(tbodyId, rows) {
            const tbody = document.getElementById(tbodyId);
            if (!tbody) return;
            const total = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
            if (!rows.length || !total) {
                tbody.innerHTML = '<tr><td colspan="3" class="text-muted text-center">데이터 없음</td></tr>';
                return;
            }
            tbody.innerHTML = rows.map((row) => {
                const count = Number(row.count || 0);
                const pct = ((count / total) * 100).toFixed(1);
                return `<tr><td>${escapeHtml(row.name)}</td><td class="text-end">${count}</td><td class="text-end">${pct}%</td></tr>`;
            }).join("");
        }

        renderDonut(donutId, legendId, rows) {
            const donut = document.getElementById(donutId);
            const legend = document.getElementById(legendId);
            if (!donut || !legend) return;

            const total = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
            if (!rows.length || !total) {
                donut.style.background = "conic-gradient(#e9ecef 0 100%)";
                donut.innerHTML = "";
                legend.innerHTML = '<div class="text-muted">데이터 없음</div>';
                return;
            }

            const palette = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#17becf", "#bcbd22", "#e377c2"];
            const topRows = rows.slice(0, 8);
            const etc = rows.slice(8).reduce((sum, row) => sum + Number(row.count || 0), 0);
            if (etc > 0) topRows.push({ name: "기타", count: etc });

            const size = 220;
            const strokeWidth = 30;
            const radius = (size - strokeWidth) / 2;
            const cx = size / 2;
            const cy = size / 2;
            const circumference = 2 * Math.PI * radius;
            let offset = 0;

            const segments = topRows.map((row, idx) => {
                const count = Number(row.count || 0);
                const length = (count / total) * circumference;
                const dasharray = `${length} ${circumference - length}`;
                const dashoffset = -offset;
                offset += length;
                return `<circle class="segment" data-index="${idx}" cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${palette[idx % palette.length]}" stroke-width="${strokeWidth}" stroke-dasharray="${dasharray}" stroke-dashoffset="${dashoffset}" />`;
            }).join("");

            donut.innerHTML = `<svg viewBox="0 0 ${size} ${size}" aria-hidden="true"><g transform="rotate(-90 ${cx} ${cy})">${segments}</g></svg><div class="itma-donut-center"><div class="donut-label"></div><div class="donut-total"></div></div>`;
            legend.innerHTML = topRows.map((row, idx) => {
                const count = Number(row.count || 0);
                const pct = ((count / total) * 100).toFixed(1);
                return `<div class="legend-item" data-index="${idx}"><span class="legend-color" style="background:${palette[idx % palette.length]}"></span><span>${escapeHtml(row.name)}</span><span>${pct}%</span></div>`;
            }).join("");

            const centerLabel = donut.querySelector(".donut-label");
            const centerTotal = donut.querySelector(".donut-total");
            const setCenter = (row) => {
                if (!row || !centerLabel || !centerTotal) return;
                const count = Number(row.count || 0);
                centerLabel.textContent = row.name;
                centerTotal.textContent = `${((count / total) * 100).toFixed(1)}%`;
            };
            setCenter(topRows[0]);

            donut.querySelectorAll(".segment").forEach((seg) => {
                const idx = Number(seg.dataset.index);
                seg.addEventListener("click", () => setCenter(topRows[idx]));
            });
            legend.querySelectorAll(".legend-item").forEach((item) => {
                const idx = Number(item.dataset.index);
                item.addEventListener("click", () => setCenter(topRows[idx]));
            });
        }

        render(data) {
            const kpi = data.kpi || {};
            const progress = data.progress || {};
            const dist = data.distribution || {};

            this.setText("itmaKpiCategoryCount", kpi.category_count || 0);
            this.setText("itmaKpiManufacturerCount", kpi.manufacturer_count || 0);
            this.setText("itmaKpiStorageCount", kpi.storage_count || 0);
            this.setText("itmaKpiTotalCount", kpi.total_count || 0);
            this.setText("itmaKpiInUseCount", kpi.in_use_count || 0);
            this.setText("itmaKpiUnusedCount", kpi.unused_count || 0);
            this.setText("itmaKpiUpdated30d", kpi.updated_30d_count || 0);
            this.setText("itmaKpiQualityScore", `${Number(kpi.quality_score || 0).toFixed(1)}점`);

            this.setText("itmaCategoryTotalInTab", (dist.category || []).reduce((s, r) => s + Number(r.count || 0), 0));
            this.setText("itmaManufacturerTotalInTab", (dist.manufacturer || []).reduce((s, r) => s + Number(r.count || 0), 0));
            this.setText("itmaStorageTotalInTab", (dist.storage || []).reduce((s, r) => s + Number(r.count || 0), 0));

            this.setProgress("itmaProgCategoryBar", "itmaProgCategoryText", progress.category);
            this.setProgress("itmaProgManufacturerBar", "itmaProgManufacturerText", progress.manufacturer);
            this.setProgress("itmaProgStorageBar", "itmaProgStorageText", progress.storage);
            this.setProgress("itmaProgSerialBar", "itmaProgSerialText", progress.serial);
            this.setProgress("itmaProgAssetIdBar", "itmaProgAssetIdText", progress.asset_id);

            this.renderTable("itmaCategorySummaryBody", dist.category || []);
            this.renderTable("itmaManufacturerSummaryBody", dist.manufacturer || []);
            this.renderTable("itmaStorageSummaryBody", dist.storage || []);

            this.renderDonut("itmaCategoryDonut", "itmaCategoryLegend", dist.category || []);
            this.renderDonut("itmaManufacturerDonut", "itmaManufacturerLegend", dist.manufacturer || []);
            this.renderDonut("itmaStorageDonut", "itmaStorageLegend", dist.storage || []);
        }
    }

    document.addEventListener("DOMContentLoaded", function () {
        new ItmaDashboardLive().init();
    });
})();
