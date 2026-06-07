#!/bin/bash
# exp-loop record hook — fires on Stop
# Records the episode in the background (async)
INPUT=$(cat)
node "$(dirname "$0")/../../packages/adapter-mcp/dist/hooks/record.js" <<< "$INPUT" &
