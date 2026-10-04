#!/bin/sh
# Rebuild public/models/luffy.glb from the AI-generated source model.
#   tools/blender/luffy/build.sh path/to/source.glb [blender-python]
# The python must have the `bpy` module (pip install bpy) and numpy.
set -e
SRC=${1:?source glb}; PY=${2:-python3}
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/../../.." && pwd)
TMP=${TMPDIR:-/tmp}/luffy-build; mkdir -p "$TMP"
"$PY" "$HERE/stage1.py" -- "$SRC" "$TMP/prep.blend"      # weld, decimate, texture colours
"$PY" "$HERE/stage2.py" -- "$TMP/prep.blend" "$TMP/rig.blend"   # skeleton, weights, hat, left arm, hands
"$PY" "$HERE/stage3.py" -- "$TMP/rig.blend" "$ROOT/public/models/luffy.glb"   # bake clips, export
