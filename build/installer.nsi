; ════════════════════════════════════════════════════════════════════════
; BeatZ Fit — Custom NSIS Installer Script
; ════════════════════════════════════════════════════════════════════════
; Fully branded dark-themed installer with rounded corners.
; Replaces electron-builder's default NSIS template.
;
; electron-builder provides (via command-line defines):
;   APP_ID, APP_GUID, UNINSTALL_APP_KEY, PRODUCT_NAME, PRODUCT_FILENAME,
;   APP_FILENAME, APP_DESCRIPTION, VERSION, APP_64, COMPRESSION_METHOD,
;   MUI_ICON, MUI_UNICON, SHORTCUT_NAME, UNINSTALL_DISPLAY_NAME,
;   APP_EXECUTABLE_FILENAME, UNINSTALL_FILENAME, INSTALL_REGISTRY_KEY,
;   UNINSTALL_REGISTRY_KEY, ESTIMATED_SIZE, COMPRESS, APP_PACKAGE_NAME
;
; electron-builder provides (via command-line commands):
;   OutFile, VIProductVersion, VIAddVersionKey, Unicode, SetCompressor
; ════════════════════════════════════════════════════════════════════════

; ── Defines normally provided by common.nsh / multiUser.nsh ────────────
!define APP_EXECUTABLE_FILENAME "${PRODUCT_FILENAME}.exe"
!define UNINSTALL_FILENAME "Uninstall ${PRODUCT_FILENAME}.exe"
!define INSTALL_REGISTRY_KEY "Software\${APP_GUID}"
!define UNINSTALL_REGISTRY_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"

; ── Variables ──────────────────────────────────────────────────────────
Var appExe

!include "nsDialogs.nsh"
!include "WinVer.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"
!include "StrContains.nsh"
!include "extractAppPackage.nsh"

; ── Page-level Variables ───────────────────────────────────────────────
Var launchLink
Var DirText
Var DirBrowseBtn
Var ProgressBar
Var ProgressLabel
Var FinishCheckbox
Var LaunchOnFinish

; ── GetInQuotes (from installUtil.nsh, standalone) ─────────────────────
Function GetInQuotes
  Exch $R0
  Push $R1
  Push $R2
  Push $R3
   StrCpy $R2 -1
   IntOp $R2 $R2 + 1
    StrCpy $R3 $R0 1 $R2
    StrCmp $R3 "" 0 +3
     StrCpy $R0 ""
     Goto Done_GetInQuotes
    StrCmp $R3 '"' 0 -5
   IntOp $R2 $R2 + 1
   StrCpy $R0 $R0 "" $R2
   StrCpy $R2 0
   IntOp $R2 $R2 + 1
    StrCpy $R3 $R0 1 $R2
    StrCmp $R3 "" 0 +3
     StrCpy $R0 ""
     Goto Done_GetInQuotes
    StrCmp $R3 '"' 0 -5
   StrCpy $R0 $R0 $R2
   Done_GetInQuotes:
  Pop $R3
  Pop $R2
  Pop $R1
  Exch $R0
FunctionEnd

!macro GetInQuotes Var Str
  Push "${Str}"
  Call GetInQuotes
  Pop "${Var}"
!macroend

; ── Brand Colors ───────────────────────────────────────────────────────
!define BG_COLOR       "0x0F0F17"
!define BG_COLOR_LIGHT "0x1E1E2A"
!define TEXT_COLOR     "0xFFFFFF"
!define TEXT_DIM        "0x888896"
!define ACCENT_COLOR   "0x7EC8E3"
!define CORNER_RADIUS  16

; ── Icon path (for LoadImage calls in pages) ───────────────────────────
!define ICON_PATH "${MUI_ICON}"

; ════════════════════════════════════════════════════════════════════════
; Installer Attributes
; ════════════════════════════════════════════════════════════════════════
Name "${PRODUCT_NAME}"
BrandingText " "
RequestExecutionLevel user
Icon "${MUI_ICON}"
UninstallIcon "${MUI_UNICON}"

