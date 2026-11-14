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
5. **DB·앱 포트**: 기본값이 이 PC에서만 접속되도록(127.0.0.1) 바뀌어 있다. 인터넷에 열리는 것은 운영 구성의 프록시(Caddy)의 80/443뿐이다(6장). 같은 망의 다른 PC에서 열어 보려면 `APP_BIND=0.0.0.0`.
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
- 서버 한 대(VPS)에 이 compose를 올리고 앞에 Caddy로 HTTPS를 붙이는 방법이 가장 단순하다. **이 저장소에 준비되어 있다 → 6장.**

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
| `APP_BIND` | `127.0.0.1` | 앱 포트(8080)를 여는 주소. 같은 망의 다른 PC에서 열려면 `0.0.0.0` (운영은 프록시가 받으므로 그대로 둔다) |
| `DOMAIN` | 없음 | 운영 프록시의 도메인 (예: qa.example.com). `docker-compose.prod.yml`에서 필수 |
| `HTTP_PORT` / `HTTPS_PORT` | 80 / 443 | 운영 프록시가 여는 포트 (로컬 시험에서만 바꾼다) |

## 6. 서버(VPS)에 올리기

**준비된 것**: `docker-compose.prod.yml`(운영 덧씌우기), `deploy/Caddyfile`(HTTPS 프록시), `.env.production.example`(운영 설정 예시). 구성 안내: 인터넷에 열리는 것은 Caddy의 80/443뿐이고, 앱(3000)과 DB(5432)는 밖에 열리지 않는다. 공개 서버 설정(`DEMO_MODE=false`, `COOKIE_SECURE=true`, `TRUST_PROXY=true`)은 `.env`로 바꿀 수 없게 덧씌우기 파일에서 고정한다.

**상태**: 개발 PC에서 `DOMAIN=localhost`(Caddy 내장 인증서)로 전체를 띄워 아래를 확인했다 — HTTPS 화면·API, HTTP→HTTPS 308, 보안 헤더(HSTS 등), 로그인 쿠키 `HttpOnly; Secure; SameSite=Lax`, 데모 계정(1234) 정리와 새 관리자 로그인, 밖에 열린 포트는 80/443뿐, 필수값(`ADMIN_PASSWORD`·`DOMAIN`) 누락 시 시작 거부. **실제 서버와 실제 도메인에서는 아직 실행해 보지 않았다**(Let's Encrypt 인증서 발급은 실제 도메인에서만 확인할 수 있다).

### 순서
1. **준비물**: Ubuntu 22.04 이상 VPS(메모리 2GB 이상 권장: 데이터베이스+서버+이미지 처리), 도메인(예: `qa.example.com`)과 그 DNS **A 레코드가 서버 IP를 가리키게** 해 둔다. 서버 방화벽은 22(SSH), 80, 443만 연다.
2. **Docker 설치**: `curl -fsSL https://get.docker.com | sh` 후 `sudo usermod -aG docker $USER` (다시 로그인).
3. **받기**: `git clone https://github.com/ImJaePang/qa-image-review.git && cd qa-image-review`
4. **설정**: `cp .env.production.example .env.production` 후 값을 채운다. 비밀번호·키는 `openssl rand -base64 36`로 만든다. 필수: `DOMAIN`, `POSTGRES_PASSWORD`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`(12자 이상). `.env.production`은 git에 올라가지 않는다.
5. **실행**:
   ```bash
   docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.prod.yml --profile app up -d --build
   ```
   처음에는 이미지를 빌드하느라 몇 분 걸린다. 시작 때 마이그레이션 적용, 데모 계정 정리, 관리자 설정이 자동으로 된다.
6. **확인**: `https://<도메인>` 접속(인증서 발급에 1분 안팎) → `ADMIN_EMAIL`/`ADMIN_PASSWORD`로 로그인 → 상단 `비밀번호 변경`이 되는지, 설정 > 사용자 관리에 데모 계정 3개(qa1~qa3)가 비활성으로 보이는지 확인. 로그: `docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production --profile app logs -f app`.
7. **데이터 넣기**: 데모 이미지는 만들지 않는다(`DEMO_DATA_COUNT=0`). 관리자로 `데이터 > 이미지 업로드`에서 이미지를 올리면 워커가 판정한다(기본은 목 모델). 면접관에게 보여 줄 계정은 가입 신청 → 사용자 관리에서 승인으로 만든다.

### 운영
- **업데이트**: `git pull` 후 5번 명령을 다시 실행한다(`--build`가 이미지를 새로 만들고, 마이그레이션은 시작 때 자동 적용). 데이터는 볼륨에 있어 유지된다.
- **중지**: `docker compose ... --profile app down` (**`-v`는 붙이지 않는다** — 데이터가 지워진다). 서버를 재부팅해도 `restart: unless-stopped`로 다시 올라온다.
- **백업**: DB `docker exec qa-db pg_dump -U <POSTGRES_USER> <POSTGRES_DB> | gzip > backup-$(date +%F).sql.gz`, 이미지 파일 볼륨(`appdata`)은 `docker run --rm -v qa-image-review_appdata:/d -v "$PWD":/b alpine tar czf /b/images-$(date +%F).tgz -C /d .`. 정기적으로 서버 밖으로 복사해 둔다(백업 자동화는 아직 없다).
- **복원 시험은 해 본 적 없다.** 중요한 데이터가 생기기 전에 한 번 해 볼 것.

### 공개 전 점검표 (3장의 항목과 대응)
| 항목 | 상태 |
|---|---|
| `DEMO_MODE=false`, 데모 계정 정리, 관리자 비밀번호 | 덧씌우기 파일이 고정 + 시작 때 자동 (필수값 없으면 시작 거부) |
| HTTPS, 쿠키 Secure | Caddy가 인증서 자동 발급 + `COOKIE_SECURE=true` 고정 |
| `TRUST_PROXY` | 프록시 뒤라 `true` 고정 (로그인 잠금이 접속자별로 정확히 동작) |
| DB·앱 포트 | 밖에 열리지 않음 (기본 127.0.0.1) |
| 비밀값 | `.env.production`에 직접 채움 (저장소에 없음) |
| 메일 | 기본 off. 임시 비밀번호를 메일로 보내려면 `MAIL_MODE=smtp` + `SMTP_*` |
| 가입 | 누구나 신청 가능, 승인은 관리자만. 원하지 않으면 공개 범위를 제한 |

### 아직 안 한 것 / 알아둘 점
- 실제 서버·도메인에서 실행과 인증서 발급 확인, 백업 복원 시험, 백업 자동화.
- 실제 모델(Python)은 이미지에 없다 → 목 모델로 동작한다(박스·점수는 가짜).
- 업로드 이미지는 서버 디스크에 쌓인다(`appdata` 볼륨). 디스크 용량을 지켜볼 것.
- 서버가 한 대라 점검·업데이트 중에는 잠시 접속이 끊긴다.
