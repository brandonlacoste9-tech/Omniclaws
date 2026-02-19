/**
 * EU AI Act Article 6 compliance - High-risk AI systems (recruitment automation)
 *
 * **Article 6**: High-risk AI systems listed in Annex III require risk management,
 * human oversight, and transparency. Recruitment AI that automates employment
 * decisions (screening, ranking, rejection) is explicitly high-risk.
 *
 * **Article 52**: Right to explanation - data subjects must be informed that
 * a decision was made by automated means and have the right to obtain human
 * intervention, express their point of view, and contest the decision.
 *
 * **Annex III(5)**: AI intended to be used for recruitment or selection of natural
 * persons, notably for advertising vacancies, screening or filtering applications.
 *
 * @see https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689
 */

import type { R2Bucket } from "@cloudflare/workers-types";

const CONFIDENCE_THRESHOLD = 0.95;

/**
 * Risk assessment result per EU AI Act Article 6.
 * High-risk AI: recruitment automation affects employment decisions (Annex III).
 */
export interface RiskAssessment {
  riskLevel: "minimal" | "high";
  confidenceScore: number;
  requiresHumanReview: boolean;
  rationale: string[];
}

export interface HighRiskAuditData {
  taskId: string;
  timestamp: string;
  decision: string;
  confidenceScore: number;
  humanReviewRequired: boolean;
  rationale: string[];
  candidateData?: Record<string, unknown>;
  jobData?: Record<string, unknown>;
}

/**
 * Assess recruitment risk per EU AI Act Article 6 Annex III.
 * Automated decisions affecting employment require human oversight when confidence < 0.95.
 *
 * @param candidateData - Candidate profile (skills, experience, etc.)
 * @param jobData - Job description and requirements
 * @returns RiskAssessment with riskLevel, confidenceScore, requiresHumanReview, rationale
 */
export function assessRecruitmentRisk(
  candidateData: Record<string, unknown>,
  jobData: Record<string, unknown>
): RiskAssessment {
  const rationale: string[] = [];
  const confidenceScore = calculateSkillsMatchScore(candidateData, jobData, rationale);

  const requiresHumanReview = confidenceScore < CONFIDENCE_THRESHOLD;
  const riskLevel = requiresHumanReview ? "high" : "minimal";

  if (requiresHumanReview) {
    rationale.push("Automated rejection proposed");
    rationale.push("Confidence below 0.95 threshold - human intervention required per Article 6");
  }

  if (confidenceScore < 0.7) {
    rationale.push("Skill mismatch detected");
  }

  return {
    riskLevel,
    confidenceScore,
    requiresHumanReview,
    rationale,
  };
}

/**
 * Mock AI scoring: skills match percentage (0.0-1.0).
 * In production: replace with actual ML model.
 */
function calculateSkillsMatchScore(
  candidateData: Record<string, unknown>,
  jobData: Record<string, unknown>,
  rationale: string[]
): number {
  const candidateSkills = (candidateData.skills as string[]) ?? [];
  const jobRequirements = (jobData.requiredSkills as string[]) ?? [];
  const jobNiceToHave = (jobData.preferredSkills as string[]) ?? [];

  if (jobRequirements.length === 0) {
    rationale.push("No job requirements specified - defaulting to moderate confidence");
    return 0.85;
  }

  const requiredMatch = jobRequirements.filter((r) =>
    candidateSkills.some((s) => String(s).toLowerCase().includes(String(r).toLowerCase()))
  ).length;
  const preferredMatch = jobNiceToHave.filter((r) =>
    candidateSkills.some((s) => String(s).toLowerCase().includes(String(r).toLowerCase()))
  ).length;

  const requiredScore = jobRequirements.length > 0 ? requiredMatch / jobRequirements.length : 1;
  const preferredScore = jobNiceToHave.length > 0 ? preferredMatch / jobNiceToHave.length : 0.5;

  const score = requiredScore * 0.8 + preferredScore * 0.2;
  const confidence = Math.min(0.99, Math.max(0.1, score + (Math.random() * 0.05 - 0.02)));

  rationale.push(
    `Skills match: ${Math.round(requiredScore * 100)}% required, ${Math.round(preferredScore * 100)}% preferred`
  );

  return confidence;
}

/**
 * Log high-risk decision to R2. Immutable write-once audit trail.
 * Path: audit/eu-ai-act/YYYY/MM/DD/{timestamp}_{taskId}.json
 *
 * Article 52: Data subjects have the right to obtain an explanation of the decision.
 * Must not fail silently - throws on R2 write failure.
 */
export async function logHighRiskDecision(
  bucket: R2Bucket,
  auditData: HighRiskAuditData
): Promise<void> {
  const now = new Date(auditData.timestamp);
  const datePath = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${String(now.getUTCDate()).padStart(2, "0")}`;
  const timestamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}${String(now.getUTCSeconds()).padStart(2, "0")}`;
  const key = `audit/eu-ai-act/${datePath}/${timestamp}_${auditData.taskId}.json`;

  const payload = {
    ...auditData,
    dataSubjectRights: "Right to explanation per Article 52",
  };

  try {
    await bucket.put(key, JSON.stringify(payload, null, 0), {
      customMetadata: {
        taskId: auditData.taskId,
        humanReviewRequired: String(auditData.humanReviewRequired),
      },
    });
  } catch (err) {
    console.error("[eu-ai-act] R2 write failed - compliance violation:", err);
    throw new Error(`EU AI Act audit log failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
