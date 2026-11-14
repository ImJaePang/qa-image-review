# 단일 이미지: 화면(React)을 빌드해 API 서버가 함께 내려준다.
#   docker compose --profile app up -d --build   (사용법은 docs/deploy.md)
# 실제 모델(Python PatchCore)은 넣지 않는다 — 기본 목(mock) 모델로 동작한다.

# 1) 화면 빌드
FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# 2) 실행 이미지
FROM node:22-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    API_PORT=3000 \
    FRONTEND_DIST=/app/frontend/dist \
    FILES_DIR=/data/images
WORKDIR /app
COPY backend/package.json backend/package-lock.json backend/
RUN cd backend && npm ci --omit=dev
COPY backend/ backend/
COPY db/ db/
COPY --from=web /web/dist frontend/dist
# 이미지·업로드 파일 위치: 볼륨으로 이어 붙인다 (컨테이너를 지워도 유지)
RUN mkdir -p /data/images && chown -R node:node /data
USER node
WORKDIR /app/backend
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.API_PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "scripts/docker-start.mjs"]
