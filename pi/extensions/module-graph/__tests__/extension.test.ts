import { describe, expect, it, vi } from 'vitest';

import moduleGraphExtension, { COMMAND_NAMES, formatGenerated, formatStatus } from '../index';

interface RegisteredCommand {
  name: string;
  options: { description: string; handler: (args: string, ctx: unknown) => Promise<void> };
}

describe('module graph extension', () => {
  it('registers the four colon commands and shutdown cleanup', () => {
    const commands: RegisteredCommand[] = [];
    const events = new Map<string, () => Promise<void>>();
    const pi = {
      registerCommand: vi.fn((name: string, options: RegisteredCommand['options']) => {
        commands.push({ name, options });
      }),
      on: vi.fn((event: string, handler: () => Promise<void>) => {
        events.set(event, handler);
      }),
    };

    moduleGraphExtension(pi as never);

    expect(commands.map(({ name }) => name)).toEqual(COMMAND_NAMES);
    expect(events.has('session_shutdown')).toBe(true);
  });

  it('formats a useful empty status', () => {
    expect(formatStatus({ running: false })).toBe(
      [
        'Graph: not generated',
        '',
        'Server: stopped',
        'Run /module-graph:generate <path> first.',
      ].join('\n'),
    );
  });

  it('formats stale caches as a state that can be regenerated', () => {
    expect(formatStatus({ running: false, staleCache: true })).toContain(
      'Graph: not generated (stale cache, regenerate)',
    );
  });

  it('reports unresolved imports and warns when holes exceed five percent', () => {
    const output = formatGenerated({
      running: false,
      graph: {
        modulesRoot: 'src',
        projectRoot: '/project',
        generatedAt: '2026-09-11T12:00:00.000Z',
        moduleCount: 2,
        dependencyCount: 1,
        runtimeCycleCount: 0,
        unmappedImportCount: 0,
        importsFound: 20,
        unresolvedImportCount: 2,
        configFailures: [],
        parseDiagnosticFiles: [],
      },
    });

    expect(output).toContain('Unresolved imports: 2');
    expect(output).toContain(
      'Warning: graph is incomplete; 2 of 20 imports (10.0%) could not be resolved.',
    );
  });
});
