# Security

## Reporting a vulnerability

Report it privately through
[GitHub's private vulnerability reporting](https://github.com/Zeatrex01/keyframe/security/advisories/new),
never in a public issue. Say what an attacker can do, the steps, and the studio version
(`VERSION`). You get an answer within a week; a fix is released before the report is made public.

Only the latest release is supported.

## The security model

Keyframe Studio runs on your own machine and works on folders you open. It has no accounts and
no network service of its own.

- **The page server** (`tools/studio.js`) listens on `127.0.0.1` only. It answers only requests
  whose `Host` is that address (so DNS rebinding fails), refuses requests whose `Origin` is
  another site, and refuses a non-GET request a browser marks `Sec-Fetch-Site: cross-site`.
  Every response carries a content security policy with no inline script and no other origin,
  and the page cannot be framed. It is not meant to be exposed to a network: there is no login.
- **Files** are served only from inside the open project (links that lead out of it are
  refused) and only for the types the page shows (skeleton JSON, atlas, images, video).
- **The one-way rule:** nothing writes the owner's source skeleton. Deliveries are new files
  with backups; references are saved without replacing a file already there.
- **The MCP server** (`tools/mcp-server.js`) talks over stdio to the agent you start it from.
  Its tools read and write inside the project folder only.
- **Optional programs** (ffmpeg, yt-dlp, the Spine CLI) are run as separate processes with
  argument arrays, never through a shell. A video link is checked as text before it reaches
  yt-dlp: https only, no local or private address, no credentials, no port, no cookies.
  `docs/concept.md` states the boundary and what a text check cannot see.
- **The package zip** (Settings > Download) leaves out version control, the machine's config,
  agent client configs, logs, environment files and every project's working folders.

## What is out of scope

The official Spine runtime that the optional Spine add-on downloads is Esoteric Software's; report issues in
it to them. A skeleton or video you choose to open is trusted to be yours.
