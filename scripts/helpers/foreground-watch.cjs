// Observes window ownership only. Never activates a window or sends OS input.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

exports.startForegroundWatch = async function (out, profile) {
  const stopFile = path.join(out, 'foreground-watch.stop');
  const dataFile = path.join(out, 'foreground-watch.json');
  const readyFile = path.join(out, 'foreground-watch.ready');
  const ownedFile = path.join(out, 'foreground-owned-pids.json');
  const ownedAck = path.join(out, 'foreground-owned-ack.json');
  const script = path.join(out, 'foreground-watch.ps1');
  for(const file of [stopFile,dataFile,readyFile,ownedFile,ownedAck,script])if(fs.existsSync(file))throw Error('Observer requires a fresh evidence directory: '+file);
  fs.mkdirSync(path.join(out,'tmp'),{recursive:true});
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
 public class EventRecord {public uint pid;public uint kind;public uint at;public uint root;}
 public static int[] roots=new int[0];
 public static System.Collections.Generic.List<EventRecord> events=new System.Collections.Generic.List<EventRecord>();
 public delegate void WinEvent(IntPtr hook,uint kind,IntPtr window,int objectId,int childId,uint thread,uint time);
 [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min,uint max,IntPtr module,WinEvent callback,uint process,uint thread,uint flags);
 [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
 [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window,uint flags);
 [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 [StructLayout(LayoutKind.Sequential)] struct BasicProcess {public IntPtr reserved1,peb,reserved2a,reserved2b,pid,parent;}
 [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr handle,int type,ref BasicProcess info,int length,out int returned);
 public static uint FamilyRoot(uint owner){var seen=new System.Collections.Generic.HashSet<uint>();for(var depth=0;owner!=0&&depth<32&&seen.Add(owner);depth++){if(Array.IndexOf(roots,(int)owner)>=0)return owner;var handle=OpenProcess(0x1000,false,owner);if(handle==IntPtr.Zero)return 0;var info=new BasicProcess();int returned;var status=NtQueryInformationProcess(handle,0,ref info,Marshal.SizeOf(typeof(BasicProcess)),out returned);CloseHandle(handle);if(status!=0)return 0;owner=(uint)info.parent.ToInt64();}return 0;}
 [StructLayout(LayoutKind.Sequential)] public struct Msg {public IntPtr window;public uint message;public UIntPtr wParam;public IntPtr lParam;public uint time;public int x;public int y;public uint privateField;}
 [DllImport("user32.dll")] static extern bool PeekMessage(out Msg message,IntPtr window,uint min,uint max,uint flags);
 [DllImport("user32.dll")] static extern bool TranslateMessage(ref Msg message);
 [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref Msg message);
 static IntPtr foreground,shown;static WinEvent callback=Observe;
 static void Observe(IntPtr hook,uint kind,IntPtr window,int objectId,int childId,uint thread,uint time){if(window==IntPtr.Zero||kind==0x8002&&(objectId!=0||GetAncestor(window,2)!=window))return;uint owner;GetWindowThreadProcessId(window,out owner);events.Add(new EventRecord{pid=owner,kind=kind,at=time,root=FamilyRoot(owner)});}
 public static void Begin(){foreground=SetWinEventHook(3,3,IntPtr.Zero,callback,0,0,0);shown=SetWinEventHook(0x8002,0x8002,IntPtr.Zero,callback,0,0,0);if(foreground==IntPtr.Zero||shown==IntPtr.Zero)throw new Exception("WinEvent observer failed to install");}
 public static void Pump(){Msg message;while(PeekMessage(out message,IntPtr.Zero,0,0,1)){TranslateMessage(ref message);DispatchMessage(ref message);}}
 public static void End(){Pump();UnhookWinEvent(foreground);UnhookWinEvent(shown);}
}
'@
$samples=0;$last=-1;$changes=@();$visible=@();$deadline=(Get-Date).AddMinutes(25);$ownedText=''
[WindowOwnerWatch]::Begin()
Set-Content -LiteralPath ${quote(readyFile)} -Value 'ready' -Encoding utf8
while(!(Test-Path -LiteralPath ${quote(stopFile)}) -and (Get-Date) -lt $deadline){
 [WindowOwnerWatch]::Pump()
 [uint32]$owner=0;[void][WindowOwnerWatch]::GetWindowThreadProcessId([WindowOwnerWatch]::GetForegroundWindow(),[ref]$owner)
 $samples++;if($owner -ne $last){$changes+=@{pid=$owner;at=(Get-Date).ToString('o')};$last=$owner}
 if(Test-Path -LiteralPath ${quote(ownedFile)}){try{$newText=Get-Content -LiteralPath ${quote(ownedFile)} -Raw;if($newText -ne $ownedText){$owned=$newText|ConvertFrom-Json;[WindowOwnerWatch]::roots=[int[]]$owned;$ownedText=$newText;Set-Content -LiteralPath ${quote(ownedAck)} -Value $newText -Encoding utf8};if($owned.Count){$seen=@([WindowOwnerWatch]::VisibleOwned([int[]]$owned));if($seen.Count){$visible+=@{pids=$seen;at=(Get-Date).ToString('o')}}}}catch{if($_.Exception -isnot [System.ArgumentException]){throw}}}
 Start-Sleep -Milliseconds 40
}
[WindowOwnerWatch]::End()
@{samples=$samples;changes=$changes;winEvents=@([WindowOwnerWatch]::events.ToArray());winEventHooks=$true;stoppedByRequest=(Test-Path -LiteralPath ${quote(stopFile)});completedAt=(Get-Date).ToString('o');visibleOwnedWindows=$visible;observedOnly=$true;windowTitlesRead=$false;osInputSent=$false}|ConvertTo-Json -Depth 6|Set-Content -LiteralPath ${quote(dataFile)} -Encoding utf8
`, 'utf8');
  const logFile=path.join(out,'foreground-observer.log'),logFd=fs.openSync(logFile,'a');
  const watcher = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, stdio: ['ignore',logFd,logFd],env:{...process.env,TEMP:path.join(out,'tmp'),TMP:path.join(out,'tmp'),TMPDIR:path.join(out,'tmp')} });
  fs.closeSync(logFd);
  try{for (let attempt = 0; !fs.existsSync(readyFile); attempt++) {
    if (attempt >= 100 || watcher.exitCode !== null) throw Error('Foreground observer did not become ready before launch');
    await new Promise(resolve => setTimeout(resolve, 100));
  }}catch(error){fs.writeFileSync(stopFile,'startup failed');if(watcher.exitCode===null)watcher.kill();throw error;}
  const known = new Set([watcher.pid]);
  const acknowledge=async()=>{fs.writeFileSync(ownedFile+'.new',JSON.stringify([...known]));fs.renameSync(ownedFile+'.new',ownedFile);for(let attempt=0;attempt<100;attempt++){if(watcher.exitCode!==null)throw Error('Observer exited before ownership ACK');if(fs.existsSync(ownedAck)){try{const value=JSON.parse(fs.readFileSync(ownedAck,'utf8').replace(/^\uFEFF/,''));if([...known].every(pid=>value.includes(pid)))return;}catch{}}await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Observer ownership ACK unavailable');};
  return {
    async rememberBrowserPids(ids) {
      // IDs come from SystemInfo.getProcessInfo on this browser's own CDP session.
      for (const id of ids) if (Number.isSafeInteger(id) && id > 0) known.add(id);
      if (!known.size) throw Error('No test browser process identity; foreground proof unavailable');
      await acknowledge();
    },
    async rememberNativePid(pid) {
      if(!Number.isSafeInteger(pid)||pid<=0)throw Error('Invalid native process identity');
      known.add(pid);await acknowledge();
    },
    async stop() {
      const aliveAtStop=watcher.exitCode===null&&watcher.signalCode===null;
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
      const ownedWinEvents=winEvents.filter(item=>known.has(item.pid)||item.root>0);
      const result = { ...observation, testProcessPids: [...known], foregroundTestPids, ownedWinEvents,aliveAtControlledStop:aliveAtStop, passed: aliveAtStop&&observation.stoppedByRequest===true&&observation.winEventHooks===true&&observation.samples > 0 && known.size > 0 && foregroundTestPids.length === 0 && !observation.visibleOwnedWindows?.length&&!ownedWinEvents.length };
      fs.writeFileSync(path.join(out, 'foreground-proof.json'), JSON.stringify(result, null, 2));
      return result;
    },
  };
};
