#!/usr/bin/env bash
# Builds Mono and zips dist/ with skin-manifest.json at the zip root → mono.zip
set -euo pipefail
cd "$(dirname "$0")/.."
npm run -s build
rm -f mono.zip
(cd dist && python3 -m zipfile -c ../mono.zip $(ls -A))
echo "$(pwd)/mono.zip"