; ── Language & Button Text ─────────────────────────────────────────────
LoadLanguageFile "${NSISDIR}\Contrib\Language files\SimpChinese.nlf"
MiscButtonText "上一步" "下一步" "取消" "关闭"
InstallButtonText "安装"

; ════════════════════════════════════════════════════════════════════════
; Pages (all custom nsDialogs)
; ════════════════════════════════════════════════════════════════════════
Page custom BeatZFit_WelcomePage
Page custom BeatZFit_DirectoryPage BeatZFit_DirectoryLeave
Page custom BeatZFit_InstallPage
Page custom BeatZFit_FinishPage BeatZFit_FinishLeave
Page instfiles BeatZFit_SkipInstFiles

UninstPage custom un.BeatZFit_UnWelcomePage
UninstPage instfiles

; ════════════════════════════════════════════════════════════════════════
; .onInit — set default install directory
; ════════════════════════════════════════════════════════════════════════
Function .onInit
  ; Check 64-bit Windows
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "BeatZ Fit 需要 64 位 Windows 系统。"
    Quit
  ${EndIf}
  SetRegView 64

  ; Check for previous installation
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  ${If} $0 != ""
    StrCpy $INSTDIR $0
  ${Else}
    ReadRegStr $0 HKLM "${INSTALL_REGISTRY_KEY}" "InstallLocation"
    ${If} $0 != ""
      StrCpy $INSTDIR $0
    ${Else}
      ; Fresh install — default to D:\BeatZ Fit if D: exists
      IfFileExists "D:\*.*" 0 +3
        StrCpy $INSTDIR "D:\BeatZ Fit"
      Goto +2
        StrCpy $INSTDIR "$LOCALAPPDATA\Programs\${APP_FILENAME}"
    ${EndIf}
  ${EndIf}

  ; Allow /D switch override
  ${StdUtils.GetParameter} $R0 "D" ""
  ${If} $R0 != ""
    StrCpy $INSTDIR $R0
  ${EndIf}

  StrCpy $LaunchOnFinish "1"

  ; Silent install
  ${If} ${Silent}
    Call BeatZFit_DoInstall
    SetErrorLevel 0
    Quit
  ${EndIf}
FunctionEnd

; ════════════════════════════════════════════════════════════════════════
; GUI Init — rounded corners + dark window background
; ════════════════════════════════════════════════════════════════════════
Var CornerRgnApplied

Function .onGUIInit
  ; ── Dark window background only (NO SetWindowRgn here!) ──
  ; Rounded corners are applied in BeatZFit_ApplyCorners() after window is visible
  SetCtlColors $hwndParent "${TEXT_COLOR}" "${BG_COLOR}"
  StrCpy $CornerRgnApplied "0"
FunctionEnd

; ════════════════════════════════════════════════════════════════════════
; Helper: apply rounded corners (called from each page after window is sized)
; ════════════════════════════════════════════════════════════════════════
Function BeatZFit_ApplyCorners
  ${If} $CornerRgnApplied == "1"
    Return
  ${EndIf}
  StrCpy $CornerRgnApplied "1"

  ; Get window width/height via GetClientRect (client area, always valid)
  System::Call '*(i, i, i, i) i .r0'
  System::Call 'user32::GetClientRect(i $hwndParent, i r0)'
  System::Call '*r0 (i .r1, i .r2, i .r3, i .r4)'
  System::Free $0
  ; r3 = right = width, r4 = bottom = height (left/top are 0 for client rect)
  ${If} $3 > 0
  ${AndIf} $4 > 0
    ; Add 1 to width/height because CreateRoundRectRgn uses exclusive right/bottom
    IntOp $3 $3 + 1
    IntOp $4 $4 + 1
    ; Also add title bar + borders to make region cover full window
    IntOp $3 $3 + 8
    IntOp $4 $4 + 30
    System::Call 'gdi32::CreateRoundRectRgn(i 0, i 0, i r3, i r4, i ${CORNER_RADIUS}, i ${CORNER_RADIUS}) i .r5'
    System::Call 'user32::SetWindowRgn(i $hwndParent, i r5, i 1)'
  ${EndIf}
