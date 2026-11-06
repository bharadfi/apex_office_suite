; Keeps the apexoffice command line (resources\cli, holding apexoffice.cmd and the
; extension-less apexoffice for Git Bash) on the installing user's PATH for the
; lifetime of the install. The value is read and written unexpanded
; (REG_EXPAND_SZ) so entries such as %USERPROFILE%\bin survive, and Explorer
; is told about the change so terminals opened afterwards see it.
; electron-builder compiles the script twice (the second pass, with
; BUILD_UNINSTALLER, only produces the uninstaller); an unreferenced function
; in either pass is a warning makensis treats as an error, hence the guards.
!include "WinMessages.nsh"
!include "StrFunc.nsh"
!include "nsProcess.nsh"

!macro GenOfficeKillHelper NAME
  ${nsProcess::FindProcess} "${NAME}" $R0
  ${if} $R0 == 0
    ${nsProcess::KillProcess} "${NAME}" $R0
    Sleep 300
  ${endIf}
!macroend

; electron-builder's stock CHECK_APP_RUNNING runs powershell.exe via nsExec
; (CREATE_NEW_CONSOLE + SW_HIDE); Windows Terminal as default host ignores
; SW_HIDE, so every silent update flashed a PowerShell window. nsProcess does
; the same work in-process. Used by both the installer and the uninstaller.
!macro customCheckAppRunning
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  ${if} $R0 == 0
    ${if} ${isUpdated}
      ; let the app finish quitting on its own
      Sleep 1000
      Goto genofficeStopApp
    ${endIf}
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK genofficeStopApp
    Quit

    genofficeStopApp:
    DetailPrint "$(appClosing)"
    ${nsProcess::CloseProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    Sleep 300
    StrCpy $R1 0

    genofficeWaitLoop:
      IntOp $R1 $R1 + 1
      ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
      ${if} $R0 == 0
        Sleep 1000
        ${nsProcess::KillProcess} "${APP_EXECUTABLE_FILENAME}" $R0
        ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
        ${if} $R0 == 0
          DetailPrint `Waiting for "${PRODUCT_NAME}" to close.`
          Sleep 2000
        ${else}
          Goto genofficeAppClosed
        ${endIf}
      ${else}
        Goto genofficeAppClosed
      ${endIf}
      ${if} $R1 > 1
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY genofficeWaitLoop
        Quit
      ${else}
        Goto genofficeWaitLoop
      ${endIf}
    genofficeAppClosed:
  ${endIf}
  ; the stock macro closed every process under $INSTDIR; a killed app can
  ; orphan its helpers, which keep their binaries locked
  !insertmacro GenOfficeKillHelper "xlsx-sidecar.exe"
  !insertmacro GenOfficeKillHelper "win-ocr.exe"
  ${nsProcess::Unload}
!macroend

!define GENOFFICE_PATH_MAX 7900

; Scope templates to our ProgIDs (electron-builder uses fileAssociations.name).
; A shared .ext\ShellNew would overwrite Office/WPS templates. OOXML files
; must be copied from valid packages, never created with NullFile.
!macro GenOfficeRegisterShellNew EXT PROGID
  WriteRegStr SHELL_CONTEXT "Software\Classes\.${EXT}\${PROGID}\ShellNew" "FileName" "$INSTDIR\resources\shell-new\blank.${EXT}"
!macroend

!macro GenOfficeUnregisterShellNew EXT PROGID
  ; Only remove our own registration, including when uninstalling for an update.
  ReadRegStr $0 SHELL_CONTEXT "Software\Classes\.${EXT}\${PROGID}\ShellNew" "FileName"
  ${If} $0 == "$INSTDIR\resources\shell-new\blank.${EXT}"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\.${EXT}\${PROGID}\ShellNew"
    DeleteRegKey /ifempty SHELL_CONTEXT "Software\Classes\.${EXT}\${PROGID}"
  ${EndIf}
!macroend

; Explorer thumbnails: apex_thumbs.dll (beside the program) draws page 1 of documents, spreadsheets,
; presentations, PDFs, Markdown and HTML pages with the Apex Office badge in the corner. Registered
; like the file types (per user or per machine, whichever the installer runs as). The shell asks for
; a thumbnail handler through the {e357fccd-...} key of the extension; SystemFileAssociations is the
; fallback when another program owns the extension's ProgID.
!define APEX_THUMB_CLSID "{6F3A2B9E-5D14-4E0B-8C7A-1B2D9E4F7A30}"
!define APEX_THUMB_IFACE "{e357fccd-a995-4576-b01f-234630154e96}"

!macro ApexRegisterThumbnails EXT
  WriteRegStr SHELL_CONTEXT "Software\Classes\.${EXT}\ShellEx\${APEX_THUMB_IFACE}" "" "${APEX_THUMB_CLSID}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\SystemFileAssociations\.${EXT}\ShellEx\${APEX_THUMB_IFACE}" "" "${APEX_THUMB_CLSID}"
!macroend

!macro ApexUnregisterThumbnails EXT
  ; only our own registration
  ReadRegStr $0 SHELL_CONTEXT "Software\Classes\.${EXT}\ShellEx\${APEX_THUMB_IFACE}" ""
  ${If} $0 == "${APEX_THUMB_CLSID}"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\.${EXT}\ShellEx\${APEX_THUMB_IFACE}"
    DeleteRegKey /ifempty SHELL_CONTEXT "Software\Classes\.${EXT}\ShellEx"
  ${EndIf}
  ReadRegStr $0 SHELL_CONTEXT "Software\Classes\SystemFileAssociations\.${EXT}\ShellEx\${APEX_THUMB_IFACE}" ""
  ${If} $0 == "${APEX_THUMB_CLSID}"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\SystemFileAssociations\.${EXT}\ShellEx\${APEX_THUMB_IFACE}"
    DeleteRegKey /ifempty SHELL_CONTEXT "Software\Classes\SystemFileAssociations\.${EXT}\ShellEx"
  ${EndIf}
!macroend

; The shell resolves the handler through the effective ProgID first, so register there as well.
!macro ApexRegisterThumbnailProgId PROGID
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}\ShellEx\${APEX_THUMB_IFACE}" "" "${APEX_THUMB_CLSID}"
!macroend

