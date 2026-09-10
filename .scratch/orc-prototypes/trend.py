import json, glob, os, datetime, collections

BASE = os.path.expanduser('~/.pi/agent/sessions')
days = collections.defaultdict(lambda: dict(n=0, fail=0, cost=0.0, wall=0.0, turns=0, tools=0, to=0, r429=0))
for p in glob.glob(os.path.join(BASE, '*', 'subagent-artifacts', '*_meta.json')):
    d = datetime.datetime.fromtimestamp(os.path.getmtime(p)).date()
    try:
        m = json.load(open(p))
    except Exception:
        continue
    k = days[d]
    k['n'] += 1
    err = str(m.get('error') or '')
    if m.get('exitCode') != 0:
        k['fail'] += 1
    if 'timed out' in err:
        k['to'] += 1
    for a in (m.get('modelAttempts') or []):
        if not a.get('success') and '429' in str(a.get('error')):
            k['r429'] += 1
    u = m.get('usage') or {}
    k['cost'] += u.get('cost') or 0
    k['turns'] += u.get('turns') or 0
    k['tools'] += m.get('toolCount') or 0
    tp = p.replace('_meta.json', '_transcript.jsonl')
    if os.path.exists(tp):
        try:
            evs = [json.loads(l) for l in open(tp) if l.strip()]
            if len(evs) > 1:
                a = datetime.datetime.fromisoformat(evs[0]['timestamp'].replace('Z', '+00:00'))
                b = datetime.datetime.fromisoformat(evs[-1]['timestamp'].replace('Z', '+00:00'))
                k['wall'] += (b - a).total_seconds() / 60
        except Exception:
            pass

print(f"{'date':12s} {'children':>8s} {'failed':>7s} {'timeout':>8s} {'429':>5s} {'wall_min':>9s} {'avg_min':>8s} {'turns':>7s} {'tools':>7s} {'cost$':>8s}")
for d in sorted(days):
    k = days[d]
    print(f"{str(d):12s} {k['n']:8d} {k['fail']:7d} {k['to']:8d} {k['r429']:5d} {k['wall']:9.0f} {k['wall']/max(k['n'],1):8.1f} {k['turns']:7d} {k['tools']:7d} {k['cost']:8.2f}")
