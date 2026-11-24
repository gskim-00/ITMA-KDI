/**
 * FullCalendar 초기화 및 관리
 */

// 전역 초기화 플래그
window.calendarInitialized = false;

/**
 * 달력 초기화 함수
 */
function initializeCalendar() {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;
    
    // 탭이 보이지 않으면 초기화 안함
    const calendarTab = document.getElementById('sub-calendar');
    if (!calendarTab || !calendarTab.classList.contains('show', 'active')) return;
    
    // 이미 초기화되었으면 크기만 업데이트
    if (window.globalCalendar && window.calendarInitialized) {
        window.globalCalendar.updateSize();
        return;
    }
    
    // 서버에서 전달된 이벤트 데이터 확인
    if (typeof window.calendarEventData === 'undefined') {
        console.error('Calendar event data not found');
        return;
    }
    
    const eventData = window.calendarEventData;
    const startDate = new Date().toISOString().split('T')[0];
    
    // Raw 데이터를 포맷팅하여 캘린더 이벤트 생성
    const formattedEvents = formatCalendarEvents(eventData);
    
    // 기존 달력이 있으면 제거
    if (window.globalCalendar) {
        window.globalCalendar.destroy();
    }
    
    // FullCalendar 초기화
    window.globalCalendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        initialDate: startDate,
        locale: 'ko',
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,dayGridWeek'
        },
        events: formattedEvents,
        height: 'auto',
        contentHeight: 'auto',
        aspectRatio: 1.8,
        eventContent: function(arg) {
            return createEventElement(arg.event.title);
        }
    });
    
    window.globalCalendar.render();
    window.calendarInitialized = true;
}

/**
 * 이벤트 데이터 포맷팅
 */
function formatCalendarEvents(eventData) {
    const formattedEvents = [];
    const dateCustomerMap = {};
    
    // Step 1: 날짜/고객별로 그룹화
    eventData.forEach(item => {
        const key = `${item.date}_${item.customer}`;
        if (!dateCustomerMap[key]) {
            dateCustomerMap[key] = {
                date: item.date,
                customer: item.customer,
                manager: item.manager,
                devices: []
            };
        }
        if (item.device && item.device.trim()) {
            dateCustomerMap[key].devices.push(item.device);
        }
    });
    
    // Step 2: 행 개수로 타이틀 생성
    for (const [key, data] of Object.entries(dateCustomerMap)) {
        const totalRows = data.devices.length;
        let title;
        
        if (totalRows >= 2) {
            // 2개 이상 행 → 장비명 숨김
            title = `${data.manager} | ${data.customer}`;
        } else if (totalRows === 1) {
            // 1개 행 → 장비명 표시
            title = `${data.manager} | ${data.customer} | ${data.devices[0]}`;
        } else {
            // 장비 없음
            title = `${data.manager} | ${data.customer}`;
        }
        
        formattedEvents.push({
            title: title,
            start: data.date,
            allDay: true
        });
    }
    
    return formattedEvents;
}

/**
 * 이벤트 엘리먼트 생성
 */
function createEventElement(title) {
    let titleParts = title.split('|').map(p => p.trim());
    let titleEl = document.createElement('div');
    titleEl.style.fontSize = '0.7rem';
    titleEl.style.whiteSpace = 'normal';
    titleEl.style.wordWrap = 'break-word';
    titleEl.style.lineHeight = '1.2';
    
    // 개통담당자 | 고객명 | 장비명 (모두 표시)
    let html = `<b>${titleParts[0]}</b>`;
    if (titleParts[1]) {
        html += ` | ${titleParts[1]}`;
    }
    if (titleParts[2]) {
        html += ` | ${titleParts[2]}`;
    }
    
    titleEl.innerHTML = html;
    return { domNodes: [titleEl] };
}

/**
 * 탭 전환 리스너 설정
 */
document.addEventListener('shown.bs.tab', function(event) {
    const target = event.target.getAttribute('data-bs-target');
    if (target === '#sub-calendar') {
        setTimeout(function() {
            initializeCalendar();
        }, 150);
    } else if (target === '#project-calender' && window.globalCalendar) {
        // 프로젝트 상세 탭으로 전환 시 크기 업데이트
        window.globalCalendar.updateSize();
    }
});
