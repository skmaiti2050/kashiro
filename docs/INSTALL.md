# Installing writing-check 1.0

writing-check runs entirely on your computer. It needs Windows 10 or 11 (64-bit) and no administrator rights.
Neither the installer nor the app connects to the internet.

There are three files to choose from. All contain the same app; only the last leaves out the optional AI helper.

| | File | Use it when |
|---|---|---|
| Installer | `writing-check_1.0.0_x64-setup.exe` | You want a Start menu entry and an uninstaller. |
| Portable | `writing-check-1.0.0-win-x64.zip` | You can't run installers, or want to keep it in one folder. |
| Portable, without AI | `writing-check-1.0.0-win-x64-noai.zip` | You won't use AI rewrites and want a smaller download. |

## The installer

1. Run `writing-check_1.0.0_x64-setup.exe`. It installs for your Windows account only, into
   `%LOCALAPPDATA%\writing-check`, so it doesn't ask for an administrator password.
2. Open **writing-check** from the Start menu.

## The portable zip

1. Right-click the zip, choose **Extract All…**, and pick any folder you can write to, for example
   `Documents\writing-check`.
2. Open the extracted `writing-check` folder and run `writing-check.exe`.

Keep the folder together: the app needs the `dictionary`, `llama` (the AI helper; not in the "without AI" zip)
and `notices` folders next to the exe. You can move the whole folder later.

Even the portable copy keeps its settings and saved reviews in the app's data folder (see "Where your data lives"
below), not in the extracted folder. Two copies on the same Windows account share them.

## "Windows protected your PC" (SmartScreen)

Version 1.0 is not code-signed yet, so Windows may warn you the first time you run it.

1. Click **More info**.
2. Check that the app is `writing-check` and the file came from the person or page you expected.
3. Click **Run anyway**.

**If your organisation blocks unsigned apps, don't work around it.** Ask your IT team to approve it, or wait
for the signed release.

## WebView2

writing-check draws its window with Microsoft Edge WebView2, which is part of Windows 11 and of up-to-date
Windows 10. The installer doesn't download or install it. WebView2 normally uses about 120–250 MB of memory.

On a rare older Windows 10 PC without it, the app won't open. Install the WebView2 Runtime yourself with
Microsoft's Evergreen installer from https://developer.microsoft.com/microsoft-edge/webview2/ (the per-user
Evergreen Bootstrapper or Standalone Installer), then start writing-check again.

## The optional AI helper and its model file

Spelling, grammar and style checks work as soon as the app opens. The AI helper ("AI rewrites") is optional and
off until you give it a model file. **The app never downloads a model**; you download one yourself, once.

1. Download the model file `Qwen3.5-4B-IQ4_NL.gguf` (about 2.6 GB) from the `unsloth/Qwen3.5-4B-GGUF` page on
   Hugging Face. Qwen3.5-4B is made by the Qwen team (Alibaba Cloud) and licensed under Apache-2.0.
2. Save it anywhere on this computer (not on a network drive).
3. In writing-check, open **Settings › Modules › AI rewrites** and click **Choose model file…**.
   The app checks the file; the expected one shows "Qwen3.5-4B (IQ4_NL), licence Apache-2.0". Any other
   `.gguf` file works too, but shows "Unknown model; use at your own risk".

The helper runs on your graphics card when it can, otherwise on the processor. It needs about as much free
memory as the model's size.

**If Settings says "AI helper not installed":** you have the version without AI (the `-noai` zip). Use the
installer or `writing-check-1.0.0-win-x64.zip` instead; your settings and saved reviews carry over.

**If the helper reports "The writing helper's Visual C++ runtime is missing":** it needs the Microsoft Visual C++
2015–2022 runtime (x64), which most Windows PCs already have. If yours doesn't, ask your IT team to install
Microsoft's "Visual C++ Redistributable for Visual Studio 2015–2022 (x64)" (it needs administrator rights).
Everything else in writing-check works without it.

## Where your data lives

| What | Where |
|---|---|
| The app (installer) | `%LOCALAPPDATA%\writing-check` |
| The app (portable) | the folder you extracted |
| Settings and your dictionary | `%APPDATA%\app.writingcheck.desktop\settings.json` |
| Saved reviews | `%APPDATA%\app.writingcheck.desktop\sessions\` |
| The window's own browser data | `%LOCALAPPDATA%\app.writingcheck.desktop\` |
| Your documents, corrected copies and `.bak` backups | where you saved them; the app never moves them |

Saved reviews hold your decisions, never a copy of your document. Your model file stays where you saved it.

## Uninstalling

- **Installer:** Windows **Settings › Apps › Installed apps › writing-check › Uninstall**. Tick "Delete the
  application data" to remove the settings and saved reviews too.
- **Portable:** close the app and delete the extracted folder.

To remove the data by hand (for example after using the portable copy), close writing-check and delete the two
`app.writingcheck.desktop` folders listed above: paste `%APPDATA%` and then `%LOCALAPPDATA%` into the File
Explorer address bar to find them. Delete the model file yourself if you no longer need it.

## Licences

writing-check is licensed under Apache-2.0 (`LICENSE.txt`). The third-party notices for the word data, fonts,
libraries and the AI helper are in the `notices` folder next to the app, and in the app under **About ›
Third-party notices**.
