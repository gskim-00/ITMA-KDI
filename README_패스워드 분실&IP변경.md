# 패스워드 분실 & 허용 IP 변경 복구 가이드

## 목적
관리자 계정 비밀번호를 분실했거나, 허용 IP 설정 때문에 로그인할 수 없을 때 Docker 환경에서 직접 복구하는 절차를 정리한 문서입니다.

## 전제 조건
- 작업 위치: 프로젝트 루트
- Docker 컨테이너가 실행 중이어야 함
- 기본 서비스명: `web`, `db`
- 기본 DB 정보는 `docker-compose.yml`과 `.env` 기준으로 동작

## 먼저 확인할 것
1. 현재 컨테이너 상태 확인

```powershell
docker compose ps
```

2. DB 컨테이너가 떠 있지 않으면 먼저 기동

```powershell
docker compose up -d db web
```

## 방법 1. 비밀번호만 재설정
가장 안전한 방법은 `web` 컨테이너 안에서 앱과 동일한 해시 방식으로 비밀번호를 다시 만드는 것입니다.

### 1-1. 관리자 비밀번호를 새 값으로 변경
아래 명령에서 `admin`과 `새비밀번호123!`를 실제 값으로 바꿔 실행합니다.

```powershell
docker compose exec web python -c "from werkzeug.security import generate_password_hash; from models import get_db_connection; username='admin'; new_password='새비밀번호123!'; conn=get_db_connection(); cur=conn.cursor(); cur.execute(\"UPDATE users SET password=%s, must_change_password=FALSE, is_active=TRUE WHERE username=%s\", (generate_password_hash(new_password), username)); conn.commit(); print(f'updated={cur.rowcount}'); cur.close(); conn.close()"
```

### 1-2. 다음 로그인 때 비밀번호 강제 변경까지 같이 걸고 싶을 때

```powershell
docker compose exec web python -c "from werkzeug.security import generate_password_hash; from models import get_db_connection; username='admin'; new_password='임시비밀번호123!'; conn=get_db_connection(); cur=conn.cursor(); cur.execute(\"UPDATE users SET password=%s, must_change_password=TRUE, is_active=TRUE WHERE username=%s\", (generate_password_hash(new_password), username)); conn.commit(); print(f'updated={cur.rowcount}'); cur.close(); conn.close()"
```

## 방법 2. 허용 IP 때문에 로그인 불가할 때
계정별 허용 IP는 `users.allowed_ip_list` 컬럼에 저장됩니다.

### 2-1. 특정 계정의 허용 IP를 모두 제거
허용 IP를 비우면 해당 계정은 다시 전체 IP에서 로그인 가능합니다.

```powershell
docker compose exec db psql -U jininfra -d project_db -c "UPDATE users SET allowed_ip_list = NULL WHERE username = 'admin';"
```

### 2-2. 특정 계정의 허용 IP를 새 값으로 변경
단일 IP 또는 CIDR만 넣어야 합니다.

```powershell
docker compose exec db psql -U jininfra -d project_db -c "UPDATE users SET allowed_ip_list = '203.0.113.10' WHERE username = 'admin';"
```

예시:
- 단일 IP: `203.0.113.10`
- 대역 허용: `203.0.113.0/24`

### 2-3. 현재 저장된 허용 IP 확인

```powershell
docker compose exec db psql -U jininfra -d project_db -c "SELECT username, allowed_ip_list FROM users WHERE username = 'admin';"
```

## 방법 3. 전역 IP 필터 때문에 로그인 불가할 때
보안설정의 전역 IP 필터는 `security_settings` 테이블에 저장됩니다.

### 3-1. 전역 IP 필터 비활성화

```powershell
docker compose exec db psql -U jininfra -d project_db -c "UPDATE security_settings SET setting_value = 'False' WHERE setting_key = 'ip_filter_enabled';"
```

### 3-2. 전역 IP 목록 초기화

```powershell
docker compose exec db psql -U jininfra -d project_db -c "UPDATE security_settings SET setting_value = '' WHERE setting_key = 'ip_filter_list';"
```

### 3-3. 현재 전역 IP 필터 상태 확인

```powershell
docker compose exec db psql -U jininfra -d project_db -c "SELECT setting_key, setting_value FROM security_settings WHERE setting_key IN ('ip_filter_enabled', 'ip_filter_type', 'ip_filter_list') ORDER BY setting_key;"
```

## 방법 4. 비밀번호와 허용 IP를 한 번에 복구
가장 자주 쓰는 운영 복구 시나리오입니다.

```powershell
docker compose exec web python -c "from werkzeug.security import generate_password_hash; from models import get_db_connection; username='admin'; new_password='임시비밀번호123!'; conn=get_db_connection(); cur=conn.cursor(); cur.execute(\"UPDATE users SET password=%s, must_change_password=TRUE, allowed_ip_list=NULL, is_active=TRUE WHERE username=%s\", (generate_password_hash(new_password), username)); conn.commit(); print(f'updated={cur.rowcount}'); cur.close(); conn.close()"
```

## 복구 후 확인
1. 관리자 로그인 시도
2. 로그인 성공 후 관리자 화면에서 허용 IP 재설정
3. 필요 시 감사 로그에서 로그인 성공 여부 확인

## 주의 사항
- `allowed_ip_list`에 단일 IP를 넣으면 해당 IP만 허용됩니다.
- `203.0.113.0/24`처럼 CIDR로 넣으면 해당 대역 전체가 허용됩니다.
- 전역 IP 필터와 계정별 허용 IP가 동시에 있으면 둘 다 통과해야 로그인됩니다.
- 운영 중 직접 SQL을 수정한 경우, 변경 후 별도 앱 재시작은 보통 필요하지 않지만 문제가 있으면 `web` 재시작을 권장합니다.

## 필요 시 재시작

```powershell
docker compose restart web
```
