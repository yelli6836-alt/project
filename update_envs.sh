set -euo pipefail

# key=value를 "있으면 치환 / 없으면 추가"
set_kv() {
  local file="$1" key="$2" val="$3"
  if grep -qE "^${key}=" "$file"; then
    # macOS sed 호환까지 고려하면 -i '' 필요하지만, 너 환경이 리눅스면 아래로 OK
    sed -i "s|^${key}=.*|${key}=${val}|" "$file"
  else
    echo "${key}=${val}" >> "$file"
  fi
}

ensure_file() {
  local file="$1"
  if [ ! -f "$file" ]; then
    mkdir -p "$(dirname "$file")"
    touch "$file"
  fi
}

# 각 서비스별로 어떤 DB를 쓰는지 매핑
# (api-order는 기존에 order_user 쓰고 있었어도, 네 요청대로 payment_db면 payment_user로 통일)
declare -A SVC_DB=(
  [api-product]=product_db
  [api-customer]=customer_db
  [api-cart]=cart_db
  [api-review]=review_db
  [api-payment]=payment_db
  [api-order]=payment_db
  [api-delivery]=delivery_db
  [api-wms]=warehouse_db
  [api-accesslog]=accesslog_db
)

# DB별 계정/비번 매핑
declare -A DB_USER=(
  [product_db]=product_user
  [customer_db]=customer_user
  [cart_db]=cart_user
  [review_db]=review_user
  [payment_db]=payment_user
  [delivery_db]=delivery_user
  [warehouse_db]=warehouse_user
  [accesslog_db]=accesslog_user
)

declare -A DB_PASS=(
  [product_db]='Product!1234'
  [customer_db]='Customer!1234'
  [cart_db]='Cart!1234'
  [review_db]='Review!1234'
  [payment_db]='Payment!1234'
  [delivery_db]='Delivery!1234'
  [warehouse_db]='Warehouse!1234'
  [accesslog_db]='Accesslog!1234'
)

for svc in "${!SVC_DB[@]}"; do
  dir="$svc"
  env="$dir/.env"
  db="${SVC_DB[$svc]}"

  if [ ! -d "$dir" ]; then
    echo "[skip] $svc (no dir)"
    continue
  fi

  ensure_file "$env"

  # DB_* 업데이트
  set_kv "$env" "DB_NAME" "${db}"
  set_kv "$env" "DB_USER" "${DB_USER[$db]}"
  set_kv "$env" "DB_PASS" "${DB_PASS[$db]}"
  set_kv "$env" "DB_PORT" "3306"

  # DB_HOST는 환경마다 다르니 건드리지 않음(없으면 빈 값 추가만)
  if ! grep -qE "^DB_HOST=" "$env"; then
    echo "DB_HOST=" >> "$env"
  fi

  echo "[ok] $svc -> DB=${db}, USER=${DB_USER[$db]}"
done

echo
echo "Done. Changed: DB_NAME / DB_USER / DB_PASS / DB_PORT (+ DB_HOST if missing)"
