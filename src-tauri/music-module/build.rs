use std::path::Path;
fn main() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let lib = root.parent().expect("music-module inside src-tauri").join("libmpv");
    println!("cargo:rustc-link-search=native={}", lib.display());
}
