# The Windows app

Keyframe Studio runs from source with Node on any system (`npm start`). On Windows it also comes
as an app: Node is bundled, it starts from its own icon and opens in your default browser, and it
updates itself when you say so.

## Using it

- **Setup:** `Keyframe-Studio-<version>-win-x64-setup.exe` installs the app for the current
  Windows user (no administrator rights) into `%LOCALAPPDATA%\Programs\Keyframe Studio`, adds
  Start menu and desktop shortcuts, and adds an entry to Settings > Apps that removes it again.
- **Portable:** unzip `Keyframe-Studio-<version>-win-x64.zip` anywhere you can write and start
  `Keyframe Studio.exe`. `Install.cmd` in that folder does what the setup does.
- **The page** opens as a tab in your default browser; no console window. Starting the app again
  while it runs opens another tab on the running studio. Dropping a project folder on
  `Keyframe Studio.exe` opens that folder.
- **Stopping:** a browser cannot tell the studio that a tab was closed, so the studio stops by
  itself about two and a half minutes after its last page is closed (a page in a background tab
  still keeps it running). Start the app again to come back.
- **Ports:** the studio uses 8731, or the next free port when another program holds it.
- **The AI:** the built-in Director runs the agent program you already use (Claude Code, Codex or
  Gemini CLI); install and sign in to it separately. MCP clients start the studio's server with
  `cmd /c "<install folder>\keyframe-mcp.cmd"` (Settings shows the exact line), which keeps
  working across updates.
- **The `keyframe` command:** the setup (and `Install.cmd`) puts the install folder on your user
  PATH, so a new terminal has `keyframe`: `keyframe <folder>` opens the studio on a folder and
  `keyframe setup` in a project folder makes `claude` started there use the studio on it.
  Uninstalling takes the folder off the PATH again. An install updated from an earlier version
  gets the command the next time the setup runs.
- **Opening a project:** **Open a folder** shows Windows' own folder window; you can also paste a
  path.
- **Unsigned:** until the app is signed, SmartScreen may warn on the first start: choose
  **More info**, then **Run anyway**.

## Where things are

| What | Where |
| --- | --- |
| The app | the install folder, one `app-<version>` folder per version and a `current` file naming the one that starts |
| Settings and the project list | `%LOCALAPPDATA%\Keyframe Studio` |
| The log | `%LOCALAPPDATA%\Keyframe Studio\logs\studio.log` |
| Your projects | wherever you keep them; the app never moves them |

Updating or removing the app never touches the data folder or your projects. To remove
everything, delete `%LOCALAPPDATA%\Keyframe Studio` after uninstalling.

## Updates

At start (and with **Check now** in Settings > About) the app asks the repository's GitHub
releases whether a newer version is out. The request is a plain GET with a generic user agent: no
identifiers and no telemetry. The check can be turned off in Settings > About. While there is no
release it says nothing.

When there is one, the header shows an **Update** pill and Settings > About shows the release
notes. Nothing is downloaded until you choose **Download and install**. The package is then
checked against the checksum published with the release; a package that does not match is
thrown away and nothing changes. A good one is unpacked as a new `app-<version>` folder beside the
running one and becomes `current`; the running version stays as `previous`. **Restart now** starts
the new version through the launcher and the open page reloads into it.

If the new version fails on its first start, the launcher goes back to `previous` and says so.
Later failures never roll back. After the
new version has run for half a minute, older version folders are removed.

## What a release must contain

The updater picks a release up when:

- its tag is the version with a `v` in front, as in `VERSION`: `v0.0.2-beta` (pre-releases count);
- it is published (not a draft);
- it has the asset `Keyframe-Studio-<version>-win-x64.zip` (for example
  `Keyframe-Studio-0.0.2-beta-win-x64.zip`), the zip `npm run package:win` writes;
- it has the asset `SHA256SUMS.txt` with a line `<sha256>  <file name>` for that zip, as the build
  writes it.

The setup .exe is for people downloading by hand; the updater does not use it. The release notes
are shown to the owner as they are written.

## Building it

```bash
npm run package:win
```

writes into `dist/`: the portable `Keyframe Studio/` folder, its zip, the setup .exe and
`SHA256SUMS.txt`. Node (the version pinned in `tools/package-win.js`) is downloaded once from
nodejs.org, checked against its published checksums and cached in `dist/cache/`;
`--node-zip <file>` uses a local copy instead. The launcher and the setup are compiled with the
C# compiler of the .NET Framework that every Windows 10 and 11 has, so the build needs nothing
installed, but it must run on Windows: a build on another system gets a `.cmd` launcher and no
setup, which is fine for trying the layout and not for a release. Nothing is signed or published
by the build; the release is made by hand from `dist/`.
