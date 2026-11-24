"""
공통 헬퍼 함수
요청 처리 및 유틸리티
"""
import ipaddress

from flask import request


def log_audit(username, action, resource='', details='', ip_address=None, success=True, project_id=None):
    """
    감사 로그 기록
    
    Args:
        username (str): 사용자명
        action (str): 작업 유형 (login, logout, create, update, delete, download, upload, config)
        resource (str): 대상 리소스 (프로젝트명, 파일명 등)
        details (str): 상세 내용
        ip_address (str): IP 주소 (None이면 자동 감지)
        success (bool): 성공 여부
    """
    try:
        from models import get_db_connection
        
        if ip_address is None:
            ip_address = get_client_ip()
        
        conn = get_db_connection()
        cur = conn.cursor()
        
        cur.execute("""
            INSERT INTO audit_logs (username, action, project_id, resource, details, ip_address, success)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (username, action, project_id, resource, details, ip_address, success))
        
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        print(f"⚠️ 감사 로그 기록 실패: {e}")


def get_client_ip():
    """
    클라이언트 IP 주소 가져오기
    프록시 뒤에 있는 경우 X-Real-IP / X-Forwarded-For 헤더 확인
    
    Returns:
        str: 클라이언트 IP 주소
    """
    x_real_ip = normalize_ip_value(request.headers.get('X-Real-IP'))
    if x_real_ip:
        return x_real_ip

    x_forwarded_for = normalize_ip_value(request.headers.get('X-Forwarded-For'))
    if x_forwarded_for:
        return x_forwarded_for

    return normalize_ip_value(request.remote_addr)


def get_client_ip_debug_info():
    """
    IP 판정에 사용된 원본 헤더 정보를 반환

    Returns:
        dict: 디버깅용 IP 정보
    """
    return {
        'client_ip': get_client_ip(),
        'x_real_ip': normalize_ip_value(request.headers.get('X-Real-IP')),
        'x_forwarded_for': request.headers.get('X-Forwarded-For', ''),
        'remote_addr': normalize_ip_value(request.remote_addr),
    }


def normalize_ip_value(ip_addr):
    """
    X-Forwarded-For 형태를 고려해 첫 번째 IP만 정규화

    Args:
        ip_addr (str): 원본 IP 문자열

    Returns:
        str: 정규화된 IP 문자열
    """
    if not ip_addr:
        return ''
    return str(ip_addr).split(',')[0].strip()


def parse_ip_entries(ip_list_raw):
    """
    줄바꿈/쉼표 기반 IP 목록을 정리

    Args:
        ip_list_raw (str): 원본 IP 목록

    Returns:
        list[str]: 정리된 IP/CIDR 목록
    """
    return [
        line.strip()
        for line in str(ip_list_raw or '').replace(',', '\n').splitlines()
        if line.strip()
    ]


def validate_ip_entries(ip_list_raw):
    """
    허용 IP 목록의 형식을 검증

    Args:
        ip_list_raw (str): 원본 IP 목록

    Returns:
        tuple[bool, list[str]]: 검증 성공 여부와 잘못된 항목 목록
    """
    invalid_entries = []
    for entry in parse_ip_entries(ip_list_raw):
        try:
            ipaddress.ip_network(entry, strict=False)
        except ValueError:
            invalid_entries.append(entry)
    return len(invalid_entries) == 0, invalid_entries


def is_ip_in_entries(ip_addr, ip_list_raw):
    """
    단일 IP가 목록(IP/CIDR)에 포함되는지 확인

    Args:
        ip_addr (str): 검사 대상 IP
        ip_list_raw (str): 허용/차단 IP 목록

    Returns:
        bool: 포함 여부
    """
    try:
        parsed_ip = ipaddress.ip_address(normalize_ip_value(ip_addr))
    except ValueError:
        return False

    for entry in parse_ip_entries(ip_list_raw):
        try:
            if parsed_ip in ipaddress.ip_network(entry, strict=False):
                return True
        except ValueError:
            continue
    return False


def format_datetime(dt, format='%Y-%m-%d %H:%M:%S'):
    """
    날짜/시간 포맷팅
    
    Args:
        dt: datetime 객체
        format (str): 날짜 포맷 문자열
    
    Returns:
        str: 포맷된 날짜 문자열
    """
    if dt:
        return dt.strftime(format)
    return ''


def paginate(items, page=1, per_page=20):
    """
    리스트 페이지네이션
    
    Args:
        items (list): 전체 항목 리스트
        page (int): 현재 페이지 (1부터 시작)
        per_page (int): 페이지당 항목 수
    
    Returns:
        dict: {
            'items': list,  # 현재 페이지 항목
            'total': int,   # 전체 항목 수
            'page': int,    # 현재 페이지
            'pages': int,   # 전체 페이지 수
            'has_prev': bool,
            'has_next': bool
        }
    """
    total = len(items)
    pages = (total + per_page - 1) // per_page
    start = (page - 1) * per_page
    end = start + per_page
    
    return {
        'items': items[start:end],
        'total': total,
        'page': page,
        'pages': pages,
        'has_prev': page > 1,
        'has_next': page < pages
    }


def sanitize_filename(filename):
    """
    파일명에서 위험한 문자 제거
    
    Args:
        filename (str): 원본 파일명
    
    Returns:
        str: 정제된 파일명
    """
    import re
    # 경로 구분자 및 특수 문자 제거
    filename = re.sub(r'[<>:"/\\|?*]', '', filename)
    # 앞뒤 공백 제거
    filename = filename.strip()
    # 빈 파일명 방지
    if not filename:
        filename = 'unnamed'
    return filename
