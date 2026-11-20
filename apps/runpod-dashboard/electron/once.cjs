// once(fn): a function that runs fn the first time it is called and never again. The main process uses it for the setup that may only happen once per process (custom protocols, IPC handlers,
// the core's timers): on macOS closing the window keeps the app running, and a click on the Dock icon runs boot() again; registering `podfile` twice threw "Failed to register protocol" and no window opened.
function once(fn) { let done = false, value; return (...args) => { if (!done) { done = true; value = fn(...args) } return value } }
module.exports = { once }
