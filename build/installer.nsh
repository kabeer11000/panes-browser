; Makes Panes show up in Windows' list of browsers (Settings, Apps, Default apps), able to open web
; links and HTML or PDF files. Windows lets only the user choose the default, so this registers the
; capabilities and Panes asks the user to confirm in Settings. Per-user (HKCU) like the installer.

; Wording for the setup wizard's own pages. Guarded, so a default the builder already set is left alone.
!macro customHeader
  !ifndef MUI_WELCOMEPAGE_TITLE
    !define MUI_WELCOMEPAGE_TITLE "Welcome to Panes"
  !endif
  !ifndef MUI_WELCOMEPAGE_TEXT
    !define MUI_WELCOMEPAGE_TEXT "Panes is a calm, fast browser built around the way you work.$\r$\n$\r$\nSetup installs it for your account in about a minute. Your tabs, spaces and settings stay on your computer."
  !endif
  !ifndef MUI_FINISHPAGE_TITLE
    !define MUI_FINISHPAGE_TITLE "Panes is ready"
  !endif
  !ifndef MUI_FINISHPAGE_TEXT
    !define MUI_FINISHPAGE_TEXT "Panes is installed. Start it to choose your look and layout."
  !endif
  !ifndef MUI_FINISHPAGE_RUN_TEXT
    !define MUI_FINISHPAGE_RUN_TEXT "Start Panes"
  !endif
!macroend

!macro customInstall
  ; ProgID for documents
  WriteRegStr SHCTX "Software\Classes\PanesHTML" "" "Panes Document"
  WriteRegStr SHCTX "Software\Classes\PanesHTML\Application" "ApplicationName" "Panes"
  WriteRegStr SHCTX "Software\Classes\PanesHTML\Application" "ApplicationDescription" "A browser built around panes"
  WriteRegStr SHCTX "Software\Classes\PanesHTML\Application" "AppUserModelId" "pk.procheck.panes"
  WriteRegStr SHCTX "Software\Classes\PanesHTML\Application" "ApplicationIcon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\PanesHTML\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\PanesHTML\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  ; ProgID for web links
  WriteRegStr SHCTX "Software\Classes\PanesURL" "" "Panes URL"
  WriteRegStr SHCTX "Software\Classes\PanesURL" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\PanesURL\Application" "ApplicationName" "Panes"
  WriteRegStr SHCTX "Software\Classes\PanesURL\Application" "AppUserModelId" "pk.procheck.panes"
  WriteRegStr SHCTX "Software\Classes\PanesURL\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\PanesURL\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  ; The browser entry Windows lists under Default apps
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\Panes" "" "Panes"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\Panes\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\Panes\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\Panes\Capabilities" "ApplicationName" "Panes"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\Panes\Capabilities" "ApplicationDescription" "A browser built around panes"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\Panes\Capabilities" "ApplicationIcon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\Panes\Capabilities\URLAssociations" "http" "PanesURL"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\Panes\Capabilities\URLAssociations" "https" "PanesURL"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\Panes\Capabilities\FileAssociations" ".htm" "PanesHTML"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\Panes\Capabilities\FileAssociations" ".html" "PanesHTML"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\Panes\Capabilities\FileAssociations" ".xhtml" "PanesHTML"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\Panes\Capabilities\FileAssociations" ".pdf" "PanesHTML"
  WriteRegStr SHCTX "Software\RegisteredApplications" "Panes" "Software\Clients\StartMenuInternet\Panes\Capabilities"
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\Classes\PanesHTML"
  DeleteRegKey SHCTX "Software\Classes\PanesURL"
  DeleteRegKey SHCTX "Software\Clients\StartMenuInternet\Panes"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "Panes"
!macroend
