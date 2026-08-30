#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./generate.sh openai "image description" [output.png]
  ./generate.sh antigravity "image description" [output.png]

The old form still defaults to OpenAI:
  ./generate.sh "image description" [output.png]

Both providers use consumer subscription login. API-key and Google Cloud
credential variables are removed from the provider process.

Optional environment variable:
  CODEX_IMAGE_MODEL   Codex model to run. Default: gpt-5.6-sol
EOF
}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is not installed"
}

run_openai() {
  local request=$1
  local model=${CODEX_IMAGE_MODEL:-gpt-5.6-sol}

  require_command codex
  env \
    -u OPENAI_API_KEY \
    -u CODEX_API_KEY \
    -u CODEX_ACCESS_TOKEN \
    codex login status 2>&1 | grep -q "Logged in using ChatGPT" || \
    fail "Codex is not using ChatGPT subscription auth. Run: codex login"

  printf '%s\n' "$request" | \
    env \
      -u OPENAI_API_KEY \
      -u CODEX_API_KEY \
      -u CODEX_ACCESS_TOKEN \
      codex exec \
        -c 'model_provider="openai"' \
        --model "$model" \
        --enable image_generation \
        --sandbox workspace-write \
        --cd "$output_dir" \
        --skip-git-repo-check \
        -
}

run_antigravity() {
  local request=$1

  require_command agy

  (
    cd -- "$output_dir"
    env \
      -u GEMINI_API_KEY \
      -u GOOGLE_API_KEY \
      -u GOOGLE_APPLICATION_CREDENTIALS \
      -u GOOGLE_CLOUD_PROJECT \
      -u GOOGLE_CLOUD_LOCATION \
      -u GOOGLE_CLOUD_QUOTA_PROJECT \
      -u GCLOUD_PROJECT \
      -u CLOUDSDK_CORE_PROJECT \
      -u GOOGLE_GENAI_USE_VERTEXAI \
      -u GOOGLE_GENAI_USE_GCA \
      agy -p "$request" --print-timeout 10m
  )
}

if [[ ${1:-} == "-h" || ${1:-} == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -lt 1 || -z ${1:-} ]]; then
  usage >&2
  exit 2
fi

case $1 in
  openai | antigravity)
    provider=$1
    shift
    ;;
  *)
    provider=openai
    ;;
esac

if [[ $# -lt 1 || -z ${1:-} ]]; then
  usage >&2
  exit 2
fi

prompt=$1
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
default_name="$provider-$(date +%Y%m%d-%H%M%S).png"
output=${2:-"$script_dir/output/$default_name"}
output=$(python3 -c 'import os, sys; print(os.path.abspath(sys.argv[1]))' "$output")
output_dir=$(dirname -- "$output")
mkdir -p -- "$output_dir"

case $provider in
  openai)
    request=$(printf '%s\n' \
      "Use the built-in \$imagegen capability." \
      'Do not use the Images API, an SDK, a fallback script, or any API key.' \
      '' \
      "Generate exactly one image from this request: $prompt" \
      '' \
      "Copy the generated PNG to this exact path: $output" \
      '' \
      'Do not change any other file. Stop after verifying that the PNG exists at that path.')
    run_openai "$request"
    ;;
  antigravity)
    request=$(printf '%s\n' \
      "Use Antigravity's built-in generative image tool powered by Nano Banana 2." \
      '' \
      "Generate exactly one image from this request: $prompt" \
      '' \
      "Save the generated binary raster PNG to this exact path: $output" \
      '' \
      'Do not create SVG, HTML, CSS, Canvas, Mermaid, ASCII art, or a code-generated graphic.' \
      'Do not use an API key, Google Cloud, Vertex AI, an MCP server, or an external API.' \
      'If the built-in image tool is unavailable, report that clearly and do not substitute another method.' \
      'Do not change any other file. Stop after verifying that the PNG exists at that path.')
    run_antigravity "$request"
    ;;
esac

if [[ ! -s $output ]]; then
  fail "$provider finished without creating $output"
fi

file "$output"
printf 'Saved with %s: %s\n' "$provider" "$output"
