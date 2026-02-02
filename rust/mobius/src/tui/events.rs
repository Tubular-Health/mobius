use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;

use crossterm::event::{self, Event, KeyEvent};

/// Events that the TUI event loop processes.
#[derive(Debug)]
pub enum TuiEvent {
    /// Keyboard input event
    Key(KeyEvent),
    /// The runtime state file changed on disk
    StateFileChanged,
    /// 1-second tick for elapsed time updates
    Tick,
}

/// Manages the three event sources: keyboard, file watcher, and tick timer.
pub struct EventHandler {
    rx: mpsc::Receiver<TuiEvent>,
    _keyboard_handle: std::thread::JoinHandle<()>,
    _tick_handle: std::thread::JoinHandle<()>,
    _watcher: Option<notify::RecommendedWatcher>,
}

impl EventHandler {
    /// Create a new event handler that watches the given runtime state file path.
    pub fn new(runtime_state_path: Option<PathBuf>) -> Self {
        let (tx, rx) = mpsc::channel();

        // Keyboard event thread
        let tx_key = tx.clone();
        let keyboard_handle = std::thread::spawn(move || {
            loop {
                if event::poll(Duration::from_millis(100)).unwrap_or(false) {
                    if let Ok(Event::Key(key)) = event::read() {
                        if tx_key.send(TuiEvent::Key(key)).is_err() {
                            break;
                        }
                    }
                }
            }
        });

        // Tick timer thread (1 second interval)
        let tx_tick = tx.clone();
        let tick_handle = std::thread::spawn(move || {
            loop {
                std::thread::sleep(Duration::from_secs(1));
                if tx_tick.send(TuiEvent::Tick).is_err() {
                    break;
                }
            }
        });

        // File watcher for runtime state
        let watcher = runtime_state_path.and_then(|path| {
            use notify::{Watcher, RecursiveMode, Config};
            let tx_watch = tx.clone();
            let mut watcher = notify::RecommendedWatcher::new(
                move |res: Result<notify::Event, notify::Error>| {
                    if let Ok(event) = res {
                        if event.kind.is_modify() || event.kind.is_create() {
                            let _ = tx_watch.send(TuiEvent::StateFileChanged);
                        }
                    }
                },
                Config::default(),
            ).ok()?;

            // Watch the parent directory to catch file creation
            if let Some(parent) = path.parent() {
                let _ = watcher.watch(parent, RecursiveMode::NonRecursive);
            }
            Some(watcher)
        });

        Self {
            rx,
            _keyboard_handle: keyboard_handle,
            _tick_handle: tick_handle,
            _watcher: watcher,
        }
    }

    /// Try to receive the next event, blocking up to the given timeout.
    pub fn next(&self, timeout: Duration) -> Option<TuiEvent> {
        self.rx.recv_timeout(timeout).ok()
    }
}
