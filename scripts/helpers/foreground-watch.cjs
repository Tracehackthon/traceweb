// Observes window ownership only. Never activates a window or sends OS input.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

exports.startForegroundWatch = async function (out, profile) {
  const stopFile = path.join(out, 'foreground-watch.stop');
  const dataFile = path.join(out, 'foreground-watch.json');
  const readyFile = path.join(out, 'foreground-watch.ready');
  const ownedFile = path.join(out, 'foreground-owned-pids.json');
  const script = path.join(out, 'foreground-watch.ps1');
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  fs.writeFileSync(script, `
$ErrorActionPreference='Stop'
Add-Type @'
using System;using System.Runtime.InteropServices;
public static class WindowOwnerWatch {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 public delegate bool Callback(IntPtr h,IntPtr p);
 [DllImport("user32.dll")] public static extern bool EnumWindows(Callback c,IntPtr p);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 public static uint[] VisibleOwned(int[] ids) {var found=new System.Collections.Generic.HashSet<uint>();EnumWindows((h,p)=>{uint owner;GetWindowThreadProcessId(h,out owner);if(Array.IndexOf(ids,(int)owner)>=0&&IsWindowVisible(h))found.Add(owner);return true;},IntPtr.Zero);var result=new uint[found.Count];found.CopyTo(result);return result;}
 public class EventRecord {public uint pid;public uint kind;public uint at;}
 public static System.Collections.Generic.List<EventRecord> events=new System.Collections.Generic.List<EventRecord>();
 public delegate void WinEvent(IntPtr hook,uint kind,IntPtr window,int objectId,int childId,uint thread,uint time);
 [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min,uint max,IntPtr module,WinEvent callback,uint process,uint thread,uint flags);
 [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
 [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window,uint flags);
 [StructLayout(LayoutKind.Sequential)] public struct Msg {public IntPtr window;public uint message;public UIntPtr wParam;public IntPtr lParam;public uint time;public int x;public int y;public uint privateField;}
 [DllImport("user32.dll")] static extern bool PeekMessage(out Msg message,IntPtr window,uint min,uint max,uint flags);
 [DllImport("user32.dll")] static extern bool TranslateMessage(ref Msg message);
 [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref Msg message);
 static IntPtr foreground,shown;static WinEvent callback=Observe;
 static void Observe(IntPtr hook,uint kind,IntPtr window,int objectId,int childId,uint thread,uint time){if(window==IntPtr.Zero||kind==0x8002&&(objectId!=0||GetAncestor(window,2)!=window))return;uint owner;GetWindowThreadProcessId(window,out owner);events.Add(new EventRecord{pid=owner,kind=kind,at=time});}
 public static void Begin(){foreground=SetWinEventHook(3,3,IntPtr.Zero,callback,0,0,0);shown=SetWinEventHook(0x8002,0x8002,IntPtr.Zero,callback,0,0,0);if(foreground==IntPtr.Zero||shown==IntPtr.Zero)throw new Exception("WinEvent observer failed to install");}
 public static void Pump(){Msg message;while(PeekMessage(out message,IntPtr.Zero,0,0,1)){TranslateMessage(ref message);DispatchMessage(ref message);}}
 public static void End(){Pump();UnhookWinEvent(foreground);UnhookWinEvent(shown);}
}
'@
$samples=0;$last=-1;$changes=@();$visible=@();$deadline=(Get-Date).AddMinutes(25)
[WindowOwnerWatch]::Begin()
Set-Content -LiteralPath ${quote(readyFile)} -Value 'ready' -Encoding utf8
while(!(Test-Path -LiteralPath ${quote(stopFile)}) -and (Get-Date) -lt $deadline){
 [WindowOwnerWatch]::Pump()
 [uint32]$owner=0;[void][WindowOwnerWatch]::GetWindowThreadProcessId([WindowOwnerWatch]::GetForegroundWindow(),[ref]$owner)
 $samples++;if($owner -ne $last){$changes+=@{pid=$owner;at=(Get-Date).ToString('o')};$last=$owner}
 if(Test-Path -LiteralPath ${quote(ownedFile)}){$owned=Get-Content -LiteralPath ${quote(ownedFile)} -Raw|ConvertFrom-Json;if($owned.Count){$seen=@([WindowOwnerWatch]::VisibleOwned([int[]]$owned));if($seen.Count){$visible+=@{pids=$seen;at=(Get-Date).ToString('o')}}}}
 Start-Sleep -Milliseconds 40
}
[WindowOwnerWatch]::End()
@{samples=$samples;changes=$changes;winEvents=@([WindowOwnerWatch]::events.ToArray());winEventHooks=$true;visibleOwnedWindows=$visible;observedOnly=$true;windowTitlesRead=$false;osInputSent=$false}|ConvertTo-Json -Depth 6|Set-Content -LiteralPath ${quote(dataFile)} -Encoding utf8
`, 'utf8');
  const logFile=path.join(out,'foreground-observer.log'),logFd=fs.openSync(logFile,'a');
  const watcher = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, stdio: ['ignore',logFd,logFd] });
  fs.closeSync(logFd);
  for (let attempt = 0; !fs.existsSync(readyFile); attempt++) {
    if (attempt >= 100 || watcher.exitCode !== null) throw Error('Foreground observer did not become ready before launch');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const known = new Set();
  return {
    rememberBrowserPids(ids) {
      // IDs come from SystemInfo.getProcessInfo on this browser's own CDP session.
      for (const id of ids) if (Number.isSafeInteger(id) && id > 0) known.add(id);
      if (!known.size) throw Error('No test browser process identity; foreground proof unavailable');
      fs.writeFileSync(ownedFile, JSON.stringify([...known]));
    },
    rememberNativePid(pid) {
      if(!Number.isSafeInteger(pid)||pid<=0)throw Error('Invalid native process identity');
      known.add(pid);fs.writeFileSync(ownedFile,JSON.stringify([...known]));
    },
    async stop() {
      fs.writeFileSync(stopFile, 'stop');
      await Promise.race([
        new Promise(resolve => watcher.exitCode !== null ? resolve() : watcher.once('exit', resolve)),
        new Promise((_, reject) => setTimeout(() => reject(Error('Foreground observer did not finish')), 10000)),
      ]);
      if(watcher.exitCode!==0)throw Error('Foreground observer failed: '+fs.readFileSync(logFile,'utf8'));
      const observation = JSON.parse(fs.readFileSync(dataFile, 'utf8').replace(/^\uFEFF/, ''));
      const foregroundTestPids = observation.changes.filter(item => known.has(item.pid));
      const winEvents=(observation.winEvents||[]).flat(Infinity);
      if(winEvents.some(item=>!Number.isInteger(item.pid)||![3,0x8002].includes(item.kind)))throw Error('Invalid WinEvent observation schema');
      const ownedWinEvents=winEvents.filter(item=>known.has(item.pid));
      const result = { ...observation, testProcessPids: [...known], foregroundTestPids, ownedWinEvents, passed: observation.winEventHooks===true&&observation.samples > 0 && known.size > 0 && foregroundTestPids.length === 0 && !observation.visibleOwnedWindows?.length&&!ownedWinEvents.length };
      fs.writeFileSync(path.join(out, 'foreground-proof.json'), JSON.stringify(result, null, 2));
      return result;
    },
  };
};
