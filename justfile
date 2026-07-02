default:
    @just --list

up:
    docker compose up -d --build --remove-orphans

down:
    docker compose down --remove-orphans

devup:
    docker compose -f compose.dev.yml up -d --build --remove-orphans

devdown:
    docker compose -f compose.dev.yml down --remove-orphans

publish:
    test -z "$$(git status --porcelain)" || (echo "Refusing to publish from dirty worktree" >&2; exit 1)
    npm run ci
    npm publish --access public
