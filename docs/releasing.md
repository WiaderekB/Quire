# Build and release Quire

## Local release folders

- `release/v0.4.0/` holds the current DMG, the two Linux archives, and their checksums.
- `release/v0.3.0/` holds the previous staged release.
- `release/build/` is the default output for new packaging runs.
- `release/archive/` holds earlier packages and build output.

The release binaries are ignored by Git. [0.4.0 release notes](releases/v0.4.0.md)

## Publish a release

From the repository root, create a tag for the commit used to build the bundles, then push the branch and tag.

```sh
version=$(node -p 'require("./package.json").version')
tag="v$version"
git tag -a "$tag" -m "Quire $version"
git push --atomic origin main "$tag"
```

Choose **Draft a new release** on GitHub, select the new tag, paste the release notes, and attach the three packages and checksums. An authenticated GitHub CLI can prepare the same draft. [GitHub Releases guide](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)

```sh
directory="release/$tag"
gh release create "$tag" --repo WiaderekB/Quire --draft --verify-tag \
  --title "Quire $version" --notes-file "docs/releases/$tag.md" \
  "$directory/Quire-$version-mac-universal.dmg" \
  "$directory/Quire-$version-linux-x64.tar.gz" \
  "$directory/Quire-$version-linux-arm64.tar.gz" \
  "$directory/SHA256SUMS.txt"
```

## Rebuild the packages

Run `pnpm install --frozen-lockfile` and `pnpm test`. Build the universal DMG on macOS. The macOS command below produces an ad hoc signed developer build. Follow the notarization steps for a public DMG. [Electron Builder code signing](https://www.electron.build/v26/docs/features/code-signing/code-signing-mac/)

```sh
version=$(node -p 'require("./package.json").version')

pnpm package --mac --universal \
  -c.mac.identity=- -c.mac.hardenedRuntime=false \
  "-c.directories.output=release/build/v$version/mac"

pnpm package --linux tar.gz --x64 --arm64 \
  "-c.directories.output=release/build/v$version/linux"
```

Verify the DMG and app signature, and inspect both Linux archives. Stage the three verified packages in `release/v$version/`, then generate the checksums inside that directory.

```sh
shasum -a 256 ./*.dmg ./*.tar.gz > SHA256SUMS.txt
shasum -a 256 -c SHA256SUMS.txt
```

## Notarize the public macOS DMG

Install the Apple Developer Program team's Developer ID Application certificate with its private key in the macOS keychain. Create the `quire` notary profile in Terminal. `notarytool` prompts for credentials and validates them before storing them in the keychain. [Developer ID certificates](https://developer.apple.com/help/account/certificates/create-developer-id-certificates) · [Apple notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow) · [App-specific passwords](https://support.apple.com/en-us/102654)

```sh
security find-identity -v -p codesigning
xcrun notarytool store-credentials quire
```

From the release source checkout with dependencies installed, run `bash scripts/notarize-dmg.sh`. Set `QUIRE_SIGNING_IDENTITY` to the certificate's SHA-1 fingerprint if multiple Developer ID Application identities are available. Set `QUIRE_NOTARY_PROFILE` to use a different keychain profile. For a tag that predates this script, run it by absolute path from that tag's checkout.

The script builds a universal app with hardened runtime, signs the DMG, submits it to Apple, and attaches the accepted ticket. It prints the verified DMG path under `release/build/`. Review `notarization-log.json` and test the downloaded DMG with Gatekeeper before staging it alongside the Linux archives. Generate `SHA256SUMS.txt` after stapling the DMG.

## Test a published Linux release

Run **Verify Linux release** in GitHub Actions with the published tag. The workflow downloads the two archives, verifies their checksums, and launches each on a native Ubuntu 24.04 runner. It opens the bundled project and builds a PDF with the installed LaTeX tools. [Linux installation guide](install-linux.md)