FunctionEnd

; ════════════════════════════════════════════════════════════════════════
; Helper: style buttons on current page
; ════════════════════════════════════════════════════════════════════════
Function BeatZFit_StyleButtons
  GetDlgItem $0 $hwndParent 1
  SetCtlColors $0 "${TEXT_COLOR}" "${BG_COLOR_LIGHT}"
  GetDlgItem $0 $hwndParent 2
  SetCtlColors $0 "${TEXT_DIM}" "${BG_COLOR}"
  GetDlgItem $0 $hwndParent 3
  SetCtlColors $0 "${TEXT_DIM}" "${BG_COLOR}"
FunctionEnd

; ════════════════════════════════════════════════════════════════════════
; Page 1: Welcome
; ════════════════════════════════════════════════════════════════════════
Function BeatZFit_WelcomePage
  ; Apply rounded corners now that window is visible and sized
  Call BeatZFit_ApplyCorners

  GetDlgItem $0 $hwndParent 3
  EnableWindow $0 0
  ShowWindow $0 0

  nsDialogs::Create 1018
  Pop $0
  SetCtlColors $0 "${TEXT_COLOR}" "${BG_COLOR}"

  ; Logo (load from ICO)
  ${NSD_CreateBitmap} 125u 15u 70u 70u ""
  Pop $0
  System::Call 'user32::LoadImage(i 0, t "${ICON_PATH}", i 1, i 0, i 0, i 0x10) i .r2'
  ${If} $2 != 0
    SendMessage $0 ${STM_SETIMAGE} 1 $2
  ${EndIf}

  ; App Name
  CreateFont $1 "Segoe UI" 28 700
  ${NSD_CreateLabel} 40u 92u 320u 40u "BeatZ Fit"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $1 0
  SetCtlColors $0 "${TEXT_COLOR}" "${BG_COLOR}"

  ; Tagline
  CreateFont $1 "Segoe UI" 11 400
  ${NSD_CreateLabel} 40u 128u 320u 20u "音乐驱动训练 · 沉浸式音乐健身桌面应用"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $1 0
  SetCtlColors $0 "${ACCENT_COLOR}" "${BG_COLOR}"

  ; Description
  CreateFont $1 "Segoe UI" 10 400
  ${NSD_CreateLabel} 40u 160u 330u 60u "BeatZ Fit 将音乐播放器、3D 音频可视化与健身训练管理融合为一体。$\n每首歌的封面驱动独特的 3D 可视化效果，让你的训练不再单调。$\n$\n点击「下一步」开始安装。"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $1 0
  SetCtlColors $0 "${TEXT_DIM}" "${BG_COLOR}"

  ; Version
  ${NSD_CreateLabel} 40u 230u 100u 15u "v${VERSION}"
  Pop $0
  SetCtlColors $0 "${TEXT_DIM}" "${BG_COLOR}"

  Call BeatZFit_StyleButtons
  nsDialogs::Show
FunctionEnd

