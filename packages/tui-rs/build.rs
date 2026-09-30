//! Embeds the compiled server into the binary when the `embed-core` feature is on.

use std::env;
use std::fs;
use std::io::Write;
use std::path::PathBuf;

use flate2::Compression;
use flate2::write::GzEncoder;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=CREWCODE_CORE_BIN");
    let out = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR is set by cargo"));
    let generated = out.join("core_embedded.rs");

    if env::var_os("CARGO_FEATURE_EMBED_CORE").is_none() {
        fs::write(generated, "pub static EMBEDDED: Option<Core> = None;\n")
            .expect("write core_embedded.rs");
        return;
    }

    let source = env::var_os("CREWCODE_CORE_BIN")
        .map(PathBuf::from)
        .expect("the embed-core feature needs CREWCODE_CORE_BIN to point at the compiled server");
    println!("cargo:rerun-if-changed={}", source.display());
    let core =
        fs::read(&source).unwrap_or_else(|e| panic!("cannot read {}: {e}", source.display()));

    let mut crc = flate2::Crc::new();
    crc.update(&core);
    let key = format!("{:08x}-{}", crc.sum(), core.len());

    let mut encoder = GzEncoder::new(Vec::new(), Compression::new(9));
    encoder.write_all(&core).expect("compress the core");
    let compressed = encoder.finish().expect("finish compressing the core");
    fs::write(out.join("core.gz"), compressed).expect("write core.gz");

    fs::write(
        generated,
        format!(
            "pub static EMBEDDED: Option<Core> = Some(Core {{ compressed: include_bytes!(concat!(env!(\"OUT_DIR\"), \"/core.gz\")), key: \"{key}\", size: {} }});\n",
            core.len()
        ),
    )
    .expect("write core_embedded.rs");
}