!macro ApexUnregisterThumbnailProgId PROGID
  ReadRegStr $0 SHELL_CONTEXT "Software\Classes\${PROGID}\ShellEx\${APEX_THUMB_IFACE}" ""
  ${If} $0 == "${APEX_THUMB_CLSID}"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\${PROGID}\ShellEx\${APEX_THUMB_IFACE}"
    DeleteRegKey /ifempty SHELL_CONTEXT "Software\Classes\${PROGID}\ShellEx"
  ${EndIf}
!macroend

!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\Classes\CLSID\${APEX_THUMB_CLSID}" "" "Apex Office thumbnail handler"
  WriteRegStr SHELL_CONTEXT "Software\Classes\CLSID\${APEX_THUMB_CLSID}\InprocServer32" "" "$INSTDIR\apex_thumbs.dll"
  WriteRegStr SHELL_CONTEXT "Software\Classes\CLSID\${APEX_THUMB_CLSID}\InprocServer32" "ThreadingModel" "Apartment"
  !insertmacro ApexRegisterThumbnails "docx"
  !insertmacro ApexRegisterThumbnails "xlsx"
  !insertmacro ApexRegisterThumbnails "xlsm"
  !insertmacro ApexRegisterThumbnails "pptx"
  !insertmacro ApexRegisterThumbnails "pdf"
  !insertmacro ApexRegisterThumbnails "md"
  !insertmacro ApexRegisterThumbnails "markdown"
  !insertmacro ApexRegisterThumbnails "html"
  !insertmacro ApexRegisterThumbnails "htm"
  !insertmacro ApexRegisterThumbnailProgId "Word Document"
  !insertmacro ApexRegisterThumbnailProgId "Excel Workbook"
  !insertmacro ApexRegisterThumbnailProgId "Excel Macro-Enabled Workbook"
  !insertmacro ApexRegisterThumbnailProgId "PowerPoint Presentation"
  !insertmacro ApexRegisterThumbnailProgId "PDF Document"
  !insertmacro ApexRegisterThumbnailProgId "Markdown Document"
  !insertmacro ApexRegisterThumbnailProgId "HTML Document"
  Push "$INSTDIR\resources\cli"
  Call GenOfficeAddToUserPath
  !insertmacro GenOfficeRegisterShellNew "docx" "Word Document"
  !insertmacro GenOfficeRegisterShellNew "xlsx" "Excel Workbook"
  !insertmacro GenOfficeRegisterShellNew "pptx" "PowerPoint Presentation"
  !insertmacro UPDATEFILEASSOC
