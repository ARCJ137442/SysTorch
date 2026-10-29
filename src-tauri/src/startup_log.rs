//! Native window construction diagnostics only; stop before loading task UI.
use std::sync::atomic::{AtomicBool, Ordering};
struct StartupLog;
static LOGGER: StartupLog = StartupLog;
static COMPLETE: AtomicBool = AtomicBool::new(false);
impl log::Log for StartupLog {
    fn enabled(&self, metadata: &log::Metadata<'_>) -> bool {
        !COMPLETE.load(Ordering::Relaxed)
            && metadata.level() == log::Level::Error
            && metadata.target().starts_with("tauri_runtime_wry")
    }
    fn log(&self, record: &log::Record<'_>) {
        if self.enabled(record.metadata()) {
            eprintln!("native window initialization: {}", record.args());
        }
    }
    fn flush(&self) {}
}
pub fn init() {
    if log::set_logger(&LOGGER).is_ok() {
        log::set_max_level(log::LevelFilter::Error);
    }
}
pub fn complete() {
    COMPLETE.store(true, Ordering::Relaxed);
}
