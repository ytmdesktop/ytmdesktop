In order to install latest node-gyp run:
```
npm install -g node-gyp
```

Installation (what should get Windows to build):
=============
In order to install this module, run npm install:

```
npm install @nodert-win10-rs4/windows.storage.streams
```

If you wish to rebuild this module using node-gyp, make sure to use the appropriate VS version using --msvs_version=2012/2013/2015/2017 flag:

For example:

```
cd [module folder path]
node-gyp rebuild --msvs_version=2017
```

## To determine the windows version for getting the following files required
Open the `binding.vcxproj` file located in: C:\<workspace path>\ytmdesktop\node_modules\@nodert-win10-rs4\windows.foundation\build.

Look for the value defined in the XML for the `WindowsTargetPlatformVersion`.  Use this in the following steps as the `Windows Version`.

## To get **yarn install** to run successfully

1. Get the `Windows.winmd` file from `C:\Program Files (x86)\Windows Kits\10\UnionMetadata\<Windows Version from bindings>\` to `C:\Program Files (x86)\Microsoft Visual Studio 14.0\VC\lib\store\references` (verify this destination directory in the .vcxproj file)

  a. Use the command `mkdir "C:\Program Files (x86)\Microsoft Visual Studio 14.0\VC\lib\store\references"` to make the directory.
  b. Also copy the `Windows.winmd` file to the above directory path.

2. Copy the `platform.winmd` file from `C:\Program Files (x86)\Microsoft Visual Studio\2017\BuildTools\VC\Tools\MSVC\14.16.27023\lib\x86\store\references` to `C:\Program Files (x86)\Microsoft Visual Studio 14.0\VC\lib\store\references` (verify this destination directory in the .vcxproj file - this is the path that should have been created earlier)