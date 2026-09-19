!include LogicLib.nsh
!include getProcessInfo.nsh

Var pid
Var traceStopFailed

!macro traceStopAppAtPath APP_PATH
  ${if} ${FileExists} "${APP_PATH}"
    System::Call 'Kernel32::SetEnvironmentVariable(t, t)i("TRACE_INSTALL_EXE", "${APP_PATH}").r0'
    nsExec::Exec `"$PowerShellPath" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$target = [IO.Path]::GetFullPath($$env:TRACE_INSTALL_EXE); if (@(Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ExecutablePath -and [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetFullPath($$_.ExecutablePath), $$target) }).Count -gt 0) { exit 0 } else { exit 1 }"`
    Pop $R0
    ${if} $R0 == 0
      DetailPrint "Requesting the existing Trace process to close."
      Exec '"${APP_PATH}" --trace-shutdown-for-update'

      # Give 0.2.2+ five seconds to flush SQLite and stop its embedded
      # runtime. Older versions do not understand the shutdown argument, so
      # after the grace period terminate only this exact registered image and
      # wait until CIM no longer exposes it. Do not fall through to the broad
      # directory-prefix check while a terminated Electron child is lingering.
      nsExec::ExecToLog `"$PowerShellPath" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$target = [IO.Path]::GetFullPath($$env:TRACE_INSTALL_EXE); $$grace = [DateTime]::UtcNow.AddSeconds(5); do { $$items = @(Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ExecutablePath -and [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetFullPath($$_.ExecutablePath), $$target) }); if ($$items.Count -eq 0) { exit 0 }; if ([DateTime]::UtcNow -ge $$grace) { break }; Start-Sleep -Milliseconds 250 } while ($$true); $$items | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }; $$deadline = [DateTime]::UtcNow.AddSeconds(5); do { $$items = @(Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ExecutablePath -and [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetFullPath($$_.ExecutablePath), $$target) }); if ($$items.Count -eq 0) { exit 0 }; Start-Sleep -Milliseconds 250 } while ([DateTime]::UtcNow -lt $$deadline); exit 1"`
      Pop $R0
      ${if} $R0 != 0
        StrCpy $traceStopFailed 1
      ${endIf}
    ${endIf}
    System::Call 'Kernel32::SetEnvironmentVariable(t, p0)i("TRACE_INSTALL_EXE", 0).r0'
  ${endIf}
!macroend

!macro traceStopRegisteredApp ROOT
  ReadRegStr $R8 ${ROOT} "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${if} $R8 != ""
    !insertmacro traceStopAppAtPath "$R8\${APP_EXECUTABLE_FILENAME}"
  ${endIf}
!macroend

# electron-builder's update uninstaller first renames every installed file into
# $PLUGINSDIR. That operation cannot cross drive boundaries, so an older Trace
# installed on (for example) D: returns code 2 while the installer is running
# from the user's C: temp directory. The new installer has already stopped the
# exact registered executable above, so replace the registered application tree
# directly. Trace user data lives under Electron's userData directory and is
# deliberately outside this tree.
!macro tracePurgeRegisteredInstall ROOT
  ReadRegStr $R7 ${ROOT} "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${if} $R7 != ""
    DetailPrint "Removing the previous Trace application files from $R7."
    SetOutPath "$TEMP"
    # Perform both the product-identity guard and the recursive removal in one
    # exact-path PowerShell process. This avoids NSIS Rename/RMDir differences
    # across volumes and still refuses to erase a non-Trace directory if a
    # registry value has been corrupted.
    System::Call 'Kernel32::SetEnvironmentVariable(t, t)i("TRACE_INSTALL_DIR", "$R7").r0'
    nsExec::ExecToLog `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$target = [IO.Path]::GetFullPath($$env:TRACE_INSTALL_DIR); if (!(Test-Path -LiteralPath $$target)) { exit 0 }; $$entries = @(Get-ChildItem -LiteralPath $$target -Force -ErrorAction SilentlyContinue); $$traceMarkers = @((Join-Path $$target '${APP_EXECUTABLE_FILENAME}'), (Join-Path $$target '${UNINSTALL_FILENAME}'), (Join-Path $$target 'version')); if ($$entries.Count -gt 0 -and !($$traceMarkers | Where-Object { Test-Path -LiteralPath $$_ -PathType Leaf } | Select-Object -First 1)) { exit 2 }; for ($$attempt = 0; $$attempt -lt 20; $$attempt++) { Remove-Item -LiteralPath $$target -Recurse -Force -ErrorAction SilentlyContinue; if (!(Test-Path -LiteralPath $$target)) { exit 0 }; Start-Sleep -Milliseconds 250 }; exit 1"`
    Pop $R0
    System::Call 'Kernel32::SetEnvironmentVariable(t, p0)i("TRACE_INSTALL_DIR", 0).r0'
    # Replacement is all-or-nothing. Never erase registration for a directory
    # that does not prove it belongs to Trace, and never mix a new payload with
    # files that could not be removed after the bounded retry window.
    ${if} $R0 == 2
      Abort "Trace 的旧安装位置无法通过产品身份校验。为保护该目录，安装已停止。"
    ${elseIf} $R0 != 0
      Abort "Trace 的旧程序文件仍在使用中，无法安全替换。请稍后重试。"
    ${endIf}

    # The old payload is now gone. Removing its registration makes
    # electron-builder's uninstallOldVersion a no-op, avoiding the legacy
    # cross-volume Rename path that caused the false "cannot be closed" loop.
    DeleteRegKey ${ROOT} "${UNINSTALL_REGISTRY_KEY}"
    !ifdef UNINSTALL_REGISTRY_KEY_2
      DeleteRegKey ${ROOT} "${UNINSTALL_REGISTRY_KEY_2}"
    !endif
    DeleteRegKey ${ROOT} "${INSTALL_REGISTRY_KEY}"
  ${endIf}
!macroend

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  StrCpy $traceStopFailed 0
  ${if} $IsPowerShellAvailable == 0
    !insertmacro traceStopRegisteredApp HKCU
    !insertmacro traceStopRegisteredApp HKLM
    !insertmacro traceStopAppAtPath "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  ${else}
    # On old systems without usable PowerShell, retain electron-builder's
    # standard Retry/Cancel process handling.
    StrCpy $traceStopFailed 1
  ${endIf}
  ${if} $traceStopFailed != 0
    !insertmacro _CHECK_APP_RUNNING
  ${endIf}

  # Only the installer replaces a registered old application tree. The
  # generated uninstaller uses customRemoveFiles below instead.
  !ifndef BUILD_UNINSTALLER
    # If the exact-path stop fell back to electron-builder's process check,
    # that check either closed the process or quit the installer. Reaching
    # here is therefore sufficient proof that replacement may proceed; do not
    # suppress cleanup because the fallback path was used.
    !insertmacro tracePurgeRegisteredInstall HKCU
    !insertmacro tracePurgeRegisteredInstall HKLM
  !endif
!macroend

# Do not use electron-builder's atomicRMDir for updates: it relies on Rename,
# which is restricted to a single volume. The uninstaller itself is already
# running from a temporary copy, so direct recursive removal works for any
# user-selected installation drive while keeping Electron userData intact.
!macro customRemoveFiles
  SetOutPath "$TEMP"
  RMDir /r "$INSTDIR"
  ${if} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    Abort "Trace 的程序文件仍在使用中，无法完成卸载。"
  ${endIf}
!macroend
