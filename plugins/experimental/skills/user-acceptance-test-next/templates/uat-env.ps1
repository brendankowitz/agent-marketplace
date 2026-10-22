# Hidden setup for a VHS terminal recording (PowerShell 7). Copy into the UAT working
# directory, replace the two placeholders, and dot-source it inside the tape's Hide block.
# It must print UAT_ENV_READY last; the tape waits for that marker.

$UatSkillDir = '__SKILL_DIR__'   # absolute path of the user-acceptance-test-next skill
$base = '__BASE_URL__'           # system under test, e.g. http://localhost:5000

# Keep the recording clean and free of secrets: short prompt, no history written to disk.
function prompt { '> ' }
if (Get-Module PSReadLine) { Set-PSReadLineOption -HistorySaveStyle SaveNothing }

$UatHttp = Join-Path $UatSkillDir 'scripts/http-step.mjs'   # for uat-log actions: --run node $UatHttp --evidence evidence ...
function uat-http { node $UatHttp --evidence evidence @args }
function uat-log  { node (Join-Path $UatSkillDir 'scripts/log-step.mjs') --evidence evidence @args }

# Credentials: acquire offscreen into an environment variable and pass --bearer-env UAT_TOKEN.
# Never echo the token, put it in the tape, or write it to a file. Example (Azure):
# $env:UAT_TOKEN = az account get-access-token --resource '<app-id-uri>' --query accessToken -o tsv

# Synthetic test data for this run (unique per run so reruns do not collide):
$run = Get-Date -Format 'HHmmss'

Write-Host 'UAT_ENV_READY'
