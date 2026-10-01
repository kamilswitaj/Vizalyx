import {
  db,
  type ProjectEntity,
  type AssetEntity,
  type RunEntity,
  type RunUsageEntity,
  type RunCostEntity,
} from './database';

function generateId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export interface LoadedProject {
  project: ProjectEntity;
  sourceAsset: AssetEntity;
  runs: RunEntity[];
}

export interface RunReferenceInput {
  assetId?: string;
  blob?: Blob;
}

export interface SaveRunInput {
  projectId: string;
  providerId: string;
  modelId: string;
  quality: string;
  prompt: string;
  editMode: 'ai-mask' | 'strict-mask';
  featherPixels: number;
  maskBlob: Blob;
  providerResultBlob: Blob;
  finalResultBlob: Blob;
  references?: RunReferenceInput[];
  referenceBlobs?: Blob[];
  referenceAssetIds?: string[];
  elapsedMilliseconds: number;
  providerRequestId?: string;
  status?: 'completed' | 'failed';
  error?: string;
  usage?: RunUsageEntity;
  cost?: RunCostEntity;
}

export async function createProject(
  name: string,
  sourceBlob: Blob,
  width: number,
  height: number
): Promise<LoadedProject> {
  const projectId = generateId();
  const sourceAssetId = generateId();
  const now = Date.now();

  const sourceAsset: AssetEntity = {
    id: sourceAssetId,
    projectId,
    kind: 'source',
    blob: sourceBlob,
    mimeType: sourceBlob.type || 'image/png',
    width,
    height,
    createdAt: now,
  };

  const project: ProjectEntity = {
    id: projectId,
    name: name.trim() || `Project ${new Date(now).toLocaleDateString()}`,
    createdAt: now,
    updatedAt: now,
    sourceAssetId,
  };

  await db.transaction('rw', [db.projects, db.assets], async () => {
    await db.assets.add(sourceAsset);
    await db.projects.add(project);
  });

  return {
    project,
    sourceAsset,
    runs: [],
  };
}

export async function listProjects(): Promise<ProjectEntity[]> {
  return db.projects.orderBy('updatedAt').reverse().toArray();
}

export async function loadProject(id: string): Promise<LoadedProject | null> {
  const project = await db.projects.get(id);
  if (!project) return null;

  const sourceAsset = await db.assets.get(project.sourceAssetId);
  if (!sourceAsset) return null;

  const runs = await db.runs.where('projectId').equals(id).reverse().sortBy('createdAt');

  return {
    project,
    sourceAsset,
    runs,
  };
}

export async function loadLatestProject(): Promise<LoadedProject | null> {
  const latestProject = await db.projects.orderBy('updatedAt').last();
  if (!latestProject) return null;
  return loadProject(latestProject.id);
}

export async function saveRun(input: SaveRunInput): Promise<RunEntity> {
  const runId = generateId();
  const maskAssetId = generateId();
  const providerResultAssetId = generateId();
  const finalResultAssetId = generateId();
  const now = Date.now();

  const maskAsset: AssetEntity = {
    id: maskAssetId,
    projectId: input.projectId,
    kind: 'mask',
    blob: input.maskBlob,
    mimeType: 'image/png',
    width: 0,
    height: 0,
    createdAt: now,
  };

  const providerResultAsset: AssetEntity = {
    id: providerResultAssetId,
    projectId: input.projectId,
    kind: 'provider-result',
    blob: input.providerResultBlob,
    mimeType: 'image/png',
    width: 0,
    height: 0,
    createdAt: now,
  };

  const finalResultAsset: AssetEntity = {
    id: finalResultAssetId,
    projectId: input.projectId,
    kind: 'final-result',
    blob: input.finalResultBlob,
    mimeType: 'image/png',
    width: 0,
    height: 0,
    createdAt: now,
  };

  const referenceAssets: AssetEntity[] = [];
  const allReferenceAssetIds: string[] = [];

  if (input.references && input.references.length > 0) {
    for (const ref of input.references) {
      if (ref.assetId) {
        allReferenceAssetIds.push(ref.assetId);
      } else if (ref.blob) {
        const id = generateId();
        referenceAssets.push({
          id,
          projectId: input.projectId,
          kind: 'reference',
          blob: ref.blob,
          mimeType: ref.blob.type || 'image/png',
          width: 0,
          height: 0,
          createdAt: now,
        });
        allReferenceAssetIds.push(id);
      }
    }
  } else {
    for (const id of input.referenceAssetIds ?? []) {
      allReferenceAssetIds.push(id);
    }
    for (const blob of input.referenceBlobs ?? []) {
      const id = generateId();
      referenceAssets.push({
        id,
        projectId: input.projectId,
        kind: 'reference',
        blob,
        mimeType: blob.type || 'image/png',
        width: 0,
        height: 0,
        createdAt: now,
      });
      allReferenceAssetIds.push(id);
    }
  }

  const run: RunEntity = {
    id: runId,
    projectId: input.projectId,
    createdAt: now,
    providerId: input.providerId,
    modelId: input.modelId,
    quality: input.quality,
    prompt: input.prompt,
    editMode: input.editMode,
    featherPixels: input.featherPixels,
    maskAssetId,
    providerResultAssetId,
    finalResultAssetId,
    referenceAssetIds: allReferenceAssetIds,
    elapsedMilliseconds: input.elapsedMilliseconds,
    providerRequestId: input.providerRequestId,
    status: input.status ?? 'completed',
    error: input.error,
    usage: input.usage,
    cost: input.cost,
  };

  await db.transaction('rw', [db.projects, db.assets, db.runs], async () => {
    await db.assets.bulkAdd([
      maskAsset,
      providerResultAsset,
      finalResultAsset,
      ...referenceAssets,
    ]);
    await db.runs.add(run);
    await db.projects.update(input.projectId, { updatedAt: now });
  });

  return run;
}

export async function getAssetBlob(assetId: string): Promise<Blob | null> {
  const asset = await db.assets.get(assetId);
  return asset ? asset.blob : null;
}

export async function deleteProject(projectId: string): Promise<void> {
  await db.transaction('rw', [db.projects, db.assets, db.runs], async () => {
    await db.runs.where('projectId').equals(projectId).delete();
    await db.assets.where('projectId').equals(projectId).delete();
    await db.projects.delete(projectId);
  });
}
