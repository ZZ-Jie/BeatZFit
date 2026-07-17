; ════════════════════════════════════════════════════════════════════════
; BeatZ Fit — Custom NSIS Installer Include (Retro-Futurism Dark Theme)
; ════════════════════════════════════════════════════════════════════════

; ── Brand Colors (Retro-Futurism) ─────────────────────────────────────
!define BG_COLOR       "0x0A0A14"
!define BG_COLOR_PANEL "0x14142A"
!define BG_COLOR_BTN   "0x1A1A30"
!define TEXT_COLOR     "0xE8E8F0"
!define TEXT_DIM        "0x686880"
!define ACCENT_COLOR   "0x00E5FF"
!define CORNER_RADIUS  12

; ════════════════════════════════════════════════════════════════════════
; Force current-user install (skip install-mode selection page)
; ════════════════════════════════════════════════════════════════════════
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; ════════════════════════════════════════════════════════════════════════
; Custom Init — default install directory to D:\BeatZFit
; ════════════════════════════════════════════════════════════════════════
!macro customInit
  ${If} $hasPerUserInstallation == "0"
  ${AndIf} $hasPerMachineInstallation == "0"
    IfFileExists "D:\*.*" 0 beatzfit_nodrive
      WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation" "D:\BeatZFit"
    beatzfit_nodrive:
  ${EndIf}
!macroend

; ════════════════════════════════════════════════════════════════════════
; GUI Init — dark theme + rounded corners + button styling
; ════════════════════════════════════════════════════════════════════════
!define MUI_CUSTOMFUNCTION_GUIINIT BeatZFit_GUIInit

Var BeatZFit_FontTitle
Var BeatZFit_FontSub

Function BeatZFit_GUIInit
  ; ── Dark background for entire window ──
  SetCtlColors $hwndParent "${TEXT_COLOR}" "${BG_COLOR}"

  ; ── Style standard buttons: Next(1), Back(2), Cancel(3) ──
  GetDlgItem $0 $hwndParent 1
  SetCtlColors $0 "${TEXT_COLOR}" "${BG_COLOR_BTN}"
  GetDlgItem $0 $hwndParent 2
  SetCtlColors $0 "${TEXT_DIM}" "${BG_COLOR}"
  GetDlgItem $0 $hwndParent 3
  SetCtlColors $0 "${TEXT_DIM}" "${BG_COLOR}"

  ; ── Style header area (MUI2 header controls) ──
  GetDlgItem $0 $hwndParent 1034  ; header bitmap area
  ${If} $0 != 0
    SetCtlColors $0 "${TEXT_COLOR}" "${BG_COLOR}"
  ${EndIf}
  GetDlgItem $0 $hwndParent 1035  ; header title
  ${If} $0 != 0
    SetCtlColors $0 "${ACCENT_COLOR}" "${BG_COLOR}"
  ${EndIf}
  GetDlgItem $0 $hwndParent 1036  ; header subtitle
  ${If} $0 != 0
    SetCtlColors $0 "${TEXT_DIM}" "${BG_COLOR}"
  ${EndIf}

  ; ── Style content area (1018) ──
  GetDlgItem $0 $hwndParent 1018
  ${If} $0 != 0
    SetCtlColors $0 "${TEXT_COLOR}" "${BG_COLOR}"
  ${EndIf}

  ; ── Apply rounded corners via SetWindowRgn ──
  System::Call '*(i 0, i 0, i 0, i 0) p .r9'
  System::Call 'user32::GetWindowRect(i $hwndParent, p r9)'
  System::Call '*$9(i .r0, i .r1, i .r2, i .r3)'
  System::Free $9
  IntOp $2 $2 - $0   ; width  = right - left
  IntOp $3 $3 - $1   ; height = bottom - top
  ${If} $2 > 0
  ${AndIf} $3 > 0
    System::Call 'gdi32::CreateRoundRectRgn(i 0, i 0, i r2, i r3, i ${CORNER_RADIUS}, i ${CORNER_RADIUS}) p .r4'
    System::Call 'user32::SetWindowRgn(i $hwndParent, p r4, b 1)'
  ${EndIf}

  ; ── Create fonts for custom pages ──
  CreateFont $BeatZFit_FontTitle "Segoe UI Light" 28
  CreateFont $BeatZFit_FontSub   "Segoe UI" 12
FunctionEnd

; ════════════════════════════════════════════════════════════════════════
; Directory page — style all child controls (keeps Browse button visible)
; ════════════════════════════════════════════════════════════════════════
!define MUI_PAGE_CUSTOMFUNCTION_SHOW BeatZFit_DirShow

