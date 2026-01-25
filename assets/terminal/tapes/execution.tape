# VHS tape file for mobius execution demo
# https://github.com/charmbracelet/vhs

Output execution.cast
Set Shell bash
Set FontSize 14
Set Width 900
Set Height 600
Set Theme "Catppuccin Mocha"

Type "mobius ABC-123"
Enter
Sleep 2s

# Simulated execution output
Sleep 1s
Type@100ms "# Output would show:"
Enter
Sleep 500ms
Type@50ms "# [1/5] Executing: Add user authentication service"
Enter
Sleep 1s
Type@50ms "#   -> Implementing src/services/auth.ts"
Enter
Sleep 1s
Type@50ms "#   -> Running tests... PASS"
Enter
Sleep 500ms
Type@50ms "#   -> Committed: feat(auth): add authentication service"
Enter
Sleep 1s
Type@50ms "# [2/5] Executing: Add login endpoint"
Enter
Sleep 1s
Type@50ms "#   -> Implementing src/routes/login.ts"
Enter
Sleep 1s
Type@50ms "#   -> Running tests... PASS"
Enter
Sleep 500ms
Type@50ms "#   -> Committed: feat(auth): add login endpoint"
Enter
Sleep 2s
