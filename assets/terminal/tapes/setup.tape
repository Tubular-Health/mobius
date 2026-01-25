# VHS tape file for mobius setup demo
# https://github.com/charmbracelet/vhs

Output setup.cast
Set Shell bash
Set FontSize 14
Set Width 800
Set Height 500
Set Theme "Catppuccin Mocha"

Type "mobius setup"
Enter
Sleep 2s

# Simulated interactive prompts
Type "linear"
Sleep 500ms
Enter
Sleep 1s

Type "3"
Sleep 500ms
Enter
Sleep 1s

Type "y"
Sleep 500ms
Enter
Sleep 2s

Sleep 3s
