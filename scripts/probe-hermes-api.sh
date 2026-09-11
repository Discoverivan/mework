#!/usr/bin/env bash
set -u

# Read-only capability probe. Do not pass credentials or start a server.
status=0
printf '%s\n' '== hermes --version =='
hermes --version || status=$?
printf '%s\n' '== hermes acp --version =='
hermes acp --version || status=$?
printf '%s\n' '== hermes acp --check =='
hermes acp --check || status=$?
printf '%s\n' '== hermes acp --help =='
hermes acp --help || status=$?
printf '%s\n' '== hermes serve --help =='
hermes serve --help || status=$?
printf '%s\n' '== hermes api-server --help (expected absent on some builds) =='
hermes api-server --help || true
printf '%s\n' '== hermes serve --status =='
hermes serve --status || status=$?
exit "$status"
