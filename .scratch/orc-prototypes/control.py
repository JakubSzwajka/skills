import json, glob, os, datetime, collections, re

BASE = os.path.expanduser('~/.pi/agent/sessions')

PATTERNS = [
    ('task identity refused', 'cannot carry the attached task identity'),
    ('run id not found', 'Async run not found'),
    ('steer: wrong target', 'live foreground children; steer a child run id'),
    ('steer: no ack', 'no acknowledgment was received'),
    ('steer: not running', 'is not running or queued and cannot be steered'),
    ('steer: no live child', 'has no live foreground child'),
    ('interrupt unsupported', 'Interrupt is unsupported'),
    ('workflow validate fail', '"ok":false'),
    ('preflight requires script', 'preflight requires workflowScript'),
    ('child launch failed', 'Failed to load extension'),
    ('run failed', 'State: failed'),
    ('no retained children', 'No retained workflow children'),
    ('tool arg validation', 'Validation failed'),
]

tot = collections.Counter()
per = collections.defaultdict(collections.Counter)
for f in sorted(glob.glob(os.path.join(BASE, '*', '2026-09-09T*.jsonl'))):
    sess = os.path.basename(os.path.dirname(f)).strip('-').replace('Users-jakubszwajka-', '') + ' ' + os.path.basename(f)[11:19]
    for l in open(f):
        try:
            d = json.loads(l)
        except Exception:
            continue
        if d.get('type') != 'message':
            continue
        m = d['message']
        if m.get('role') != 'toolResult':
            continue
        txt = ''.join(x.get('text', '') for x in m.get('content', []) if x.get('type') == 'text')[:2000]
        for name, pat in PATTERNS:
            if pat in txt:
                tot[name] += 1
                per[sess][name] += 1

print('control-plane / launch friction in PARENT sessions today')
for k, v in tot.most_common():
    print(f'  {v:3d}  {k}')
print()
for s, c in per.items():
    if c:
        print(f'{s:44s} {dict(c)}')
