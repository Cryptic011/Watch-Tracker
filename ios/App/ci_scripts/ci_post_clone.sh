#!/bin/sh
set -eu
cd "$CI_PRIMARY_REPOSITORY_PATH"
if command -v brew >/dev/null 2>&1; then
  brew list node@24 >/dev/null 2>&1 || brew install node@24
  export PATH="$(brew --prefix node@24)/bin:$PATH"
fi
node -e 'if(process.versions.node.split(".")[0]!=="24")throw Error("Node.js 24 is required")'
npm ci
npm test
npm run ios:sync
# Xcode Cloud assigns a unique build number for every archive.
if [ -n "${CI_BUILD_NUMBER:-}" ]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $CI_BUILD_NUMBER" ios/App/App/Info.plist
fi
