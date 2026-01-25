#!/bin/bash
# Render Mermaid diagrams to SVG using mermaid-cli
# Usage: ./scripts/render-diagrams.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SRC_DIR="$PROJECT_DIR/assets/diagrams/src"
OUT_DIR="$PROJECT_DIR/assets/diagrams"

# Check if mermaid-cli is available
if ! command -v mmdc &> /dev/null && ! npx mmdc --version &> /dev/null 2>&1; then
    echo "Installing @mermaid-js/mermaid-cli..."
    npm install -g @mermaid-js/mermaid-cli
fi

echo "Rendering Mermaid diagrams..."

for file in "$SRC_DIR"/*.mmd; do
    if [ -f "$file" ]; then
        name=$(basename "$file" .mmd)
        echo "  Rendering $name.svg..."
        npx -p @mermaid-js/mermaid-cli mmdc \
            -i "$file" \
            -o "$OUT_DIR/$name.svg" \
            -t dark \
            -b transparent \
            --configFile "$PROJECT_DIR/assets/diagrams/mermaid.config.json" 2>/dev/null || \
        npx -p @mermaid-js/mermaid-cli mmdc \
            -i "$file" \
            -o "$OUT_DIR/$name.svg" \
            -t dark \
            -b transparent
    fi
done

echo "Done! Diagrams rendered to $OUT_DIR/"
