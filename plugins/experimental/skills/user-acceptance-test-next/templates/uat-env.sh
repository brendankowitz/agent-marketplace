# Hidden setup for a VHS terminal recording (bash). Copy into the UAT working directory,
# replace the two placeholders, and source it inside the tape's Hide block.
# It must print UAT_ENV_READY last; the tape waits for that marker.

UAT_SKILL_DIR='__SKILL_DIR__'   # absolute path of the user-acceptance-test-next skill
base='__BASE_URL__'             # system under test, e.g. http://localhost:5000

# Keep the recording clean and free of secrets: short prompt, no history written to disk.
PS1='> '
unset HISTFILE

UAT_HTTP="$UAT_SKILL_DIR/scripts/http-step.mjs"   # for uat-log actions: --run node "$UAT_HTTP" --evidence evidence ...
uat-http() { node "$UAT_HTTP" --evidence evidence "$@"; }
uat-log()  { node "$UAT_SKILL_DIR/scripts/log-step.mjs" --evidence evidence "$@"; }

# Credentials: acquire offscreen into an environment variable and pass --bearer-env UAT_TOKEN.
# Never echo the token, put it in the tape, or write it to a file. Example (Azure):
# export UAT_TOKEN="$(az account get-access-token --resource '<app-id-uri>' --query accessToken -o tsv)"

# Synthetic test data for this run (unique per run so reruns do not collide):
run="$(date +%H%M%S)"

echo 'UAT_ENV_READY'
