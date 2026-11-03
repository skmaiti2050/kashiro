# Installing Kashiro 1.0

Kashiro runs entirely on your computer. It needs Windows 10 or 11 (64-bit) and no administrator rights.
Neither the installer nor the app connects to the internet.

There are four files to choose from. All contain the same app; the "without AI" ones leave out the optional AI
helper (about 45 MB of its files), so AI rewrites aren't available in them.

| | With the AI helper | Without AI | Use it when |
|---|---|---|---|
| Installer | `Kashiro_1.3.0_x64-setup.exe` | `Kashiro-noai_1.3.0_x64-setup.exe` | You want a Start menu entry and an uninstaller. |
| Portable | `Kashiro-1.3.0-win-x64.zip` | `Kashiro-1.3.0-win-x64-noai.zip` | You can't run installers, or want to keep it in one folder. |

**Which one?** Take the one with the AI helper unless you are sure you won't use AI rewrites or need the smaller
download. Spelling, grammar and style checks are the same in all four.

## The installer

1. Run the installer. It installs for your Windows account only, into `%LOCALAPPDATA%\Kashiro`, so it
   doesn't ask for an administrator password.
2. Open **Kashiro** from the Start menu.

Both installers install the same app in the same place, so you can switch at any time by running the other one:
it replaces the first (the version without AI also removes the AI helper's files). Your settings, dictionary and
saved reviews stay.

## The portable zip

1. Right-click the zip, choose **Extract All…**, and pick any folder you can write to, for example
   `Documents\Kashiro`.
2. Open the extracted `Kashiro` folder and run `Kashiro.exe`.

Keep the folder together: the app needs the `dictionary`, `llama` (the AI helper; not in the "without AI" zip)
and `notices` folders next to the exe. You can move the whole folder later.

Even the portable copy keeps its settings and saved reviews in the app's data folder (see "Where your data lives"
below), not in the extracted folder. Two copies on the same Windows account share them.

## Coming from writing-check

Kashiro is the new name of writing-check. It installs beside the old app rather than over it.

1. Install Kashiro and open it once. On its first start it copies your settings, dictionary and saved reviews
   from writing-check's data folder. It never changes or deletes writing-check's own copy.
2. Then uninstall writing-check: Windows **Settings › Apps › Installed apps › writing-check › Uninstall**. You
   can tick "Delete the application data" now that Kashiro has its own copy.

## "Windows protected your PC" (SmartScreen)

Version 1.0 is not code-signed yet, so Windows may warn you the first time you run it.

1. Click **More info**.
2. Check that the app is `Kashiro` and the file came from the person or page you expected.
3. Click **Run anyway**.

**If your organisation blocks unsigned apps, don't work around it.** Ask your IT team to approve it, or wait
for the signed release.

## WebView2

Kashiro draws its window with Microsoft Edge WebView2, which is part of Windows 11 and of up-to-date
Windows 10. The installer doesn't download or install it. WebView2 normally uses about 120–250 MB of memory.

On a rare older Windows 10 PC without it, the app won't open. Install the WebView2 Runtime yourself with
Microsoft's Evergreen installer from https://developer.microsoft.com/microsoft-edge/webview2/ (the per-user
Evergreen Bootstrapper or Standalone Installer), then start Kashiro again.

## The optional AI helper and its model file

Spelling, grammar and style checks work as soon as the app opens. The AI helper ("AI rewrites") is optional and
off until you give it a model file. **The app never downloads a model**; you download one yourself, once.

1. Download the model file `Qwen3.5-4B-IQ4_NL.gguf` (about 2.6 GB) from the `unsloth/Qwen3.5-4B-GGUF` page on
   Hugging Face. Qwen3.5-4B is made by the Qwen team (Alibaba Cloud) and licensed under Apache-2.0.
2. Save it anywhere on this computer (not on a network drive).
3. In Kashiro, open **Settings › Modules › AI rewrites** and click **Choose model file…**.
   The app checks the file; the expected one shows "Qwen3.5-4B (IQ4_NL), licence Apache-2.0". Any other
   `.gguf` file works too, but shows "Unknown model; use at your own risk".

The helper runs on your graphics card when it can, otherwise on the processor. It needs about as much free
memory as the model's size.

**If Settings says "AI helper not installed":** you have a version without AI. Run
`Kashiro_1.3.0_x64-setup.exe` or use `Kashiro-1.3.0-win-x64.zip` instead; your settings and saved
reviews carry over.

The helper's Microsoft Visual C++ runtime ships with it (in the `llama` folder), so there is nothing else to
install. **If the helper still reports "The writing helper's Visual C++ runtime is missing":** a file in the
`llama` folder is missing or damaged, for example removed by security software. Reinstall Kashiro, or unzip
the portable copy again. If that doesn't help, ask your IT team to install Microsoft's "Visual C++
Redistributable" (x64). Everything else in Kashiro works without the helper.

## Tracked changes in Word

A `.docx` saved with **Tracked changes** shows each correction as a tracked change by "Kashiro" that your reviewer
can accept or reject. Word records a replaced word as two changes, a deletion and an insertion, so accepting one
with the cursor leaves the other. In Word, use Review › Accept All, or select a change and then click Accept.

## Where your data lives

| What | Where |
|---|---|
| The app (installer) | `%LOCALAPPDATA%\Kashiro` |
| The app (portable) | the folder you extracted |
| Settings and your dictionary | `%APPDATA%\app.kashiro.desktop\settings.json` |
| Saved reviews | `%APPDATA%\app.kashiro.desktop\sessions\` |
| The window's own browser data | `%LOCALAPPDATA%\app.kashiro.desktop\` |
| Your documents, corrected copies and `.bak` backups | where you saved them; the app never moves them |

Saved reviews of files hold your decisions, never a copy of the file. Text you paste is different: with **Keep pasted text for resuming** turned on in Settings (it is off at first), its review keeps a copy of that text, so it can be opened again. Your model file stays where you saved it.

If you used writing-check before, its data is still in the `app.writingcheck.desktop` folders in the same two
places until you delete them.

## Uninstalling

- **Installer:** Windows **Settings › Apps › Installed apps › Kashiro › Uninstall**. Tick "Delete the
  application data" to remove the settings and saved reviews too.
- **Portable:** close the app and delete the extracted folder.

To remove the data by hand (for example after using the portable copy), close Kashiro and delete the two
`app.kashiro.desktop` folders listed above: paste `%APPDATA%` and then `%LOCALAPPDATA%` into the File
Explorer address bar to find them. Delete the model file yourself if you no longer need it.

## Licences

Kashiro is licensed under Apache-2.0 (`LICENSE.txt`). The third-party notices for the word data, fonts,
libraries and the AI helper are in the `notices` folder next to the app, and in the app under **About ›
Third-party notices**.
