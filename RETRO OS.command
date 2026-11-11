#!/bin/zsh
cd -- "${0:A:h}"
for candidate in /usr/local/bin/node /opt/homebrew/bin/node /usr/bin/node; do
  if [[ -x "$candidate" ]]; then
    exec "$candidate" companion/server.mjs
  fi
done
if command -v node >/dev/null 2>&1; then
  exec node companion/server.mjs
fi
print 'Node.js가 필요합니다. https://nodejs.org 에서 LTS를 설치한 다음 다시 실행하세요.'
read '?Enter 키를 누르면 닫힙니다.'
