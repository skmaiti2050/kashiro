; Installer hooks for the version without the AI helper (tauri.noai.conf.json). Both installers are the same app
; (same name, identifier and folder), so one installs over the other. Installed over the full version, this one
; removes the helper's files it does not ship, so the app says "AI helper not installed" instead of running a
; helper left from the other install. Settings and saved reviews are kept.
;
; Never damage the user's files: $INSTDIR is whatever folder was picked, so this runs only where writing-check.exe
; is, deletes only the pinned file names (deps/assets.json: llama-server, vc-runtime, llama-server-vulkan; a test
; keeps this list equal to them), and removes a folder only once it is empty.
!macro NSIS_HOOK_POSTINSTALL
  ${If} ${FileExists} "$INSTDIR\writing-check.exe"
    Delete "$INSTDIR\llama\llama-server.exe"
    Delete "$INSTDIR\llama\llama-server-impl.dll"
    Delete "$INSTDIR\llama\llama-common.dll"
    Delete "$INSTDIR\llama\llama.dll"
    Delete "$INSTDIR\llama\mtmd.dll"
    Delete "$INSTDIR\llama\ggml.dll"
    Delete "$INSTDIR\llama\ggml-base.dll"
    Delete "$INSTDIR\llama\ggml-cpu-alderlake.dll"
    Delete "$INSTDIR\llama\ggml-cpu-cannonlake.dll"
    Delete "$INSTDIR\llama\ggml-cpu-cascadelake.dll"
    Delete "$INSTDIR\llama\ggml-cpu-cooperlake.dll"
    Delete "$INSTDIR\llama\ggml-cpu-haswell.dll"
    Delete "$INSTDIR\llama\ggml-cpu-icelake.dll"
    Delete "$INSTDIR\llama\ggml-cpu-ivybridge.dll"
    Delete "$INSTDIR\llama\ggml-cpu-piledriver.dll"
    Delete "$INSTDIR\llama\ggml-cpu-sandybridge.dll"
    Delete "$INSTDIR\llama\ggml-cpu-sapphirerapids.dll"
    Delete "$INSTDIR\llama\ggml-cpu-skylakex.dll"
    Delete "$INSTDIR\llama\ggml-cpu-sse42.dll"
    Delete "$INSTDIR\llama\ggml-cpu-x64.dll"
    Delete "$INSTDIR\llama\ggml-cpu-zen4.dll"
    Delete "$INSTDIR\llama\libomp.dll"
    Delete "$INSTDIR\llama\LICENSE-LLVM-OpenMP"
    Delete "$INSTDIR\llama\msvcp140.dll"
    Delete "$INSTDIR\llama\vcruntime140.dll"
    Delete "$INSTDIR\llama\vcruntime140_1.dll"
    Delete "$INSTDIR\llama\vulkan\ggml-vulkan.dll"
    RMDir "$INSTDIR\llama\vulkan"
    RMDir "$INSTDIR\llama"
  ${EndIf}
!macroend
