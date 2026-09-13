# Pi configuration

This directory holds portable Pi configuration that is versioned with the shared agent setup.

`~/.pi/agent/settings.json`, `keybindings.json`, and `devports.json` are symlinks to files here. `settings.json` loads `extensions/`, `prompts/`, and `themes/` directly from this directory, so those resources need no second symlink.

`../install.sh` creates the configuration links, validates JSON, and refuses to replace a path it does not already manage.

Keep machine state out of this directory: `auth.json`, `trust.json`, sessions, caches, installed packages, and tool-managed extensions remain in `~/.pi/agent/`.

Pi discovers `~/.agents/skills/` directly. Do not add a second Pi skill mirror here.

`extensions/module-graph/` carries its own `package.json` and vendors `three` plus `typescript`. Its `node_modules/` is ignored, so run `npm install` inside that directory on a new machine before the `/module-graph:*` commands work.

`extensions/blocks-connector/` is global code with directory-local configuration. It reads
`.env` and `agent-card.json` from Pi's trusted current working directory, so separate agent
directories can run separate Blocks identities without copying the extension. Each working
directory also links `handler.js` to the extension's CLI-required placeholder.
