#!/usr/bin/env bash
# 部署 carbon-platform 到 GitHub 仓库 monchichi7125/Carbon-platform（GitHub Pages 从根目录发布）
# 用法:
#   bash _deploy_github.sh [token文件路径]     默认 C:/Users/15319/gh_token.txt
#   或 GH_TOKEN=xxx bash _deploy_github.sh
# 安全: token 仅读取一次到内存变量，磁盘文件立即删除；不在任何输出中回显。
set -euo pipefail

WS="C:/Users/15319/WorkBuddy/2026-09-14-15-45-06"
REPO="monchichi7125/Carbon-platform"
TOKEN="${GH_TOKEN:-}"

if [ -z "$TOKEN" ]; then
  TOKENFILE="${1:-C:/Users/15319/gh_token.txt}"
  if [ ! -s "$TOKENFILE" ]; then
    echo "ERROR: 未提供 token（环境变量 GH_TOKEN 为空，且文件不存在: $TOKENFILE）"
    exit 1
  fi
  TOKEN="$(head -n1 "$TOKENFILE" | tr -d '\r\n ')"
  rm -f "$TOKENFILE"
fi

if [ -z "$TOKEN" ]; then echo "ERROR: token 为空"; exit 1; fi

cd "$WS"
TMP="_ghdeploy"
rm -rf "$TMP"

echo "==> 克隆仓库…"
git clone "https://x-access-token:${TOKEN}@github.com/${REPO}.git" "$TMP" 2>&1 | sed 's/x-access-token:[^@]*@/***@/g'

cd "$TMP"
git checkout -B main 2>&1 | sed 's/x-access-token:[^@]*@/***@/g'

echo "==> 复制平台文件到仓库根目录…"
# 注意：首页必须来自最新的 carbon-learning-platform.html（含政策库·可搜索阶段 / undefined 修复），
# 不要改回 carbon-platform/index.html（那是旧版快照，会回退本次修复）。
cp "$WS/carbon-learning-platform.html"         "$TMP/index.html"
cp "$WS/carbon-platform/emission-factors.json" "$TMP/emission-factors.json"
cp "$WS/carbon-mindmap.html"                    "$TMP/carbon-mindmap.html"

git config user.email "workbuddy@local"
git config user.name  "WorkBuddy"
git add -A
if git diff --cached --quiet; then
  echo "==> 无文件变更，跳过提交"
else
  git commit -m "feat: 双碳学习平台（地方碳市场专项29项 · 试点区域标注 · 省份合并渲染 · 随堂小测迁入考核认证）"
fi

echo "==> 推送到 main…"
git push -u origin main 2>&1 | sed 's/x-access-token:[^@]*@/***@/g'
echo "DEPLOY_OK"
echo "链接: https://monchichi7125.github.io/Carbon-platform/"

cd "$WS"
rm -rf "$TMP"
