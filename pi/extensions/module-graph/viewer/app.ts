import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import type { ModuleGraph } from '../analyzer';
import {
  deriveDirectoryScopeGraph,
  type DirectoryScopeGraph,
  type DirectoryScopeNodeKind,
} from './graph-metrics.js';

/** The fields the three.js scene needs from one directory scope. */
interface LevelNode {
  id: string;
  label: string;
  radius: number;
  cyclic: boolean;
  kind: DirectoryScopeNodeKind;
  expandable: boolean;
}

/** The fields the three.js scene needs from either level's derived links. */
interface LevelLink {
  source: string;
  target: string;
  weight: number;
  runtime: boolean;
  cyclic: boolean;
}

interface SceneNode extends LevelNode {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  force: THREE.Vector3;
  group: THREE.Group;
  body: THREE.Mesh;
  glow?: THREE.Mesh;
  labelElement: HTMLDivElement;
}

interface SceneLink extends LevelLink {
  sourceNode: SceneNode;
  targetNode: SceneNode;
  line: THREE.Line;
  particle?: THREE.Mesh;
  phase: number;
}

const COLORS = {
  background: 0x060607,
  accent: 0x8351e1,
  accentEmissive: 0x2d1457,
  danger: 0xff5c5f,
  edge: 0x77717f,
  typeEdge: 0x3c3c3f,
  stub: 0x9a94a6,
};

void start().catch(showFailure);

async function start(): Promise<void> {
  const response = await fetch('/graph.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load graph.json: ${response.status}`);
  renderGraph((await response.json()) as ModuleGraph);
}

function renderGraph(source: ModuleGraph): void {
  const canvas = element<HTMLCanvasElement>('graph-canvas');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.background);
  scene.fog = new THREE.FogExp2(COLORS.background, 0.0045);

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 600);
  camera.position.set(0, 12, 115);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    1.35,
    0.65,
    0.72,
  );
  composer.addPass(bloom);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.domElement.className = 'label-layer';
  document.body.append(labelRenderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.72));
  const keyLight = new THREE.DirectionalLight(0xd8cbff, 2.4);
  keyLight.position.set(30, 45, 50);
  scene.add(keyLight);
  const rimLight = new THREE.PointLight(COLORS.danger, 28, 180);
  rimLight.position.set(-35, -15, 35);
  scene.add(rimLight);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.42;
  controls.minDistance = 22;
  controls.maxDistance = 240;

  let level = deriveDirectoryScopeGraph(source);
  let sceneNodes: SceneNode[] = [];
  let sceneLinks: SceneLink[] = [];
  let layoutTicks = 0;

  function enterLevel(next: DirectoryScopeGraph): void {
    disposeLevel(scene, sceneNodes, sceneLinks);
    level = next;
    sceneNodes = createNodes(levelNodes(next), scene);
    sceneLinks = createLinks(
      levelLinks(next),
      new Map(sceneNodes.map((node) => [node.id, node])),
      scene,
    );
    layoutTicks = 0;
    renderMetrics(next);
    renderBreadcrumb(next, enterScope);
    renderInspectorPrompt(next);
    clearFailure();
  }

  function enterScope(scopePath: string): void {
    try {
      enterLevel(deriveDirectoryScopeGraph(source, scopePath));
    } catch (error: unknown) {
      showFailure(error);
    }
  }

  function openNode(node: SceneNode | undefined): void {
    if (!node || node.kind !== 'directory' || !node.expandable) return;
    enterScope(nodePath(level, node.id));
  }

  enterLevel(level);

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && level.parentPath) enterScope(level.parentPath);
  });

  const rotateButton = element<HTMLButtonElement>('toggle-rotation');
  rotateButton.addEventListener('click', () => {
    controls.autoRotate = !controls.autoRotate;
    rotateButton.textContent = controls.autoRotate ? 'Pause rotation' : 'Resume rotation';
  });

  installPicking(
    canvas,
    camera,
    () => sceneNodes,
    (node) => renderInspector(level, node.id),
    openNode,
  );

  function animate(time: number): void {
    requestAnimationFrame(animate);
    if (layoutTicks < 900) {
      const steps = layoutTicks < 240 ? 2 : 1;
      for (let step = 0; step < steps; step += 1) simulateLayout(sceneNodes, sceneLinks);
      layoutTicks += steps;
    }
    updateScene(sceneNodes, sceneLinks, time);
    controls.update();
    composer.render();
    labelRenderer.render(scene, camera);
  }
  requestAnimationFrame(animate);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function levelNodes(level: DirectoryScopeGraph): LevelNode[] {
  return level.nodes.map((node) => ({
    id: node.id,
    label: node.label,
    radius: node.radius,
    cyclic: node.cyclic,
    kind: node.kind,
    expandable: node.expandable,
  }));
}

