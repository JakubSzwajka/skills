//! OpenAI Codex adapter. Mirrors the proven `generate.sh` invocation:
//! `codex exec` with subscription auth and the built-in image tool.

use super::adapter::{reference_section, CommandSpec, JobRequest, ProviderAdapter, CREDENTIAL_ENV_VARS};
use crate::domain::Provider;
use std::path::Path;

pub const DEFAULT_MODEL: &str = "gpt-5.6-sol";

pub struct OpenAiAdapter;

impl ProviderAdapter for OpenAiAdapter {
    fn provider(&self) -> Provider {
        Provider::Openai
    }

    fn build_command(&self, executable: &Path, request: &JobRequest) -> CommandSpec {
        let prompt = format!(
            "Use the built-in $imagegen capability.\n\
             Do not use the Images API, an SDK, a fallback script, or any API key.\n\n\
             {refs}\
             Generate exactly one image from this request: {prompt}\n\n\
             Copy the generated PNG to this exact path: {output}\n\n\
             Do not change any other file. Stop after verifying that the PNG exists at that path.\n",
            refs = reference_section(&request.reference_files),
            prompt = request.prompt,
            output = request.output_path.display(),
        );
        CommandSpec {
            program: executable.to_path_buf(),
            args: vec![
                "exec".into(),
                "-c".into(),
                "model_provider=\"openai\"".into(),
                "--model".into(),
                DEFAULT_MODEL.into(),
                "--enable".into(),
                "image_generation".into(),
                "--sandbox".into(),
                "workspace-write".into(),
                "--cd".into(),
                request.workspace.display().to_string(),
                "--skip-git-repo-check".into(),
                "-".into(),
            ],
            stdin: Some(prompt),
            cwd: request.workspace.clone(),
            env_remove: CREDENTIAL_ENV_VARS,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn request() -> JobRequest {
        JobRequest {
            prompt: "a red circle".into(),
            workspace: PathBuf::from("/tmp/ws"),
            output_path: PathBuf::from("/tmp/ws/output.png"),
            reference_files: vec![PathBuf::from("/tmp/ws/ref-1.png")],
        }
    }

    #[test]
    fn command_matches_proven_invocation() {
        let spec = OpenAiAdapter.build_command(Path::new("/opt/homebrew/bin/codex"), &request());
        assert_eq!(spec.program, Path::new("/opt/homebrew/bin/codex"));
        assert_eq!(spec.args[0], "exec");
        assert!(spec.args.contains(&"image_generation".to_string()));
        assert!(spec.args.contains(&"workspace-write".to_string()));
        assert!(spec.args.contains(&"--skip-git-repo-check".to_string()));
        assert_eq!(spec.args.last().map(String::as_str), Some("-"));
        let stdin = spec.stdin.unwrap();
        assert!(stdin.contains("a red circle"));
        assert!(stdin.contains("/tmp/ws/output.png"));
        assert!(stdin.contains("ref-1.png"));
        assert!(stdin.contains("Do not use the Images API"));
    }

    #[test]
    fn credential_variables_are_removed() {
        let spec = OpenAiAdapter.build_command(Path::new("/x/codex"), &request());
        assert!(spec.env_remove.contains(&"OPENAI_API_KEY"));
        assert!(spec.env_remove.contains(&"GOOGLE_APPLICATION_CREDENTIALS"));
    }
}