!macroend

!macro customUnInstall
  Push "$INSTDIR\resources\cli"
  Call un.GenOfficeRemoveFromUserPath
  Push $0
  !insertmacro GenOfficeUnregisterShellNew "docx" "Word Document"
  !insertmacro GenOfficeUnregisterShellNew "xlsx" "Excel Workbook"
  !insertmacro GenOfficeUnregisterShellNew "pptx" "PowerPoint Presentation"
  !insertmacro ApexUnregisterThumbnails "docx"
  !insertmacro ApexUnregisterThumbnails "xlsx"
  !insertmacro ApexUnregisterThumbnails "xlsm"
  !insertmacro ApexUnregisterThumbnails "pptx"
  !insertmacro ApexUnregisterThumbnails "pdf"
  !insertmacro ApexUnregisterThumbnails "md"
  !insertmacro ApexUnregisterThumbnails "markdown"
  !insertmacro ApexUnregisterThumbnails "html"
  !insertmacro ApexUnregisterThumbnails "htm"
  !insertmacro ApexUnregisterThumbnailProgId "Word Document"
  !insertmacro ApexUnregisterThumbnailProgId "Excel Workbook"
  !insertmacro ApexUnregisterThumbnailProgId "Excel Macro-Enabled Workbook"
  !insertmacro ApexUnregisterThumbnailProgId "PowerPoint Presentation"
  !insertmacro ApexUnregisterThumbnailProgId "PDF Document"
  !insertmacro ApexUnregisterThumbnailProgId "Markdown Document"
  !insertmacro ApexUnregisterThumbnailProgId "HTML Document"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\CLSID\${APEX_THUMB_CLSID}"
  Pop $0
  !insertmacro UPDATEFILEASSOC
!macroend

!ifndef BUILD_UNINSTALLER
${StrStr}

Function GenOfficeAddToUserPath
  Exch $0 ; directory
  Push $1
  Push $2
  Push $3
  ReadRegStr $1 HKCU "Environment" "Path"
  StrLen $2 $1
  ; leave an already oversized PATH alone rather than truncate it
  IntCmp $2 ${GENOFFICE_PATH_MAX} done 0 done
  ${StrStr} $3 ";$1;" ";$0;"
  StrCmp $3 "" 0 done
  StrCmp $1 "" 0 +3
    StrCpy $1 "$0"
    Goto write
  StrCpy $1 "$1;$0"
write:
  WriteRegExpandStr HKCU "Environment" "Path" $1
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
done:
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd
!endif

!ifdef BUILD_UNINSTALLER
${UnStrStr}
${UnStrRep}

Function un.GenOfficeRemoveFromUserPath
  Exch $0 ; directory
  Push $1
  Push $2
  ReadRegStr $1 HKCU "Environment" "Path"
  StrCmp $1 "" done
  ${UnStrStr} $2 ";$1;" ";$0;"
  StrCmp $2 "" done
  StrCpy $1 ";$1;"
  ${UnStrRep} $1 $1 ";$0;" ";"
  ; strip the sentinels added above
  StrCpy $1 $1 -1
  StrCpy $1 $1 "" 1
  WriteRegExpandStr HKCU "Environment" "Path" $1
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
done:
  Pop $2
  Pop $1
  Pop $0
FunctionEnd
!endif
