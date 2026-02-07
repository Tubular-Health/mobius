#!/bin/bash
# Mobius Installation Script
#
# Downloads a pre-compiled Rust binary from GitHub Releases and sets up configuration.
#
# Usage:
#   ./install.sh              # Install latest version to ~/.local/bin
#   ./install.sh --uninstall  # Remove installation (binary, skills, config)
#   ./install.sh --help       # Show help
#
# Environment Variables:
#   MOBIUS_VERSION       Override version to install (e.g., v1.7.0)
#   MOBIUS_INSTALL_DIR   Override install directory (default: ~/.local/bin)
#   XDG_CONFIG_HOME      Override config directory (default: ~/.config)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${MOBIUS_INSTALL_DIR:-$HOME/.local/bin}"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/mobius"
GITHUB_REPO="Tubular-Health/mobius"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info() { echo -e "${BLUE}[info]${NC} $1"; }
success() { echo -e "${GREEN}[done]${NC} $1"; }
warn() { echo -e "${YELLOW}[warn]${NC} $1"; }
error() { echo -e "${RED}[error]${NC} $1"; }

# HTTP client helper: prefers curl, falls back to wget
download() {
    local url="$1"
    local output="$2"

    if command -v curl &> /dev/null; then
        curl -fsSL "$url" -o "$output"
    elif command -v wget &> /dev/null; then
        wget -qO "$output" "$url"
    else
        error "Neither curl nor wget found. Please install one and retry."
        exit 1
    fi
}

# Download to stdout (for API requests)
download_stdout() {
    local url="$1"

    if command -v curl &> /dev/null; then
        curl -fsSL "$url"
    elif command -v wget &> /dev/null; then
        wget -qO- "$url"
    else
        error "Neither curl nor wget found. Please install one and retry."
        exit 1
    fi
}

detect_os() {
    local os
    os="$(uname -s)"
    case "$os" in
        Linux)  echo "unknown-linux-gnu" ;;
        Darwin) echo "apple-darwin" ;;
        *)
            error "Unsupported operating system: $os. Mobius supports Linux and macOS."
            exit 1
            ;;
    esac
}

detect_arch() {
    local arch
    arch="$(uname -m)"
    case "$arch" in
        x86_64|amd64)   echo "x86_64" ;;
        aarch64|arm64)   echo "aarch64" ;;
        *)
            error "Unsupported architecture: $arch. Mobius supports x86_64 and aarch64."
            exit 1
            ;;
    esac
}

check_dependencies() {
    local runtime="$1"

    info "Checking dependencies..."

    # Check runtime-specific CLI
    case "$runtime" in
        claude)
            if ! command -v claude &> /dev/null; then
                warn "Claude CLI not found. Install it from: https://claude.ai/code"
                warn "Current runtime is set to 'claude' (default)."
            else
                success "Claude CLI found: $(which claude)"
            fi
            ;;
        opencode)
            if ! command -v opencode &> /dev/null; then
                warn "OpenCode CLI not found."
                warn "Current runtime is set to 'opencode'. Install OpenCode CLI and ensure it is in PATH."
            else
                success "OpenCode CLI found: $(which opencode)"
            fi
            ;;
    esac

    # Check for cclean (optional but recommended)
    if ! command -v cclean &> /dev/null; then
        warn "cclean not found. Output formatting may be limited."
        warn "Consider installing cclean for better output."
    fi

    # Check for Docker (optional for sandbox mode)
    if ! command -v docker &> /dev/null; then
        info "Docker not found. Sandbox mode will be unavailable."
    fi
}

resolve_selected_runtime() {
    local runtime="claude"

    if [ -n "${MOBIUS_RUNTIME:-}" ]; then
        case "${MOBIUS_RUNTIME,,}" in
            claude|opencode)
                runtime="${MOBIUS_RUNTIME,,}"
                ;;
            *)
                warn "Ignoring invalid MOBIUS_RUNTIME='${MOBIUS_RUNTIME}'. Using 'claude'."
                ;;
        esac
        echo "$runtime"
        return
    fi

    if [ -f "$CONFIG_DIR/config.yaml" ]; then
        local configured_runtime
        configured_runtime="$(grep -E '^[[:space:]]*runtime:[[:space:]]*(claude|opencode)[[:space:]]*$' "$CONFIG_DIR/config.yaml" | sed -E 's/^[[:space:]]*runtime:[[:space:]]*([a-zA-Z0-9_-]+)[[:space:]]*$/\1/' | sed -n '1p')"

        if [ -n "$configured_runtime" ]; then
            runtime="$configured_runtime"
        fi
    fi

    echo "$runtime"
}

check_npm_conflict() {
    if command -v mobius &> /dev/null; then
        local mobius_path
        mobius_path="$(command -v mobius)"
        if [[ "$mobius_path" == *"node_modules"* ]]; then
            warn "Found npm-installed mobius at: $mobius_path"
            warn "Consider running: npm uninstall -g mobius-ai"
        fi
    fi
}

