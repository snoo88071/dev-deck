//! The app's language: the Windows display language when Dev Deck has it, English
//! otherwise. The panel and the session descriptions both use it, so they agree.

/// The languages the panel is translated into.
pub const SUPPORTED: [&str; 5] = ["en", "it", "es", "fr", "pt"];

/// From a BCP 47 tag ("it-IT", "pt-BR", "de") to one of `SUPPORTED`.
pub fn resolve(tag: Option<&str>) -> &'static str {
    let primary = tag.unwrap_or("").split(['-', '_']).next().unwrap_or("").to_ascii_lowercase();
    SUPPORTED.iter().find(|l| **l == primary).copied().unwrap_or("en")
}

/// `DEVDECK_LANG` wins (for tests and for anyone who wants it), then the system.
pub fn app_language() -> &'static str {
    match std::env::var("DEVDECK_LANG") {
        Ok(v) if !v.trim().is_empty() => resolve(Some(v.trim())),
        _ => resolve(sys_locale::get_locale().as_deref()),
    }
}

/// The language's name in English, for the `claude -p` prompt.
pub fn english_name(code: &str) -> &'static str {
    match code {
        "it" => "Italian",
        "es" => "Spanish",
        "fr" => "French",
        "pt" => "Brazilian Portuguese",
        _ => "English",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_translated_language_is_kept_anything_else_is_english() {
        assert_eq!(resolve(Some("it-IT")), "it");
        assert_eq!(resolve(Some("pt_BR")), "pt");
        assert_eq!(resolve(Some("FR")), "fr");
        assert_eq!(resolve(Some("de-DE")), "en");
        assert_eq!(resolve(Some("")), "en");
        assert_eq!(resolve(None), "en");
    }
}
