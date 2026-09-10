#!/bin/zsh
set -e
cd "$(dirname "$0")"
research_python="../code and data/.venv/bin/python"
if [[ ! -x "$research_python" ]]; then
  research_python=".venv/bin/python"
fi
if [[ ! -x "$research_python" ]]; then
  print 'Scientific Python environment not found. See research-app/README.md for setup.'
  read -r '?Press Return to close.'
  exit 1
fi
exec "$research_python" launcher.py "$@"
