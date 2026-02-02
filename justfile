# Mobius - Essential Commands
# For file finding/searching, use Claude's Glob/Grep tools instead

# Show available recipes
default:
    @just --list

# TypeScript build (compile to dist/)
build:
    npm run build

# Watch mode for development
dev:
    npm run dev

# TypeScript type check
typecheck:
    npm run typecheck

# Run Biome linter
lint:
    npm run lint

# Run all unit tests
test *args:
    bun test {{args}}

# Run tests matching a pattern
test-file pattern:
    bun test "{{pattern}}"

# Run tests in watch mode
test-watch:
    bun test --watch

# Run mobius locally (development mode)
run *args:
    bun src/bin/mobius.ts {{args}}

# Run mobius loop on a Linear issue
loop task-id *args:
    ./scripts/mobius.sh {{task-id}} {{args}}

# Run mobius loop locally (bypass sandbox)
loop-local task-id *args:
    ./scripts/mobius.sh {{task-id}} --local {{args}}

# Show mobius configuration
config:
    ./scripts/mobius.sh --config

# Full validation (typecheck + test + build)
validate:
    npm run typecheck && bun test && npm run build

# Clean build artifacts
clean:
    npm run clean

# Install dependencies
deps:
    bun install

# Lint commit messages (useful for debugging commitlint issues)
lint-commit msg:
    echo "{{msg}}" | bunx commitlint

# Generate workflow demo recording from VHS tape file
tape:
    cd assets/terminal/tapes && vhs workflow-demo.tape
