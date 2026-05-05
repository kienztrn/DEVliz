import { spawn } from 'node:child_process'
import { writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

const PS_SCRIPT = `param(
  [int]$TargetPid,
  [string]$Aumid,
  [string]$Ico,
  [int]$DurationSec = 90
)

$ErrorActionPreference = 'Continue'

$cs = @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Diagnostics;
using System.Collections.Generic;

public class WinIdent {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr LoadImage(IntPtr hinst, string lpszName, uint uType, int cxDesired, int cyDesired, uint fuLoad);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount);
    [DllImport("shell32.dll")] public static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore ppv);

    [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPropertyStore {
        void GetCount(out uint cProps);
        void GetAt(uint iProp, out PropertyKey pkey);
        void GetValue([In] ref PropertyKey key, [In, Out] PropVariant pv);
        void SetValue([In] ref PropertyKey key, [In] PropVariant pv);
        void Commit();
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PropertyKey {
        public Guid fmtid; public int pid;
        public PropertyKey(Guid g, int p) { fmtid = g; pid = p; }
    }

    [StructLayout(LayoutKind.Explicit, Size=24)]
    public class PropVariant {
        [FieldOffset(0)] public ushort vt;
        [FieldOffset(8)] public IntPtr ptr;
        public PropVariant() {}
        public PropVariant(string s) { vt = 31; ptr = Marshal.StringToCoTaskMemUni(s); }
    }

    static HashSet<IntPtr> Touched = new HashSet<IntPtr>();
    static IntPtr HIconBig = IntPtr.Zero;
    static IntPtr HIconSmall = IntPtr.Zero;
    static string TargetAumid = "";

    public static List<IntPtr> FindWindowsForPid(uint targetPid) {
        var list = new List<IntPtr>();
        EnumWindows((h, l) => {
            uint pid; GetWindowThreadProcessId(h, out pid);
            if (pid != targetPid) return true;
            if (!IsWindowVisible(h)) return true;
            if (GetWindow(h, 4) != IntPtr.Zero) return true;
            if (GetWindowTextLength(h) == 0) return true;
            var sb = new System.Text.StringBuilder(256);
            GetClassName(h, sb, sb.Capacity);
            var cls = sb.ToString();
            if (cls != "Chrome_WidgetWin_1" && cls != "Chrome_WidgetWin_0") return true;
            list.Add(h);
            return true;
        }, IntPtr.Zero);
        return list;
    }

    public static void ApplyToWindow(IntPtr hwnd) {
        if (Touched.Contains(hwnd)) return;
        try {
            var iidPropertyStore = new Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99");
            var pkAumid = new PropertyKey(new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), 5);
            IPropertyStore store;
            int hr = SHGetPropertyStoreForWindow(hwnd, ref iidPropertyStore, out store);
            if (hr == 0 && store != null) {
                var pv = new PropVariant(TargetAumid);
                store.SetValue(ref pkAumid, pv);
                store.Commit();
                Marshal.FinalReleaseComObject(store);
            }
        } catch {}
        try {
            if (HIconSmall != IntPtr.Zero) SendMessage(hwnd, 0x0080, IntPtr.Zero, HIconSmall);
            if (HIconBig != IntPtr.Zero) SendMessage(hwnd, 0x0080, (IntPtr)1, HIconBig);
        } catch {}
        Touched.Add(hwnd);
    }

    public static void Run(int pid, string aumid, string ico, int durationSec) {
        TargetAumid = aumid;
        try { HIconBig = LoadImage(IntPtr.Zero, ico, 1, 32, 32, 0x0010); } catch {}
        try { HIconSmall = LoadImage(IntPtr.Zero, ico, 1, 16, 16, 0x0010); } catch {}

        var deadline = DateTime.Now.AddSeconds(durationSec);
        while (DateTime.Now < deadline) {
            try {
                var p = Process.GetProcessById(pid);
                if (p.HasExited) return;
            } catch { return; }
            var wnds = FindWindowsForPid((uint)pid);
            foreach (var w in wnds) ApplyToWindow(w);
            Thread.Sleep(750);
        }
    }
}
'@

try {
  Add-Type -TypeDefinition $cs -ErrorAction Stop
} catch {
  # type already loaded in this powershell session is fine
}

[WinIdent]::Run($TargetPid, $Aumid, $Ico, $DurationSec)
`

let scriptPath: string | null = null
function ensureScript(): string {
  if (scriptPath && existsSync(scriptPath)) return scriptPath
  const dir = app.getPath('userData')
  const p = join(dir, 'set-window-identity.ps1')
  try {
    writeFileSync(p, PS_SCRIPT, 'utf8')
    scriptPath = p
    return p
  } catch {
    return p
  }
}

export function applyWindowIdentity(pid: number, aumid: string, icoPath: string): void {
  if (process.platform !== 'win32') return
  if (!pid || !aumid || !icoPath) return
  if (!existsSync(icoPath)) return
  try {
    const ps = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        ensureScript(),
        '-TargetPid',
        String(pid),
        '-Aumid',
        aumid,
        '-Ico',
        icoPath,
      ],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      },
    )
    ps.unref()
  } catch {
    // best effort
  }
}

export function aumidForProfile(profileId: string): string {
  const safe = profileId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32) || 'profile'
  return `DEVliz.MultiBrowser.${safe}`
}
