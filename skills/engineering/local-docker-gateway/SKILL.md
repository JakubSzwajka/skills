---
name: local-docker-gateway
description: Run many isolated local Docker Compose web application stacks on one machine without port conflicts. Use when starting, adapting, or troubleshooting Compose-based frontend/backend/database/cache stacks for local agents, when avoiding fixed host ports, when wiring browser-to-backend env vars, or when exposing a stack through the shared Caddy Docker Proxy gateway at project.localhost.
---

# Local Docker Gateway

Use one shared Caddy Docker Proxy gateway for the machine. Every app stack gets a unique Compose project name, keeps internal services on its own default network, and exposes browser-facing services through labels on the external `dev-ingress` network.

## Contract

- Run Compose with an explicit DNS-safe project name: `docker compose -p <project> ...`.
- Use lowercase letters, digits, and hyphens only. Avoid underscores because project names become hostnames.
- Do not set `container_name`.
- Do not publish fixed host `ports` for app, API, DB, cache, queue, or worker services.
- Use `expose` for container ports Caddy or sibling services need to reach.
- Attach only browser-facing services to external network `dev-ingress`.
- Keep DB/cache/queue services on the default Compose network only.
- Use Compose service DNS inside Docker: `db:5432`, `redis:6379`, `api:3000`.
- Use same-origin `/api` for browser-facing frontend-to-backend calls.
- Report the project name, URL, and stop command after starting a stack.

## Naming

Prefer:

```txt
<repo-slug>-<task-slug>-<short-id>
```

Examples:

```txt
career-auth-7f3a
portfolio-home-b21c
crm-leads-042
```

If no helper exists, generate a safe fallback:

```bash
repo="$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")"
repo="$(printf '%s' "$repo" | tr '[:upper:]_' '[:lower:]-' | sed 's/[^a-z0-9-]/-/g; s/-\{2,\}/-/g; s/^-//; s/-$//')"
project="${repo}-$(date +%H%M%S)"
docker compose -p "$project" up -d --build
printf 'URL: http://%s.localhost\n' "$project"
```

`-p` is preferred because it is explicit and also makes `${COMPOSE_PROJECT_NAME}` available during Compose interpolation in modern Docker Compose. If a repo wrapper exists, use it instead of inventing a new naming flow.

## Gateway

The singleton gateway should live outside app repos, for example:

```txt
~/DEV/infra/local-docker-gateway/compose.yaml
```

Create or update it only when the user asks to install or repair the machine-level gateway. Use this Compose file:

```yaml
services:
  caddy:
    image: lucaslorentz/caddy-docker-proxy:2.12.1-alpine
    ports:
      - "80:80"
      - "443:443/tcp"
      - "443:443/udp"
    environment:
      CADDY_INGRESS_NETWORKS: dev-ingress
    networks:
      - dev-ingress
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - caddy_data:/data
      - caddy_config:/config
    restart: unless-stopped

networks:
  dev-ingress:
    external: true

volumes:
  caddy_data:
  caddy_config:
```

Start it:

```bash
docker network inspect dev-ingress >/dev/null 2>&1 || docker network create dev-ingress
docker compose -p dev-gateway -f ~/DEV/infra/local-docker-gateway/compose.yaml up -d
```

Use `http://<project>.localhost` by default to avoid local HTTPS trust work. Switch to HTTPS only when the repo or user explicitly needs it.

## App Compose Pattern

Preferred minimal shape:

```yaml
services:
  frontend:
    build: ./frontend
    expose:
      - "5173"
    environment:
      VITE_API_BASE_URL: /api
    networks:
      - default
      - dev-ingress
    labels:
      caddy: "http://${COMPOSE_PROJECT_NAME}.localhost"
      caddy.reverse_proxy: "{{upstreams 5173}}"

  api:
    build: ./api
    expose:
      - "3000"
    environment:
      DATABASE_URL: postgres://postgres:postgres@db:5432/app
    depends_on:
      - db

  db:
    image: postgres:16
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    volumes:
      - pgdata:/var/lib/postgresql/data

networks:
  dev-ingress:
    external: true

volumes:
  pgdata:
```

This assumes the frontend dev/server process proxies `/api` to `http://api:3000` inside Docker. For Vite, Next, Remix, or similar frameworks, prefer the repo's existing proxy/runtime convention and make the browser env stay `/api`.

If the frontend cannot proxy `/api`, let Caddy route both frontend and API on the same hostname:

```yaml
services:
  frontend:
    build: ./frontend
    expose:
      - "5173"
    networks:
      - default
      - dev-ingress
    labels:
      caddy: "http://${COMPOSE_PROJECT_NAME}.localhost"
      caddy.route.1_handle: "*"
      caddy.route.1_handle.0_reverse_proxy: "{{upstreams 5173}}"

  api:
    build: ./api
    expose:
      - "3000"
    networks:
      - default
      - dev-ingress
    labels:
      caddy: "http://${COMPOSE_PROJECT_NAME}.localhost"
      caddy.route.0_handle_path: "/api/*"
      caddy.route.0_handle_path.0_reverse_proxy: "{{upstreams 3000}}"
```

Use `handle_path` when the backend expects routes without the `/api` prefix. Use `handle` instead when the backend routes already include `/api`.

## Env Rules

Do not use Docker container names in app env. Use service names.

Container-internal examples:

```env
DATABASE_URL=postgres://postgres:postgres@db:5432/app
REDIS_URL=redis://redis:6379
INTERNAL_API_URL=http://api:3000
```

Browser-facing examples:

```env
VITE_API_BASE_URL=/api
NEXT_PUBLIC_API_BASE_URL=/api
PUBLIC_API_BASE_URL=/api
PUBLIC_ORIGIN=http://${COMPOSE_PROJECT_NAME}.localhost
```

Browser code cannot reach `http://api:3000`; that DNS name only exists inside Docker.

## Startup Workflow

1. Read the repo's existing Docker docs and Compose files first.
2. Choose or generate a DNS-safe project name.
3. Ensure the shared gateway is running if the task needs browser access.
4. Adapt Compose to the contract with minimal changes.
5. Preview the final config:

```bash
docker compose -p "$project" config
```

6. Start the stack:

```bash
docker compose -p "$project" up -d --build
```

7. Verify:

```bash
docker compose -p "$project" ps
curl -I "http://$project.localhost"
```

Also curl a known health endpoint, such as `http://$project.localhost/api/health`, when the repo has one.

8. Report:

```txt
Project: <project>
URL: http://<project>.localhost
Stop: docker compose -p <project> down
```

Do not use `docker compose down -v` unless the user explicitly approves deleting stack data volumes.

## Troubleshooting

- If the browser cannot load the app, check `docker compose -p dev-gateway logs caddy`.
- If Caddy returns 502, the target service is usually not on `dev-ingress`, the exposed port is wrong, or the service is not listening on `0.0.0.0`.
- Inspect generated Caddy config:

```bash
docker exec "$(docker compose -p dev-gateway -f ~/DEV/infra/local-docker-gateway/compose.yaml ps -q caddy)" cat /config/caddy/Caddyfile.autosave
```

- If `${COMPOSE_PROJECT_NAME}` did not interpolate as expected, rerun with `docker compose -p "$project" config` and inspect labels.
- If a service truly needs direct host access for a debugger, prefer a random host port and discover it with `docker compose -p "$project" port <service> <container-port>`. Do not add fixed ports to shared templates.
- If multiple app stacks collide, look for fixed `ports`, `container_name`, hardcoded external volume names, or hardcoded external networks other than `dev-ingress`.