Function BeatZFit_DirShow
  ; Style inner dialog background
  GetDlgItem $0 $hwndParent 1018
  ${If} $0 != 0
    SetCtlColors $0 "${TEXT_COLOR}" "${BG_COLOR}"

    ; Enumerate ALL child controls of 1018 and style them
    StrCpy $1 0   ; hwndChildAfter = NULL
    beatzfit_dir_loop:
      System::Call 'user32::FindWindowEx(i r0, i r1, i 0, i 0) i .r2'
      StrCmp $2 0 beatzfit_dir_done

      ; Get class name to identify control type
      System::Call 'user32::GetClassName(i r2, t .r3, i 256)'

      ${If} $3 == "Button"
        ; Browse button — give it a visible panel background
        SetCtlColors $2 "${TEXT_COLOR}" "${BG_COLOR_BTN}"
      ${Else}
        ; Labels, edit fields, etc. — dark background
        SetCtlColors $2 "${TEXT_COLOR}" "${BG_COLOR}"
      ${EndIf}

      StrCpy $1 $2
      Goto beatzfit_dir_loop
    beatzfit_dir_done:
  ${EndIf}
FunctionEnd

; ════════════════════════════════════════════════════════════════════════
; Custom Welcome Page
; ════════════════════════════════════════════════════════════════════════
!macro customWelcomePage
  Page custom BeatZFit_WelcomePage
!macroend

Function BeatZFit_WelcomePage
  ; Hide Back button on first page
  GetDlgItem $0 $hwndParent 2
  EnableWindow $0 0
  ShowWindow $0 0

  nsDialogs::Create 1018
  Pop $0
  SetCtlColors $0 "${TEXT_COLOR}" "${BG_COLOR}"

  ; ── Large title in neon cyan ──
  ${NSD_CreateLabel} 25u 35u 100% 45u "BeatZ Fit"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $BeatZFit_FontTitle 0
  SetCtlColors $0 "${ACCENT_COLOR}" "${BG_COLOR}"

  ; ── Tagline ──
  ${NSD_CreateLabel} 25u 82u 100% 18u "IMMERSIVE MUSIC FITNESS"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $BeatZFit_FontSub 0
  SetCtlColors $0 "${TEXT_DIM}" "${BG_COLOR}"

  ; ── Separator line ──
  ${NSD_CreateLabel} 25u 108u 300u 1u ""
  Pop $0
  SetCtlColors $0 "${ACCENT_COLOR}" "${ACCENT_COLOR}"

  ; ── Description ──
  ${NSD_CreateLabel} 25u 120u 320u 50u "将音乐节奏与健身运动完美融合。$\r$\n通过沉浸式 3D 可视化与实时音频分析，$\r$\n打造前所未有的运动体验。"
  Pop $0
  SetCtlColors $0 "${TEXT_COLOR}" "${BG_COLOR}"

  ; ── Version info ──
  ${NSD_CreateLabel} 25u 185u 100% 15u "Version ${VERSION}"
  Pop $0
  SetCtlColors $0 "${TEXT_DIM}" "${BG_COLOR}"

  nsDialogs::Show
FunctionEnd

; ════════════════════════════════════════════════════════════════════════
; Custom Finish Page
; ════════════════════════════════════════════════════════════════════════
!macro customFinishPage
  Page custom BeatZFit_FinishPage BeatZFit_FinishLeave
!macroend

Var FinishCheckbox

Function BeatZFit_FinishPage
  ; Hide Back button
  GetDlgItem $0 $hwndParent 2
  EnableWindow $0 0
  ShowWindow $0 0

  ; Change Next button text to "完成"
  GetDlgItem $0 $hwndParent 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:完成"

  nsDialogs::Create 1018
  Pop $0
  SetCtlColors $0 "${TEXT_COLOR}" "${BG_COLOR}"

  ; ── Title ──
  ${NSD_CreateLabel} 25u 35u 100% 40u "安装完成"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $BeatZFit_FontTitle 0
  SetCtlColors $0 "${ACCENT_COLOR}" "${BG_COLOR}"

  ; ── Separator ──
  ${NSD_CreateLabel} 25u 78u 300u 1u ""
  Pop $0
  SetCtlColors $0 "${ACCENT_COLOR}" "${ACCENT_COLOR}"

  ; ── Description ──
  ${NSD_CreateLabel} 25u 92u 320u 30u "BeatZ Fit 已成功安装到您的计算机。$\r$\n点击「完成」退出安装程序。"
  Pop $0
  SetCtlColors $0 "${TEXT_COLOR}" "${BG_COLOR}"

  ; ── Launch checkbox ──
  ${NSD_CreateCheckbox} 25u 140u 300u 15u "立即启动 BeatZ Fit"
  Pop $FinishCheckbox
  SetCtlColors $FinishCheckbox "${TEXT_COLOR}" "${BG_COLOR}"
  ${NSD_Check} $FinishCheckbox

  nsDialogs::Show
