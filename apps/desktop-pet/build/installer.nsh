!include LogicLib.nsh
!include getProcessInfo.nsh

Var pid

!macro traceStopRegisteredApp ROOT
  ReadRegStr $R8 ${ROOT} "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${if} $R8 != ""
    ${if} ${FileExists} "$R8\${APP_EXECUTABLE_FILENAME}"
      System::Call 'Kernel32::SetEnvironmentVariable(t, t)i("TRACE_REGISTERED_EXE", "$R8\${APP_EXECUTABLE_FILENAME}").r0'
      nsExec::Exec `"$PowerShellPath" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$target = [IO.Path]::GetFullPath($$env:TRACE_REGISTERED_EXE); if (@(Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ExecutablePath -and [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetFullPath($$_.ExecutablePath), $$target) }).Count -gt 0) { exit 0 } else { exit 1 }"`
      Pop $R0
      ${if} $R0 == 0
        DetailPrint "Requesting the existing Trace process to close."
        Exec '"$R8\${APP_EXECUTABLE_FILENAME}" --trace-shutdown-for-update'
        Sleep 3200

        # 0.2.2+ exits through the app-owned shutdown handshake above. For an
        # older build that does not understand the argument, terminate only
        # the executable registered for this exact installation; never match
        # every process merely named Trace.exe.
        nsExec::ExecToLog `"$PowerShellPath" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$target = [IO.Path]::GetFullPath($$env:TRACE_REGISTERED_EXE); Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ExecutablePath -and [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetFullPath($$_.ExecutablePath), $$target) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
        Pop $R0
        Sleep 400
      ${endIf}
      System::Call 'Kernel32::SetEnvironmentVariable(t, p0)i("TRACE_REGISTERED_EXE", 0).r0'
    ${endIf}
  ${endIf}
!macroend

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  ${if} $IsPowerShellAvailable == 0
    !insertmacro traceStopRegisteredApp HKCU
    !insertmacro traceStopRegisteredApp HKLM
  ${endIf}

  # Keep electron-builder's scoped fallback. It catches an unregistered
  # portable/legacy process below the selected install directory and retains
  # the normal Retry/Cancel UI when elevation prevents termination.
  !insertmacro _CHECK_APP_RUNNING
!macroend
