#!/bin/zsh
# Five clean runs of the devnet demo, each a fresh process with a fresh resolver store and fresh mandates. Outputs in $DEMO_DIR (default demo-runs).
cd "$(dirname "$0")/.."
D=${DEMO_DIR:-demo-runs}
mkdir -p $D
for i in 1 2 3 4 5; do
  { echo "# run $i started $(date -u +%FT%TZ)"; node scripts/demo-devnet.mjs; echo "# exit code $?"; echo "# run $i finished $(date -u +%FT%TZ)"; } > $D/run-$i.txt 2>&1
  tail -1 $D/run-$i.txt
done
