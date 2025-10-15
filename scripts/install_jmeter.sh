#!/usr/bin/env bash
# Minimal helper to install JMeter on macOS using Homebrew
set -euo pipefail
if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew not found. Install Homebrew first: https://brew.sh/"
  exit 2
fi
if brew info apache-jmeter >/dev/null 2>&1; then
  echo "Installing apache-jmeter via brew..."
  brew install apache-jmeter || brew install --cask apache-jmeter
else
  echo "Trying 'jmeter' formula"
  brew install jmeter || { echo 'Failed to install jmeter via brew'; exit 1; }
fi
echo "jmeter installed. Run 'jmeter -v' to verify." 
