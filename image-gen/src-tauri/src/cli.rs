//! Minimal CLI trigger: a second launch with `--prompt` forwards a
//! generation request to the running instance through the
//! single-instance channel. This is how agents create *tracked*
//! batches instead of bypassing the library.

use crate::domain::Provider;
use crate::generation::CreateBatchInput;

#[derive(Debug, Clone, PartialEq)]
pub struct CliRequest {
    pub prompt: String,
    pub providers: Vec<Provider>,
    pub variant_count: u32,
}

impl CliRequest {
    pub fn into_input(self) -> CreateBatchInput {
        CreateBatchInput {
            prompt: self.prompt,
            providers: self.providers,
            variant_count: self.variant_count,
            reference_asset_ids: Vec::new(),
        }
    }
}

/// Parse `--prompt <text> [--providers openai,antigravity] [--variants N]`.
/// Returns `None` when no `--prompt` flag is present (a plain GUI launch).
pub fn parse(args: &[String]) -> Option<Result<CliRequest, String>> {
    if !args.iter().any(|a| a == "--prompt") {
        return None;
    }
    let mut prompt: Option<String> = None;
    let mut providers = vec![Provider::Openai];
    let mut variant_count = 1u32;

    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--prompt" => match iter.next() {
                Some(value) if !value.trim().is_empty() => prompt = Some(value.clone()),
                _ => return Some(Err("--prompt requires a non-empty value".into())),
            },
            "--providers" => {
                let Some(value) = iter.next() else {
                    return Some(Err("--providers requires a value".into()));
                };
                let mut parsed = Vec::new();
                for name in value.split(',').map(str::trim).filter(|s| !s.is_empty()) {
                    match Provider::parse(name) {
                        Some(p) if !parsed.contains(&p) => parsed.push(p),
                        Some(_) => {}
                        None => {
                            return Some(Err(format!(
                                "unknown provider '{name}' (use openai, antigravity)"
                            )))
                        }
                    }
                }
                if parsed.is_empty() {
                    return Some(Err("--providers requires at least one provider".into()));
                }
                providers = parsed;
            }
            "--variants" => {
                let Some(value) = iter.next() else {
                    return Some(Err("--variants requires a value".into()));
                };
                match value.parse::<u32>() {
                    Ok(n) if (1..=3).contains(&n) => variant_count = n,
                    _ => return Some(Err("--variants must be 1, 2, or 3".into())),
                }
            }
            _ => {}
        }
    }

    match prompt {
        Some(prompt) => Some(Ok(CliRequest {
            prompt,
            providers,
            variant_count,
        })),
        None => Some(Err("--prompt requires a value".into())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(args: &[&str]) -> Vec<String> {
        args.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn plain_gui_launch_is_not_a_request() {
        assert!(parse(&strings(&[])).is_none());
        assert!(parse(&strings(&["--some-flag"])).is_none());
    }

    #[test]
    fn full_request_parses() {
        let req = parse(&strings(&[
            "--prompt",
            "a red circle",
            "--providers",
            "openai,antigravity",
            "--variants",
            "2",
        ]))
        .unwrap()
        .unwrap();
        assert_eq!(req.prompt, "a red circle");
        assert_eq!(req.providers, vec![Provider::Openai, Provider::Antigravity]);
        assert_eq!(req.variant_count, 2);
    }

    #[test]
    fn defaults_are_openai_one_variant() {
        let req = parse(&strings(&["--prompt", "x"])).unwrap().unwrap();
        assert_eq!(req.providers, vec![Provider::Openai]);
        assert_eq!(req.variant_count, 1);
    }

    #[test]
    fn malformed_requests_error_instead_of_guessing() {
        assert!(parse(&strings(&["--prompt"])).unwrap().is_err());
        assert!(parse(&strings(&["--prompt", "x", "--variants", "9"]))
            .unwrap()
            .is_err());
        assert!(parse(&strings(&["--prompt", "x", "--providers", "gemini"]))
            .unwrap()
            .is_err());
        assert!(parse(&strings(&["--prompt", "x", "--providers", ""]))
            .unwrap()
            .is_err());
    }

    #[test]
    fn duplicate_providers_collapse() {
        let req = parse(&strings(&["--prompt", "x", "--providers", "openai,openai"]))
            .unwrap()
            .unwrap();
        assert_eq!(req.providers, vec![Provider::Openai]);
    }
}
