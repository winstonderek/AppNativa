; Pynn finish page: two checkboxes, both ticked by default, applied on Finish.
;   - "Create a desktop shortcut": the install section already created it
;     (createDesktopShortcut: true), so an unticked box removes it.
;   - "Launch Pynn": opens the app as the signed-in user after the wizard hides.
;
; Silent updates (electron-updater) never show this page. They relaunch the
; app through --force-run, and keep the user's shortcut choice via KeepShortcuts.

!macro customFinishPage
  Function PynnFinishLaunch
    ; Hide the wizard first so the app window opens in front of it.
    HideWindow
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" ""
  FunctionEnd

  Function PynnFinishDesktopShortcut
    ; Ticked: the shortcut from the install section stays.
  FunctionEnd

  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_TEXT "Launch Pynn"
  !define MUI_FINISHPAGE_RUN_FUNCTION PynnFinishLaunch

  !define MUI_FINISHPAGE_SHOWREADME
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Create a desktop shortcut"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION PynnFinishDesktopShortcut

  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE PynnFinishLeave
  !insertmacro MUI_PAGE_FINISH

  ; Defined after MUI_PAGE_FINISH, which declares $mui.FinishPage.ShowReadme.
  ; MUI runs this before it acts on the ticked boxes.
  Function PynnFinishLeave
    ${NSD_GetState} $mui.FinishPage.ShowReadme $R0
    ${if} $R0 != ${BST_CHECKED}
      WinShell::UninstShortcut "$newDesktopLink"
      Delete "$newDesktopLink"
      System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
    ${endIf}
  FunctionEnd
!macroend
