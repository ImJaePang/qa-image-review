// 연결할 수 없는 SMTP 서버로 설정해 발송 실패를 만든다
process.env.MAIL_MODE = 'smtp'
process.env.SMTP_HOST = '127.0.0.1'
process.env.SMTP_PORT = '1'
