/**
 * Skill output parser module
 *
 * Parses structured output from skills, extracting status, issue updates,
 * and actions from skill stdout/files. Supports YAML and JSON formats.
 */

import { parse as parseYaml } from 'yaml';
import type {
  SkillOutput,
  SkillOutputStatus,
} from '../types/context.js';

/**
 * Error thrown when skill output cannot be parsed
 */
export class SkillOutputParseError extends Error {
  constructor(
    message: string,
    public readonly rawOutput: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'SkillOutputParseError';
  }
}

/**
 * Valid status values for skill output
 */
const VALID_STATUSES: SkillOutputStatus[] = [
  'SUBTASK_COMPLETE',
  'SUBTASK_PARTIAL',
  'ALL_COMPLETE',
  'ALL_BLOCKED',
  'NO_SUBTASKS',
  'VERIFICATION_FAILED',
  'NEEDS_WORK',
  'PASS',
  'FAIL',
];

/**
 * Attempt to parse input as JSON
 */
function tryParseJson(input: string): unknown | null {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

/**
 * Attempt to parse input as YAML
 */
function tryParseYaml(input: string): unknown | null {
  try {
    const result = parseYaml(input);
    // parseYaml returns undefined for empty strings, null for explicit null
    return result ?? null;
  } catch {
    return null;
  }
}

/**
 * Validate that an object has a status field with a valid value
 */
function isValidStatus(status: unknown): status is SkillOutputStatus {
  return typeof status === 'string' && VALID_STATUSES.includes(status as SkillOutputStatus);
}

/**
 * Validate required fields for each status type
 */
function validateStatusSpecificFields(output: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const status = output.status as SkillOutputStatus;

  switch (status) {
    case 'SUBTASK_COMPLETE':
      if (typeof output.subtaskId !== 'string') {
        errors.push('SUBTASK_COMPLETE requires subtaskId (string)');
      }
      if (typeof output.commitHash !== 'string') {
        errors.push('SUBTASK_COMPLETE requires commitHash (string)');
      }
      if (!Array.isArray(output.filesModified)) {
        errors.push('SUBTASK_COMPLETE requires filesModified (array)');
      }
      if (typeof output.verificationResults !== 'object' || output.verificationResults === null) {
        errors.push('SUBTASK_COMPLETE requires verificationResults (object)');
      }
      break;

    case 'SUBTASK_PARTIAL':
      if (typeof output.subtaskId !== 'string') {
        errors.push('SUBTASK_PARTIAL requires subtaskId (string)');
      }
      if (!Array.isArray(output.progressMade)) {
        errors.push('SUBTASK_PARTIAL requires progressMade (array)');
      }
      if (!Array.isArray(output.remainingWork)) {
        errors.push('SUBTASK_PARTIAL requires remainingWork (array)');
      }
      break;

    case 'ALL_COMPLETE':
      if (typeof output.parentId !== 'string') {
        errors.push('ALL_COMPLETE requires parentId (string)');
      }
      if (typeof output.completedCount !== 'number') {
        errors.push('ALL_COMPLETE requires completedCount (number)');
      }
      break;

    case 'ALL_BLOCKED':
      if (typeof output.parentId !== 'string') {
        errors.push('ALL_BLOCKED requires parentId (string)');
      }
      if (typeof output.blockedCount !== 'number') {
        errors.push('ALL_BLOCKED requires blockedCount (number)');
      }
      if (!Array.isArray(output.waitingOn)) {
        errors.push('ALL_BLOCKED requires waitingOn (array)');
      }
      break;

    case 'NO_SUBTASKS':
      if (typeof output.parentId !== 'string') {
        errors.push('NO_SUBTASKS requires parentId (string)');
      }
      break;

    case 'VERIFICATION_FAILED':
      if (typeof output.subtaskId !== 'string') {
        errors.push('VERIFICATION_FAILED requires subtaskId (string)');
      }
      if (typeof output.errorType !== 'string') {
        errors.push('VERIFICATION_FAILED requires errorType (string)');
      }
      if (typeof output.errorOutput !== 'string') {
        errors.push('VERIFICATION_FAILED requires errorOutput (string)');
      }
      if (!Array.isArray(output.attemptedFixes)) {
        errors.push('VERIFICATION_FAILED requires attemptedFixes (array)');
      }
      if (!Array.isArray(output.uncommittedFiles)) {
        errors.push('VERIFICATION_FAILED requires uncommittedFiles (array)');
      }
      break;

    case 'NEEDS_WORK':
      if (typeof output.subtaskId !== 'string') {
        errors.push('NEEDS_WORK requires subtaskId (string)');
      }
      if (!Array.isArray(output.issues)) {
        errors.push('NEEDS_WORK requires issues (array)');
      }
      if (!Array.isArray(output.suggestedFixes)) {
        errors.push('NEEDS_WORK requires suggestedFixes (array)');
      }
      break;

    case 'PASS':
      // PASS has optional fields only
      break;

    case 'FAIL':
      if (typeof output.reason !== 'string') {
        errors.push('FAIL requires reason (string)');
      }
      break;
  }

  return errors;
}

/**
 * Parse structured output from a skill
 *
 * Supports both YAML and JSON formats. The function attempts to parse the input
 * as JSON first (for speed), then falls back to YAML parsing.
 *
 * @param rawOutput - The raw output string from the skill
 * @returns Typed SkillOutput with discriminated union based on status
 * @throws SkillOutputParseError if the output cannot be parsed or is invalid
 */
export function parseSkillOutput(rawOutput: string): SkillOutput {
  if (!rawOutput || typeof rawOutput !== 'string') {
    throw new SkillOutputParseError(
      'Skill output is empty or not a string',
      rawOutput ?? ''
    );
  }

  const trimmed = rawOutput.trim();
  if (trimmed === '') {
    throw new SkillOutputParseError(
      'Skill output is empty after trimming whitespace',
      rawOutput
    );
  }

  // Try JSON first (faster), then YAML
  let parsed = tryParseJson(trimmed);
  if (parsed === null) {
    parsed = tryParseYaml(trimmed);
  }

  if (parsed === null) {
    throw new SkillOutputParseError(
      'Failed to parse skill output as JSON or YAML. Ensure the output is valid JSON or YAML format.',
      rawOutput
    );
  }

  // Validate it's an object
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SkillOutputParseError(
      `Skill output must be an object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`,
      rawOutput
    );
  }

  const output = parsed as Record<string, unknown>;

  // Check for required 'status' field
  if (!('status' in output)) {
    throw new SkillOutputParseError(
      'Skill output missing required field: status',
      rawOutput
    );
  }

  // Validate status is a valid value
  if (!isValidStatus(output.status)) {
    throw new SkillOutputParseError(
      `Invalid status value: "${output.status}". Valid values are: ${VALID_STATUSES.join(', ')}`,
      rawOutput
    );
  }

  // Check for required 'timestamp' field
  if (!('timestamp' in output) || typeof output.timestamp !== 'string') {
    throw new SkillOutputParseError(
      'Skill output missing required field: timestamp (ISO-8601 string)',
      rawOutput
    );
  }

  // Validate status-specific required fields
  const fieldErrors = validateStatusSpecificFields(output);
  if (fieldErrors.length > 0) {
    throw new SkillOutputParseError(
      `Invalid skill output: ${fieldErrors.join('; ')}`,
      rawOutput
    );
  }

  // The output object now has all required fields validated
  // Cast to the appropriate type based on status
  // We use unknown as an intermediate cast because we've validated the fields above
  return {
    output: output as unknown as SkillOutput['output'],
  };
}

