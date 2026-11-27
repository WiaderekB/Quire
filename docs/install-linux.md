# Install Quire on Linux

Choose **x64** for Intel and AMD machines or **ARM64** for 64-bit ARM machines. Download the archive and `SHA256SUMS.txt` into the same directory. Run `sha256sum --check --ignore-missing SHA256SUMS.txt` there to verify the archive. [Quire releases](https://github.com/WiaderekB/Quire/releases)

On distributions where your user can create namespaces, extract the archive and run `./quire` from the extracted folder. For Ubuntu 24.04, install Quire at `/opt/Quire` and load its AppArmor profile.

## Ubuntu 24.04

AppArmor restricts user namespaces by default. Quire uses them to start its Chromium sandbox. The profile below permits namespaces for the root-owned executable at `/opt/Quire/quire`. [Ubuntu 24.04 AppArmor documentation](https://documentation.ubuntu.com/release-notes/24.04/#unprivileged-user-namespace-restrictions)

Save the profile as `quire.apparmor` beside the verified archive. Run the following commands for a fresh installation. Set `archive` to the filename you downloaded. [Quire AppArmor profile](../packaging/linux/quire.apparmor)

```sh
archive=Quire-0.4.0-linux-x64.tar.gz
sudo apt install apparmor libgtk-3-0t64 libnss3 libasound2t64
sudo mkdir -m 0755 /opt/Quire &&
  sudo tar -xzf "$archive" -C /opt/Quire --strip-components=1 --no-same-owner --no-same-permissions &&
  sudo install -m 0644 quire.apparmor /etc/apparmor.d/quire &&
  sudo apparmor_parser --replace /etc/apparmor.d/quire
```

Launch Quire as your regular user with `/opt/Quire/quire`. For local PDF compilation, install `latexmk` and the TeX packages your project needs. On Ubuntu, `sudo apt install latexmk texlive-latex-base texlive-latex-recommended lmodern` supports the bundled example project.
