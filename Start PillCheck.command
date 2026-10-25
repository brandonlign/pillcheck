#!/bin/zsh -l
cd "${0:A:h}"
if [[ ! -f node_modules/onnxruntime-web/dist/ort.wasm.bundle.min.mjs ]]; then
  npm ci || exit 1
fi
node --env-file-if-exists=.env server.mjs --open
