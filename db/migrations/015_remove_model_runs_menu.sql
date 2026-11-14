-- 015: 「데이터 > 모델 > 모델 실행 이력」 메뉴 제거
--  이유: 화면을 만든 적이 없고(준비 중 상태), 모델 처리 시간은 「모니터링 > 소요 시간 분석」의 '모델 처리 시간'이 이미 보여 준다.
--  메뉴·권한 부여·권한 코드(model_run.view)를 함께 지운다. 이 권한은 쓰인 적이 없어 변경 이력도 의미가 없으므로 같이 지운다.
--  (model_runs 테이블은 판정 기록의 근거라서 그대로 둔다 — 지우는 것은 메뉴뿐이다.)
DELETE FROM menus WHERE permission_code = 'model_run.view';
DELETE FROM role_permissions WHERE permission_code = 'model_run.view';
DELETE FROM permission_history WHERE permission_code = 'model_run.view';
DELETE FROM permissions WHERE code = 'model_run.view';
