@echo off
rem ---------------------------------------------------------------------------
rem  Ultimate Baby Tracker - Windows launcher.
rem
rem  PowerShell refuses to run unsigned script FILES by default (the execution
rem  policy is Restricted for a standard user), and a .ps1 downloaded from the
rem  internet carries a mark-of-the-web that even RemoteSigned rejects. Both are
rem  lifted by -ExecutionPolicy Bypass, which applies to this one invocation
rem  only: it changes nothing on the machine and needs no administrator rights.
rem
rem  Use this rather than calling install.ps1 directly:
rem
rem     scripts\install.cmd install
rem     scripts\install.cmd update
rem     scripts\install.cmd status
rem ---------------------------------------------------------------------------

setlocal
set "PS1=%~dp0install.ps1"

if not exist "%PS1%" (
  echo error: install.ps1 was not found next to this file.>&2
  exit /b 1
)

rem PowerShell 7 if it is here, Windows PowerShell 5.1 otherwise - the script
rem only uses cmdlets that both have.
set "PS=powershell"
where pwsh >nul 2>&1 && set "PS=pwsh"

rem The call and the exit are one bracketed block, which cmd.exe reads in full
rem before running any of it. It reads the rest of a batch file a line at a
rem time, from where it left off, and the copy of this file in the app
rem directory is the one people run later: update may rewrite it and uninstall
rem deletes it while it runs. Anything after the call would then come from the
rem new file at the old offset, or fail with "The batch file cannot be found".
rem exit /b with no number passes PowerShell's exit code on unchanged.
(
  %PS% -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
  exit /b
)
