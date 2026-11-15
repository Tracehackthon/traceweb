#!/bin/sh
set -eu

if [ "${VERCEL_ENV:-}" = "preview" ]; then
  echo "Preview build: skip case tests; browser E2E is required for acceptance."
else
  npm test
fi

npm run build:vercel
