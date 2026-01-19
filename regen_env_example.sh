set -euo pipefail

sanitize() {
  # 민감값은 비움/치환
  sed -E \
    -e 's/^(DB_PASS)=.*/\1=/' \
    -e 's/^(JWT_SECRET)=.*/\1=ChangeMe_SuperSecret/' \
    -e 's/^(RABBITMQ_URL)=.*/\1=/' \
    -e 's/^(AWS_ACCESS_KEY_ID)=.*/\1=/' \
    -e 's/^(AWS_SECRET_ACCESS_KEY)=.*/\1=/' \
    -e 's/^([A-Z0-9_]*TOKEN)=.*/\1=/' \
    -e 's/^([A-Z0-9_]*SECRET)=.*/\1=/' \
    -e 's/^([A-Z0-9_]*PASSWORD)=.*/\1=/' \
    -e 's/^([A-Z0-9_]*KEY)=.*/\1=/' \
    ;
}

# 루트/.env 포함, 모든 하위 폴더의 .env에 대해 .env.example 생성
while IFS= read -r env; do
  ex="${env}.example"   # api-x/.env -> api-x/.env.example
  sanitize < "$env" > "$ex"
  echo "[ok] $ex created"
done < <(find . -type f -name ".env")

