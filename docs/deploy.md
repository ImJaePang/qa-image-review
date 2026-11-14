# 배포 가이드

이 프로젝트를 다른 PC나 서버에서 한 번에 실행하는 방법과, 인터넷에 공개할 때 지켜야 할 것을 정리한다.
개발할 때의 실행(백엔드·프론트를 npm으로 따로 띄우기)은 [guide.md](guide.md) 4장.

## 1. 한 줄로 실행하기 (Docker만 있으면 됨)

필요한 것: Docker Desktop(또는 Docker Engine + compose). Node.js는 필요 없다.

```bash
cp .env.example .env        # POSTGRES_PASSWORD, JWT_SECRET(16자 이상 무작위) 수정
docker compose --profile app up -d --build
```

- 브라우저에서 **http://localhost:8080** (포트는 `.env`의 `APP_PORT`).
- 처음 시작할 때 자동으로: DB 스키마 적용 → 목 이미지 300장 생성·적재(`DEMO_DATA_COUNT`, 0이면 빈 상태) → API+화면 서버 → 수신 워커 시작.
- 데모 계정: `admin@example.com`(관리자), `qa1@example.com`(QA) / 비밀번호 `1234`.
- 데모 모드(`DEMO_MODE=true`, 기본)에서는 `qa1`에게 **데모 배정 1건**(의심·불량 위주 40장)이 미리 만들어져 있다. `qa1`로 로그인해 바로 검수해 보고, 관리자로는 **검수 관리 > 배정 리스트 > 신규 배정**으로 남은 이미지를 배정해 본다.
- 끄기: `docker compose --profile app down` (데이터 유지). 데이터까지 지우려면 `down -v`.
- 코드를 바꾼 뒤 다시 반영: `docker compose --profile app up -d --build`.

구성(컨테이너 3개): `db`(PostgreSQL) / `app`(API + 빌드된 화면, 시작 시 마이그레이션) / `worker`(파일 수신·추론). `app`과 `worker`는 같은 이미지(`Dockerfile`)이고, 이미지 파일은 `appdata` 볼륨에 둔다.

> 개발용 `docker compose up -d`(프로필 없음)는 DB만 띄운다. `app`·`worker`는 `--profile app`을 붙여야 뜬다.

## 2. 이 이미지에 들어 있지 않은 것
- **실제 모델(PatchCore, Python)**: 용량이 크고 학습이 필요해 넣지 않았다. 기본 **목(mock) 모델**로 동작한다. 실제 모델은 로컬에서 `python/README.md` 절차로 쓴다.
- **ComfyUI 이미지 생성**: 개발 PC 전용 도구라 배포와 무관하다.
- 개발 중 쌓은 데이터(`data/images`, DB): 저장소에 없다. 새로 시작하면 위 목 데이터가 만들어진다.

## 3. 인터넷에 공개하기 전 체크리스트
데모 계정 비밀번호는 `1234`로 알려져 있다. **`DEMO_MODE=true` 그대로 공개하면 로그인 화면이 계정과 비밀번호를 알려 주고 입력까지 채워 주므로 누구나 관리자로 들어올 수 있다.** 공개한다면:

0. **`DEMO_MODE=false` + `ADMIN_PASSWORD`** (12자 이상, 길고 무작위로). 로그인 화면의 안내·기본 입력값과 데모 배정이 없어지고, **시작할 때 서버가 데모 계정을 정리한다**: 관리자 비밀번호를 `ADMIN_PASSWORD`로 바꾸고(`ADMIN_EMAIL`이 있으면 이메일도), `qa1`~`qa3`은 비활성화하며 비밀번호를 무작위로 바꾼다. `ADMIN_PASSWORD`가 없거나 약하면 **서버가 뜨지 않는다**(알려진 비밀번호로 공개되는 것을 막는 장치). 이미 바꾼 뒤에는 다시 시작해도 아무것도 덮어쓰지 않는다. 컨테이너가 아니면 `cd backend && npm run bootstrap-admin`.

