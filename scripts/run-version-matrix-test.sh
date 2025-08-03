#!/bin/bash

set -e

npm ci
npm run build
echo 'export * from "../dist/zod-fast-check";' > ./tests/zod-fast-check-module-proxy.ts
tsc --project tests
npm install --no-save $@
echo "Running tests against versions $@"
jest dist/*.test.js
