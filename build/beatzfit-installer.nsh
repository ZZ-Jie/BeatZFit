; ── BeatZ Fit — Custom NSIS installer script ───────────────────────────
; Included by electron-builder (build.nsis.include).
;
; Requirement: default install directory MUST be D:\BeatZFit.
; The Electron main process redirects userData to <install_dir>/Data,
; so with the default path all app data lands in D:\BeatZFit\Data.

!macro preInit
  ; Set the default installation directory to D:\BeatZFit.
  ; Called before the directory selection page, so the user sees D:\BeatZFit
  ; pre-filled (and can still change it thanks to allowToChangeInstallationDirectory).
  SetRegView 64
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "D:\BeatZFit"
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "D:\BeatZFit"
  StrCpy $INSTDIR "D:\BeatZFit"
!macroend
