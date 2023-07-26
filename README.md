# YouTube Music Desktop App
### Now with a Fresh new Codebase 😉

<img type="image/png" src="https://placehold.co/1920x1080/EEE/31343C/?text=Screenshot" alt="window"/>

[![Discord][discord-img]](discord-url)
[![Gitmoji][gitmoji-img]][gitmoji-url]
[![GitHub license][license-img]](license-url)
[![GitHub release][release-img]][release-url]
[![Download][download-img]][download-url]

#### 📖 Guide:
1. [How to use](https://github.com/ytmdesktop/ytmdesktop/wiki/How-use)
2. [FAQ](https://github.com/ytmdesktop/ytmdesktop/wiki/FAQ)

# ⬇️ Download at
<a href="https://repology.org/project/ytmdesktop/versions">
	<img type="image/svg" align="right" src="https://repology.org/badge/vertical-allrepos/ytmdesktop.svg" alt="Packaging status"/>
</a>

### Current V2 Builds are not actually here yet.
#### Windows
<!--
### UPDATE THESE PLATFORMS ###
- Winget: ```winget install "YouTube Music Desktop App"``` or ```winget install Ytmdesktop.Ytmdesktop```
- Chocolatey: ```choco install ytmdesktop```
-->
- Binaries: <https://github.com/ytmdesktop/ytmdesktop/releases>

#### Linux
<!--
### UPDATE THESE PLATFORMS ###
- Arch Linux (AUR): <https://aur.archlinux.org/packages/ytmdesktop-git>
- Snap: <https://snapcraft.io/youtube-music-desktop-app>
-->
- Binaries: <https://github.com/ytmdesktop/ytmdesktop/releases>

#### Mac
<!--
### UPDATE THESE PLATFORMS ###
- Brew: ```brew install --cask ytmdesktop-youtube-music```
-->
- Binaries: <https://github.com/ytmdesktop/ytmdesktop/releases>

# Developing
To clone and run this repository you'll need [Git](https://git-scm.com) and [Node.js (v18)](https://nodejs.org/en/download/) (which comes with [npm](http://npmjs.com)) installed on your computer. From your command line:

```sh
# Clone this repository
git clone https://github.com/ytmdesktop/ytmdesktop.git
# Go into the directory
cd ytmdesktop
```
##### And:
```sh
# If you do not have Yarn Installed / New to Node as a whole please install Yarn with:
npm install yarn --global

# Install dependencies
yarn install
# Run the app
yarn start
```

# Building the Project
To build for your platform you need to run `yarn make`, however please see the information below regarding the required additionally Software, Tools and Packages which are needed to successfully package into a nice installer file.

## Windows
To download the full suite of Tools/Software needed to build the app it is recommended to install the suite of build tools that electron provide which includes Visual Studio, Python and other tools.

`npm i -g @electron/build-tools`

This will start downloading and installing, and may require a few prompts here and there to finalise everything.

## MacOS
*to do*

## Linux
Building the project on Linux only requires you to install:
- For building for Debian based Linux Distros like Ubuntu, you will need to install `fakeroot` and `dpkg`
- For building for RedHat based Linux Distros like Fedora, you will need to install `rpm` or `rpm-build`

*please note that by default both packages are built if you try to building this application on a linux distro*

<!--
### Note to the note, I suspect this has been fixed now, testing myself I was able to run the software without anything extra, although did have to sepecify `--disable-gpu` to run.
**Note:** If you're using Windows Subsystem for Linux (WSL2), [see this guide][more] or use `node` from the command prompt. -->

<!--
Project currently doesn't have Locales, so Ignore this for now.
## To contribute for your own language
Navigate to [ytmdesktop-locales](https://github.com/ytmdesktop/ytmdesktop-locales) and follow the instructions there.
-->

## Contributors
A Thank you to all the contributors throughout the project, without their work this project would have just been a small project and never expanded to where it is now.
<a href="https://github.com/ytmdesktop/ytmdesktop/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=ytmdesktop/ytmdesktop&columns=8&max=48" style="width:100%;" />
</a>

[discord-img]: https://img.shields.io/badge/Discord-JOIN-GREEN.svg?style=for-the-badge&logo=discord
[discord-url]: https://discord.gg/88P2n2a
[gitmoji-img]: https://img.shields.io/badge/Gitmoji-STANDARD-FFDD67.svg?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyBhcmlhLWhpZGRlbj0idHJ1ZSIgZGF0YS1wcmVmaXg9ImZhcyIgZGF0YS1pY29uPSJncmluLXRvbmd1ZS13aW5rIiBjbGFzcz0ic3ZnLWlubGluZS0tZmEgZmEtZ3Jpbi10b25ndWUtd2luayBmYS13LTE2IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0OTYgNTEyIj48cGF0aCBmaWxsPSIjRkZERDY3IiBkPSJNMzQ0IDE4NGEyNCAyNCAwIDEwMCA0OCAyNCAyNCAwIDEwMC00OHpNMjQ4IDhhMjQ4IDI0OCAwIDAwLTg3IDQ4MGMtNi0xMi05LTI2LTktNDB2LTQ1Yy0yNS0xNy00My0zOS00OC02NC0yLTEyIDEwLTIyIDIxLTE4IDMwIDEwIDc1IDE1IDEyMyAxNXM5My01IDEyMy0xNWMxMi00IDIzIDYgMjEgMTgtNCAyNS0yMyA0Ny00OCA2M3Y0NmMwIDE0LTMgMjgtOSA0MEEyNDggMjQ4IDAgMDAyNDggOHptLTU2IDIyNWwtOS04Yy0xNS0xNC00Ny0xNC02MSAwbC0xMCA4Yy04IDctMjIgMC0yMC0xMSA0LTI1IDM0LTQyIDYwLTQyczU2IDE3IDYwIDQyYzIgMTEtMTIgMTgtMjAgMTF6bTE1MiAzOWE2NCA2NCAwIDExMC0xMjggNjQgNjQgMCAwMTAgMTI4em0tNTEgMTAzYy0xNC03LTMxIDItMzQgMTdsLTIgOGMtMiA5LTE2IDktMTggMGwtMS04Yy00LTE1LTIxLTI0LTM1LTE3bC0xOSA5djYzYzAgMzUgMjggNjUgNjMgNjUgMzYgMCA2NS0yOSA2NS02NHYtNjRsLTE5LTl6Ii8+PC9zdmc+
[gitmoji-url]: https://gitmoji.carloscuesta.me
[license-img]: https://img.shields.io/github/license/ytmdesktop/ytmdesktop.svg?style=for-the-badge&logo=librarything
[license-url]: https://github.com/ytmdesktop/ytmdesktop/blob/master/LICENSE
[release-img]: https://img.shields.io/github/release/ytmdesktop/ytmdesktop.svg?style=for-the-badge&logo=flattr
[release-url]: https://GitHub.com/ytmdesktop/ytmdesktop/releases/
[download-img]: https://img.shields.io/github/downloads/ytmdesktop/ytmdesktop/total.svg?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyBhcmlhLWhpZGRlbj0idHJ1ZSIgZGF0YS1wcmVmaXg9ImZhcyIgZGF0YS1pY29uPSJjbG91ZC1kb3dubG9hZC1hbHQiIGNsYXNzPSJzdmctaW5saW5lLS1mYSBmYS1jbG91ZC1kb3dubG9hZC1hbHQgZmEtdy0yMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB2aWV3Qm94PSIwIDAgNjQwIDUxMiI+PHBhdGggZmlsbD0iI0ZGRiIgZD0iTTUzOCAyMjdjNC0xMSA2LTIzIDYtMzVhOTYgOTYgMCAwMC0xNDktODAgMTYwIDE2MCAwIDAwLTI5OSA4OCAxNDQgMTQ0IDAgMDA0OCAyODBoMzY4YTEyOCAxMjggMCAwMDI2LTI1M3ptLTEzMyA4OEwyOTkgNDIxYy02IDYtMTYgNi0yMiAwTDE3MSAzMTVjLTEwLTEwLTMtMjcgMTItMjdoNjVWMTc2YzAtOSA3LTE2IDE2LTE2aDQ4YzkgMCAxNiA3IDE2IDE2djExMmg2NWMxNSAwIDIyIDE3IDEyIDI3eiIvPjwvc3ZnPg==
[download-url]: https://github.com/ytmdesktop/ytmdesktop/releases/
[more]: https://www.howtogeek.com/261575/how-to-run-graphical-linux-desktop-applications-from-windows-10s-bash-shell/
