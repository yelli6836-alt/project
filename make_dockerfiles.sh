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

  cat > "$d/.dockerignore" <<'EOF'
node_modules
npm-debug.log
.env
.env.*
.git
EOF

  p="${PORT[$d]:-3000}"

  cat > "$d/Dockerfile" <<EOF
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src
EXPOSE ${p}
CMD ["node","src/server.js"]
EOF

  echo "[ok] $d Dockerfile/.dockerignore (port=$p)"
done
