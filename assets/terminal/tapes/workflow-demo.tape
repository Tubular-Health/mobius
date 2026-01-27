# VHS tape file for Mobius workflow demo
# https://github.com/charmbracelet/vhs

Output workflow-demo.gif
Set Shell bash
Set FontSize 18
Set Width 1920
Set Height 1080
Set Theme "nord"
Set TypingSpeed 30ms
Set Padding 20
Set Framerate 60
Set WindowBar Colorful

# Clean start
Hide
Type "clear"
Enter
Sleep 100ms
Show

# Step 1: Run mobius
Type "mobius -n 4 MOB-1"
Sleep 1s
Enter
Sleep 15s

# Clear and show TUI
Hide
Type "clear"
Enter
Sleep 100ms
Show
