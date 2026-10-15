; Wikang Tagalog's own steps in the Windows installer (tauri.windows.conf.json: installerHooks).

!macro NSIS_HOOK_POSTINSTALL
  ; up to 0.1.3 the program was lumen.exe (Lumen's name); it is WikangTagalog.exe now, so an
  ; update doesn't leave the old copy behind
  Delete "$INSTDIR\lumen.exe"
!macroend
