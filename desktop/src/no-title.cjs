// Preloaded (`--require`) into every npm the app spawns. npm sets process.title ('npm install'); on macOS libuv
// registers a titled process with LaunchServices, so each run showed up as a bouncing "exec" tile in the Dock.
Object.defineProperty(process, 'title', { get: () => 'node', set() {}, configurable: true });
