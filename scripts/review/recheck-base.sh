#!/usr/bin/env bash
# Picks the base of a Maestro re-check, so that `git diff <base>...HEAD` holds only what
# changed since the last reviewed head. Prints `base=<commit or ref>` on stdout, and each
# notice on stderr.
#
# After a rebase, an amend or a merge of the base branch, the last reviewed head is no longer
# the fork point of the new history. The script then replays the last reviewed changes onto
# the new fork point, and moves HEAD to a stand-in commit: the same files as the head, with
# that replay as its parent. The base stays an ancestor of HEAD, so every three-dot diff of
# the review reads only the new changes.
#
# On a line conflict, the replay keeps the lines of the base (`-X ours`), so the re-check reads
# every resolution that differs from the base, an overwrite of the base included.
#
# Usage: recheck-base.sh <last reviewed head> <base of the pull request, origin/<branch>>
set -euo pipefail

last_head=$1
pr_base=$2

full_review() {
  echo "maestro-review: $1 The re-check reads the whole pull request." >&2
  echo "base=$pr_base"
  exit 0
}

commit() {
  git -c user.name="Maestro review" -c user.email="maestro-review@users.noreply.github.com" \
    commit-tree "$@"
}

# A force-push leaves the last head on no branch, and GitHub still serves it by its id.
git cat-file -e "$last_head^{commit}" 2>/dev/null ||
  git fetch -q --no-write-fetch-head origin "$last_head" ||
  full_review "GitHub does not serve the last reviewed head $last_head."

# `merge-base` and `merge-tree` exit 1 for the expected outcome, and above 1 for a fault. A
# fault exits the script with that status, so that the caller reports a script failure,
# and not a notice that names the wrong cause.
status=0
old_fork=$(git merge-base "$last_head" "$pr_base") || status=$?
[ "$status" -le 1 ] || exit "$status"
[ "$status" -eq 0 ] || full_review "The last reviewed head $last_head shares no history with $pr_base."
new_fork=$(git merge-base HEAD "$pr_base")

git merge-base --is-ancestor "$last_head" HEAD || status=$?
[ "$status" -le 1 ] || exit "$status"
if [ "$old_fork" = "$new_fork" ] && [ "$status" -eq 0 ]; then
  echo "base=$last_head"
  exit 0
fi

replay_tree() {
  git merge-tree --write-tree --name-only --no-messages "$@" --merge-base="$old_fork" "$new_fork" "$last_head"
}

status=0
tree=$(replay_tree) || status=$?
[ "$status" -le 1 ] || exit "$status"
if [ "$status" -eq 1 ]; then
  conflicted=$(tail -n +2 <<<"$tree" | sort -u | paste -sd ' ' -)
  status=0
  tree=$(replay_tree -X ours) || status=$?
  [ "$status" -le 1 ] || exit "$status"
  [ "$status" -eq 0 ] || full_review "The changes of $last_head conflict with $pr_base."
  echo "maestro-review: The changes of $last_head conflict with $pr_base in $conflicted. The re-check reads each resolution against $pr_base." >&2
fi

head=$(git rev-parse HEAD)
replay=$(commit "$tree" -p "$new_fork" -m "Maestro re-check: the changes of $last_head, replayed onto $new_fork")
stand_in=$(commit "HEAD^{tree}" -p "$replay" -m "Maestro re-check: the files of $head, on top of the last reviewed changes")
git reset -q --soft "$stand_in"
echo "maestro-review: The history changed since $last_head. The re-check reads the changes since then, replayed onto $pr_base." >&2
echo "base=$replay"
