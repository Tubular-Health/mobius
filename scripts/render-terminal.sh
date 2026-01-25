#!/bin/bash
# Render VHS tape files to SVG terminal recordings
# Usage: ./scripts/render-terminal.sh
#
# Requirements:
#   - VHS: brew install charmbracelet/tap/vhs (macOS) or go install github.com/charmbracelet/vhs@latest
#   - svg-term-cli: npm install -g svg-term-cli

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TAPES_DIR="$PROJECT_DIR/assets/terminal/tapes"
OUT_DIR="$PROJECT_DIR/assets/terminal"

# Check for VHS
if ! command -v vhs &> /dev/null; then
    echo "Error: VHS is not installed."
    echo "Install with: brew install charmbracelet/tap/vhs (macOS)"
    echo "         or: go install github.com/charmbracelet/vhs@latest"
    exit 1
fi

# Check for svg-term-cli
if ! command -v svg-term &> /dev/null && ! npx svg-term --version &> /dev/null 2>&1; then
    echo "Installing svg-term-cli..."
    npm install -g svg-term-cli
fi

echo "Rendering terminal recordings..."

for tape in "$TAPES_DIR"/*.tape; do
    if [ -f "$tape" ]; then
        name=$(basename "$tape" .tape)
        cast_file="$OUT_DIR/$name.cast"
        svg_file="$OUT_DIR/$name.svg"

        echo "  Recording $name..."
        vhs "$tape" -o "$cast_file"

        echo "  Converting to SVG..."
        npx svg-term --in "$cast_file" --out "$svg_file" --window --no-cursor

        # Clean up cast file (optional, comment out to keep)
        rm -f "$cast_file"
    fi
done

echo "Done! Terminal recordings rendered to $OUT_DIR/"
