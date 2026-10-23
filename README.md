# writing-check

A free, offline proofreader for your writing. It runs entirely on your computer.
Status: version 1.0 (private release, Windows).

To install it, see [INSTALL.md](INSTALL.md), next to this file in the installed app (in the source code:
[docs/INSTALL.md](docs/INSTALL.md)): a per-user installer and a portable zip, neither needing administrator
rights or an internet connection.

## Building it

```
npm ci
npm run fetch:llama        # the pinned llama.cpp builds, checked file by file (see docs/UPGRADING.md)
npx tauri build            # the per-user NSIS installer, in src-tauri/target/release/bundle/nsis/
npm run portable:zip       # the portable zip, in dist-portable/
```

Licensed under Apache-2.0. Third-party notices are in `resources/` and in the app under About.
