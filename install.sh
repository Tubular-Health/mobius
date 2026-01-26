#!/bin/bash
# Mobius Installation Script
#
# Installs the 'mobius' command to your PATH and sets up configuration.
#
# Usage:
#   ./install.sh           # Install to ~/.local/bin
#   ./install.sh --uninstall  # Remove installation

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${MOBIUS_INSTALL_DIR:-$HOME/.local/bin}"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/mobius"
SKILLS_DIR="$HOME/.claude/skills"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info() { echo -e "${BLUE}[info]${NC} $1"; }
success() { echo -e "${GREEN}[done]${NC} $1"; }
warn() { echo -e "${YELLOW}[warn]${NC} $1"; }
error() { echo -e "${RED}[error]${NC} $1"; }

check_dependencies() {
    info "Checking dependencies..."

    # Check for Claude CLI
    if ! command -v claude &> /dev/null; then
        warn "Claude CLI not found. Install it from: https://claude.ai/code"
        warn "Mobius requires Claude CLI to function."
    else
        success "Claude CLI found: $(which claude)"
    fi

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

install_command() {
    info "Installing mobius command..."

    # Create install directory if it doesn't exist
    mkdir -p "$INSTALL_DIR"

    # Copy the script as 'mobius'
    cp "$SCRIPT_DIR/scripts/mobius.sh" "$INSTALL_DIR/mobius"
    chmod +x "$INSTALL_DIR/mobius"
    success "Installed: $INSTALL_DIR/mobius"
}

install_config() {
    info "Setting up configuration..."

    # Create config directory
    mkdir -p "$CONFIG_DIR"

    # Copy default config if user config doesn't exist
    if [ ! -f "$CONFIG_DIR/config.yaml" ]; then
        cp "$SCRIPT_DIR/mobius.config.yaml" "$CONFIG_DIR/config.yaml"
        success "Created: $CONFIG_DIR/config.yaml"
    else
        info "Config already exists: $CONFIG_DIR/config.yaml (not overwritten)"
    fi
}

install_skills() {
    info "Installing Claude skills..."

    # Create skills directory
    mkdir -p "$SKILLS_DIR"

    # Copy skills
    local skills=("define-issue" "refine-issue" "execute-issue" "verify-linear-issue")

    for skill in "${skills[@]}"; do
        local src="$SCRIPT_DIR/.claude/skills/$skill"
        local dest="$SKILLS_DIR/$skill"

        if [ -d "$src" ]; then
            if [ -d "$dest" ]; then
                info "Skill already exists: $skill (not overwritten)"
            else
                cp -r "$src" "$dest"
                success "Installed skill: $skill"
            fi
        fi
    done
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

    echo ""
    info "Config preserved at: $CONFIG_DIR/config.yaml"
    info "Skills preserved at: $SKILLS_DIR/"
    info "Remove these manually if desired."
}

show_help() {
    cat << EOF
Mobius Installation Script

Usage:
    ./install.sh              Install mobius command and configuration
    ./install.sh --uninstall  Remove mobius command (preserves config)
    ./install.sh --help       Show this help message

Installation:
    1. Copies 'mobius' command to ~/.local/bin/
    2. Creates config directory at ~/.config/mobius/
    3. Copies default configuration to ~/.config/mobius/config.yaml
    4. Installs Claude skills to ~/.claude/skills/

Environment Variables:
    MOBIUS_INSTALL_DIR    Override install directory (default: ~/.local/bin)
    XDG_CONFIG_HOME       Override config directory (default: ~/.config)

After Installation:
    1. Ensure ~/.local/bin is in your PATH
    2. Edit ~/.config/mobius/config.yaml to customize settings
    3. Copy AGENTS.md to your project root
    4. Run 'mobius --help' to verify installation
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

    check_dependencies
    echo ""
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
