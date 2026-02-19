/**
 * Q-Emplois: Recruitment AI Service (HIGH-RISK under EU AI Act Article 6)
 * Automated recruitment and candidate screening
 * Requires EU AI Act compliance, human oversight, and audit logging
 */

import { checkHighRiskCompliance } from '../compliance/eu-ai-act';
import { logAIDecision } from '../compliance/audit-logger';

export interface CandidateProfile {
  name: string;
  email: string;
  resume: string;
  skills: string[];
  experience_years: number;
  education: string;
  location: string;
}

export interface JobRequirements {
  title: string;
  required_skills: string[];
  min_experience_years: number;
  education_level: string;
  location?: string;
}

export interface RecruitmentInput {
  candidate: CandidateProfile;
  job: JobRequirements;
}

export interface RecruitmentResult {
  success: boolean;
  score: number;
  confidence: number;
  recommendation: 'hire' | 'interview' | 'reject' | 'human_review_required';
  reasoning: string;
  matchedSkills: string[];
  missingSkills: string[];
  complianceCheck: {
    passed: boolean;
    requiresHumanReview: boolean;
  };
  error?: string;
}

/**
 * Screens candidate for job position
 * This is a HIGH-RISK AI system under EU AI Act Article 6
 */
export async function screenCandidate(
  taskId: string,
  userId: string,
  input: RecruitmentInput,
  db: D1Database,
  r2: R2Bucket,
  request: Request
): Promise<RecruitmentResult> {
  try {
    // Perform candidate screening
    const screeningResult = await performScreening(input);
    
    // EU AI Act Article 6 compliance check
    const complianceCheck = await checkHighRiskCompliance(
      taskId,
      'q-emplois',
      input,
      screeningResult.confidence,
      db
    );
    
    // Log AI decision for audit trail (required by EU AI Act)
    await logAIDecision(
      userId,
      taskId,
      'q-emplois',
      screeningResult.recommendation,
      screeningResult.confidence,
      complianceCheck.assessment.decisionRationale,
      complianceCheck.requiresHumanReview,
      request,
      r2
    );
    
    // If requires human review, override recommendation
    let finalRecommendation = screeningResult.recommendation;
    if (complianceCheck.requiresHumanReview) {
      finalRecommendation = 'human_review_required';
    }
    
    return {
      success: true,
      score: screeningResult.score,
      confidence: screeningResult.confidence,
      recommendation: finalRecommendation,
      reasoning: screeningResult.reasoning,
      matchedSkills: screeningResult.matchedSkills,
      missingSkills: screeningResult.missingSkills,
      complianceCheck: {
        passed: complianceCheck.passed,
        requiresHumanReview: complianceCheck.requiresHumanReview,
      },
    };
  } catch (error) {
    return {
      success: false,
      score: 0,
      confidence: 0,
      recommendation: 'human_review_required',
      reasoning: 'Error during screening process',
      matchedSkills: [],
      missingSkills: [],
      complianceCheck: {
        passed: false,
        requiresHumanReview: true,
      },
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Performs AI-based candidate screening
 */
async function performScreening(input: RecruitmentInput): Promise<{
  score: number;
  confidence: number;
  recommendation: 'hire' | 'interview' | 'reject';
  reasoning: string;
  matchedSkills: string[];
  missingSkills: string[];
}> {
  const { candidate, job } = input;
  
  // Calculate skill match
  const candidateSkills = new Set(candidate.skills.map(s => s.toLowerCase()));
  const requiredSkills = job.required_skills.map(s => s.toLowerCase());
  
  const matchedSkills = requiredSkills.filter(skill => candidateSkills.has(skill));
  const missingSkills = requiredSkills.filter(skill => !candidateSkills.has(skill));
  
  const skillMatchRatio = matchedSkills.length / requiredSkills.length;
  
  // Calculate experience match
  const experienceMatch = candidate.experience_years >= job.min_experience_years ? 1.0 : 
                         candidate.experience_years / job.min_experience_years;
  
  // Calculate education match (simplified)
  const educationLevels = ['high_school', 'bachelor', 'master', 'phd'];
  const candidateEduLevel = educationLevels.indexOf(candidate.education.toLowerCase()) + 1;
  const requiredEduLevel = educationLevels.indexOf(job.education_level.toLowerCase()) + 1;
  const educationMatch = candidateEduLevel >= requiredEduLevel ? 1.0 : 0.5;
  
  // Calculate overall score (weighted average)
  const score = (
    skillMatchRatio * 0.5 +
    experienceMatch * 0.3 +
    educationMatch * 0.2
  );
  
  // Calculate confidence based on data quality
  // Lower confidence if missing critical information
  let confidence = 0.9;
  if (!candidate.resume || candidate.resume.length < 100) confidence -= 0.1;
  if (candidate.skills.length < 3) confidence -= 0.1;
  if (!candidate.education) confidence -= 0.05;
  
  // Ensure confidence is capped
  confidence = Math.max(0.6, Math.min(1.0, confidence));
  
  // Determine recommendation
  let recommendation: 'hire' | 'interview' | 'reject';
  if (score >= 0.8) {
    recommendation = 'hire';
  } else if (score >= 0.6) {
    recommendation = 'interview';
  } else {
    recommendation = 'reject';
  }
  
  // Generate reasoning
  const reasoning = `Candidate scored ${(score * 100).toFixed(1)}% match. ` +
    `${matchedSkills.length}/${requiredSkills.length} required skills matched. ` +
    `Experience: ${candidate.experience_years} years (required: ${job.min_experience_years}). ` +
    `Education: ${candidate.education} (required: ${job.education_level}). ` +
    `Confidence: ${(confidence * 100).toFixed(1)}%`;
  
  return {
    score,
    confidence,
    recommendation,
    reasoning,
    matchedSkills,
    missingSkills,
  };
}

/**
 * Retrieves candidates pending human review
 */
export async function getPendingReviews(
  db: D1Database
): Promise<Array<{
  taskId: string;
  userId: string;
  input: RecruitmentInput;
  screeningResult: any;
  createdAt: number;
}>> {
  const results = await db
    .prepare(
      `SELECT t.id, t.user_id, t.input, t.output, t.created_at
       FROM tasks t
       JOIN ai_risk_assessments a ON t.id = a.task_id
       WHERE t.service = 'q-emplois'
         AND a.requires_human_review = 1
         AND a.human_reviewed_at IS NULL
       ORDER BY t.created_at ASC`
    )
    .all();
  
  return (results.results || []).map((row: any) => ({
    taskId: row.id,
    userId: row.user_id,
    input: JSON.parse(row.input),
    screeningResult: row.output ? JSON.parse(row.output) : null,
    createdAt: row.created_at,
  }));
}
