/**
 * Pagination Patch for ScheduleHandler
 * 페이지 로드 후 ScheduleHandler의 메서드를 패치하여 페이지네이션 기능 추가
 */

document.addEventListener('DOMContentLoaded', () => {
    // 약간의 지연을 주어 원본 핸들러가 먼저 초기화되도록 함
    setTimeout(() => {
        const table = document.getElementById('schedule-table');
        if (!table || !window.scheduleHandlerInstance) return;
        
        const handler = window.scheduleHandlerInstance;
        
        // columnSort 메서드 패치
        const originalColumnSort = handler.columnSort.bind(handler);
        handler.columnSort = function(column) {
            originalColumnSort(column);
            // 정렬 후 페이지네이션 업데이트
            this.filteredRows = Array.from(this.table.querySelectorAll('tbody tr'));
            this.allRows = [...this.filteredRows];
            this.currentPage = 1;
            this.renderPage();
            this.reinitEditableFields();
        };
        
        // resetSort 메서드 패치
        const originalResetSort = handler.resetSort.bind(handler);
        handler.resetSort = function() {
            originalResetSort();
            // 정렬 초기화 후 페이지네이션 업데이트
            this.filteredRows = [...this.originalRows];
            this.allRows = [...this.originalRows];
            this.currentPage = 1;
            this.renderPage();
            this.reinitEditableFields();
        };
    }, 100);
});
