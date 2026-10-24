; Reinstalling or uninstalling while Kashiro is open (Task U3 item 9). Tauri's own check, which runs right
; after these hooks, offers to end the app, and ending it would lose unsaved work. These hooks run first and ask
; the user to close Kashiro themselves (so they can save), with Retry and Cancel; once it is closed, Tauri's
; check finds nothing running. A silent or passive install is not asked anything and keeps Tauri's handling.
;
; Both installers use these hooks: tauri.conf.json names this file, and noai-hooks.nsh includes it.

; Waits, with Retry and Cancel, until Kashiro.exe in $INSTDIR is no longer running. Cancel stops the setup
; before anything is changed. Uses the Restart Manager as Tauri's CheckIfAppIsRunning does (utils.nsh).
!macro KASHIRO_ASK_TO_CLOSE
  !define CloseID ${__LINE__}
  IfSilent close_done_${CloseID}
  ${IfThen} $PassiveMode = 1 ${|} Goto close_done_${CloseID} ${|}
  close_check_${CloseID}:
    StrCpy $R4 0
    !insertmacro RestartManager_StartSession $R0
    ${If} $R0 != ""
      !insertmacro RestartManager_RegisterFile $R0 "$INSTDIR\${MAINBINARYNAME}.exe"
      ${If} $0 = 0
        System::Call 'RSTRTMGR::RmGetList(p R0, *i .r1, *i .r2, p 0, *i .r3) i .r0'
        ; ERROR_MORE_DATA: at least one process has the file open, so the app is running.
        ${If} $0 = ${ERROR_MORE_DATA}
          StrCpy $R4 1
        ${EndIf}
      ${EndIf}
      !insertmacro RestartManager_EndSession $R0
    ${EndIf}
    ${If} $R4 = 1
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "${PRODUCTNAME} is open.$\r$\n$\r$\nClose ${PRODUCTNAME} yourself (save your work first), then click Retry." IDRETRY close_check_${CloseID}
      Abort "${PRODUCTNAME} is still open, so nothing was changed. Close it and run setup again."
    ${EndIf}
  close_done_${CloseID}:
  !undef CloseID
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro KASHIRO_ASK_TO_CLOSE
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro KASHIRO_ASK_TO_CLOSE
!macroend