function levelLinks(level: DirectoryScopeGraph): LevelLink[] {
  return level.links.map((link) => ({
    source: link.source,
    target: link.target,
    weight: link.weight,
    runtime: link.runtime,
    cyclic: link.cyclic,
  }));
}

function createNodes(nodes: LevelNode[], scene: THREE.Scene): SceneNode[] {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const spread = Math.max(28, Math.sqrt(nodes.length) * 7.5);

  return nodes.map((node, index) => {
    const y = nodes.length === 1 ? 0 : 1 - (index / (nodes.length - 1)) * 2;
    const ringRadius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * index;
    const position = new THREE.Vector3(
      Math.cos(theta) * ringRadius * spread,
      y * spread,
      Math.sin(theta) * ringRadius * spread,
    );
    const group = new THREE.Group();
    group.position.copy(position);

    const size = node.radius * 1.5;
    const boundary = node.kind === 'boundary';
    const geometry =
      node.kind === 'file'
        ? new THREE.SphereGeometry(node.radius, 28, 20)
        : new THREE.BoxGeometry(size, size, size);
    const material = new THREE.MeshStandardMaterial({
      color: boundary ? COLORS.stub : node.cyclic ? COLORS.danger : COLORS.accent,
      emissive: boundary ? COLORS.stub : node.cyclic ? COLORS.danger : COLORS.accentEmissive,
      emissiveIntensity: boundary ? 0.35 : node.cyclic ? 2.8 : 0.7,
      roughness: 0.3,
      metalness: 0.18,
      transparent: true,
      opacity: boundary ? 0.6 : 1,
      wireframe: boundary,
    });
    const body = new THREE.Mesh(geometry, material);
    body.userData.nodeId = node.id;
    group.add(body);

    let glow: THREE.Mesh | undefined;
    if (node.cyclic) {
      glow = new THREE.Mesh(
        new THREE.SphereGeometry(node.radius * 1.42, 22, 16),
        new THREE.MeshBasicMaterial({
          color: COLORS.danger,
          transparent: true,
          opacity: 0.14,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      group.add(glow);
    }

    const labelElement = document.createElement('div');
    labelElement.className = [
      'node-label',
      node.kind === 'directory' ? 'node-label--directory' : '',
      boundary ? 'node-label--stub' : '',
      node.cyclic ? 'node-label--cycle' : '',
    ]
      .filter(Boolean)
      .join(' ');
    labelElement.textContent = node.label;
    const labelObject = new CSS2DObject(labelElement);
    labelObject.position.set(0, node.radius + 1.35, 0);
    group.add(labelObject);
    scene.add(group);

    return {
      ...node,
      position,
      velocity: new THREE.Vector3(),
      force: new THREE.Vector3(),
      group,
      body,
      glow,
      labelElement,
    };
  });
}

function createLinks(
  links: LevelLink[],
  nodesById: Map<string, SceneNode>,
  scene: THREE.Scene,
): SceneLink[] {
  return links.map((link) => {
    const sourceNode = requiredNode(nodesById, link.source);
    const targetNode = requiredNode(nodesById, link.target);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const material = link.cyclic
      ? new THREE.LineBasicMaterial({ color: COLORS.danger, transparent: true, opacity: 0.95 })
      : link.runtime
        ? new THREE.LineBasicMaterial({
            color: COLORS.edge,
            transparent: true,
            opacity: Math.min(0.24 + link.weight * 0.035, 0.58),
          })
        : new THREE.LineDashedMaterial({
            color: COLORS.typeEdge,
            transparent: true,
            opacity: 0.42,
            dashSize: 1.1,
            gapSize: 0.75,
          });
    const line = new THREE.Line(geometry, material);
    scene.add(line);

    let particle: THREE.Mesh | undefined;
    if (link.runtime) {
      particle = new THREE.Mesh(
        new THREE.SphereGeometry(link.cyclic ? 0.28 : 0.16, 10, 8),
        new THREE.MeshBasicMaterial({
          color: link.cyclic ? COLORS.danger : 0xc3b4e8,
          transparent: true,
          opacity: 1,
        }),
      );
      scene.add(particle);
    }

    return {
      ...link,
      sourceNode,
      targetNode,
      line,
      particle,
      phase: hashUnit(`${link.source}->${link.target}`),
    };
  });
}

function disposeLevel(scene: THREE.Scene, nodes: SceneNode[], links: SceneLink[]): void {
  for (const link of links) {
    scene.remove(link.line);
    link.line.geometry.dispose();
    disposeMaterial(link.line.material);
    if (!link.particle) continue;
    scene.remove(link.particle);
    link.particle.geometry.dispose();
    disposeMaterial(link.particle.material);
  }
  for (const node of nodes) {
    scene.remove(node.group);
    node.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      disposeMaterial(object.material);
    });
    node.labelElement.remove();
  }
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) material.forEach((item) => item.dispose());
  else material.dispose();
}

