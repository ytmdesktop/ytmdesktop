# YouTube Music Desktop App
### Now with a Fresh new Codebase 😉

![YouTube Music Desktop App](.github/images/readme_main_app.png)

[![Discord][discord-img]][discord-url]
[![Gitmoji][gitmoji-img]][gitmoji-url]
[![GitHub license][license-img]][license-url]
[![GitHub release][release-img]][release-url]
[![Download][download-img]][download-url]

<!--
TODO: Write guides for v2. While these may still be helpful they are geared towards v1
#### 📖 Guide:
1. [How to use](https://github.com/ytmdesktop/ytmdesktop/wiki/How-use)
2. [FAQ](https://github.com/ytmdesktop/ytmdesktop/wiki/FAQ)
-->

# ⬇️ Download at
<a href="https://repology.org/project/ytmdesktop/versions">
	<img type="image/svg" align="right" src="https://repology.org/badge/vertical-allrepos/ytmdesktop.svg" alt="Packaging status"/>
</a>

#### Windows
<!--
### UPDATE THESE PLATFORMS ###
- Chocolatey: ```choco install ytmdesktop```
-->
- Winget: ```winget install "YouTube Music Desktop App"``` or ```winget install Ytmdesktop.Ytmdesktop```
- Scoop: ```scoop bucket add extras``` then ```scoop install ytmdesktop``` (Community Maintained)
- Binaries: <https://github.com/ytmdesktop/ytmdesktop/releases>

#### Linux
<!--
### UPDATE THESE PLATFORMS ###
- Snap: <https://snapcraft.io/youtube-music-desktop-app>
-->
- Arch Linux (AUR): <https://aur.archlinux.org/packages/ytmdesktop> (Community Maintained)
- Binaries: <https://github.com/ytmdesktop/ytmdesktop/releases>

#### Mac
- Brew: ```brew install --cask ytmdesktop-youtube-music``` (Community Maintained)
- Binaries: <https://github.com/ytmdesktop/ytmdesktop/releases>

# Developing
To clone and run this repository you'll need [Git](https://git-scm.com) and [Node.js (v20)](https://nodejs.org/en/download/) (which comes with [npm](http://npmjs.com)) installed on your computer. From your command line:

```sh
# Clone this repository
git clone https://github.com/ytmdesktop/ytmdesktop.git
# Go into the directory
cd ytmdesktop
```
##### And:
```sh
# If you do not have Yarn Installed / New to Node as a whole you can enable Yarn with:
corepack enable

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

<!--
TODO: Fill this information in
## MacOS
*to do*
-->

## Linux
Building the project on Linux only requires you to install:
- For building on Debian based Linux Distros like Ubuntu, you will need to install `fakeroot` and `dpkg`
- For building on RedHat based Linux Distros like Fedora, you will need to install `rpm` or `rpm-build`

*please note that by default both packages are built if you try building this application on a linux distro*

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

[<img alt="adlerluiz" src="https://avatars.githubusercontent.com/u/2112638?v=4&s=240" width="120" height="120">](https://github.com/adlerluiz)
[<img alt="NovusTheory" src="https://avatars.githubusercontent.com/u/3434404?v=4&s=240" width="120" height="120">](https://github.com/NovusTheory)
[<img alt="mingjun97" src="https://avatars.githubusercontent.com/u/15214491?v=4&s=240" width="120" height="120">](https://github.com/mingjun97)
[<img alt="rickpalmeira" src="https://avatars.githubusercontent.com/u/4140033?v=4&s=240" width="120" height="120">](https://github.com/rickpalmeira)
[<img alt="Alipoodle" src="https://avatars.githubusercontent.com/u/17199186?v=4&s=240" width="120" height="120">](https://github.com/Alipoodle)
[<img alt="flleeppyy" src="https://avatars.githubusercontent.com/u/18307183?v=4&s=240" width="120" height="120">](https://github.com/flleeppyy)
[<img alt="zagoruev" src="https://avatars.githubusercontent.com/u/986243?v=4&s=240" width="120" height="120">](https://github.com/zagoruev)
[<img alt="Venipa" src="https://avatars.githubusercontent.com/u/17952364?v=4&s=240" width="120" height="120">](https://github.com/Venipa)
[<img alt="serjan-nasredin" src="https://avatars.githubusercontent.com/u/67647968?v=4&s=240" width="120" height="120">](https://github.com/serjan-nasredin)
[<img alt="TotalChris" src="https://avatars.githubusercontent.com/u/41809916?v=4&s=240" width="120" height="120">](https://github.com/TotalChris)
[<img alt="ArnyminerZ" src="https://avatars.githubusercontent.com/u/12086466?v=4&s=240" width="120" height="120">](https://github.com/ArnyminerZ)
[<img alt="TotallyNotInUse" src="https://avatars.githubusercontent.com/u/56458705?v=4&s=240" width="120" height="120">](https://github.com/TotallyNotInUse)
[<img alt="ddarkr" src="https://avatars.githubusercontent.com/u/6638675?v=4&s=240" width="120" height="120">](https://github.com/ddarkr)
[<img alt="pinkiesky" src="https://avatars.githubusercontent.com/u/7098424?v=4&s=240" width="120" height="120">](https://github.com/pinkiesky)
[<img alt="NNowakowski" src="https://avatars.githubusercontent.com/u/16933892?v=4&s=240" width="120" height="120">](https://github.com/NNowakowski)
[<img alt="dm3ch" src="https://avatars.githubusercontent.com/u/5025313?v=4&s=240" width="120" height="120">](https://github.com/dm3ch)
[<img alt="Vistaus" src="https://avatars.githubusercontent.com/u/1716229?v=4&s=240" width="120" height="120">](https://github.com/Vistaus)
[<img alt="smarquespt" src="https://avatars.githubusercontent.com/u/1302668?v=4&s=240" width="120" height="120">](https://github.com/smarquespt)
[<img alt="peter9811" src="https://avatars.githubusercontent.com/u/22783445?v=4&s=240" width="120" height="120">](https://github.com/peter9811)
[<img alt="KageRyo" src="https://avatars.githubusercontent.com/u/36478298?v=4&s=240" width="120" height="120">](https://github.com/KageRyo)
[<img alt="andrew000" src="https://avatars.githubusercontent.com/u/11490628?v=4&s=240" width="120" height="120">](https://github.com/andrew000)
[<img alt="danparidae" src="https://avatars.githubusercontent.com/u/7272087?v=4&s=240" width="120" height="120">](https://github.com/danparidae)
[<img alt="tbvjaos510" src="https://avatars.githubusercontent.com/u/32216112?v=4&s=240" width="120" height="120">](https://github.com/tbvjaos510)
[<img alt="andia89" src="https://avatars.githubusercontent.com/u/6475757?v=4&s=240" width="120" height="120">](https://github.com/andia89)
[<img alt="nils-kt" src="https://avatars.githubusercontent.com/u/34674720?v=4&s=240" width="120" height="120">](https://github.com/nils-kt)
[<img alt="Nerogar" src="https://avatars.githubusercontent.com/u/3390934?v=4&s=240" width="120" height="120">](https://github.com/Nerogar)
[<img alt="nattadasu" src="https://avatars.githubusercontent.com/u/49780229?v=4&s=240" width="120" height="120">](https://github.com/nattadasu)
[<img alt="mkotb" src="https://avatars.githubusercontent.com/u/6364146?v=4&s=240" width="120" height="120">](https://github.com/mkotb)
[<img alt="chaoky" src="https://avatars.githubusercontent.com/u/9826702?v=4&s=240" width="120" height="120">](https://github.com/chaoky)
[<img alt="ElectricalBoy" src="https://avatars.githubusercontent.com/u/15651807?v=4&s=240" width="120" height="120">](https://github.com/ElectricalBoy)

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
