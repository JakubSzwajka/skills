import { readFileSync } from 'node:fs';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import type { CachedModuleGraph } from './graph-store';

const HOST = '127.0.0.1';
const VIEWER_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), 'viewer');
const require = createRequire(import.meta.url);
const THREE_DIRECTORY = dirname(dirname(require.resolve('three')));

export class ModuleGraphViewerServer {
  private server: Server | undefined;
  private url: string | undefined;

  constructor(private readonly getGraph: () => CachedModuleGraph | undefined) {}

  async start(): Promise<string> {
    if (this.url) return this.url;
    if (!this.getGraph()) {
      throw new Error(
        'No module graph has been generated for this project. Run /module-graph:generate <path> first.',
      );
    }

    const server = createServer((request, response) => {
      try {
        const pathname = new URL(request.url ?? '/', `http://${HOST}`).pathname;
        if (request.method !== 'GET') {
          return send(response, 405, 'text/plain; charset=utf-8', 'Method not allowed');
        }
        if (pathname === '/' || pathname === '/index.html') {
          return sendFile(response, join(VIEWER_DIRECTORY, 'index.html'));
        }
        if (pathname === '/styles.css') {
          return sendFile(response, join(VIEWER_DIRECTORY, 'styles.css'));
        }
        if (pathname === '/graph.json') {
          const cached = this.getGraph();
          if (!cached) {
            return send(response, 404, 'application/json; charset=utf-8', '{"error":"No graph"}\n');
          }
          return send(
            response,
            200,
            'application/json; charset=utf-8',
            `${JSON.stringify(cached.graph)}\n`,
          );
        }
        if (pathname === '/app.js') {
          return sendTypeScript(response, join(VIEWER_DIRECTORY, 'app.ts'));
        }
        if (pathname === '/graph-metrics.js') {
          return sendTypeScript(response, join(VIEWER_DIRECTORY, 'graph-metrics.ts'));
        }
        if (pathname.startsWith('/vendor/three/addons/')) {
          const root = resolve(THREE_DIRECTORY, 'examples/jsm');
          const file = resolve(root, pathname.slice('/vendor/three/addons/'.length));
          assertInside(root, file, 'Three.js addon');
          return sendFile(response, file);
        }
        if (pathname.startsWith('/vendor/three/')) {
          const root = resolve(THREE_DIRECTORY, 'build');
          const file = resolve(root, pathname.slice('/vendor/three/'.length));
          assertInside(root, file, 'Three.js build file');
          return sendFile(response, file);
        }
        return send(response, 404, 'text/plain; charset=utf-8', 'Not found');
      } catch (error) {
        return send(
          response,
          500,
          'text/plain; charset=utf-8',
          error instanceof Error ? error.message : String(error),
        );
      }
    });

    this.server = server;
    try {
      await new Promise<void>((resolveStart, rejectStart) => {
        const onError = (error: Error): void => rejectStart(error);
        server.once('error', onError);
        server.listen(0, HOST, () => {
          server.off('error', onError);
          resolveStart();
        });
      });
    } catch (error) {
      this.server = undefined;
      throw new Error(
        `Could not start module graph viewer: ${error instanceof Error ? error.message : error}`,
      );
    }

    const address = server.address();
    if (!address || typeof address === 'string') {
      await this.stop();
      throw new Error('Module graph viewer did not receive a TCP port.');
    }
    this.url = `http://${HOST}:${address.port}`;
    return this.url;
  }

  async stop(): Promise<boolean> {
    const server = this.server;
    if (!server) return false;

    this.server = undefined;
    this.url = undefined;
    await new Promise<void>((resolveStop, rejectStop) => {
      server.close((error) => {
        if (error) rejectStop(error);
        else resolveStop();
      });
      server.closeAllConnections?.();
    });
    return true;
  }

  status(): { running: boolean; url?: string } {
    return this.url ? { running: true, url: this.url } : { running: false };
  }
}

function sendTypeScript(response: ServerResponse, path: string): void {
  const result = ts.transpileModule(readFileSync(path, 'utf8'), {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      isolatedModules: true,
    },
  });
  const errors = result.diagnostics?.filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (errors && errors.length > 0) {
    throw new Error(errors.map(formatDiagnostic).join('\n'));
  }
  send(response, 200, 'text/javascript; charset=utf-8', result.outputText);
}

function sendFile(response: ServerResponse, path: string, contentType?: string): void {
  const types: Record<string, string> = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
  };
  send(
    response,
    200,
    contentType ?? types[extname(path)] ?? 'application/octet-stream',
    readFileSync(path),
  );
}

function send(
  response: ServerResponse,
  status: number,
  contentType: string,
  body: string | Buffer,
): void {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

function assertInside(parent: string, child: string, label: string): void {
  const path = relative(parent, child);
  if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error(`${label} must stay inside ${parent}: ${child}`);
  }
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
}
