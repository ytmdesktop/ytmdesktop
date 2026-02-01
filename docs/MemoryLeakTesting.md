# Memory Leak Testing Guide

This guide provides instructions for testing and validating the memory leak fixes implemented in the YouTube Music Desktop application.

## Prerequisites

1. **Chrome DevTools**: Electron apps use Chromium, so Chrome DevTools work perfectly for memory profiling
2. **Task Manager**: Use your OS task manager to monitor overall memory usage
3. **Development Build**: Run the app in development mode to see memory monitor logs

## Quick Start

### Enable Memory Monitoring

Memory monitoring is automatically enabled in development mode. To start the app:

```bash
npm start
```

The memory monitor will log memory usage every 60 seconds to the console and will alert you of potential memory leaks.

## Test 1: Heap Snapshot Comparison

**Objective**: Verify that repeated actions don't accumulate objects in memory

### Steps:

1. **Open Chrome DevTools**
   - In development mode, DevTools opens automatically
   - Or use the shortcut: `F12` (if enabled in settings)

2. **Take Baseline Snapshot**
   - Go to the "Memory" tab
   - Select "Heap snapshot"
   - Click "Take snapshot"
   - Label it "Baseline"

3. **Perform Actions**
   - Open and close the settings window 10 times
   - Play/pause music multiple times
   - Navigate between different pages in YouTube Music
   - Let it run for 5 minutes

4. **Take Second Snapshot**
   - Take another heap snapshot
   - Label it "After Actions"

5. **Compare Snapshots**
   - Select "Comparison" view
   - Compare "After Actions" with "Baseline"
   - Look for:
     - ✅ **GOOD**: Small number of detached DOM nodes (< 10)
     - ✅ **GOOD**: Event listeners count stable or slightly increased
     - ❌ **BAD**: Large number of detached DOM nodes (> 50)
     - ❌ **BAD**: Event listeners multiplying rapidly

### Success Criteria:
- Detached DOM nodes < 20
- No excessive event listeners
- Memory growth < 50MB for typical usage

## Test 2: Extended Run Test (1+ Hour)

**Objective**: Verify memory remains stable during extended use

### Steps:

1. **Start the Application**
   ```bash
   npm start
   ```

2. **Note Initial Memory**
   - Open Task Manager
   - Find "YouTube Music Desktop App" processes
   - Note the memory usage (should be around 100-200MB initially)

3. **Use Normally for 1 Hour**
   - Play music continuously
   - Interact with the app (change songs, playlists, settings)
   - Don't just let it sit idle

4. **Monitor Memory Growth**
   - Check memory every 15 minutes
   - Log the values
   - Memory monitor will automatically warn if issues detected

5. **Check Final Memory**
   - After 1 hour, note final memory usage
   - Calculate growth percentage

### Success Criteria:
- **✅ PASS**: Memory growth < 100MB (< 50% growth from baseline)
- **✅ PASS**: Memory stabilizes (not continuously growing)
- **❌ FAIL**: Memory grows > 200MB (> 100% growth)
- **❌ FAIL**: Memory continuously increases without leveling off

### Expected Behavior:
```
Initial: ~150MB
After 15min: ~180MB
After 30min: ~200MB
After 45min: ~210MB (starting to stabilize)
After 60min: ~215MB (stable)
```

## Test 3: Window Open/Close Stress Test

**Objective**: Verify settings window cleanup doesn't leak

### Steps:

1. **Start App in Development Mode**
   ```bash
   npm start
   ```

2. **Open Chrome DevTools Memory Tab**

3. **Take Baseline Snapshot**

4. **Stress Test Settings Window**
   - Open settings: Click settings button
   - Close settings: Click close button
   - Repeat 50 times rapidly

5. **Force Garbage Collection**
   - In DevTools console: Click the trash can icon (collect garbage)
   - Or if app started with `--expose-gc`:
     ```javascript
     window.gc()
     ```

6. **Take Final Snapshot**

7. **Compare Snapshots**
   - Look for BrowserWindow objects
   - Look for event listeners
   - Look for Vue component instances