; ════════════════════════════════════════════════════════════════════════
; Page 2: Directory Selection
; ════════════════════════════════════════════════════════════════════════
Function BeatZFit_DirectoryPage
  GetDlgItem $0 $hwndParent 3
  ShowWindow $0 1
  EnableWindow $0 1

  GetDlgItem $0 $hwndParent 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:安装"

  nsDialogs::Create 1018
  Pop $0
  SetCtlColors $0 "${TEXT_COLOR}" "${BG_COLOR}"

  CreateFont $1 "Segoe UI" 16 600
  ${NSD_CreateLabel} 10u 5u 300u 25u "选择安装位置"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $1 0
  SetCtlColors $0 "${TEXT_COLOR}" "${BG_COLOR}"

  CreateFont $1 "Segoe UI" 10 400
  ${NSD_CreateLabel} 10u 35u 330u 20u "应用数据将存储在安装目录下的 Data 文件夹中。"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $1 0
  SetCtlColors $0 "${TEXT_DIM}" "${BG_COLOR}"

  ${NSD_CreateLabel} 10u 68u 80u 14u "安装路径："
  Pop $0
  SetCtlColors $0 "${TEXT_COLOR}" "${BG_COLOR}"

  ${NSD_CreateText} 10u 83u 260u 16u "$INSTDIR"
  Pop $DirText
  SetCtlColors $DirText "${TEXT_COLOR}" "${BG_COLOR_LIGHT}"

  ${NSD_CreateButton} 278u 82u 55u 18u "浏览..."
  Pop $DirBrowseBtn
  SetCtlColors $DirBrowseBtn "${TEXT_COLOR}" "${BG_COLOR_LIGHT}"
  ${NSD_OnClick} $DirBrowseBtn BeatZFit_BrowseDir

  ${NSD_CreateLabel} 10u 113u 330u 30u "建议安装在 D 盘以节省 C 盘空间。$\n应用数据目录：$INSTDIR\Data"
  Pop $0
  SetCtlColors $0 "${TEXT_DIM}" "${BG_COLOR}"

  ${NSD_CreateLabel} 10u 150u 330u 15u "所需磁盘空间：约 350 MB"
  Pop $0
  SetCtlColors $0 "${TEXT_DIM}" "${BG_COLOR}"

  Call BeatZFit_StyleButtons
  nsDialogs::Show
FunctionEnd

Function BeatZFit_BrowseDir
  nsDialogs::SelectFolderDialog "选择安装目录" "$INSTDIR"
  Pop $0
  ${If} $0 != "error"
    StrCpy $INSTDIR $0
    ${StrContains} $1 "${APP_FILENAME}" $INSTDIR
    ${If} $1 == ""
      StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
    ${EndIf}
    ${NSD_SetText} $DirText "$INSTDIR"
  ${EndIf}
FunctionEnd

Function BeatZFit_DirectoryLeave
  ${NSD_GetText} $DirText $0
  StrCpy $INSTDIR $0
  ${If} $INSTDIR == ""
    MessageBox MB_OK|MB_ICONEXCLAMATION "请选择安装目录。"
    Abort
  ${EndIf}
  ${StrContains} $1 "${APP_FILENAME}" $INSTDIR
  ${If} $1 == ""
    StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
  ${EndIf}
FunctionEnd

; ════════════════════════════════════════════════════════════════════════
; Page 3: Installation
; ════════════════════════════════════════════════════════════════════════
Function BeatZFit_InstallPage
  GetDlgItem $0 $hwndParent 3
  EnableWindow $0 0
  GetDlgItem $0 $hwndParent 1
  EnableWindow $0 0
  SendMessage $0 ${WM_SETTEXT} 0 "STR:安装中..."
  GetDlgItem $0 $hwndParent 2
  EnableWindow $0 0

  nsDialogs::Create 1018
  Pop $0
  SetCtlColors $0 "${TEXT_COLOR}" "${BG_COLOR}"

  CreateFont $1 "Segoe UI" 16 600
  ${NSD_CreateLabel} 10u 5u 300u 25u "正在安装..."
  Pop $0
  SendMessage $0 ${WM_SETFONT} $1 0
  SetCtlColors $0 "${TEXT_COLOR}" "${BG_COLOR}"

  ${NSD_CreateLabel} 10u 45u 330u 20u "正在将 BeatZ Fit 安装到 $INSTDIR"
  Pop $ProgressLabel
  SetCtlColors $ProgressLabel "${TEXT_DIM}" "${BG_COLOR}"

  ${NSD_CreateProgressBar} 10u 72u 330u 14u ""
  Pop $ProgressBar
  SendMessage $ProgressBar ${PBM_SETRANGE32} 0 100
  SendMessage $ProgressBar ${PBM_SETPOS} 0 0
  SetCtlColors $ProgressBar "" "${BG_COLOR_LIGHT}"

  Call BeatZFit_StyleButtons
  nsDialogs::Show

  ; Perform installation
  Call BeatZFit_DoInstall
FunctionEnd

