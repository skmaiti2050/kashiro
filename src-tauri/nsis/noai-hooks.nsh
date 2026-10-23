; Installer hooks for the version without the AI helper (tauri.noai.conf.json). Both installers are the same app
; (same name, identifier and folder), so one installs over the other. Installed over the full version, this one
; removes the helper's files it does not ship, so the app says "AI helper not installed" instead of running a
; helper left from the other install. Settings and saved reviews are kept.
!macro NSIS_HOOK_POSTINSTALL
  RMDir /r "$INSTDIR\llama"
!macroend