resolve_version() {
    if [ -n "${MOBIUS_VERSION:-}" ]; then
        echo "$MOBIUS_VERSION"
        return
    fi

    info "Fetching latest release version..." >&2
    local api_url="https://api.github.com/repos/${GITHUB_REPO}/releases/latest"
    local response
    response="$(download_stdout "$api_url" 2>/dev/null)" || {
        error "Failed to fetch latest release from GitHub."
        error "Check your network connection or visit https://github.com/${GITHUB_REPO}/releases"
        exit 1
    }

    local tag
    tag="$(echo "$response" | grep '"tag_name"' | sed -E 's/.*"tag_name":\s*"([^"]+)".*/\1/')"
    if [ -z "$tag" ]; then
        error "Could not determine latest version from GitHub API response."
        error "Visit https://github.com/${GITHUB_REPO}/releases to find the version manually,"
        error "then run: MOBIUS_VERSION=v1.x.x ./install.sh"
        exit 1
    fi

    echo "$tag"
}

verify_checksum() {
    local tarball="$1"
    local checksums_file="$2"
    local tarball_name
    tarball_name="$(basename "$tarball")"

    local expected
    expected="$(grep "$tarball_name" "$checksums_file" 2>/dev/null)" || {
        error "Checksum entry not found for $tarball_name in checksums.txt"
        exit 1
    }

    info "Verifying SHA256 checksum..."
    local checksum_ok
    if command -v sha256sum &> /dev/null; then
        # Linux
        echo "$expected" | (cd "$(dirname "$tarball")" && sha256sum -c - > /dev/null 2>&1) && checksum_ok=true || checksum_ok=false
    elif command -v shasum &> /dev/null; then
        # macOS
        echo "$expected" | (cd "$(dirname "$tarball")" && shasum -a 256 -c - > /dev/null 2>&1) && checksum_ok=true || checksum_ok=false
    else
        error "Neither sha256sum nor shasum found. Cannot verify checksum."
        exit 1
    fi

    if [ "$checksum_ok" = true ]; then
        success "Checksum verified"
    else
        error "Checksum verification failed for $tarball_name"
        error "The downloaded file may be corrupted or tampered with."
        exit 1
    fi
}

install_command() {
    local target_os target_arch target tag
    target_os="$(detect_os)"
    target_arch="$(detect_arch)"
    target="${target_arch}-${target_os}"

    info "Detected platform: $target"

    tag="$(resolve_version)"
    info "Installing mobius $tag for $target..."

    local tarball_name="mobius-${target}.tar.gz"
    local base_url="https://github.com/${GITHUB_REPO}/releases/download/${tag}"
    local tarball_url="${base_url}/${tarball_name}"
    local checksums_url="${base_url}/checksums.txt"

    # Create a temporary directory for downloads
    local tmpdir
    tmpdir="$(mktemp -d)"
    trap "rm -rf '$tmpdir'" EXIT

    # Download tarball
    info "Downloading $tarball_name..."
    download "$tarball_url" "$tmpdir/$tarball_name" || {
        error "Failed to download binary for $target from release $tag."
        error "Binary not found for ${target} in release ${tag}. This platform may not be supported yet."
        error "Visit https://github.com/${GITHUB_REPO}/releases/tag/${tag} to check available assets."
        exit 1
    }

    # Download checksums
    download "$checksums_url" "$tmpdir/checksums.txt" || {
        error "Failed to download checksums.txt from release $tag."
        error "Check your network connection or visit https://github.com/${GITHUB_REPO}/releases"
        exit 1
    }

    # Verify checksum
    verify_checksum "$tmpdir/$tarball_name" "$tmpdir/checksums.txt"

    # Create install directory if it doesn't exist
    mkdir -p "$INSTALL_DIR"

    # Extract tarball to temp directory first, then move contents into place
    mkdir -p "$tmpdir/extract"
    tar -xzf "$tmpdir/$tarball_name" -C "$tmpdir/extract"

    # Install binary
    cp "$tmpdir/extract/mobius" "$INSTALL_DIR/mobius"
    chmod +x "$INSTALL_DIR/mobius"

    # Install bundled skills alongside the binary (used by mobius setup)
    if [ -d "$tmpdir/extract/skills" ]; then
        rm -rf "$INSTALL_DIR/skills"
        cp -r "$tmpdir/extract/skills" "$INSTALL_DIR/skills"
        success "Bundled skills installed to: $INSTALL_DIR/skills/"
    fi

    # Install shortcuts script alongside the binary (used by mobius setup)
    if [ -f "$tmpdir/extract/shortcuts.sh" ]; then
        cp "$tmpdir/extract/shortcuts.sh" "$INSTALL_DIR/shortcuts.sh"
        success "Shortcuts installed to: $INSTALL_DIR/shortcuts.sh"
    fi

    success "Installed: $INSTALL_DIR/mobius ($tag)"
}

install_config() {
    info "Setting up configuration..."

    # Create config directory
    mkdir -p "$CONFIG_DIR"

    # Copy default config if user config doesn't exist
    if [ ! -f "$CONFIG_DIR/config.yaml" ]; then
        if [ -f "$SCRIPT_DIR/mobius.config.yaml" ]; then
            cp "$SCRIPT_DIR/mobius.config.yaml" "$CONFIG_DIR/config.yaml"
            success "Created: $CONFIG_DIR/config.yaml"
        else
            info "No default config template found. Skipping config installation."
        fi
    else
        info "Config already exists: $CONFIG_DIR/config.yaml (not overwritten)"
    fi
}

install_skills() {
    info "Run 'mobius setup' to install skills and shell shortcuts."
}

copy_agents_template() {
    info "AGENTS.md template available at: $SCRIPT_DIR/templates/AGENTS.md"
    info "Copy it to your project root and customize for your codebase."
}

check_path() {
    if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
        echo ""
        warn "$INSTALL_DIR is not in your PATH."
        echo ""
        echo "Add it to your shell configuration:"
        echo ""
        echo "  # For bash (~/.bashrc):"
        echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
        echo ""
        echo "  # For zsh (~/.zshrc):"
        echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
        echo ""
        echo "Then reload your shell or run: source ~/.bashrc"
    fi
}

uninstall() {
    info "Uninstalling mobius..."

    if [ -f "$INSTALL_DIR/mobius" ]; then
        rm "$INSTALL_DIR/mobius"
        success "Removed: $INSTALL_DIR/mobius"
    else
        info "Command not found: $INSTALL_DIR/mobius"
    fi

    # Remove bundled skills
    if [ -d "$INSTALL_DIR/skills" ]; then
        rm -rf "$INSTALL_DIR/skills"
        success "Removed: $INSTALL_DIR/skills/"
    fi

    # Remove bundled shortcuts
    if [ -f "$INSTALL_DIR/shortcuts.sh" ]; then
        rm "$INSTALL_DIR/shortcuts.sh"
        success "Removed: $INSTALL_DIR/shortcuts.sh"
    fi

    # Remove config
    if [ -d "$CONFIG_DIR" ]; then
        rm -rf "$CONFIG_DIR"
        success "Removed config: $CONFIG_DIR"
    fi

    echo ""
    success "Mobius has been fully uninstalled."
}

show_help() {
    cat << EOF
Mobius Installation Script

Downloads a pre-compiled Rust binary from GitHub Releases.

Usage:
    ./install.sh              Install mobius (latest version)
    ./install.sh --uninstall  Remove mobius (binary, skills, config)
    ./install.sh --help       Show this help message

Installation:
    1. Detects OS and architecture (Linux/macOS, x86_64/aarch64)
    2. Downloads pre-compiled binary from GitHub Releases
    3. Verifies SHA256 checksum
    4. Places binary at ~/.local/bin/mobius
    5. Creates config at ~/.config/mobius/config.yaml (if not exists)
    6. Bundles skills and shortcuts alongside the binary
    7. Run 'mobius setup' to complete skill and shortcut installation

Environment Variables:
    MOBIUS_VERSION        Install a specific version (e.g., MOBIUS_VERSION=v1.7.0 ./install.sh)
    MOBIUS_INSTALL_DIR    Override install directory (default: ~/.local/bin)
    XDG_CONFIG_HOME       Override config directory (default: ~/.config)

Supported Platforms:
    - Linux x86_64 (x86_64-unknown-linux-gnu)
    - Linux aarch64 (aarch64-unknown-linux-gnu)
    - macOS x86_64 (x86_64-apple-darwin)
    - macOS aarch64 (aarch64-apple-darwin)

After Installation:
    1. Ensure ~/.local/bin is in your PATH
    2. Edit ~/.config/mobius/config.yaml to customize settings
    3. Run 'mobius --help' to verify installation
EOF
}

main() {
    echo ""
    echo "================================"
    echo "  Mobius Installer"
    echo "================================"
    echo ""

    case "${1:-}" in
        --help|-h)
            show_help
            exit 0
            ;;
        --uninstall)
            uninstall
            exit 0
            ;;
    esac

    local selected_runtime
    selected_runtime="$(resolve_selected_runtime)"
    info "Selected runtime for dependency checks: $selected_runtime"

    check_dependencies "$selected_runtime"
    echo ""
    check_npm_conflict
    install_command
    install_config
    install_skills
    echo ""
    copy_agents_template
    check_path

    echo ""
    echo "================================"
    echo "  Installation Complete"
    echo "================================"
    echo ""
    success "Run 'mobius --help' to get started"
    echo ""
}

main "$@"
