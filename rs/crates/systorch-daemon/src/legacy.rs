// Compatibility executable for existing Jev Switch scripts and containers.
fn main() -> anyhow::Result<()> {
    systorch_daemon::startup::run()
}
