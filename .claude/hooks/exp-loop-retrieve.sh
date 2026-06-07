#!/bin/bash
# exp-loop retrieve hook — fires on UserPromptSubmit
# Retrieves relevant experiences and injects them as context
INPUT=$(cat)
node "$(dirname "$0")/../../packages/adapter-mcp/dist/hooks/retrieve.js" <<< "$INPUT"
