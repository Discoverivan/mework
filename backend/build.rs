fn main() {
    println!("cargo:rerun-if-changed=icons");
    println!("cargo:rerun-if-changed=../public/mework-icon-original.png");
    tauri_build::build()
}
