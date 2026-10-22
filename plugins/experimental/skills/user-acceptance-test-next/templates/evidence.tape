# VHS tape for the terminal evidence of one criterion. Copy into the UAT working
# directory, edit the scenes, then from that directory:
#   vhs validate AC1.tape
#   vhs AC1.tape
# Paths resolve from the working directory. One tape per criterion keeps chapters clean.
# Every scene must fit on one screen: on Windows the display stops updating once output
# scrolls, so clear (hidden) before each scene and cap output with --select / --max-lines.

Output clips/AC1.mp4

# Windows: "pwsh" (not "pwsh.exe") with uat-env.ps1. macOS/Linux: "bash" with uat-env.sh.
Set Shell "pwsh"
Set Width 1920
Set Height 1080
# Cascadia Mono on Windows, Menlo on macOS, DejaVu Sans Mono on Linux.
Set FontFamily "Cascadia Mono"
Set FontSize 16
Set Padding 24
Set Theme "Dracula"
Set TypingSpeed 12ms
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

# Scene 1: say what is being proven, run it for real, then hold on the result.
Type "# AC1: creating an order returns 201 and logs OrderCreated with the new id"
Enter
Sleep 1200ms
Type `uat-log --step AC1 --file app.log --pattern "OrderCreated id=" --show "AUDIT:|OrderCreated" --run node $UatHttp --evidence evidence --step AC1-request --method POST --url "$base/api/orders" --header "Content-Type: application/json" --body '@order.json' --expect-status 201 --select "id,status"`
Enter
# Wait for any outcome so a FAIL is recorded rather than timing out. The marker text never
# appears in the typed command, so the wait cannot match the command line itself.
Wait+Screen@120s /UAT_STEP AC1 (PASS|FAIL|ERROR)/
Sleep 8s

# Scene 2 starts on a clean screen.
Hide
Type "Clear-Host"
Enter
Sleep 400ms
Show
Type "# AC1 (boundary): an order without items is rejected with 400"
Enter
Sleep 1200ms
Type `uat-http --step AC1b --method POST --url "$base/api/orders" --header "Content-Type: application/json" --body '{"items":[]}' --expect-status 400 --select "title,errors"`
Enter
Wait+Screen@120s /UAT_STEP AC1b (PASS|FAIL|ERROR)/
Sleep 8s
Screenshot evidence/AC1.png
