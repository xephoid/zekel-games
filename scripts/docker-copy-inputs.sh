#!/bin/sh
# Used by the Dockerfile only: copy the files named in docker-build-files.txt
# from the build folder (mounted read-only at $1, never saved in the image)
# into $2. Nothing else from the build folder is copied, so untracked files
# can't get into the image even when their names look like game files.
# Stops the build if the list names a path that isn't a plain relative path,
# or a file that is missing or is a link.
set -eu
src=$1
dest=$2
list="$src/docker-build-files.txt"
files=$(mktemp)
trap 'rm -f "$files"' EXIT

if [ ! -f "$list" ]; then
  echo "docker-build-files.txt is missing from the build folder." >&2
  exit 1
fi
grep -v '^#' "$list" | grep -v '^$' > "$files" || true
if [ ! -s "$files" ]; then
  echo "docker-build-files.txt lists no files." >&2
  exit 1
fi
if grep -qvE '^[A-Za-z0-9_@+-][A-Za-z0-9._@+/-]*$' "$files" \
   || grep -qE '(^|/)\.\.(/|$)' "$files"; then
  echo "docker-build-files.txt has a path that is not a plain relative path." >&2
  exit 1
fi
while IFS= read -r f; do
  if [ -L "$src/$f" ] || [ ! -f "$src/$f" ]; then
    echo "docker-build-files.txt names $f, which is missing or not a plain file. Run: pnpm docker-files" >&2
    exit 1
  fi
done < "$files"

mkdir -p "$dest"
tar -C "$src" --no-recursion --verbatim-files-from -T "$files" -cf - | tar -C "$dest" -xf -
echo "copied $(wc -l < "$files") file(s) named in docker-build-files.txt" >&2
