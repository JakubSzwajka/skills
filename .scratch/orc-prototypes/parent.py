import json, glob, os, datetime, collections

BASE = os.path.expanduser('~/.pi/agent/sessions')

def T(s):
    return datetime.datetime.fromisoformat(s.replace('Z', '+00:00'))

for f in sorted(glob.glob(os.path.join(BASE, '*', '2026-09-09T*.jsonl'))):
    evs = [json.loads(l) for l in open(f) if l.strip()]
    calls = {}
    seq = []
    for d in evs:
        if d.get('type') != 'message':
            continue
        m = d['message']
        ts = T(d['timestamp'])
        if m.get('role') == 'assistant':
            for c in m.get('content', []):
                if c.get('type') == 'toolCall':
                    calls[c['id']] = dict(name=c['name'], args=c.get('arguments') or {}, start=ts, res='', end=None)
                    seq.append(c['id'])
        elif m.get('role') == 'toolResult':
            cid = m.get('toolCallId')
            if cid in calls:
                calls[cid]['end'] = ts
                calls[cid]['res'] = ''.join(x.get('text', '') for x in m.get('content', []) if x.get('type') == 'text')
    subs = [calls[i] for i in seq if i in calls and calls[i]['name'] in ('subagent', 'bg_wait', 'subagent_supervisor')]
    if not subs:
        continue
    proj = os.path.basename(os.path.dirname(f)).strip('-').replace('Users-jakubszwajka-', '')
    print('=' * 110)
    print(proj, os.path.basename(f)[:24])
    for c in subs:
        a = c['args']
        kind = a.get('action') or ('workflowScript' if a.get('workflowScript') else (a.get('agent') or a.get('id') or ''))
        extra = []
        if a.get('async') is not None:
            extra.append('async=' + str(a['async']))
        if a.get('model'):
            extra.append('model=' + str(a['model'])[:34])
        if a.get('worktree'):
            extra.append('worktree')
        if a.get('timeoutMs') or a.get('maxRuntimeMs'):
            extra.append('t=' + str((a.get('timeoutMs') or a.get('maxRuntimeMs')) / 60000) + 'm')
        dur = (c['end'] - c['start']).total_seconds() if c['end'] else -1
        res = c['res'][:150].replace('\n', ' ')
        print(f"  {c['start'].strftime('%H:%M:%S')} {c['name']:18s} {str(kind)[:26]:26s} {dur:7.1f}s {' '.join(extra)[:60]:60s} | {res}")