; ════════════════════════════════════════════════════════════════════════
; Installation Logic
; ════════════════════════════════════════════════════════════════════════
Function BeatZFit_DoInstall
  StrCpy $appExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}"

  ; ── Check if app is running ──
  nsProcess::_FindProcess "${APP_EXECUTABLE_FILENAME}"
  Pop $0
  ${If} $0 == 0
    nsProcess::_KillProcess "${APP_EXECUTABLE_FILENAME}"
    Pop $0
    Sleep 1500
  ${EndIf}
  nsProcess::_Unload

  ; ── Uninstall old version if exists ──
  ReadRegStr $0 HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  ${If} $0 != ""
    !insertmacro GetInQuotes $1 $0
    ${If} ${FileExists} $1
      CopyFiles /SILENT $1 "$PLUGINSDIR\old-uninst.exe"
      ExecWait '"$PLUGINSDIR\old-uninst.exe" /S /KEEP_APP_DATA _?=$INSTDIR' $0
    ${EndIf}
  ${EndIf}

  ; ── Create install directory ──
  CreateDirectory $INSTDIR
  SetOutPath $INSTDIR

  ${If} $ProgressLabel != ""
    ${NSD_SetText} $ProgressLabel "正在解压文件..."
  ${EndIf}

  ; ── Extract app files from embedded 7z ──
  InitPluginsDir
  !ifdef COMPRESS
    SetCompress off
  !endif
  !insertmacro extractEmbeddedAppPackage
  !ifdef COMPRESS
    SetCompress "${COMPRESS}"
  !endif

  ${If} $ProgressBar != ""
    SendMessage $ProgressBar ${PBM_SETPOS} 50 0
  ${EndIf}

  ; ── Create uninstaller ──
  ${If} $ProgressLabel != ""
    ${NSD_SetText} $ProgressLabel "正在创建卸载程序..."
  ${EndIf}
  WriteUninstaller "$INSTDIR\${UNINSTALL_FILENAME}"

  ${If} $ProgressBar != ""
    SendMessage $ProgressBar ${PBM_SETPOS} 65 0
  ${EndIf}

  ; ── Create shortcuts ──
  ${If} $ProgressLabel != ""
    ${NSD_SetText} $ProgressLabel "正在创建快捷方式..."
  ${EndIf}

  CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
  ClearErrors
  WinShell::SetLnkAUMI "$DESKTOP\${SHORTCUT_NAME}.lnk" "${APP_ID}"

  CreateShortCut "$SMPROGRAMS\${SHORTCUT_NAME}.lnk" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
  ClearErrors
  WinShell::SetLnkAUMI "$SMPROGRAMS\${SHORTCUT_NAME}.lnk" "${APP_ID}"

  StrCpy $launchLink "$SMPROGRAMS\${SHORTCUT_NAME}.lnk"

  ${If} $ProgressBar != ""
    SendMessage $ProgressBar ${PBM_SETPOS} 80 0
  ${EndIf}

  ; ── Create Data directory ──
  CreateDirectory "$INSTDIR\Data"

  ; ── Write registry entries ──
  ${If} $ProgressLabel != ""
    ${NSD_SetText} $ProgressLabel "正在写入注册表..."
  ${EndIf}

  WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" "KeepShortcuts" "true"
  WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" "ShortcutName" "${SHORTCUT_NAME}"

  WriteRegStr HKCU "${UNINSTALL_REGISTRY_KEY}" "DisplayName" "${UNINSTALL_DISPLAY_NAME}"
  WriteRegStr HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString" '"$INSTDIR\${UNINSTALL_FILENAME}" /currentuser'
  WriteRegStr HKCU "${UNINSTALL_REGISTRY_KEY}" "QuietUninstallString" '"$INSTDIR\${UNINSTALL_FILENAME}" /currentuser /S'
  WriteRegStr HKCU "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_REGISTRY_KEY}" "DisplayIcon" "$appExe,0"
  WriteRegStr HKCU "${UNINSTALL_REGISTRY_KEY}" "Publisher" "${PRODUCT_NAME}"
  WriteRegDWORD HKCU "${UNINSTALL_REGISTRY_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_REGISTRY_KEY}" "NoRepair" 1

  !ifdef ESTIMATED_SIZE
    IntFmt $0 "0x%08X" ${ESTIMATED_SIZE}
    WriteRegDWORD HKCU "${UNINSTALL_REGISTRY_KEY}" "EstimatedSize" "$0"
  !endif

  ; Refresh desktop
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'

  ${If} $ProgressBar != ""
    SendMessage $ProgressBar ${PBM_SETPOS} 100 0
  ${EndIf}
  ${If} $ProgressLabel != ""
    ${NSD_SetText} $ProgressLabel "安装完成！"
  ${EndIf}

  ; ── Copy installer to local app data (for updates) ──
  !ifdef APP_PACKAGE_NAME
    ${StdUtils.GetParentPath} $R5 "$LOCALAPPDATA\${APP_PACKAGE_NAME}"
    CreateDirectory "$R5"
    ClearErrors
    CopyFiles /SILENT "$EXEPATH" "$LOCALAPPDATA\${APP_PACKAGE_NAME}"
  !endif