function simulateLayout(nodes: SceneNode[], links: SceneLink[]): void {
  for (const node of nodes) node.force.set(0, 0, 0);

  for (let left = 0; left < nodes.length; left += 1) {
    for (let right = left + 1; right < nodes.length; right += 1) {
      const a = nodes[left];
      const b = nodes[right];
      const delta = new THREE.Vector3().subVectors(b.position, a.position);
      const distanceSquared = Math.max(delta.lengthSq(), 2.5);
      const strength = 18 / distanceSquared;
      delta.normalize().multiplyScalar(strength);
      a.force.addScaledVector(delta, -1);
      b.force.add(delta);
    }
  }

  for (const link of links) {
    const delta = new THREE.Vector3().subVectors(
      link.targetNode.position,
      link.sourceNode.position,
    );
    const distance = Math.max(delta.length(), 0.001);
    const desired = (link.cyclic ? 17 : 24) + link.sourceNode.radius + link.targetNode.radius;
    const strength = (distance - desired) * (link.cyclic ? 0.0038 : 0.0025);
    delta.multiplyScalar(strength / distance);
    link.sourceNode.force.add(delta);
    link.targetNode.force.addScaledVector(delta, -1);
  }

  for (const node of nodes) {
    node.force.addScaledVector(node.position, -0.00075);
    node.velocity.add(node.force).multiplyScalar(0.88).clampLength(0, 1.15);
    node.position.add(node.velocity);
  }
}

function updateScene(nodes: SceneNode[], links: SceneLink[], time: number): void {
  for (const node of nodes) {
    node.group.position.copy(node.position);
    if (node.glow) {
      const pulse = 1 + Math.sin(time * 0.0034 + hashUnit(node.id) * Math.PI * 2) * 0.08;
      node.glow.scale.setScalar(pulse);
    }
  }

  for (const link of links) {
    const positions = link.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    positions.setXYZ(
      0,
      link.sourceNode.position.x,
      link.sourceNode.position.y,
      link.sourceNode.position.z,
    );
    positions.setXYZ(
      1,
      link.targetNode.position.x,
      link.targetNode.position.y,
      link.targetNode.position.z,
    );
    positions.needsUpdate = true;
    if (link.line.material instanceof THREE.LineDashedMaterial) link.line.computeLineDistances();

    if (link.particle) {
      const speed = link.cyclic ? 0.00018 : 0.0001;
      const progress = (time * speed + link.phase) % 1;
      link.particle.position.lerpVectors(
        link.sourceNode.position,
        link.targetNode.position,
        progress,
      );
    }
  }
}

function installPicking(
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  currentNodes: () => SceneNode[],
  onInspect: (node: SceneNode) => void,
  onOpen: (node: SceneNode | undefined) => void,
): void {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function hit(event: MouseEvent): SceneNode | undefined {
    const nodes = currentNodes();
    const bounds = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const intersection = raycaster.intersectObjects(
      nodes.map((node) => node.body),
      false,
    )[0];
    const id = intersection?.object.userData.nodeId as string | undefined;
    return id ? nodes.find((node) => node.id === id) : undefined;
  }

  canvas.addEventListener('pointermove', (event) => {
    canvas.style.cursor = hit(event) ? 'pointer' : 'grab';
  });
  canvas.addEventListener('click', (event) => {
    const node = hit(event);
    if (node) onInspect(node);
  });
  canvas.addEventListener('dblclick', (event) => {
    event.preventDefault();
    onOpen(hit(event));
  });
}