1. **HTTPS 뒤에 둔다** (호스팅 서비스의 기본 HTTPS 또는 nginx/Caddy). `.env`의 `COOKIE_SECURE=true`.
2. **프록시 뒤라면 `TRUST_PROXY=true`**. 안 그러면 로그인 잠금이 모든 방문자를 한 주소로 보고 한꺼번에 잠근다. 반대로 프록시가 없는데 켜면 접속 주소를 위조할 수 있으니 켜지 않는다.
3. **비밀값을 새로 만든다**: `POSTGRES_PASSWORD`, `JWT_SECRET`을 길고 무작위로.
4. **데모 계정은 0번이 자동으로 정리한다.** 면접관에게 보여 줄 계정이 필요하면 공개 서버에서 사용자 관리로 새로 만든다(가입 신청 → 승인). 시드 SQL의 `1234`는 저장소에 공개되어 있는 값이므로 공개 서버에서 절대 쓰지 않는다.
5. **DB 포트를 닫는다**: `docker-compose.yml`의 `db.ports`(5432 공개)는 개발 편의용이다. 서버에서는 이 줄을 지워 컨테이너 안에서만 접근되게 한다.
6. **메일**: 임시 비밀번호를 메일로 보내려면 `MAIL_MODE=smtp`와 `SMTP_*`를 설정한다. 끄면(`off`) 관리자 화면에 임시 비밀번호가 한 번 보인다.
7. 가입은 관리자 승인 후에만 사용할 수 있지만, 누구나 신청은 할 수 있다. 원하지 않으면 공개 범위를 제한한다.

## 4. 포트폴리오에 넣는 방법

| 방법 | 비용 | 설명 |
|---|---|---|
| **A. GitHub + 스크린샷·시연 영상** | 없음 | README에 화면 캡처(`captures/`)와 실행 방법을 넣는다. 가장 안정적이다. |
| **B. 로컬에서 보여 주기** | 없음 | 면접 때 위 1장 명령으로 바로 띄운다. Docker만 있으면 된다. |
| **C. 서버에 공개** | 소액~무료 | 이 저장소의 `Dockerfile`을 그대로 올릴 수 있는 곳(Fly.io, Render, Railway, VPS 등) + PostgreSQL(같은 서비스의 DB 또는 Neon·Supabase). 위 3장을 지킨다. |

C를 할 때 알아둘 점:
- 컨테이너 환경변수로 `POSTGRES_HOST/PORT/USER/PASSWORD/DB`, `JWT_SECRET`, `COOKIE_SECURE=true`, `TRUST_PROXY=true`, `DEMO_DATA_COUNT`를 준다. 시작할 때 마이그레이션을 적용한다.
- **스키마 최초 적용**: 이 프로젝트의 DB 초기화는 compose의 `db/init/*.sql`(스키마+시드)이 `db` 컨테이너 최초 기동 때만 실행되는 방식이다. 외부 관리형 DB를 쓰면 `db/init/01_schema.sql`, `02_seed.sql`을 한 번 직접 실행해야 한다(이후 변경은 시작 시 자동 마이그레이션).
- **이미지 파일 저장소**: `/data/images`에 볼륨(영구 디스크)이 필요하다. 영구 디스크가 없는 무료 요금제에서는 재시작할 때마다 파일이 사라지므로 `DEMO_DATA_COUNT`로 다시 만들어지지만, 업로드한 파일은 남지 않는다.
- 서버 한 대(VPS)에 이 compose를 그대로 올리고 앞에 Caddy/nginx로 HTTPS를 붙이는 방법이 가장 단순하다.

## 5. 환경변수 요약 (배포 관련)
| 변수 | 기본값 | 설명 |
|---|---|---|
| `HOST` | `127.0.0.1` (컨테이너는 `0.0.0.0`) | 듣는 주소 |
| `FRONTEND_DIST` | 없음 (컨테이너는 `/app/frontend/dist`) | 지정하면 API 서버가 빌드된 화면도 내려준다 |
| `FILES_DIR` | `data/images` (컨테이너는 `/data/images`) | 이미지·업로드 파일 위치 |
| `COOKIE_SECURE` | 운영(`NODE_ENV=production`)이면 true | 로그인 쿠키 Secure. HTTPS 없는 로컬 시험은 false |
| `TRUST_PROXY` | false | 프록시 뒤에서만 true |
| `DEMO_MODE` | 운영 아니면 true (compose는 true) | 로그인 화면 데모 안내·기본 입력값, 데모 배정. **공개 서버는 false** (그러면 ADMIN_PASSWORD 필수) |
| `ADMIN_PASSWORD` | 없음 | `DEMO_MODE=false`일 때 필수. 12자 이상. 관리자 초기 비밀번호 |
| `ADMIN_EMAIL` | 없음 | 선택. 관리자 이메일 (기본 admin@example.com) |
| `DEMO_DATA_COUNT` | 0 (compose는 300) | 처음 한 번 만들 목 이미지 수 |
| `MAIL_MODE` | off | off / log(개발만) / smtp |