FunctionEnd

; ════════════════════════════════════════════════════════════════════════
; Page 4: Finish
; ════════════════════════════════════════════════════════════════════════
Function BeatZFit_FinishPage
  GetDlgItem $0 $hwndParent 3
  ShowWindow $0 0
  EnableWindow $0 0
  GetDlgItem $0 $hwndParent 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:完成"
  GetDlgItem $0 $hwndParent 2
  EnableWindow $0 0

  nsDialogs::Create 1018
  Pop $0
  SetCtlColors $0 "${TEXT_COLOR}" "${BG_COLOR}"

  ; Logo
  ${NSD_CreateBitmap} 130u 10u 60u 60u ""
  Pop $0
  System::Call 'user32::LoadImage(i 0, t "${ICON_PATH}", i 1, i 0, i 0, i 0x10) i .r2'
  ${If} $2 != 0
    SendMessage $0 ${STM_SETIMAGE} 1 $2
  ${EndIf}

  ; Title
  CreateFont $1 "Segoe UI" 20 700
  ${NSD_CreateLabel} 40u 80u 320u 30u "安装完成"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $1 0
  SetCtlColors $0 "${TEXT_COLOR}" "${BG_COLOR}"

  ; Subtitle
  CreateFont $1 "Segoe UI" 10 400
  ${NSD_CreateLabel} 40u 112u 330u 30u "BeatZ Fit 已成功安装到您的计算机。$\n点击「完成」退出安装程序。"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $1 0
  SetCtlColors $0 "${TEXT_DIM}" "${BG_COLOR}"

  ; Launch checkbox
  ${NSD_CreateCheckbox} 40u 155u 200u 16u "立即启动 BeatZ Fit"
  Pop $FinishCheckbox
  SendMessage $FinishCheckbox ${BM_SETCHECK} ${BST_CHECKED} 0
  SetCtlColors $FinishCheckbox "${TEXT_COLOR}" "${BG_COLOR}"
  ${NSD_OnClick} $FinishCheckbox BeatZFit_FinishCheckboxClick

  Call BeatZFit_StyleButtons
  nsDialogs::Show
FunctionEnd

Function BeatZFit_FinishCheckboxClick
  Pop $0
  SendMessage $FinishCheckbox ${BM_GETCHECK} 0 0 $0
  ${If} $0 = ${BST_CHECKED}
    StrCpy $LaunchOnFinish "1"
  ${Else}
    StrCpy $LaunchOnFinish "0"
  ${EndIf}
FunctionEnd

Function BeatZFit_FinishLeave
  ; If user clicked Back, don't launch
  ${If} $LaunchOnFinish == "1"
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" ""
  ${EndIf}
FunctionEnd

; ════════════════════════════════════════════════════════════════════════
; Abort confirmation
; ════════════════════════════════════════════════════════════════════════
Function .onUserAbort
  MessageBox MB_YESNO|MB_ICONQUESTION "确定要退出 BeatZ Fit 安装程序吗？" IDNO +2
    Quit
  Abort
FunctionEnd

