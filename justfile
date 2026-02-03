# Mobius - Essential Commands
# For file finding/searching, use Claude's Glob/Grep tools instead

# Show available recipes
default:
    @just --list

# Build Rust binary (release mode)
build:
    cargo build -p mobius --release

# Build Rust binary (debug mode)
dev:
    cargo build -p mobius

# Type check (cargo check)
typecheck:
    cargo check -p mobius

# Run clippy linter
lint:
    cargo clippy -p mobius -- -D warnings

# Run all unit tests
test *args:
    cargo test -p mobius {{args}}

# Run tests matching a pattern
test-file pattern:
    cargo test -p mobius --lib "{{pattern}}"

# Run tests in watch mode (requires cargo-watch)
test-watch:
    cargo watch -x 'test -p mobius'

# Run mobius locally (development mode)
run *args:
    cargo run -p mobius -- {{args}}

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
    cargo check -p mobius && cargo test -p mobius && cargo build -p mobius --release

# Clean build artifacts
clean:
    cargo clean

# Generate workflow demo recording from VHS tape file
tape:
    cd assets/terminal/tapes && vhs workflow-demo.tape
