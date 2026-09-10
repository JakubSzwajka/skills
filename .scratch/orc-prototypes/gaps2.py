import json, glob, os, datetime, collections

BASE = os.path.expanduser('~/.pi/agent/sessions')
paths = []
for p in glob.glob(os.path.join(BASE, '*', 'subagent-artifacts', '*_transcript.jsonl')):
    if datetime.datetime.fromtimestamp(os.path.getmtime(p)).date() == datetime.date(2026, 9, 9):
        paths.append(p)

def T(s):
    return datetime.datetime.fromisoformat(s.replace('Z', '+00:00'))

cls = collections.Counter()
secs = collections.Counter()
examples = collections.defaultdict(list)
for p in paths:
    evs = [json.loads(l) for l in open(p) if l.strip()]
    pending = {}
    prev = None
    for d in evs:
        ts = T(d['timestamp'])
        m = d.get('message') or {}
        if prev:
            g = (ts - prev).total_seconds()
            if g > 60:
                if pending:
                    nm, args = list(pending.values())[0]
                    k = 'supervisor wait' if nm == 'contact_supervisor' else f'tool: {nm}'
                    ex = args[:110]
                else:
                    k = 'model stall (no tool in flight)'
                    ex = ''
                cls[k] += 1
                secs[k] += g
                examples[k].append((round(g), os.path.basename(p)[:8], ex))
        if m.get('role') == 'assistant':
            for c in m.get('content', []):
                if c.get('type') == 'toolCall':
                    pending[c['id']] = (c['name'], json.dumps(c.get('arguments'))[:200].replace('\n', ' '))
        if m.get('role') == 'toolResult':
            pending.pop(m.get('toolCallId'), None)
        prev = ts

print(f"{'bucket':40s} {'n':>4s} {'total_min':>10s}")
for k in sorted(secs, key=lambda k: -secs[k]):
    print(f'{k:40s} {cls[k]:4d} {secs[k]/60:10.1f}')
print()
for k in sorted(secs, key=lambda k: -secs[k])[:6]:
    print('###', k)
    for e in sorted(examples[k], reverse=True)[:6]:
        print('   ', e)
