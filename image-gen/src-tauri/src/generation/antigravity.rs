//! Google Antigravity adapter. Mirrors `generate.sh`: `agy -p` with the
//! built-in generative image tool, no Vertex AI, no API keys.

use super::adapter::{reference_section, CommandSpec, JobRequest, ProviderAdapter, CREDENTIAL_ENV_VARS};
use crate::domain::Provider;
use std::path::Path;

pub struct AntigravityAdapter;

impl ProviderAdapter for AntigravityAdapter {
    fn provider(&self) -> Provider {
        Provider::Antigravity
    }

    fn build_command(&self, executable: &Path, request: &JobRequest) -> CommandSpec {
        let prompt = format!(
            "Use Antigravity's built-in generative image tool powered by Nano Banana 2.\n\n\
             {refs}\
             Generate exactly one image from this request: {prompt}\n\n\
             Save the generated binary raster PNG to this exact path: {output}\n\n\
             Do not create SVG, HTML, CSS, Canvas, Mermaid, ASCII art, or a code-generated graphic.\n\
             Do not use an API key, Google Cloud, Vertex AI, an MCP server, or an external API.\n\
             If the built-in image tool is unavailable, report that clearly and do not substitute another method.\n\
             Do not change any other file. Stop after verifying that the PNG exists at that path.\n",
            refs = reference_section(&request.reference_files),
            prompt = request.prompt,
            output = request.output_path.display(),
        );
        CommandSpec {
            program: executable.to_path_buf(),
            args: vec![
                "-p".into(),
                prompt,
                "--print-timeout".into(),
                "10m".into(),
            ],
            stdin: None,
            cwd: request.workspace.clone(),
            env_remove: CREDENTIAL_ENV_VARS,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn command_matches_proven_invocation() {
        let request = JobRequest {
            prompt: "a blue square".into(),
            workspace: PathBuf::from("/tmp/ws"),
            output_path: PathBuf::from("/tmp/ws/output.png"),
            reference_files: vec![],
        };
        let spec = AntigravityAdapter.build_command(Path::new("/usr/local/bin/agy"), &request);
        assert_eq!(spec.args[0], "-p");
        assert!(spec.args[1].contains("a blue square"));
        assert!(spec.args[1].contains("Nano Banana 2"));
        assert!(spec.args[1].contains("Do not use an API key"));
        assert_eq!(spec.args[2], "--print-timeout");
        assert!(spec.stdin.is_none());
        assert!(spec.env_remove.contains(&"GEMINI_API_KEY"));
        assert!(spec.env_remove.contains(&"GOOGLE_GENAI_USE_VERTEXAI"));
    }
}
