# VHS tape for the terminal evidence of one or more criteria. Copy into the UAT working
# directory, edit the scenes, then from that directory:
#   vhs validate AC1.tape
#   vhs AC1.tape
# Paths resolve from the working directory. One tape per criterion keeps chapters clean.

Output clips/AC1.mp4

# Windows: "pwsh" (not "pwsh.exe") with uat-env.ps1. macOS/Linux: "bash" with uat-env.sh.
Set Shell "pwsh"
Set Width 1600
Set Height 900
# Cascadia Mono on Windows, Menlo on macOS, DejaVu Sans Mono on Linux.
Set FontFamily "Cascadia Mono"
Set FontSize 22
Set Padding 28
Set Theme "Dracula"
Set TypingSpeed 35ms
Set Framerate 24

# Setup the viewer does not need to see: helpers, base URL, offscreen credentials.
Hide
Type ". ./uat-env.ps1"
Enter
Wait+Screen@60s /UAT_ENV_READY/
Type "Clear-Host"
Enter
Sleep 500ms
Show

# Scene: say what is being proven, run it for real, then hold on the result.
Type "# AC1: creating an order returns 201 with the new order's id"
Enter
Sleep 1500ms
Type `uat-http --step AC1 --method POST --url "$base/api/orders" --header "Content-Type: application/json" --body '@order.json' --expect-status 201 --select id,status`
Enter
# Wait for any outcome so a FAIL is recorded rather than timing out. The marker text never
# appears in the typed command, so the wait cannot match the command line itself.
Wait+Screen@90s /UAT_STEP AC1 (PASS|FAIL|ERROR)/
Sleep 8s
Screenshot evidence/AC1.png
