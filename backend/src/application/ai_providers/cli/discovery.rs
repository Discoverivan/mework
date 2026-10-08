use super::{claude_code, codex, hermes_cli, opencode, pi, usable_cli_path};
use crate::application::ai::AiProviderId;
use std::{
    env,
    path::{Path, PathBuf},
};

pub(super) const PROVIDERS: [AiProviderId; 5] = [
    AiProviderId::CodexCli,
    AiProviderId::ClaudeCodeCli,
    AiProviderId::HermesCli,
    AiProviderId::PiCli,
    AiProviderId::OpenCodeCli,
];

#[derive(Default)]
pub(super) struct CliInstallationPaths {
    pub priority: Vec<(&'static str, PathBuf)>,
    pub additional: Vec<(&'static str, PathBuf)>,
}

impl CliInstallationPaths {
    fn additional(paths: Vec<(&'static str, PathBuf)>) -> Self {
        Self {
            additional: paths,
            ..Self::default()
        }
    }
}

struct CliSpecification {
    override_key: &'static str,
    names: &'static [&'static str],
    installations: CliInstallationPaths,
}

fn specification(provider: AiProviderId) -> CliSpecification {
    let (override_key, names, installations) = match provider {
        AiProviderId::CodexCli => {
            let paths = codex::install_paths(
                dirs::home_dir(),
                dirs::data_local_dir(),
                dirs::home_dir(),
                cfg!(windows),
            );
            #[cfg(windows)]
            let paths = paths
                .into_iter()
                .chain(codex::windows_install_paths())
                .collect::<Vec<_>>();
            (
                "MEWORK_CODEX_CLI_BIN",
                codex::executable_names(cfg!(windows)),
                CliInstallationPaths::additional(
                    paths
                        .into_iter()
                        .map(|path| ("codex-install", path))
                        .collect(),
                ),
            )
        }
        AiProviderId::ClaudeCodeCli => (
            "MEWORK_CLAUDE_CODE_CLI_BIN",
            claude_code::executable_names(),
            CliInstallationPaths::additional(claude_code::diagnostic_install_paths()),
        ),
        AiProviderId::HermesCli => (
            "MEWORK_HERMES_CLI_BIN",
            hermes_cli::executable_names(),
            CliInstallationPaths::additional(hermes_cli::diagnostic_install_paths()),
        ),
        AiProviderId::PiCli => (
            "MEWORK_PI_CLI_BIN",
            pi::executable_names(),
            pi::installation_paths(),
        ),
        AiProviderId::OpenCodeCli => (
            "MEWORK_OPENCODE_CLI_BIN",
            opencode::executable_names(),
            CliInstallationPaths::additional(opencode::diagnostic_install_paths()),
        ),
        _ => unreachable!("only local CLI providers have executable candidates"),
    };
    CliSpecification {
        override_key,
        names,
        installations,
    }
}

fn standard_candidates(provider: AiProviderId) -> Vec<(String, PathBuf)> {
    let specification = specification(provider);
    standard_candidates_for(
        &specification,
        dirs::home_dir(),
        dirs::config_dir(),
        cfg!(windows),
    )
}

fn standard_candidates_for(
    specification: &CliSpecification,
    home: Option<PathBuf>,
    config: Option<PathBuf>,
    windows: bool,
) -> Vec<(String, PathBuf)> {
    let override_key = specification.override_key;
    let names = specification.names;
    let installations = &specification.installations;
    let mut paths = Vec::new();
    if let Some(path) = env::var_os(override_key) {
        paths.push((override_key.to_owned(), PathBuf::from(path)));
    }
    if let Some(path) = env::var_os("PATH") {
        for (index, directory) in env::split_paths(&path).enumerate() {
            append_directory(&mut paths, &format!("PATH[{index}]"), &directory, names);
        }
    }
    paths.extend(
        installations
            .priority
            .iter()
            .map(|(source, path)| ((*source).to_owned(), path.clone())),
    );
    if let Some(home) = home {
        append_directory(&mut paths, "user-local", &home.join(".local/bin"), names);
        if !windows {
            append_directory(&mut paths, "user-npm", &home.join(".npm-global/bin"), names);
        }
    }
    if windows {
        if let Some(config) = config {
            append_directory(&mut paths, "user-npm", &config.join("npm"), names);
        }
    }
    if !windows {
        for directory in ["/opt/homebrew/bin", "/usr/local/bin"] {
            append_directory(&mut paths, "system-bin", Path::new(directory), names);
        }
    }
    // Keep installer-specific locations, but apply the same search stages to every CLI.
    paths.extend(
        installations
            .additional
            .iter()
            .map(|(source, path)| ((*source).to_owned(), path.clone())),
    );
    deduplicate(paths)
}

fn append_directory(
    paths: &mut Vec<(String, PathBuf)>,
    source: &str,
    directory: &Path,
    names: &[&str],
) {
    paths.extend(
        names
            .iter()
            .map(|name| (format!("{source}/{name}"), directory.join(name))),
    );
}

fn deduplicate(paths: Vec<(String, PathBuf)>) -> Vec<(String, PathBuf)> {
    let mut seen = std::collections::HashSet::new();
    paths
        .into_iter()
        .filter(|(_, path)| seen.insert(path.clone()))
        .collect()
}

fn fnm_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(root) = env::var_os("FNM_DIR") {
        roots.push(PathBuf::from(root));
    }
    for root in [dirs::data_dir(), dirs::data_local_dir(), dirs::config_dir()]
        .into_iter()
        .flatten()
    {
        roots.push(root.join("fnm"));
    }
    if let Some(home) = dirs::home_dir() {
        roots.extend([home.join(".fnm"), home.join(".local/share/fnm")]);
    }
    // Preserve the explicit root's priority while removing conventional duplicates.
    let mut seen = std::collections::HashSet::new();
    roots.retain(|root| seen.insert(root.clone()));
    roots
}

fn fnm_candidates(roots: &[PathBuf], names: &[&str]) -> Vec<(String, PathBuf)> {
    let mut paths = Vec::new();
    for root in roots {
        let Ok(entries) = std::fs::read_dir(root.join("node-versions")) else {
            continue;
        };
        let mut versions = entries
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let name = entry.file_name();
                let name = name.to_str()?.strip_prefix('v')?;
                let parts = name
                    .split('.')
                    .map(str::parse::<u64>)
                    .collect::<Result<Vec<_>, _>>()
                    .ok()?;
                (parts.len() == 3 && entry.path().is_dir()).then_some((parts, entry.path()))
            })
            .collect::<Vec<_>>();
        versions.sort_by(|a, b| b.0.cmp(&a.0));
        for (_, version) in versions {
            let installation = version.join("installation");
            let directory = if cfg!(windows) {
                installation
            } else {
                installation.join("bin")
            };
            append_directory(&mut paths, "fnm", &directory, names);
        }
    }
    deduplicate(paths)
}

