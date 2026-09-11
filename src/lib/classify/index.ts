import { classifySoftware, type SoftwareSignal } from "./software.ts";
import {
  toCategoryId,
  toContractId,
  toMethodId,
  toStatusId,
  type TorCategoryId,
  type TorContractId,
  type TorMethodId,
  type TorStatusId,
} from "./vocabulary.ts";

// Bumped whenever the rules change, so a backfill knows which TORs were
// classified by which version and what still needs redoing.
export const CLASSIFIER_VERSION = 1;

export type ClassifyInput = {
  projectName: string;
  goodsCategory?: string | null;
  procurementType?: string | null;
  procurementMethod?: string | null;
  projectStatus?: string | null;
};

export type Classification = {
  category: TorCategoryId;
  contractType: TorContractId | null;
  methodId: TorMethodId | null;
  statusId: TorStatusId | null;

  isSoftware: boolean;
  softwareScore: number;
  softwareConfidence: number;
  softwareSignals: SoftwareSignal[];

  classifiedAt: Date;
  classifierVersion: number;
};

export function classifyTor(input: ClassifyInput): Classification {
  const category = toCategoryId(input.goodsCategory);
  const contractType = toContractId(input.procurementType);

  const verdict = classifySoftware({
    title: input.projectName ?? "",
    goodsCategory: input.goodsCategory,
    procurementType: input.procurementType,
    category,
    contractType,
  });

  return {
    category,
    contractType,
    methodId: toMethodId(input.procurementMethod),
    statusId: toStatusId(input.projectStatus),

    isSoftware: verdict.isSoftware,
    softwareScore: verdict.score,
    softwareConfidence: verdict.confidence,
    softwareSignals: verdict.signals,

    classifiedAt: new Date(),
    classifierVersion: CLASSIFIER_VERSION,
  };
}

export { SOFTWARE_THRESHOLD, classifySoftware } from "./software.ts";
export * from "./vocabulary.ts";
export type { SoftwareSignal, SoftwareVerdict } from "./software.ts";
