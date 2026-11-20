fn main() {
    println!("cargo:rerun-if-changed=icons");
    println!("cargo:rerun-if-changed=../public/mework-icon-original.png");
    println!("cargo:rerun-if-changed=../public/mework-icon-dev.png");
    println!("cargo:rerun-if-changed=../public/mework-icon-dev-original.png");
    tauri_build::build()
}
