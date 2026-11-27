# Build and release Quire

## Upload the prepared 0.3.0 release

The staged upload folder for 0.3.0 is `release/github-v0.3.0/`. It contains the universal macOS DMG, the Linux x64 and ARM64 archives, and a checksum file. [Release notes](releases/v0.3.0.md)

Push the branch and its annotated tag from the root of the repository.

```sh
git push origin main && git push origin v0.3.0
```

In GitHub Releases, choose **Draft a new release**, select the existing `v0.3.0` tag, paste the release notes, and attach the four files from the upload folder. Review the draft before publishing it. [Create a GitHub release](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)

With an authenticated GitHub CLI, this command prepares the same draft.

```sh
gh release create v0.3.0 --repo WiaderekB/Quire --draft --verify-tag \
  --title "Quire 0.3.0" --notes-file docs/releases/v0.3.0.md \
  release/github-v0.3.0/Quire-0.3.0-mac-universal.dmg \
  release/github-v0.3.0/Quire-0.3.0-linux-x64.tar.gz \
  release/github-v0.3.0/Quire-0.3.0-linux-arm64.tar.gz \
  release/github-v0.3.0/SHA256SUMS.txt
```

## Rebuild the packages

From the source checkout, run `pnpm install --frozen-lockfile`, `pnpm build`, and `pnpm test`. Match the annotated tag to the version in `package.json`.

Run the DMG build on macOS. The flags below produce an ad hoc signed developer build. Use Developer ID signing and notarization for a public macOS distribution. [Electron Builder code signing](https://www.electron.build/v26/docs/features/code-signing/code-signing-mac/)

```sh
version=$(node -p 'require("./package.json").version')

pnpm package --mac --universal \
  -c.mac.identity=- -c.mac.hardenedRuntime=false \
  "-c.directories.output=release/$version/mac"

pnpm package --linux tar.gz --x64 --arm64 \
  "-c.directories.output=release/$version/linux"
```

Copy the DMG and both archives into a single upload directory. Check the macOS disk image and app signature and inspect each Linux archive. Generate the checksums from inside the upload directory so users can verify all three files together.

```sh
shasum -a 256 ./*.dmg ./*.tar.gz > SHA256SUMS.txt
shasum -a 256 -c SHA256SUMS.txt
```
