# Starts Panes as a weak PC would see it: N cores, a RAM ceiling for the whole process tree, below-normal priority.
#   pwsh scripts/launch-lowend.ps1 [-Exe <Panes.exe>] [-Port 9333] [-Cores 2] [-RamMB 2048] [-UserData <dir>]
# The launcher puts itself in a job object (memory cap) and sets its CPU affinity, then starts Panes, so every
# Chromium child inherits both. Pair with scripts/perf-report.ts / perf-load.ts / perf-lowend.ts on the same port.
param(
  [string]$Exe = "$env:LOCALAPPDATA\Programs\Panes\Panes.exe",
  [int]$Port = 9333,
  [int]$Cores = 2,
  [int]$RamMB = 2048,
  [string]$UserData = "$env:TEMP\panes-perf-lowend",
  # e.g. '--enable-low-end-device-mode' (Chromium's own low-memory mode), '--disable-gpu'
  [string[]]$ExtraArgs = @()
)
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class Job {
  [StructLayout(LayoutKind.Sequential)] struct BASIC { public long a; public long b; public uint LimitFlags; public UIntPtr min; public UIntPtr max; public uint active; public UIntPtr aff; public uint prio; public uint sched; }
  [StructLayout(LayoutKind.Sequential)] struct IO { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct EXT { public BASIC Basic; public IO Io; public UIntPtr ProcessMem; public UIntPtr JobMem; public UIntPtr PeakProc; public UIntPtr PeakJob; }
  [DllImport("kernel32.dll")] static extern IntPtr CreateJobObject(IntPtr a, string n);
  [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr j, int c, ref EXT i, int len);
  [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
  public static bool CapSelf(ulong bytes) {
    IntPtr j = CreateJobObject(IntPtr.Zero, null);
    EXT e = new EXT(); e.Basic.LimitFlags = 0x200; /* JOB_OBJECT_LIMIT_JOB_MEMORY */ e.JobMem = (UIntPtr)bytes;
    if (!SetInformationJobObject(j, 9, ref e, Marshal.SizeOf(e))) return false;
    return AssignProcessToJobObject(j, System.Diagnostics.Process.GetCurrentProcess().Handle);
  }
}
'@
if (-not [Job]::CapSelf([uint64]$RamMB * 1MB)) { throw 'could not create the memory-capped job' }
(Get-Process -Id $PID).ProcessorAffinity = [IntPtr]((1 -shl $Cores) - 1)
Remove-Item $UserData -Recurse -Force -ErrorAction SilentlyContinue
$env:PANES_USERDATA = $UserData; $env:PANES_TRACE_STARTUP = '1'
$p = Start-Process $Exe -ArgumentList (@("--remote-debugging-port=$Port", '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding') + $ExtraArgs) -PassThru -RedirectStandardOutput "$UserData.out.log" -RedirectStandardError "$UserData.err.log"
$p.PriorityClass = 'BelowNormal'
"started pid $($p.Id): $Cores cores, $RamMB MB cap, userdata $UserData"
