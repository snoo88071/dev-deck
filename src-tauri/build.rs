fn main() {
    // The installer ships `devdeck` (the CLI the MCP server uses) as the sidecar
    // binaries/devdeck-cli-<target>.exe, copied there by tools/sidecar.mjs before
    // `tauri build`. tauri-build refuses to build without the file, so plain
    // `cargo build` and `cargo test` get an empty placeholder instead.
    let target = std::env::var("TARGET").unwrap_or_default();
    let ext = if target.contains("windows") { ".exe" } else { "" };
    let sidecar = std::path::PathBuf::from(format!("binaries/devdeck-cli-{target}{ext}"));
    if !sidecar.exists() {
        std::fs::create_dir_all("binaries").expect("binaries/");
        std::fs::write(&sidecar, b"").expect("sidecar placeholder");
    }
    tauri_build::build()
}
