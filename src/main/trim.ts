/**
 * Windows: hand a process's memory back to the system without ending it (EmptyWorkingSet, as Chrome's own
 * TrimOnFreeze does). Its pages go to Windows' standby list, compressed or written out only if the memory is
 * needed elsewhere, and come back by themselves as the process touches them: a frozen tab shown again carries
 * on exactly as it was, no reload. Only for processes whose every page is frozen (pidsToTrim): a running one
 * would only fault its memory straight back in. Uses koffi, like touchpad.ts.
 */
type Fn = (...args: unknown[]) => unknown
let api: { open: Fn; empty: Fn; close: Fn } | null | undefined

export function trimProcess(pid: number): boolean {
  if (process.platform !== 'win32' || pid <= 0) return false
  if (api === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const koffi = require('koffi')
      const k32 = koffi.load('kernel32.dll')
      api = {
        open: k32.func('void * __stdcall OpenProcess(uint32 access, int inherit, uint32 pid)'),
        empty: k32.func('int __stdcall K32EmptyWorkingSet(void *h)'),
        close: k32.func('int __stdcall CloseHandle(void *h)')
      }
    } catch {
      api = null
    }
  }
  if (!api) return false
  // PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SET_QUOTA: what EmptyWorkingSet needs
  const h = api.open(0x1000 | 0x0100, 0, pid)
  if (!h) return false
  try {
    return api.empty(h) !== 0
  } finally {
    api.close(h)
  }
}
