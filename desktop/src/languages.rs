//! 界面语言代码(与 Node languages.js 对齐):v1.2.0 内置 zh/en,
//! 架构预留任意 2-3 位小写代码。语言包在 public/locales.json;这里只做防御性归一化。

pub const DEFAULT_LANG: &str = "zh";

fn lang_re() -> &'static regex::Regex {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"^[a-z]{2,3}$").unwrap())
}

pub fn normalize_lang(value: Option<&str>) -> String {
    let v = value.unwrap_or_default().trim().to_lowercase();
    if lang_re().is_match(&v) {
        v
    } else {
        DEFAULT_LANG.into()
    }
}
