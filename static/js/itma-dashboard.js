// ONE ITMA 메인 대시보드 (로그인 사용자 조회 권한 범위의 자산 현황)
(function () {
    const STATUS_META = {
        "정상": { icon: "bi-check2-circle", cls: "status-normal" },
        "사용": { icon: "bi-play-circle", cls: "status-inuse" },
        "미사용": { icon: "bi-pause-circle", cls: "status-unused" },
        "교체": { icon: "bi-arrow-repeat", cls: "status-replace" },
        "폐기": { icon: "bi-trash3", cls: "status-disposed" },
        "미지정": { icon: "bi-question-circle", cls: "status-none" },
    };
    const PALETTE = ["#2563EB", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#0ea5e9", "#84cc16", "#ec4899", "#64748b"];
    const ASSET_PAGE_URL = "/itma/assets/page";
    const AUTO_REFRESH_MS = 5 * 60 * 1000;

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = String(value);
    }

    function sumCount(rows) {
        return (rows || []).reduce((sum, row) => sum + Number(row.count || 0), 0);
    }

    function renderTable(tbodyId, rows, linkParam) {
        const tbody = document.getElementById(tbodyId);
        if (!tbody) return;
        const total = sumCount(rows);
        if (!rows || !rows.length || !total) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-muted text-center">데이터 없음</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map((row) => {
            const count = Number(row.count || 0);
            const pct = ((count / total) * 100).toFixed(1);
            const name = String(row.name ?? "");
            const label = linkParam
                ? `<a href="${ASSET_PAGE_URL}?${linkParam}=${encodeURIComponent(name)}" class="itma-dash-link">${escapeHtml(name)}</a>`
                : escapeHtml(name);
            return `<tr><td>${label}</td><td class="text-end">${count}</td><td class="text-end">${pct}%</td></tr>`;
        }).join("");
    }

    function renderDonut(donutId, legendId, rows) {
        const donut = document.getElementById(donutId);
        const legend = document.getElementById(legendId);
        if (!donut || !legend) return;
        const total = sumCount(rows);
        if (!rows || !rows.length || !total) {
            donut.innerHTML = "";
            legend.innerHTML = '<div class="text-muted">데이터 없음</div>';
            return;
        }
        const topRows = rows.slice(0, 8);
        const etc = sumCount(rows.slice(8));
        if (etc > 0) topRows.push({ name: "기타", count: etc });

        const size = 220;
        const strokeWidth = 30;
        const radius = (size - strokeWidth) / 2;
        const cx = size / 2;
        const cy = size / 2;
        const circumference = 2 * Math.PI * radius;
        let offset = 0;
        const segments = topRows.map((row, idx) => {
            const length = (Number(row.count || 0) / total) * circumference;
            const seg = `<circle class="segment" data-index="${idx}" cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${PALETTE[idx % PALETTE.length]}" stroke-width="${strokeWidth}" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}" />`;
            offset += length;
            return seg;
        }).join("");
        donut.innerHTML = `<svg viewBox="0 0 ${size} ${size}" aria-hidden="true"><g transform="rotate(-90 ${cx} ${cy})">${segments}</g></svg><div class="itma-donut-center"><div class="donut-label"></div><div class="donut-total"></div></div>`;
        legend.innerHTML = topRows.map((row, idx) => {
            const pct = ((Number(row.count || 0) / total) * 100).toFixed(1);
            return `<div class="legend-item" data-index="${idx}"><span class="legend-color" style="background:${PALETTE[idx % PALETTE.length]}"></span><span>${escapeHtml(row.name)}</span><span>${pct}%</span></div>`;
        }).join("");

        const centerLabel = donut.querySelector(".donut-label");
        const centerTotal = donut.querySelector(".donut-total");
        const setCenter = (row) => {
            if (!row || !centerLabel || !centerTotal) return;
            centerLabel.textContent = row.name;
            centerTotal.textContent = `${((Number(row.count || 0) / total) * 100).toFixed(1)}%`;
        };
        setCenter(topRows[0]);
        donut.querySelectorAll(".segment").forEach((seg) => seg.addEventListener("click", () => setCenter(topRows[Number(seg.dataset.index)])));
        legend.querySelectorAll(".legend-item").forEach((item) => item.addEventListener("click", () => setCenter(topRows[Number(item.dataset.index)])));
    }

    function renderStatus(rows, total) {
        const grid = document.getElementById("itmaDashStatusGrid");
        if (!grid) return;
        grid.innerHTML = (rows || []).map((row) => {
            const name = String(row.name || "");
            const meta = STATUS_META[name] || STATUS_META["미지정"];
            const count = Number(row.count || 0);
            const pct = total ? ((count / total) * 100).toFixed(1) : "0.0";
            const href = name === "미지정" ? ASSET_PAGE_URL : `${ASSET_PAGE_URL}?status=${encodeURIComponent(name)}`;
            return `<a class="itma-dash-status-card ${meta.cls}" href="${href}">
                <i class="bi ${meta.icon}" aria-hidden="true"></i>
                <span class="status-name">${escapeHtml(name)}</span>
                <span class="status-count">${count}</span>
                <span class="status-pct">${pct}%</span>
            </a>`;
        }).join("");
    }

    async function loadAndRender() {
        try {
            const response = await fetch("/itma/dashboard/summary", { headers: { Accept: "application/json" } });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.message || "대시보드 데이터를 불러오지 못했습니다.");
            const kpi = data.kpi || {};
            const dist = data.distribution || {};
            const total = Number(kpi.total_count || 0);
            setText("itmaDashTotal", total);
            setText("itmaDashSiteCount", (dist.site || []).filter((row) => row.name !== "미지정").length);
            setText("itmaDashCategoryCount", kpi.category_count || 0);
            setText("itmaDashUpdated30d", kpi.updated_30d_count || 0);
            renderStatus(dist.status || [], total);
            renderTable("itmaDashSiteBody", dist.site || [], "site");
            renderTable("itmaDashCategoryBody", dist.category || []);
            renderTable("itmaDashManufacturerBody", dist.manufacturer || []);
            renderTable("itmaDashStorageBody", dist.storage || []);
            renderDonut("itmaDashSiteDonut", "itmaDashSiteLegend", dist.site || []);
            renderDonut("itmaDashCategoryDonut", "itmaDashCategoryLegend", dist.category || []);
            renderDonut("itmaDashManufacturerDonut", "itmaDashManufacturerLegend", dist.manufacturer || []);
            renderDonut("itmaDashStorageDonut", "itmaDashStorageLegend", dist.storage || []);
            setText("itmaDashLastRefreshed", data.server_time || "-");
        } catch (error) {
            setText("itmaDashLastRefreshed", `오류: ${error.message}`);
        }
    }

    document.addEventListener("DOMContentLoaded", () => {
        document.getElementById("btnItmaDashRefresh")?.addEventListener("click", loadAndRender);
        loadAndRender();
        window.setInterval(loadAndRender, AUTO_REFRESH_MS);
    });
})();