FunctionEnd

Function BeatZFit_FinishLeave
  ; Check if user wants to launch the app
  ${NSD_GetState} $FinishCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    HideWindow
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" ""
  ${EndIf}
FunctionEnd

; ════════════════════════════════════════════════════════════════════════
; Instfiles page — style during installation
; ════════════════════════════════════════════════════════════════════════
!macro customInstall
  ; Style instfiles page controls
  GetDlgItem $0 $hwndParent 1018
  ${If} $0 != 0
    SetCtlColors $0 "${TEXT_COLOR}" "${BG_COLOR}"

    ; Enumerate and style child controls
    StrCpy $1 0
    beatzfit_inst_loop:
      System::Call 'user32::FindWindowEx(i r0, i r1, i 0, i 0) i .r2'
      StrCmp $2 0 beatzfit_inst_done
      System::Call 'user32::GetClassName(i r2, t .r3, i 256)'
      ${If} $3 == "Button"
        SetCtlColors $2 "${TEXT_COLOR}" "${BG_COLOR_BTN}"
      ${Else}
        SetCtlColors $2 "${TEXT_COLOR}" "${BG_COLOR}"
      ${EndIf}
      StrCpy $1 $2
      Goto beatzfit_inst_loop
    beatzfit_inst_done:
  ${EndIf}

  ; Force redraw
  System::Call 'user32::InvalidateRect(i $hwndParent, i 0, b 1)'
!macroend

; ════════════════════════════════════════════════════════════════════════
; Uninstaller — dark theme + rounded corners
; ════════════════════════════════════════════════════════════════════════
!macro customUnInit
  ; Dark background
  SetCtlColors $hwndParent "${TEXT_COLOR}" "${BG_COLOR}"

  ; Style buttons
  GetDlgItem $0 $hwndParent 1
  SetCtlColors $0 "${TEXT_COLOR}" "${BG_COLOR_BTN}"
  GetDlgItem $0 $hwndParent 2
  SetCtlColors $0 "${TEXT_DIM}" "${BG_COLOR}"
  GetDlgItem $0 $hwndParent 3
  SetCtlColors $0 "${TEXT_DIM}" "${BG_COLOR}"

  ; Style header
  GetDlgItem $0 $hwndParent 1034
  ${If} $0 != 0
    SetCtlColors $0 "${TEXT_COLOR}" "${BG_COLOR}"
  ${EndIf}
  GetDlgItem $0 $hwndParent 1035
  ${If} $0 != 0
    SetCtlColors $0 "${ACCENT_COLOR}" "${BG_COLOR}"
  ${EndIf}
  GetDlgItem $0 $hwndParent 1036
  ${If} $0 != 0
    SetCtlColors $0 "${TEXT_DIM}" "${BG_COLOR}"
  ${EndIf}

  ; Style content area
  GetDlgItem $0 $hwndParent 1018
  ${If} $0 != 0
    SetCtlColors $0 "${TEXT_COLOR}" "${BG_COLOR}"
  ${EndIf}

  ; Rounded corners
  System::Call '*(i 0, i 0, i 0, i 0) p .r9'
  System::Call 'user32::GetWindowRect(i $hwndParent, p r9)'
  System::Call '*$9(i .r0, i .r1, i .r2, i .r3)'
  System::Free $9
  IntOp $2 $2 - $0
  IntOp $3 $3 - $1
  ${If} $2 > 0
  ${AndIf} $3 > 0
    System::Call 'gdi32::CreateRoundRectRgn(i 0, i 0, i r2, i r3, i ${CORNER_RADIUS}, i ${CORNER_RADIUS}) p .r4'
    System::Call 'user32::SetWindowRgn(i $hwndParent, p r4, b 1)'
  ${EndIf}
!macroend

; ════════════════════════════════════════════════════════════════════════
; Uninstaller — prompt to delete user data
; ════════════════════════════════════════════════════════════════════════
!macro customUnInstall
  ${If} ${Silent}
    Goto beatzfit_un_skip_data
  ${EndIf}
  MessageBox MB_YESNO|MB_ICONQUESTION "是否同时删除 BeatZ Fit 的应用数据（设置、缓存等）?$\r$\n$\r$\n点击 [是] 删除所有数据，点击 [否] 保留数据。" IDNO beatzfit_un_skip_data
    RMDir /r "$APPDATA\${APP_FILENAME}"
    RMDir /r "$LOCALAPPDATA\${APP_FILENAME}"
  beatzfit_un_skip_data:
!macroend
