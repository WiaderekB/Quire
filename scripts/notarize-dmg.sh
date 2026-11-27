#!/usr/bin/env bash
set -euo pipefail

if [[ $(uname -s) != Darwin ]]; then
  printf '%s\n' 'Build and notarize the Quire DMG on macOS.' >&2
  exit 1
fi

cd "$(git rev-parse --show-toplevel)"
identities=$(security find-identity -v -p codesigning | awk '/"Developer ID Application: / { print $2 }')
if [[ -z "$identities" ]]; then
  printf '%s\n' 'Install a Developer ID Application certificate and its private key in Keychain Access.' >&2
  exit 1
fi

identity=${QUIRE_SIGNING_IDENTITY:-$identities}
if [[ ! "$identity" =~ ^[[:xdigit:]]{40}$ ]] || ! grep -Fixq "$identity" <<< "$identities"; then
  printf '%s\n' 'Set QUIRE_SIGNING_IDENTITY to the SHA-1 fingerprint of one available Developer ID Application identity.' >&2
  exit 1
fi
identity=$(printf '%s' "$identity" | tr '[:lower:]' '[:upper:]')
profile=${QUIRE_NOTARY_PROFILE:-quire}
xcrun notarytool history --keychain-profile "$profile" --output-format json >/dev/null

version=$(node -p 'require("./package.json").version')
mkdir -p release/build
output=$(mktemp -d "$PWD/release/build/v$version-mac-notarized.XXXXXX")
bundle="$output/mac-universal/Quire.app"
dmg="$output/Quire-$version-mac-universal.dmg"

pnpm package --mac --universal -c.forceCodeSigning=true \
  -c.mac.hardenedRuntime=true -c.mac.notarize=false -c.dmg.sign=false \
  "-c.mac.identity=$identity" "-c.directories.output=$output"

codesign --verify --deep --strict "$bundle"
codesign --display --verbose=4 "$bundle" 2>&1 | grep -E '^CodeDirectory .*flags=.*\(runtime\)'
architectures=" $(lipo -archs "$bundle/Contents/MacOS/Quire") "
if [[ "$architectures" != *" arm64 "* || "$architectures" != *" x86_64 "* ]]; then
  printf '%s\n' 'Quire must contain slices for Apple Silicon and Intel.' >&2
  exit 1
fi
codesign --sign "$identity" --timestamp "$dmg"
codesign --verify --strict "$dmg"
hdiutil verify "$dmg"

submission="$output/notarization.json"
xcrun notarytool submit "$dmg" --keychain-profile "$profile" --wait --output-format json > "$submission"
status=$(plutil -extract status raw -o - "$submission")
submission_id=$(plutil -extract id raw -o - "$submission")
xcrun notarytool log "$submission_id" --keychain-profile "$profile" "$output/notarization-log.json"
if [[ "$status" != Accepted ]]; then
  printf 'Apple returned %s. See %s\n' "$status" "$output/notarization-log.json" >&2
  exit 1
fi

xcrun stapler staple "$dmg"
xcrun stapler validate "$dmg"
hdiutil verify "$dmg"
printf 'Verified notarized DMG at %s\n' "$dmg"
