#!/bin/bash
# /Applications/EasyEDA.app 을 트랙패드용으로 자동 패치
#   ./patch-easyeda.sh            패치 적용
#   ./patch-easyeda.sh --restore  원본 복구
#   ./patch-easyeda.sh --check    적용 없이 검사만
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="/Applications/EasyEDA.app"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

[ -d "$APP" ] || { echo "오류: $APP 이 없습니다."; exit 1; }
command -v node >/dev/null || { echo "오류: node 가 필요합니다. (brew install node)"; exit 1; }
[ -f "$DIR/patch-easyeda.js" ] || { echo "오류: patch-easyeda.js 를 같은 폴더에 두세요."; exit 1; }

if [ "${1:-}" != "--check" ] && pgrep -x EasyEDA >/dev/null; then
  echo "EasyEDA 가 실행 중입니다. 저장하지 않은 작업이 있으면 먼저 저장하세요."
  read -r -p "지금 종료하고 계속할까요? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || { echo "취소했습니다."; exit 1; }
  osascript -e 'tell application "EasyEDA" to quit' || true
  for _ in $(seq 1 20); do pgrep -x EasyEDA >/dev/null || break; sleep 0.5; done
  pgrep -x EasyEDA >/dev/null && { echo "오류: EasyEDA 가 종료되지 않았습니다."; exit 1; }
fi

node "$DIR/patch-easyeda.js" "$@"
