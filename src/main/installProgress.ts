import { spawn } from 'child_process'

/**
 * While the installer works in silent mode there is no window at all: Panes is gone and, a few seconds
 * later, back. Say what is happening in between. A small separate process (it outlives Panes) shows a
 * message with a moving bar, and closes itself as soon as a Panes newer than itself is running again, or
 * after two minutes whatever happens.
 */
const SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
$start = Get-Date
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Panes'
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.ControlBox = $false
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.ClientSize = New-Object System.Drawing.Size(360, 96)
$label = New-Object System.Windows.Forms.Label
$label.Text = 'Updating Panes. It opens again by itself.'
$label.AutoSize = $true
$label.Location = New-Object System.Drawing.Point(20, 18)
$bar = New-Object System.Windows.Forms.ProgressBar
$bar.Style = 'Marquee'
$bar.Location = New-Object System.Drawing.Point(20, 52)
$bar.Size = New-Object System.Drawing.Size(320, 18)
$form.Controls.Add($label)
$form.Controls.Add($bar)
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 700
$timer.Add_Tick({
  $elapsed = ((Get-Date) - $start).TotalSeconds
  $fresh = Get-Process -Name Panes -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -gt $start }
  if ($elapsed -gt 120 -or ($elapsed -gt 3 -and $fresh)) { $form.Close() }
})
$timer.Start()
[void]$form.ShowDialog()
`

export function showInstallProgress(): void {
  try {
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64')
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
      { detached: true, stdio: 'ignore', windowsHide: false }
    )
    child.on('error', () => undefined)
    child.unref()
  } catch {
    // no progress window: the update still installs
  }
}
