use std::env;
use std::fs;
use std::path::{Path, PathBuf};

const OPENCV_DLL: &str = "D:\\Document\\Work\\m_prooject\\opencv-4.12.0\\opencv\\build\\x64\\vc16\\bin\\opencv_world4120.dll";

fn main() {
    println!("cargo:rerun-if-changed={OPENCV_DLL}");
    copy_opencv_runtime();
    tauri_build::build()
}

fn copy_opencv_runtime() {
    let source = Path::new(OPENCV_DLL);
    if !source.exists() {
        panic!("OpenCV runtime not found at {}", source.display());
    }

    let out_dir = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR is not set"));
    let profile_dir = out_dir
        .ancestors()
        .nth(3)
        .expect("Unable to locate Cargo profile directory");
    for destination_dir in [profile_dir.to_path_buf(), profile_dir.join("deps")] {
        fs::create_dir_all(&destination_dir).expect("Unable to create Cargo output directory");
        fs::copy(source, destination_dir.join("opencv_world4120.dll"))
            .expect("Unable to copy OpenCV runtime");
    }
}
