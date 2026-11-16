#!/bin/sh
set -eu

# Deployment builds do not run the case-test suite; behavior is verified via browser E2E.
npm run build:vercel
