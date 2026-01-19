#!/usr/bin/env bash
set -euo pipefail

for d in api-product api-customer api-cart api-order api-payment api-delivery api-wms; do
  if [ -f "$d/.env" ]; then
    echo "[skip] $d/.env already exists"
  else
    cp "$d/.env.example" "$d/.env"
    echo "[ok] created $d/.env (edit DB_HOST/DB_PASS etc.)"
  fi
done
