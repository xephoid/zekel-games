#!/bin/sh
# Used by the Dockerfile only: copy the files named in docker-build-files.txt
# from the build folder (mounted read-only at $1, never saved in the image)
# into $2. Nothing else from the build folder is copied, so an untracked file
# that isn't on the list can't get into the image, even when its name looks
# like a game file. (The list itself is trusted: it is made from git and
# checked by `pnpm test`, not here.)
# Stops the build, before copying anything, if the list names a path that
# isn't a plain relative path, or a file that is missing, is not a plain
# file, or is reached through a link. Every part of each path is checked from
# the top of the build folder down, so a folder on the way that has been
# swapped for a link (e.g. src/viz -> somewhere else) is refused too: tar
# would otherwise copy whatever the link points at.
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
# Plain relative paths only: allowed characters, no empty, "." or ".." parts,
# no leading or trailing "/".
if grep -qvE '^[A-Za-z0-9_@+-][A-Za-z0-9._@+/-]*$' "$files" \
   || grep -qE '(^|/)\.{1,2}(/|$)|//|/$' "$files"; then
  echo "docker-build-files.txt has a path that is not a plain relative path." >&2
  exit 1
fi
if [ -L "$src" ]; then
  echo "The build folder itself is a link; refusing to copy from it." >&2
  exit 1
fi
while IFS= read -r f; do
  p=$src
  rest=$f
  while [ -n "$rest" ]; do
    case $rest in
      */*) part=${rest%%/*}; rest=${rest#*/} ;;
      *) part=$rest; rest= ;;
    esac
    p=$p/$part
    if [ -L "$p" ]; then
      echo "docker-build-files.txt names $f, but ${p#"$src"/} is a link; refusing to copy through links." >&2
      exit 1
    fi
  done
  if [ ! -f "$p" ]; then
    echo "docker-build-files.txt names $f, which is missing or not a plain file. Run: pnpm docker-files" >&2
    exit 1
  fi
done < "$files"

mkdir -p "$dest"
tar -C "$src" --no-recursion --verbatim-files-from -T "$files" -cf - | tar -C "$dest" -xf -
echo "copied $(wc -l < "$files") file(s) named in docker-build-files.txt" >&2