/**
 * Extract the status from skill output without full parsing
 *
 * Useful for quick status checks without validating all fields.
 *
 * @param rawOutput - The raw output string from the skill
 * @returns The status string if found, null otherwise
 */
export function extractStatus(rawOutput: string): SkillOutputStatus | null {
  if (!rawOutput || typeof rawOutput !== 'string') {
    return null;
  }

  const trimmed = rawOutput.trim();
  if (trimmed === '') {
    return null;
  }

  // Try JSON first, then YAML
  let parsed = tryParseJson(trimmed);
  if (parsed === null) {
    parsed = tryParseYaml(trimmed);
  }

  if (parsed === null || typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const output = parsed as Record<string, unknown>;
  if ('status' in output && isValidStatus(output.status)) {
    return output.status;
  }

  return null;
}

/**
 * Check if the skill output indicates completion (terminal state)
 *
 * @param status - The skill output status
 * @returns true if the status indicates a terminal state
 */
export function isTerminalStatus(status: SkillOutputStatus): boolean {
  return [
    'SUBTASK_COMPLETE',
    'ALL_COMPLETE',
    'ALL_BLOCKED',
    'NO_SUBTASKS',
    'VERIFICATION_FAILED',
    'PASS',
    'FAIL',
  ].includes(status);
}

/**
 * Check if the skill output indicates success
 *
 * @param status - The skill output status
 * @returns true if the status indicates success
 */
export function isSuccessStatus(status: SkillOutputStatus): boolean {
  return ['SUBTASK_COMPLETE', 'ALL_COMPLETE', 'PASS'].includes(status);
}

/**
 * Check if the skill output indicates failure
 *
 * @param status - The skill output status
 * @returns true if the status indicates failure
 */
export function isFailureStatus(status: SkillOutputStatus): boolean {
  return ['VERIFICATION_FAILED', 'FAIL'].includes(status);
}
