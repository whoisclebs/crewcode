//! The server the interface talks to, called the core.
//!
//! A release binary carries the core inside itself, compressed, and unpacks it once into the user's cache
//! directory. Development builds find it next to the binary, through `CREWCODE_CORE_BIN`, or fall back to
//! running the TypeScript sources with Bun.

use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

/// A core compiled into the binary.
pub struct Core {
    pub compressed: &'static [u8],
    /// Identifies the content, so a new release unpacks next to the old one.
    pub key: &'static str,
    /// Size once unpacked.
    pub size: u64,
}

include!(concat!(env!("OUT_DIR"), "/core_embedded.rs"));

const FILE_NAME: &str = if cfg!(windows) {
    "crewcode-core.exe"
} else {
    "crewcode-core"
};

/// How to start the core.
pub enum Launch {
    /// A standalone executable.
    Executable(PathBuf),
    /// The TypeScript sources, run with Bun (development only).
    Sources(PathBuf),
}

/// Where the core lives in the cache, for content identified by `key`.
fn cache_path(cache: &Path, key: &str) -> PathBuf {
    cache.join(format!("core-{key}")).join(FILE_NAME)
}

fn cache_root() -> Option<PathBuf> {
    let var = |name: &str| std::env::var_os(name).map(PathBuf::from);
    if cfg!(windows) {
        return var("LOCALAPPDATA").map(|dir| dir.join("crewcode").join("cache"));
    }
    if cfg!(target_os = "macos") {
        return var("HOME").map(|home| home.join("Library").join("Caches").join("crewcode"));
    }
    var("XDG_CACHE_HOME")
        .or_else(|| var("HOME").map(|home| home.join(".cache")))
        .map(|dir| dir.join("crewcode"))
}

/// Unpacks `compressed` to `target` unless a file of the right size is already there.
fn unpack(compressed: &[u8], size: u64, target: &Path) -> io::Result<()> {
    if fs::metadata(target).is_ok_and(|m| m.len() == size) {
        return Ok(());
    }
    let directory = target
        .parent()
        .ok_or_else(|| io::Error::other("the cache path has no directory"))?;
    fs::create_dir_all(directory)?;
    // Written under another name and renamed, so a second instance starting at the same time never runs a half-written file.
    let partial = directory.join(format!("{FILE_NAME}.{}.partial", std::process::id()));
    let mut decoder = flate2::read::GzDecoder::new(compressed);
    let mut unpacked = Vec::with_capacity(size as usize);
    decoder.read_to_end(&mut unpacked)?;
    let mut file = fs::File::create(&partial)?;
    file.write_all(&unpacked)?;
    file.sync_all()?;
    drop(file);
    make_executable(&partial)?;
    fs::rename(&partial, target)
}

#[cfg(unix)]
fn make_executable(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o755))
}

#[cfg(not(unix))]
fn make_executable(_path: &Path) -> io::Result<()> {
    Ok(())
}

/// Removes cached cores of other releases, which nothing runs any more.
fn remove_stale(cache: &Path, keep: &str) {
    let Ok(entries) = fs::read_dir(cache) else {
        return;
    };
    let keep = format!("core-{keep}");
    entries
        .flatten()
        .filter(|entry| {
            entry.file_name().to_string_lossy().starts_with("core-")
                && entry.file_name().to_string_lossy() != keep
        })
        .for_each(|entry| drop(fs::remove_dir_all(entry.path())));
}

/// Finds or unpacks the core.
pub fn locate() -> io::Result<Launch> {
    if let Some(path) = std::env::var_os("CREWCODE_CORE_BIN") {
        return Ok(Launch::Executable(PathBuf::from(path)));
    }
    if let Some(core) = &EMBEDDED {
        let cache = cache_root()
            .ok_or_else(|| io::Error::other("cannot find a cache directory: set HOME"))?;
        let target = cache_path(&cache, core.key);
        unpack(core.compressed, core.size, &target)?;
        remove_stale(&cache, core.key);
        return Ok(Launch::Executable(target));
    }
    let beside = std::env::current_exe()?.with_file_name(FILE_NAME);
    if beside.is_file() {
        return Ok(Launch::Executable(beside));
    }
    let sources = std::env::var_os("CREWCODE_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../crewcode"))
        .join("src/index.ts");
    if sources.is_file() {
        return Ok(Launch::Sources(sources));
    }
    Err(io::Error::other(
        "cannot find the CrewCode server: this build has no embedded core and none is installed next to it",
    ))
}

/// The command that starts the core with `args`.
pub fn command(launch: &Launch, args: &[String]) -> std::process::Command {
    match launch {
        Launch::Executable(path) => {
            let mut command = std::process::Command::new(path);
            command.args(args);
            command
        }
        Launch::Sources(entry) => {
            let mut command = std::process::Command::new("bun");
            command.arg("run").arg(entry).args(args);
            command
        }
    }
}

/// Runs the core with `args` in place of this process and returns its exit code, for `crewcode run` and the like.
pub fn passthrough(args: &[String]) -> io::Result<i32> {
    let launch = locate()?;
    let mut command = command(&launch, args);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // On success this never returns: the core takes over the process, signals and all.
        Err(command.exec())
    }
    #[cfg(not(unix))]
    {
        Ok(command.status()?.code().unwrap_or(1))
    }
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use flate2::Compression;
    use flate2::write::GzEncoder;

    use super::*;

    fn gzip(bytes: &[u8]) -> Vec<u8> {
        let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
        encoder.write_all(bytes).unwrap();
        encoder.finish().unwrap()
    }

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("crewcode-core-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn a_core_is_unpacked_once_and_left_alone_after() {
        let root = scratch("unpack");
        let target = cache_path(&root, "abc-5");
        unpack(&gzip(b"hello"), 5, &target).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"hello");
        fs::write(&target, b"world").unwrap();
        unpack(&gzip(b"hello"), 5, &target).unwrap();
        assert_eq!(
            fs::read(&target).unwrap(),
            b"world",
            "a file of the right size is trusted"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn the_unpacked_core_can_be_run() {
        use std::os::unix::fs::PermissionsExt;
        let root = scratch("mode");
        let target = cache_path(&root, "k-1");
        unpack(&gzip(b"x"), 1, &target).unwrap();
        assert_eq!(
            fs::metadata(&target).unwrap().permissions().mode() & 0o111,
            0o111
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cores_of_other_releases_are_removed_and_the_current_one_kept() {
        let root = scratch("stale");
        for key in ["old-1", "new-2"] {
            unpack(&gzip(b"x"), 1, &cache_path(&root, key)).unwrap();
        }
        remove_stale(&root, "new-2");
        assert!(cache_path(&root, "new-2").is_file());
        assert!(!cache_path(&root, "old-1").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_core_can_be_started_from_sources_or_an_executable() {
        let executable = command(
            &Launch::Executable(PathBuf::from("/bin/core")),
            &["serve".to_owned()],
        );
        assert_eq!(executable.get_program(), "/bin/core");
        let sources = command(
            &Launch::Sources(PathBuf::from("/repo/src/index.ts")),
            &["serve".to_owned()],
        );
        assert_eq!(sources.get_program(), "bun");
        assert_eq!(sources.get_args().count(), 3);
    }
}
