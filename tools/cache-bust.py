#!/usr/bin/env python3
"""Stamp a date-based ?v= version onto local CSS and JS references in index.html.

Browsers cache stylesheet.css and the JS files aggressively. Editing one without
changing its URL means returning visitors keep the stale copy, which is easy to
forget by hand. This rewrites every local .css/.js reference to carry today's
date, adding -2, -3, ... if a stamp for today already exists.

Only same-origin .css/.js references are touched. External URLs are left alone,
which is what keeps links such as youtube.com/watch?v=... safe. Images and video
are deliberately not stamped: they are added under new filenames rather than
edited in place.

Usage:
    python3 tools/cache-bust.py           # preview the changes
    python3 tools/cache-bust.py --apply   # write them
"""
import datetime
import re
import sys
import os

HTML = 'index.html'
PATTERN = re.compile(r'(?P<attr>\b(?:href|src)=")(?P<path>[^"]+?\.(?:css|js))(?:\?[^"]*)?(?P<close>")')


def is_external(path):
    return path.startswith(('http://', 'https://', '//', 'data:', 'mailto:'))


def next_stamp(existing, today):
    """Always move forward: today, then today-2, today-3, ...

    Never reuse or go back to a stamp already seen for today, even if the bare
    date is unused: a browser may already hold that URL in cache from an earlier
    run, and handing it back out would serve the stale file.
    """
    used = {s for s in existing if s == today or s.startswith(today + '-')}
    if not used:
        return today
    highest = 1
    for s in used:
        if s == today:
            highest = max(highest, 1)
        else:
            suffix = s[len(today) + 1:]
            if suffix.isdigit():
                highest = max(highest, int(suffix))
    return '%s-%d' % (today, highest + 1)


def main():
    apply_changes = '--apply' in sys.argv
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    os.chdir(root)

    if not os.path.isfile(HTML):
        sys.exit('ERROR: %s not found (run from the repo or via tools/)' % HTML)

    html = open(HTML, encoding='utf-8').read()
    today = datetime.date.today().strftime('%Y%m%d')
    existing = set(re.findall(r'\?v=([0-9]{8}(?:-[0-9]+)?)', html))
    stamp = next_stamp(existing, today)

    changes = []
    missing = []

    def repl(m):
        path = m.group('path')
        if is_external(path):
            return m.group(0)
        if not os.path.isfile(path.lstrip('/')):
            missing.append(path)
        old = m.group(0)
        new = '%s%s?v=%s%s' % (m.group('attr'), path, stamp, m.group('close'))
        if old != new:
            changes.append((path, old, new))
        return new

    # Substitute only outside HTML comments, so disabled references are left
    # exactly as they are rather than being quietly re-stamped.
    parts = []
    cursor = 0
    for comment in re.finditer(r'<!--.*?-->', html, re.S):
        parts.append(PATTERN.sub(repl, html[cursor:comment.start()]))
        parts.append(comment.group(0))
        cursor = comment.end()
    parts.append(PATTERN.sub(repl, html[cursor:]))
    updated = ''.join(parts)

    print('version stamp: %s' % stamp)
    if existing:
        print('stamps already present: %s' % ', '.join(sorted(existing)))
    print()
    if not changes:
        print('nothing to change: every local css/js reference already carries %s' % stamp)
        return
    for path, _, _ in changes:
        print('  %s  ->  ?v=%s' % (path, stamp))
    if missing:
        print()
        for p in sorted(set(missing)):
            print('  WARNING: referenced file not found on disk: %s' % p)

    if apply_changes:
        open(HTML, 'w', encoding='utf-8').write(updated)
        print('\nwrote %s (%d reference(s) updated)' % (HTML, len(changes)))
    else:
        print('\npreview only - re-run with --apply to write %s' % HTML)


if __name__ == '__main__':
    main()
