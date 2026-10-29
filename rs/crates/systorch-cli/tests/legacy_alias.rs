use std::process::Command;

#[test]
fn legacy_command_has_the_same_parser_and_version_as_systorch() {
    for argument in ["--help", "--version"] {
        let current = Command::new(env!("CARGO_BIN_EXE_systorch-cli"))
            .arg(argument)
            .output()
            .expect("current CLI should start");
        let legacy = Command::new(env!("CARGO_BIN_EXE_jev-switch-cli"))
            .arg(argument)
            .output()
            .expect("legacy alias should start");
        assert!(current.status.success());
        assert!(legacy.status.success());
        // Clap correctly uses argv[0] in Usage. Only the invoked alias differs;
        // all commands, options and the advertised product/version must agree.
        let current_text = String::from_utf8(current.stdout).expect("UTF-8 help");
        let legacy_text = String::from_utf8(legacy.stdout).expect("UTF-8 help");
        assert_eq!(
            current_text,
            legacy_text.replace("jev-switch-cli", "systorch-cli")
        );
        assert!(current_text.contains("systorch-cli"));
    }
}
