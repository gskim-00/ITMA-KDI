"""
이메일 발송 서비스
SMTP를 통한 이메일 전송 관리
"""
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import formataddr
from config import email_config


def send_email(recipient_list, subject, body, html=False):
    """
    이메일 발송 함수 (DB에 저장된 설정 사용)
    
    Args:w
        recipient_list (str or list): 받는사람 이메일 (쉼표로 구분되거나 리스트)
        subject (str): 이메일 제목
        body (str): 이메일 본문
        html (bool): HTML 형식 여부
    
    Returns:
        dict: {"success": bool, "message": str}
    
    Examples:
        >>> send_email('user@example.com', '테스트', '안녕하세요')
        {'success': True, 'message': '1명에게 이메일이 성공적으로 발송되었습니다.'}
        
        >>> send_email(['user1@example.com', 'user2@example.com'], '공지', '내용', html=True)
        {'success': True, 'message': '2명에게 이메일이 성공적으로 발송되었습니다.'}
    """
    try:
        # 받는사람 목록 정리
        if isinstance(recipient_list, str):
            recipients = [email.strip() for email in recipient_list.split(',')]
        else:
            recipients = recipient_list
        
        # 전역 설정 사용
        sender_name = email_config.get('sender_name', '자산 관리 시스템')
        sender_email = email_config.get('sender_email', '')
        smtp_server = email_config.get('smtp_server', '')
        smtp_port = email_config.get('smtp_port', 587)
        smtp_username = email_config.get('smtp_username', '')
        smtp_password = email_config.get('smtp_password', '')
        use_tls = email_config.get('use_tls', True)
        
        # 디버깅 로그 추가
        print(f"🔍 SMTP 설정 확인:")
        print(f"  - 서버: {smtp_server}:{smtp_port}")
        print(f"  - TLS: {use_tls}")
        print(f"  - 사용자: {smtp_username}")
        print(f"  - 발신자: {sender_email}")
        # print(f"  - 비밀번호 길이: {len(smtp_password) if smtp_password else 0}")
        # print(f"  - 비밀번호 첫 3자: {smtp_password[:3] if smtp_password else 'None'}")
        # print(f"  - 비밀번호 마지막 2자: {smtp_password[-2:] if smtp_password else 'None'}")
        
        # MIME 메시지 생성
        msg = MIMEMultipart('alternative')
        msg['From'] = formataddr((sender_name, sender_email))
        msg['To'] = ', '.join(recipients)
        msg['Subject'] = subject
        
        # 본문 추가
        part = MIMEText(body, 'html' if html else 'plain', _charset='utf-8')
        msg.attach(part)
        
        # SMTP 서버 연결 (포트에 따라 SSL/TLS 방식 자동 선택)
        try:
            # 포트 465: SMTP_SSL (암묵적 SSL)
            if smtp_port == 465:
                server = smtplib.SMTP_SSL(smtp_server, smtp_port, timeout=30)
                server.ehlo()
            # 포트 587: STARTTLS (명시적 TLS)
            elif use_tls:
                server = smtplib.SMTP(smtp_server, smtp_port, timeout=30)
                server.ehlo()
                server.starttls()
                server.ehlo()
            # 평문 SMTP (비권장)
            else:
                server = smtplib.SMTP(smtp_server, smtp_port, timeout=30)
                server.ehlo()
            
            # 인증 (sender_email을 로그인 ID로 사용)
            if smtp_password:
                # smtp_username이 있으면 사용, 없으면 sender_email 사용
                login_id = smtp_username if smtp_username and '@' in smtp_username else sender_email
                server.login(login_id, smtp_password)
            
            # 발송
            server.sendmail(sender_email, recipients, msg.as_string())
            server.quit()
        except smtplib.SMTPException as smtp_error:
            print(f"❌ SMTP 오류: {smtp_error}")
            raise
        except Exception as conn_error:
            print(f"❌ 연결 오류: {conn_error}")
            raise
        
        print(f"✓ 이메일 발송 성공: {', '.join(recipients)}")
        return {
            "success": True, 
            "message": f"{len(recipients)}명에게 이메일이 성공적으로 발송되었습니다."
        }
        
    except Exception as e:
        print(f"❌ 이메일 발송 실패: {e}")
        return {
            "success": False,
            "message": f"이메일 발송 중 오류가 발생했습니다: {str(e)}"
        }


def test_email_connection(smtp_config):
    """
    SMTP 연결 테스트
    
    Args:
        smtp_config (dict): SMTP 설정 정보
            - smtp_server: SMTP 서버 주소
            - smtp_port: SMTP 포트
            - smtp_username: SMTP 사용자명
            - smtp_password: SMTP 비밀번호
            - use_tls: TLS 사용 여부
    
    Returns:
        dict: {"success": bool, "message": str}
    """
    try:
        smtp_server = smtp_config.get('smtp_server')
        smtp_port = int(smtp_config.get('smtp_port', 587))
        smtp_username = smtp_config.get('smtp_username')
        smtp_password = smtp_config.get('smtp_password')
        sender_email = smtp_config.get('sender_email') or smtp_username
        use_tls = smtp_config.get('use_tls', True)
        
        # SMTP 연결 테스트 (포트에 따라 SSL/TLS 방식 자동 선택)
        try:
            # 포트 465: SMTP_SSL
            if smtp_port == 465:
                server = smtplib.SMTP_SSL(smtp_server, smtp_port, timeout=30)
                server.ehlo()
            # 포트 587: STARTTLS
            elif use_tls:
                server = smtplib.SMTP(smtp_server, smtp_port, timeout=30)
                server.ehlo()
                server.starttls()
                server.ehlo()
            # 평문 SMTP
            else:
                server = smtplib.SMTP(smtp_server, smtp_port, timeout=30)
                server.ehlo()
            
            # 인증 테스트 (sender_email을 로그인 ID로 사용)
            if smtp_password:
                login_id = smtp_username if smtp_username and '@' in smtp_username else sender_email
                server.login(login_id, smtp_password)
            
            server.quit()
        except smtplib.SMTPException as smtp_error:
            raise Exception(f"SMTP 프로토콜 오류: {smtp_error}")
        except Exception as conn_error:
            raise Exception(f"서버 연결 오류: {conn_error}")
        
        return {
            "success": True,
            "message": "SMTP 서버 연결 성공"
        }
    except Exception as e:
        return {
            "success": False,
            "message": f"SMTP 연결 실패: {str(e)}"
        }
