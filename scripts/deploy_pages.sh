#!/usr/bin/env bash
# build แล้วส่ง dist/pages ขึ้น branch gh-pages ของ repo นี้ (GitHub Pages: https://tonnot3t3.github.io/allthai/)
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/build.py
remote="$(git remote get-url origin)"
tmp="$(mktemp -d)"
cp -R dist/pages/. "$tmp/"
cd "$tmp"
git init -q -b gh-pages
git add -A
git commit -qm "deploy $(date -u +%Y-%m-%dT%H:%MZ)"
git push -f "$remote" gh-pages
echo "ส่งแล้ว รอ 1–2 นาทีให้ GitHub Pages อัปเดต"
