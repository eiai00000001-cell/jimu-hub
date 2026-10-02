#!/bin/sh
# 合格を確認したシナリオ実行出力を、公式エビデンス保存先へコピーする。
# 使い方: tools/promote-evidence.sh <実行出力ディレクトリ> <イテレーション番号> [TC-ID...]
#   TC-IDを省略した場合は、実行出力ディレクトリ内の `TC-*` ファイルすべてを対象とする。
# 既存ファイルは上書きしない(イテレーション0分を含む既存エビデンスを保護する)。
set -eu
SRC="${1:?実行出力ディレクトリを指定してください}"
N="${2:?イテレーション番号を指定してください}"
shift 2
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
DEST="$ROOT/docs/07_test/evidence/iteration-$N"
mkdir -p "$DEST"
if [ "$#" -eq 0 ]; then set -- 'TC-'; fi
for prefix in "$@"; do
  for f in "$SRC"/"$prefix"*; do
    [ -e "$f" ] || continue
    base="$(basename "$f")"
    case "$base" in *.zip) continue ;; esac   # traceはローカル絶対パスを含むため対象外
    if [ -e "$DEST/$base" ]; then
      echo "SKIP(既存): $base"
    else
      cp "$f" "$DEST/$base"
      echo "COPY: $base"
    fi
  done
done
[ -f "$SRC/_index.txt" ] && cp "$SRC/_index.txt" "$DEST/_index_$(date +%Y%m%d%H%M%S).txt" || true
