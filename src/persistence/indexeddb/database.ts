import Dexie, { type Table } from 'dexie';

export type AssetKind = 'source' | 'reference' | 'mask' | 'provider-result' | 'final-result';

export interface ProjectEntity {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  sourceAssetId: string;
}

export interface AssetEntity {
  id: string;
  projectId: string;
  kind: AssetKind;
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
  createdAt: number;
}

export interface RunUsageEntity {
  inputTextTokens?: number;
  inputImageTokens?: number;
  outputImageTokens?: number;
  totalTokens?: number;
}

export interface RunCostEntity {
  usd: number;
  pln?: number;
  usdPlnRate?: number;
  fxEffectiveDate?: string;
  fxSource?: 'NBP';
  fxStale?: boolean;
  calculation: 'actual' | 'estimated';
  pricingId?: string;
}

export interface RunEntity {
  id: string;
  projectId: string;
  createdAt: number;
  providerId: string;
  modelId: string;
  quality: string;
  prompt: string;
  editMode: 'ai-mask' | 'strict-mask';
  featherPixels: number;
  maskAssetId: string;
  providerResultAssetId: string;
  finalResultAssetId: string;
  referenceAssetIds: string[];
  elapsedMilliseconds: number;
  providerRequestId?: string;
  status: 'completed' | 'failed';
  error?: string;
  usage?: RunUsageEntity;
  cost?: RunCostEntity;
}

export class VizalyxDatabase extends Dexie {
  projects!: Table<ProjectEntity, string>;
  assets!: Table<AssetEntity, string>;
  runs!: Table<RunEntity, string>;

  constructor() {
    super('vizalyx_db');
    this.version(1).stores({
      projects: 'id, updatedAt, createdAt',
      assets: 'id, projectId, kind, createdAt',
      runs: 'id, projectId, createdAt, status',
    });
  }
}

export const db = new VizalyxDatabase();
