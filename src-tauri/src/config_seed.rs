//! Normalize the maintained template before adding a local-preview listener.
//! A UTF-8 BOM is valid only at byte zero, never after an inserted TOML key.
pub fn text(template: &str) -> String {
    let template = template.trim_start_matches('\u{feff}');
    if cfg!(feature = "m1-preview") {
        format!("bind = \"127.0.0.1:11436\"\n{template}")
    } else {
        template.to_string()
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn prefixed_template_never_embeds_a_bom_in_the_middle_of_toml() {
        let seeded = super::text("\u{feff}# template\n[providers]\n");
        assert!(!seeded.contains('\u{feff}'));
        assert!(seeded.contains("[providers]"));
        if cfg!(feature = "m1-preview") {
            assert!(seeded.starts_with("bind = \"127.0.0.1:11436\"\n# template"));
        }
    }
}
