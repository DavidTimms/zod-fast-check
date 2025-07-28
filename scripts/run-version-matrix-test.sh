#!/bin/bash

set -e

npm ci
npm run build
echo 'export * from "../dist/zod-fast-check";' > ./tests/zod-fast-check-module-proxy.ts
tsc --project tests
# TODO: take versions from arguments.
npm install --no-save zod@3.18.0
jest tests/*.test.js