pub(super) fn fnm_node_directory() -> Option<PathBuf> {
    let roots = fnm_roots();
    let name = if cfg!(windows) { "node.exe" } else { "node" };
    // GUI processes can predate installer PATH updates and shell fnm activation.
    // Respect fnm's default alias before falling back to an installed runtime.
    roots
        .iter()
        .map(|root| {
            let alias = root.join("aliases/default");
            if cfg!(windows) {
                alias
            } else {
                alias.join("bin")
            }
        })
        .chain(
            fnm_candidates(&roots, &[name])
                .into_iter()
                .filter_map(|(_, path)| path.parent().map(Path::to_path_buf)),
        )
        .find(|directory| usable_cli_path(&directory.join(name)).is_some())
}

pub(super) fn resolve_binary(provider: AiProviderId) -> Option<PathBuf> {
    standard_candidates(provider)
        .into_iter()
        .find_map(|(_, path)| usable_cli_path(&path))
        .or_else(|| {
            fnm_candidates(&fnm_roots(), specification(provider).names)
                .into_iter()
                .find_map(|(_, path)| usable_cli_path(&path))
        })
}

pub(super) fn candidates(provider: AiProviderId) -> Vec<(String, PathBuf)> {
    let mut paths = standard_candidates(provider);
    paths.extend(fnm_candidates(&fnm_roots(), specification(provider).names));
    deduplicate(paths)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_and_executes_priority_installation_before_common_paths() {
        let root = tempfile::tempdir().unwrap();
        let names: &'static [&'static str] = if cfg!(windows) {
            &["example-cli.cmd"]
        } else {
            &["example-cli"]
        };
        let name = names[0];
        let priority = root.path().join("managed/bin").join(name);
        let common = root.path().join(".local/bin").join(name);
        for (path, output) in [(&priority, "managed-version"), (&common, "common-version")] {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            #[cfg(windows)]
            std::fs::write(path, format!("@echo off\necho {output}\n")).unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::write(path, format!("#!/bin/sh\necho {output}\n")).unwrap();
                std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
        }
        let specification = CliSpecification {
            override_key: "MEWORK_EXAMPLE_CLI_BIN",
            names,
            installations: CliInstallationPaths {
                priority: vec![("managed-install", priority)],
                ..CliInstallationPaths::default()
            },
        };
        let resolved = standard_candidates_for(
            &specification,
            Some(root.path().to_path_buf()),
            None,
            cfg!(windows),
        )
        .into_iter()
        .find_map(|(_, path)| usable_cli_path(&path))
        .unwrap();
        let output = super::super::local_cli_command(resolved).output().unwrap();
        assert!(output.status.success());
        assert_eq!(
            String::from_utf8(output.stdout).unwrap().trim(),
            "managed-version"
        );
    }

    #[test]
    fn finds_and_executes_a_cli_from_fnm_with_its_runtime() {
        let root = tempfile::tempdir().unwrap();
        let installation = root.path().join("node-versions/v24.1.0/installation");
        let directory = if cfg!(windows) {
            installation
        } else {
            installation.join("bin")
        };
        std::fs::create_dir_all(&directory).unwrap();
        let name = if cfg!(windows) {
            "example.cmd"
        } else {
            "example"
        };
        let binary = directory.join(name);
        #[cfg(windows)]
        std::fs::write(&binary, "@echo off\nnode.cmd\n").unwrap();
        #[cfg(windows)]
        std::fs::write(
            directory.join("node.cmd"),
            "@echo off\necho example-version\n",
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::write(&binary, "#!/usr/bin/env node\n").unwrap();
            let node = directory.join("node");
            std::fs::write(&node, "#!/bin/sh\necho example-version\n").unwrap();
            for path in [&binary, &node] {
                std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
        }
        let resolved = fnm_candidates(&[root.path().to_path_buf()], &[name])
            .into_iter()
            .find_map(|(_, path)| usable_cli_path(&path))
            .unwrap();
        let output = super::super::local_cli_command(resolved).output().unwrap();
        assert!(output.status.success());
        assert_eq!(
            String::from_utf8(output.stdout).unwrap().trim(),
            "example-version"
        );
    }
}
