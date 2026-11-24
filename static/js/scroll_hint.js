/**
 * 테이블 수평 스크롤 힌트
 * 모바일에서 테이블이 스크롤 가능할 때 시각적 힌트 제공
 */

document.addEventListener('DOMContentLoaded', function() {
    // 모든 table-responsive 요소 찾기
    const tableContainers = document.querySelectorAll('.table-responsive');
    
    tableContainers.forEach(container => {
        // 스크롤 가능 여부 확인
        if (container.scrollWidth > container.clientWidth) {
            // 스크롤 힌트 표시
            container.classList.add('has-scroll');
            
            // 초기 상태 체크
            updateScrollIndicators(container);
            
            // 스크롤 이벤트 리스너
            container.addEventListener('scroll', () => {
                updateScrollIndicators(container);
            });
        }
    });
});

/**
 * 스크롤 위치에 따라 좌우 그림자 표시
 */
function updateScrollIndicators(container) {
    const scrollLeft = container.scrollLeft;
    const scrollWidth = container.scrollWidth;
    const clientWidth = container.clientWidth;
    
    // 왼쪽 끝이 아니면 왼쪽 그림자 표시
    if (scrollLeft > 10) {
        container.classList.add('scrolled-left');
    } else {
        container.classList.remove('scrolled-left');
    }
    
    // 오른쪽 끝이 아니면 오른쪽 그림자 표시
    if (scrollLeft < scrollWidth - clientWidth - 10) {
        container.classList.add('scrolled-right');
    } else {
        container.classList.remove('scrolled-right');
    }
}

/**
 * 윈도우 리사이즈 시 스크롤 힌트 재계산
 */
window.addEventListener('resize', function() {
    const tableContainers = document.querySelectorAll('.table-responsive');
    
    tableContainers.forEach(container => {
        if (container.scrollWidth > container.clientWidth) {
            container.classList.add('has-scroll');
            updateScrollIndicators(container);
        } else {
            container.classList.remove('has-scroll');
            container.classList.remove('scrolled-left');
            container.classList.remove('scrolled-right');
        }
    });
});
