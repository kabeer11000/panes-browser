// Runs before the first paint. The window's colours, light or dark, and its scale are only worked out once the app has
// started and asked which space it is in, so until then the page would be the default dark one, then jump. This puts the
// last theme back at once: App.tsx saves it here (see the effect that sets the theme variables).
try {
  var boot = JSON.parse(localStorage.getItem('panes:boot') || 'null')
  if (boot && boot.vars && typeof boot.vars === 'object') {
    var root = document.documentElement
    for (var name in boot.vars) root.style.setProperty(name, String(boot.vars[name]))
    if (boot.scheme === 'dark' || boot.scheme === 'light') root.dataset.scheme = boot.scheme
  }
  // the effects mode main sets once the page has loaded (efficient mode has an opaque window and no layout animation)
  var fx = localStorage.getItem('panes:fx')
  if (fx === 'low' || fx === 'full') document.documentElement.dataset.fx = fx
} catch (e) {
  // no saved theme, or storage is not available: the app sets it as soon as it has started
}