### Success Criteria:
- No BrowserWindow objects retained (should be 1 - the main window)
- Event listeners properly cleaned up
- Vue components properly destroyed

## Test 4: Automated Memory Monitoring

The app includes an automated memory monitor that runs in development mode.

### View Memory Stats:

In DevTools console:
```javascript
// The memory monitor logs automatically every 60 seconds
// Look for logs like:
[Memory Monitor] Current Memory Usage:
  RSS: 234.56 MB
  Heap Used: 123.45 MB
  Heap Growth: +23.45 MB
```

### Warnings to Watch For:

1. **High Heap Growth**
   ```
   [Memory Monitor] ⚠️  Heap has grown by 75.3%
   ```

2. **Potential Memory Leak**
   ```
   [Memory Monitor] 🔴 Potential memory leak detected!
   ```

3. **High Memory Usage**
   ```
   [Memory Monitor] ⚠️  High memory usage: RSS = 567.89 MB
   ```

## Common Memory Leak Patterns (Now Fixed)

### ✅ Fixed: Vue Component Listeners
**Before**: IPC listeners added in `onMounted` but never removed
**After**: All listeners stored and removed in `onBeforeUnmount`

### ✅ Fixed: BrowserView Cleanup
**Before**: BrowserView recreated without cleaning up old one
**After**: Proper `cleanupYTMView()` function that removes listeners and destroys webContents

### ✅ Fixed: Intervals and Timeouts
**Before**: Multiple intervals/timeouts never cleared
**After**: CleanupRegistry tracks and clears all on app quit

### ✅ Fixed: PlayerStateStore Listener
**Before**: Listener added but never removed
**After**: Listener reference stored and removed on quit

### ✅ Fixed: Tray and Menu
**Before**: Tray/Menu not destroyed on quit
**After**: Proper `destroy()` calls in quit handler

## Troubleshooting

### Memory Still Growing?

1. **Check DevTools Console**: Look for uncaught errors or warnings
2. **Review Memory Monitor Logs**: Identify which phase shows growth
3. **Profile with Performance Tab**: See what's running constantly
4. **Check Third-Party Integrations**: Disable integrations one by one

### High Initial Memory?

This is normal for Electron apps. They typically use:
- Main Process: 50-100MB
- Renderer Process: 100-200MB
- GPU Process: 30-50MB
- **Total: 180-350MB** is normal at startup

### Memory Spikes During Music Playback?

Normal behavior - audio buffering can temporarily increase memory. Watch for:
- ✅ **OK**: Spikes that return to baseline
- ❌ **PROBLEM**: Spikes that never release

## Performance Benchmarks

### Expected Memory Usage:
- **Startup**: 150-250 MB
- **After 1 hour**: 200-350 MB
- **Peak**: < 500 MB

### Unacceptable Memory Usage:
- **> 500 MB** during normal use
- **> 1 GB** at any time
- **Continuous growth** without stabilization

## Reporting Issues

If you discover a memory leak:

1. **Collect Data**:
   - Heap snapshots (before and after)
   - Memory monitor logs
   - Steps to reproduce
   - System info (OS, RAM, Electron version)

2. **Create Issue** with:
   - Clear reproduction steps
   - Memory growth percentage
   - Time to reproduce
   - Screenshots of DevTools

## Cleanup Verification Checklist

Before marking testing complete, verify:

- [ ] No EventEmitter warnings in console
- [ ] Memory stable after 1+ hour use
- [ ] Window open/close doesn't accumulate memory
- [ ] All intervals cleared on quit
- [ ] All event listeners removed
- [ ] Heap snapshots show no retained objects
- [ ] Process memory < 500MB during normal use
- [ ] No continuous memory growth

## Conclusion

The comprehensive memory leak fixes include:
1. ✅ CleanupRegistry for centralized cleanup
2. ✅ Vue component lifecycle management
3. ✅ BrowserView proper disposal
4. ✅ Interval/Timeout tracking and cleanup
5. ✅ Event listener cleanup on quit
6. ✅ Tray/Menu destruction
7. ✅ PlayerStateStore listener cleanup
8. ✅ Automated memory monitoring

All critical memory leaks have been addressed. Run these tests to validate!








