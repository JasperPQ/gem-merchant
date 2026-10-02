#!/bin/zsh

set -u

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR" || exit 1

INTERFACE="$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}')"
LAN_IP=""

if [[ -n "$INTERFACE" ]]; then
  LAN_IP="$(ipconfig getifaddr "$INTERFACE" 2>/dev/null || true)"
fi

if [[ -z "$LAN_IP" ]]; then
  for candidate in en0 en1 en2 en3; do
    LAN_IP="$(ipconfig getifaddr "$candidate" 2>/dev/null || true)"
    [[ -n "$LAN_IP" ]] && break
  done
fi

printf '\n宝石商人网页地址\n'
printf '%s\n' '------------------'

if [[ -z "$LAN_IP" ]]; then
  printf '未检测到局域网 IP。请先连接 Wi-Fi 或有线网络后重试。\n'
else
  printf '本机地址： http://localhost:5173\n'
  printf '同一 Wi-Fi 玩家： http://%s:5173\n' "$LAN_IP"
fi

if curl -fsS --max-time 2 http://localhost:5173/ >/dev/null 2>&1 \
  && curl -fsS --max-time 2 http://localhost:3001/health >/dev/null 2>&1; then
  printf '\n网页与游戏服务：正在运行\n'
else
  printf '\n网页或游戏服务未运行。请在宝石商人目录启动 npm run dev，再重新打开此文件。\n'
fi

printf '\n异地玩家不能直接使用局域网地址；需部署到公网或使用网络隧道。\n'
printf '\n按回车关闭此窗口。'
read -r _
