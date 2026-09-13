import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from '@earendil-works/pi-coding-agent';

import {
  type ModuleGraphStatus,
  ModuleGraphService,
} from './module-graph-service';

export const COMMAND_NAMES = [
  'module-graph:generate',
  'module-graph:serve',
  'module-graph:stop',
  'module-graph:status',
] as const;

export default function moduleGraphExtension(pi: ExtensionAPI): void {
  const service = new ModuleGraphService();

  pi.registerCommand('module-graph:generate', {
    description: 'Generate a TypeScript module dependency graph from a directory',
    handler: async (args, ctx) => {
      await report(ctx, () => {
        const status = service.generate(ctx.cwd, args);
        return formatGenerated(status);
      });
    },
  });

  pi.registerCommand('module-graph:serve', {
    description: 'Serve the most recently generated module graph',
    handler: async (_args, ctx) => {
      await report(ctx, async () => formatServed(await service.serve(ctx.cwd)));
    },
  });

  pi.registerCommand('module-graph:stop', {
    description: 'Stop the module graph web server',
    handler: async (_args, ctx) => {
      await report(ctx, async () =>
        (await service.stop())
          ? 'Module graph server stopped. The generated graph remains cached.'
          : 'Module graph server is already stopped.',
      );
    },
  });

  pi.registerCommand('module-graph:status', {
    description: 'Show the generated graph and web server status',
    handler: async (_args, ctx) => {
      await report(ctx, () => formatStatus(service.status(ctx.cwd)));
    },
  });

  pi.on('session_shutdown', async () => {
    await service.stop();
  });
}

async function report(
  ctx: ExtensionCommandContext,
  operation: () => string | Promise<string>,
): Promise<void> {
  try {
    ctx.ui.notify(await operation(), 'info');
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error');
  }
}

export function formatGenerated(status: ModuleGraphStatus): string {
  const graph = requireGraph(status);
  const lines = [
    'Module graph generated.',
    `Source: ${graph.modulesRoot}`,
    `Modules: ${graph.moduleCount}`,
    `Dependencies: ${graph.dependencyCount}`,
    `Runtime cycles: ${graph.runtimeCycleCount}`,
  ];
  if (graph.unmappedImportCount > 0) {
    lines.push(`Imports outside module root: ${graph.unmappedImportCount}`);
  }
  if (graph.unresolvedImportCount > 0) {
    lines.push(`Unresolved imports: ${graph.unresolvedImportCount}`);
    if (graph.unresolvedImportCount / graph.importsFound > 0.05) {
      const percentage = ((graph.unresolvedImportCount / graph.importsFound) * 100).toFixed(1);
      lines.push(
        `Warning: graph is incomplete; ${graph.unresolvedImportCount} of ${graph.importsFound} imports (${percentage}%) could not be resolved.`,
      );
    }
  }
  if (graph.configFailures.length > 0) {
    lines.push(`Unusable TypeScript configs: ${graph.configFailures.length}`);
    for (const failure of graph.configFailures) {
      lines.push(`- ${failure.config}: ${failure.reason}`);
    }
  }
  if (graph.parseDiagnosticFiles.length > 0) {
    lines.push(`Files with parse diagnostics: ${graph.parseDiagnosticFiles.length}`);
    for (const file of graph.parseDiagnosticFiles) lines.push(`- ${file}`);
  }
  if (status.running && status.url) {
    lines.push(`Server remains available at ${status.url}. Refresh the browser to load this graph.`);
  } else {
    lines.push('Run /module-graph:serve to view it.');
  }
  return lines.join('\n');
}

export function formatServed(status: ModuleGraphStatus): string {
  const graph = requireGraph(status);
  return [
    'Module graph server running.',
    `URL: ${status.url}`,
    `Source: ${graph.modulesRoot}`,
    `Modules: ${graph.moduleCount}`,
    `Dependencies: ${graph.dependencyCount}`,
    `Runtime cycles: ${graph.runtimeCycleCount}`,
  ].join('\n');
}

export function formatStatus(status: ModuleGraphStatus): string {
  const lines: string[] = [];
  if (status.graph) {
    lines.push(
      'Graph: generated',
      `Source: ${status.graph.modulesRoot}`,
      `Generated: ${status.graph.generatedAt}`,
      `Modules: ${status.graph.moduleCount}`,
      `Dependencies: ${status.graph.dependencyCount}`,
      `Runtime cycles: ${status.graph.runtimeCycleCount}`,
    );
  } else {
    lines.push(status.staleCache
      ? 'Graph: not generated (stale cache, regenerate)'
      : 'Graph: not generated');
  }

  lines.push('', `Server: ${status.running ? 'running' : 'stopped'}`);
  if (status.url) lines.push(`URL: ${status.url}`);
  else if (status.graph) lines.push('Run /module-graph:serve to view it.');
  else lines.push('Run /module-graph:generate <path> first.');
  return lines.join('\n');
}

function requireGraph(status: ModuleGraphStatus): NonNullable<ModuleGraphStatus['graph']> {
  if (!status.graph) throw new Error('Module graph status did not include a generated graph.');
  return status.graph;
}
