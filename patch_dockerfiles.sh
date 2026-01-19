set -euo pipefail

declare -A PORT=(
  [api-payment]=3001
  [api-wms]=3002
  [api-delivery]=3003
  [api-product]=3005
  [api-customer]=3006
  [api-cart]=3007
  [api-order]=3008
)

for d in api-*; do
  [ -d "$d" ] || continue
  p="${PORT[$d]:-3000}"

  cat > "$d/Dockerfile" <<EOF
FROM node:20-bookworm-slim AS deps
WORKDIR /app

# git / 빌드도구 (alpine 문제 회피 + 네이티브 모듈 대비)
RUN apt-get update && apt-get install -y --no-install-recommends \\
    ca-certificates git python3 make g++ \\
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./

# lock 있으면 ci, 없으면 install (CI 안정화)
RUN if [ -f package-lock.json ]; then \\
      npm ci --omit=dev --no-audit --no-fund; \\
    else \\
      npm install --omit=dev --no-audit --no-fund; \\
    fi

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json* ./
COPY src ./src

EXPOSE ${p}
CMD ["node","src/server.js"]
EOF

  echo "[ok] patched $d (port=$p)"
done