function renderBreadcrumb(
  graph: DirectoryScopeGraph,
  onScope: (scopePath: string) => void,
): void {
  const breadcrumb = element('breadcrumb');
  breadcrumb.replaceChildren();
  graph.breadcrumbs.forEach((crumb, index) => {
    if (index > 0) breadcrumb.append(textElement('span', 'breadcrumb__separator', '/'));
    if (index === graph.breadcrumbs.length - 1) {
      breadcrumb.append(textElement('span', 'breadcrumb__current', crumb.label));
      return;
    }
    const button = textElement('button', 'breadcrumb__up', crumb.label);
    button.type = 'button';
    button.addEventListener('click', () => onScope(crumb.path));
    breadcrumb.append(button);
  });
}

function renderMetrics(graph: DirectoryScopeGraph): void {
  element('metric-primary-label').textContent = 'Items';
  element('metric-primary').textContent = String(graph.metrics.itemCount);
  element('metric-edges').textContent = String(graph.metrics.edgeCount);
}

function renderInspectorPrompt(graph: DirectoryScopeGraph): void {
  element('inspector').replaceChildren(
    textElement('p', 'inspector__eyebrow', 'Inspect an item'),
    textElement('h2', 'inspector__title', 'Click any node'),
    textElement(
      'p',
      'inspector__path',
      `Double-click a directory to open it.${graph.parentPath ? ' Press Escape to go up one directory.' : ''}`,
    ),
  );
}

function renderInspector(graph: DirectoryScopeGraph, nodeId: string): void {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return;
  const labelFor = (id: string): string =>
    graph.nodes.find((candidate) => candidate.id === id)?.label ?? id;
  const inspector = element('inspector');
  const eyebrow =
    node.kind === 'boundary'
      ? 'Boundary'
      : node.cyclic
        ? 'Runtime cycle'
        : node.kind === 'directory'
          ? 'Directory'
          : 'File';
  inspector.replaceChildren(
    textElement('p', 'inspector__eyebrow', eyebrow),
    textElement('h2', 'inspector__title', node.label),
    textElement(
      'p',
      'inspector__path',
      node.kind === 'boundary'
        ? `${node.path} — outside ${graph.scopePath}, not expandable`
        : node.path,
    ),
  );

  const facts = document.createElement('dl');
  facts.className = 'inspector__facts';
  addFact(facts, 'Imports', String(node.outDegree));
  addFact(facts, 'Imported by', String(node.inDegree));
  if (node.kind === 'directory') addFact(facts, 'Source files', String(node.files.length));
  inspector.append(facts);

  appendRelations(inspector, graph.links, node.id, labelFor);
  appendCycleGroup(inspector, graph.cycles, node.cycleGroup, labelFor);
}

function appendRelations(
  inspector: HTMLElement,
  links: Array<{ source: string; target: string }>,
  nodeId: string,
  labelFor: (id: string) => string,
): void {
  const outgoing = links
    .filter((link) => link.source === nodeId)
    .map((link) => labelFor(link.target));
  const incoming = links
    .filter((link) => link.target === nodeId)
    .map((link) => labelFor(link.source));
  inspector.append(
    textElement('p', 'inspector__line', `Needs: ${outgoing.join(', ') || 'none'}`),
    textElement('p', 'inspector__line', `Used by: ${incoming.join(', ') || 'none'}`),
  );
}

function appendCycleGroup(
  inspector: HTMLElement,
  cycles: string[][],
  cycleGroup: number | undefined,
  labelFor: (id: string) => string,
): void {
  if (cycleGroup === undefined) return;
  inspector.append(
    textElement(
      'p',
      'inspector__cycle',
      `Cycle group: ${cycles[cycleGroup].map(labelFor).join(' -> ')}`,
    ),
  );
}

function addFact(list: HTMLDListElement, label: string, value: string): void {
  list.append(textElement('dt', '', label), textElement('dd', '', value));
}

function textElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text: string,
): HTMLElementTagNameMap[K] {
  const item = document.createElement(tag);
  if (className) item.className = className;
  item.textContent = text;
  return item;
}

function requiredNode(nodes: Map<string, SceneNode>, id: string): SceneNode {
  const node = nodes.get(id);
  if (!node) throw new Error(`Missing scene node: ${id}`);
  return node;
}

function nodePath(graph: DirectoryScopeGraph, id: string): string {
  const node = graph.nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`Missing graph node: ${id}`);
  return node.path;
}

function hashUnit(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function showFailure(error: unknown): void {
  const failure = element('failure');
  failure.textContent = error instanceof Error ? error.message : String(error);
  failure.hidden = false;
}

function clearFailure(): void {
  const failure = element('failure');
  failure.textContent = '';
  failure.hidden = true;
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found as T;
}
