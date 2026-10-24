# Kashiro

A free, offline proofreader for your writing. Its mark is a touchstone, the dark stone gold is tested on, with one gold streak. It runs entirely on your computer.
Status: version 1.0 (private release, Windows).

To install it, see [INSTALL.md](INSTALL.md), next to this file in the installed app (in the source code:
[docs/INSTALL.md](docs/INSTALL.md)): per-user installers and portable zips, with or without the AI helper, none
needing administrator rights or an internet connection.

## Building it

```
npm ci
npm run fetch:llama -- --vc-runtime <folder>   # the pinned llama.cpp files and Visual C++ runtime (docs/UPGRADING.md)
npm run release                                # both per-user installers and both portable zips
```

Licensed under Apache-2.0. Third-party notices are in `resources/` and in the app under About.
