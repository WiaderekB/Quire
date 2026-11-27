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

Run `pnpm install --frozen-lockfile` and `pnpm test`. Build the universal DMG on macOS. The flags below produce an ad hoc signed developer build. Use Developer ID signing and notarization for public macOS distribution. [Electron Builder code signing](https://www.electron.build/v26/docs/features/code-signing/code-signing-mac/)

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
