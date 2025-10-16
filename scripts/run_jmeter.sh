#!/usr/bin/env bash
set -euo pipefail

# Ensure common system paths are present so JMeter's wrapper can find utilities like dirname/awk/uname
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# Simple wrapper to run the included jmeter_template.jmx against a target
# Usage: TARGET=http://localhost:4000/path VUS=10 DURATION=30 bash scripts/run_jmeter.sh

TEMPLATE="$(cd "$(dirname "$0")/.." && pwd)/jmeter_template.jmx"
RESULTS_DIR="$(mktemp -d /tmp/jmeter-results-XXXX)"
RESULTS_FILE="$RESULTS_DIR/results.csv"
LOG_FILE="$RESULTS_DIR/jmeter.log"

TARGET=${TARGET:-}
VUS=${VUS:-10}
DURATION=${DURATION:-30}

if [ -z "$TARGET" ]; then
  echo "Usage: TARGET=<url> VUS=<threads> DURATION=<seconds> $0"
  exit 2
fi

# Locate jmeter binary: prefer PATH, otherwise check common Homebrew /usr locations
JMETER_CMD=""
if command -v jmeter >/dev/null 2>&1; then
  JMETER_CMD=$(command -v jmeter)
else
  for p in /opt/homebrew/bin/jmeter /usr/local/bin/jmeter /usr/bin/jmeter /usr/local/opt/apache-jmeter/bin/jmeter /Applications/apache-jmeter/bin/jmeter; do
    if [ -x "$p" ]; then
      JMETER_CMD="$p"
      break
    fi
  done
fi
if [ -z "$JMETER_CMD" ]; then
  echo "jmeter not found. Run 'npm run install:jmeter' or install JMeter manually." >&2
  exit 3
fi

# derive host/path/protocol
python3 - <<PY
from urllib.parse import urlparse
u = urlparse('$TARGET')
print(u.scheme)
print(u.hostname)
print(u.port or ('443' if u.scheme=='https' else '80'))
print(u.path + ('?' + u.query if u.query else ''))
PY

SCHEME=$(python3 -c "from urllib.parse import urlparse; u=urlparse('$TARGET'); print(u.scheme)")
HOST=$(python3 -c "from urllib.parse import urlparse; u=urlparse('$TARGET'); print(u.hostname)")
PORT=$(python3 -c "from urllib.parse import urlparse; u=urlparse('$TARGET'); print(u.port or ('443' if u.scheme=='https' else '80'))")
PATH=$(python3 -c "from urllib.parse import urlparse; u=urlparse('$TARGET'); print((u.path or '/') + ('?' + u.query if u.query else ''))")

echo "Running JMeter test against $TARGET"

"$JMETER_CMD" -n -t "$TEMPLATE" -l "$RESULTS_FILE" -j "$LOG_FILE" \
  -Jprotocol=$SCHEME -Jhost=$HOST -Jport=$PORT -Jpath="$PATH" -Jthreads=$VUS -Jduration=$DURATION -Jjmeter.save.saveservice.output_format=csv || {
  echo "Wrapper jmeter failed; will try running JMeter jar directly as fallback..." >&2
  # try direct jar execution
  # locate jar
  if [ -z "${JAR_PATH:-}" ]; then
    # common location
    JAR_PATH="$(dirname "$JMETER_CMD")/ApacheJMeter.jar"
    if [ ! -f "$JAR_PATH" ]; then
      JAR_PATH="$(cd "$(dirname "$JMETER_CMD")/.." && pwd)/libexec/bin/ApacheJMeter.jar" || true
    fi
  fi
  if [ -f "$JAR_PATH" ]; then
    echo "Found JMeter jar at $JAR_PATH, running via java -cp";
    java -cp "$JAR_PATH" org.apache.jmeter.NewDriver -n -t "$TEMPLATE" -l "$RESULTS_FILE" -j "$LOG_FILE" \
      -Jprotocol=$SCHEME -Jhost=$HOST -Jport=$PORT -Jpath="$PATH" -Jthreads=$VUS -Jduration=$DURATION -Jjmeter.save.saveservice.output_format=csv || {
      echo "Direct jar invocation failed. Check $LOG_FILE" >&2; exit 5;
    }
  else
    echo "Unable to locate ApacheJMeter.jar for direct invocation." >&2; exit 6;
  fi
}

if [ -f "$RESULTS_FILE" ]; then
  echo "Results written to $RESULTS_FILE"
  echo "Log: $LOG_FILE"
  # attempt to parse results and append summary to tests_history.ndjson
  if command -v node >/dev/null 2>&1 && [ -f "$(pwd)/scripts/parse_jmeter_results.js" ]; then
    node scripts/parse_jmeter_results.js "$RESULTS_FILE" || echo "Result parsing failed" >&2
  fi
  echo "Done."
else
  echo "JMeter did not produce results file. Check $LOG_FILE" >&2
  exit 4
fi
