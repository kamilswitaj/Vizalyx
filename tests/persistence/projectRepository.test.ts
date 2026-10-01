import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/persistence/indexeddb/database';
import {
  createProject,
  listProjects,
  loadProject,
  saveRun,
  getAssetBlob,
  deleteProject,
} from '../../src/persistence/indexeddb/projectRepository';

describe('projectRepository', () => {
  beforeEach(async () => {
    await db.projects.clear();
    await db.assets.clear();
    await db.runs.clear();
  });

  it('creates project and stores source asset as Blob', async () => {
    const sourceBlob = new Blob(['source-bytes'], { type: 'image/png' });
    const { project, sourceAsset } = await createProject('Living Room', sourceBlob, 800, 600);

    expect(project.id).toBeDefined();
    expect(project.name).toBe('Living Room');
    expect(sourceAsset.blob).toBeInstanceOf(Blob);
    expect(sourceAsset.width).toBe(800);
    expect(sourceAsset.height).toBe(600);

    const loaded = await loadProject(project.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.project.name).toBe('Living Room');
    expect(loaded?.sourceAsset.width).toBe(800);
  });

  it('saves an immutable Run with mask, provider result, and final result assets', async () => {
    const sourceBlob = new Blob(['source'], { type: 'image/png' });
    const { project } = await createProject('Experiment 1', sourceBlob, 400, 400);

    const maskBlob = new Blob(['mask'], { type: 'image/png' });
    const providerResultBlob = new Blob(['provider-result'], { type: 'image/png' });
    const finalResultBlob = new Blob(['final-result'], { type: 'image/png' });

    const run = await saveRun({
      projectId: project.id,
      providerId: 'fake',
      modelId: 'fake-model',
      quality: 'standard',
      prompt: 'repaint the wall',
      editMode: 'strict-mask',
      featherPixels: 8,
      maskBlob,
      providerResultBlob,
      finalResultBlob,
      elapsedMilliseconds: 250,
    });

    expect(run.id).toBeDefined();
    expect(run.status).toBe('completed');
    expect(run.featherPixels).toBe(8);

    const loaded = await loadProject(project.id);
    expect(loaded?.runs).toHaveLength(1);
    expect(loaded?.runs[0]?.prompt).toBe('repaint the wall');

    // Verify assets can be fetched by ID
    const retrievedMask = await getAssetBlob(run.maskAssetId);
    expect(retrievedMask).toBeInstanceOf(Blob);
    const retrievedFinal = await getAssetBlob(run.finalResultAssetId);
    expect(retrievedFinal).toBeInstanceOf(Blob);
  });

  it('persists reference image assets with a Run', async () => {
    const sourceBlob = new Blob(['source'], { type: 'image/png' });
    const { project } = await createProject('Reference Test', sourceBlob, 400, 400);

    const maskBlob = new Blob(['mask'], { type: 'image/png' });
    const providerResultBlob = new Blob(['result'], { type: 'image/png' });
    const finalResultBlob = new Blob(['final'], { type: 'image/png' });
    const refBlob1 = new Blob(['ref1'], { type: 'image/png' });
    const refBlob2 = new Blob(['ref2'], { type: 'image/png' });

    const run = await saveRun({
      projectId: project.id,
      providerId: 'fake',
      modelId: 'fake-model',
      quality: 'standard',
      prompt: 'reference test',
      editMode: 'strict-mask',
      featherPixels: 0,
      maskBlob,
      providerResultBlob,
      finalResultBlob,
      referenceBlobs: [refBlob1, refBlob2],
      elapsedMilliseconds: 100,
    });

    expect(run.referenceAssetIds).toHaveLength(2);
    const refAsset1 = await getAssetBlob(run.referenceAssetIds[0]!);
    expect(refAsset1).toBeInstanceOf(Blob);
    const refAsset2 = await getAssetBlob(run.referenceAssetIds[1]!);
    expect(refAsset2).toBeInstanceOf(Blob);
  });

  it('reuses existing reference assets without duplicating assets in storage', async () => {
    const sourceBlob = new Blob(['source'], { type: 'image/png' });
    const { project } = await createProject('Deduplication Test', sourceBlob, 400, 400);

    const maskBlob = new Blob(['mask'], { type: 'image/png' });
    const resultBlob = new Blob(['result'], { type: 'image/png' });
    const refBlob = new Blob(['ref-bytes'], { type: 'image/png' });

    // Run 1 creates a new reference asset
    const run1 = await saveRun({
      projectId: project.id,
      providerId: 'fake',
      modelId: 'fake-model',
      quality: 'standard',
      prompt: 'first run',
      editMode: 'strict-mask',
      featherPixels: 0,
      maskBlob,
      providerResultBlob: resultBlob,
      finalResultBlob: resultBlob,
      referenceBlobs: [refBlob],
      elapsedMilliseconds: 100,
    });

    const initialAssetCount = await db.assets.where('projectId').equals(project.id).count();
    // 1 source + 1 mask + 1 providerResult + 1 finalResult + 1 reference = 5 assets
    expect(initialAssetCount).toBe(5);

    // Run 2 reuses the reference asset from Run 1 via referenceAssetIds
    const run2 = await saveRun({
      projectId: project.id,
      providerId: 'fake',
      modelId: 'fake-model',
      quality: 'standard',
      prompt: 'second run with same reference',
      editMode: 'strict-mask',
      featherPixels: 0,
      maskBlob,
      providerResultBlob: resultBlob,
      finalResultBlob: resultBlob,
      referenceAssetIds: run1.referenceAssetIds,
      elapsedMilliseconds: 100,
    });

    expect(run2.referenceAssetIds).toEqual(run1.referenceAssetIds);

    const afterAssetCount = await db.assets.where('projectId').equals(project.id).count();
    // Added 1 mask + 1 providerResult + 1 finalResult = +3 assets, 0 duplicate references!
    expect(afterAssetCount).toBe(initialAssetCount + 3);

    const refAssetCount = await db.assets
      .where('projectId')
      .equals(project.id)
      .and(a => a.kind === 'reference')
      .count();
    expect(refAssetCount).toBe(1);
  });

  it('lists projects sorted by updatedAt', async () => {
    const blob = new Blob(['img'], { type: 'image/png' });
    await createProject('Project A', blob, 100, 100);
    await createProject('Project B', blob, 100, 100);

    const list = await listProjects();
    expect(list.length).toBe(2);
  });

  it('deletes project and cascades to assets and runs', async () => {
    const blob = new Blob(['img'], { type: 'image/png' });
    const { project } = await createProject('To Delete', blob, 100, 100);
    await saveRun({
      projectId: project.id,
      providerId: 'fake',
      modelId: 'fake-model',
      quality: 'standard',
      prompt: 'test',
      editMode: 'strict-mask',
      featherPixels: 0,
      maskBlob: blob,
      providerResultBlob: blob,
      finalResultBlob: blob,
      elapsedMilliseconds: 100,
    });

    await deleteProject(project.id);

    const loaded = await loadProject(project.id);
    expect(loaded).toBeNull();

    const remainingAssets = await db.assets.where('projectId').equals(project.id).count();
    expect(remainingAssets).toBe(0);

    const remainingRuns = await db.runs.where('projectId').equals(project.id).count();
    expect(remainingRuns).toBe(0);
  });
});
