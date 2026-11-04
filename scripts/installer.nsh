!macro customUnInstallCheck
  IfErrors 0 +3
  DetailPrint "Uninstall was not successful. Not able to launch uninstaller!"
  Return

  ${if} $R0 == 0
    Return
  ${endif}

  # Older releases shipped Android build output that makes their update-only
  # uninstaller fail. The normal uninstall keeps app data and handles those paths.
  ReadRegStr $R1 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${if} $R1 == ""
    ReadRegStr $R2 HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString
    !insertmacro GetInQuotes $R2 "$R2"
    Push $R2
    Call GetFileParent
    Pop $R1
  ${endif}
  ${if} $R0 != 0
  ${andIf} $installMode == "CurrentUser"
  ${andIf} $R1 != ""
  ${andIf} ${FileExists} "$R1\resources\app.asar.unpacked\node_modules\@capacitor\android\capacitor\build\*.*"
    ClearErrors
    ExecWait '"$PLUGINSDIR\old-uninstaller.exe" /S /KEEP_APP_DATA /currentuser _?=$R1' $R0
    IfErrors 0 +3
    SetErrorLevel 2
    Quit
  ${endif}

  ${if} $R0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0"
    SetErrorLevel 2
    Quit
  ${endif}
!macroend
