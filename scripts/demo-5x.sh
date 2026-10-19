#!/bin/zsh
# Five clean runs of the devnet demo, each a fresh process with a fresh resolver store and fresh mandates. Outputs in demo-runs/.
cd "$(dirname "$0")/.."
for i in 1 2 3 4 5; do
  { echo "# run $i started $(date -u +%FT%TZ)"; node scripts/demo-devnet.mjs; echo "# exit code $?"; echo "# run $i finished $(date -u +%FT%TZ)"; } > demo-runs/run-$i.txt 2>&1
  tail -1 demo-runs/run-$i.txt
done