; ── Skip the hidden instfiles page (installation is done in custom page) ──
Function BeatZFit_SkipInstFiles
  SetErrorLevel 0
  Quit
FunctionEnd

; ════════════════════════════════════════════════════════════════════════
; Section (required by NSIS, actual work done in page functions)
; ════════════════════════════════════════════════════════════════════════
Section "Install"
SectionEnd

; ════════════════════════════════════════════════════════════════════════
; Uninstaller
; ════════════════════════════════════════════════════════════════════════
Function un.onInit
  SetRegView 64
  ReadRegStr $INSTDIR HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  ${If} $INSTDIR == ""
    ReadRegStr $INSTDIR HKLM "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  ${EndIf}
FunctionEnd

Function un.BeatZFit_UnWelcomePage
  ${If} ${Silent}
    Abort
  ${EndIf}

  ; Apply rounded corners for uninstaller window
  System::Call '*(i, i, i, i) i .r0'
  System::Call 'user32::GetClientRect(i $hwndParent, i r0)'
  System::Call '*r0 (i .r1, i .r2, i .r3, i .r4)'
  System::Free $0
  ${If} $3 > 0
  ${AndIf} $4 > 0
    IntOp $3 $3 + 9
    IntOp $4 $4 + 31
    System::Call 'gdi32::CreateRoundRectRgn(i 0, i 0, i r3, i r4, i ${CORNER_RADIUS}, i ${CORNER_RADIUS}) i .r5'
    System::Call 'user32::SetWindowRgn(i $hwndParent, i r5, i 1)'
  ${EndIf}
  SetCtlColors $hwndParent "${TEXT_COLOR}" "${BG_COLOR}"

  GetDlgItem $0 $hwndParent 3
  ShowWindow $0 0
  EnableWindow $0 0

  nsDialogs::Create 1018
  Pop $0
  SetCtlColors $0 "${TEXT_COLOR}" "${BG_COLOR}"

  CreateFont $1 "Segoe UI" 20 700
  ${NSD_CreateLabel} 10u 10u 300u 30u "卸载 BeatZ Fit"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $1 0
  SetCtlColors $0 "${TEXT_COLOR}" "${BG_COLOR}"

  CreateFont $1 "Segoe UI" 10 400
  ${NSD_CreateLabel} 10u 50u 330u 40u "即将从您的计算机上移除 BeatZ Fit。$\n$\n点击「下一步」继续卸载。"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $1 0
  SetCtlColors $0 "${TEXT_DIM}" "${BG_COLOR}"

  GetDlgItem $0 $hwndParent 1
  SetCtlColors $0 "${TEXT_COLOR}" "${BG_COLOR_LIGHT}"
  GetDlgItem $0 $hwndParent 2
  SetCtlColors $0 "${TEXT_DIM}" "${BG_COLOR}"

  nsDialogs::Show
FunctionEnd

Section "Uninstall"
  ; Check if app is running
  nsProcess::_FindProcess "${APP_EXECUTABLE_FILENAME}"
  Pop $0
  ${If} $0 == 0
    nsProcess::_KillProcess "${APP_EXECUTABLE_FILENAME}"
    Pop $0
    Sleep 1500
  ${EndIf}
  nsProcess::_Unload

  ; Ask about deleting app data
  IfFileExists "$INSTDIR\Data\*.*" 0 skip_data_delete
    MessageBox MB_YESNO|MB_ICONQUESTION \
      "是否同时删除应用数据（数据库、缓存、封面、歌词等）？$\n$\n\
      选择「是」将完全清除所有 BeatZ Fit 数据。$\n\
      选择「否」仅卸载程序，保留数据以便将来重新安装。" \
      IDNO skip_data_delete
      RMDir /r "$INSTDIR\Data"
  skip_data_delete:

  ; Delete shortcuts
  Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
  Delete "$SMPROGRAMS\${SHORTCUT_NAME}.lnk"

  ; Delete install directory
  RMDir /r "$INSTDIR"

  ; Delete registry entries
  DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"
  DeleteRegKey HKCU "${INSTALL_REGISTRY_KEY}"

  ; Refresh desktop
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
SectionEnd
