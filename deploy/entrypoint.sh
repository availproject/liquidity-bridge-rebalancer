#!/bin/sh
trap 'kill 0' TERM INT
bun run start-cron & cron=$!
bun run start & api=$!
while kill -0 "$cron" 2>/dev/null && kill -0 "$api" 2>/dev/null; do sleep 5; done
trap - TERM INT
kill 0
