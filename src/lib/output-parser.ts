/**
 * Skill output parser module
 *
 * Parses structured output from skills, extracting status, issue updates,
 * and actions from skill stdout/files. Supports YAML and JSON formats.
 */

import { parse as parseYaml } from 'yaml';
import type { SkillOutput, SkillOutputStatus } from '../types/context.js';

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
 * Extract structured output block from raw pane content
 *
 * The raw output from tmux panes contains the entire Claude conversation.
 * The structured output is a YAML or JSON block typically at the end,
 * delimited by `---` markers (YAML front matter style) or code fences.
 *
 * @param rawOutput - The full pane content
 * @returns The extracted structured block, or null if not found
 */
function extractStructuredBlock(rawOutput: string): string | null {
  // Strategy 1: Look for YAML blocks with --- delimiters
  // Skills output structured data at the END, so we search from the end
  const allYamlBlocks = rawOutput.match(/---\s*\n[\s\S]*?\n---/g);
  if (allYamlBlocks) {
    // Check blocks from end to start (most recent first)
    for (let i = allYamlBlocks.length - 1; i >= 0; i--) {
      const block = allYamlBlocks[i];
      // Remove the --- delimiters
      const content = block
        .replace(/^---\s*\n/, '')
        .replace(/\n---\s*$/, '')
        .trim();
      if (content.includes('status:')) {
        return content;
      }
    }
  }

  // Strategy 2: Look for code-fenced YAML (```yaml\n...\n```)
  const fencedYamlRegex = /```ya?ml\s*\n([\s\S]*?)\n```/g;
  const fencedMatches = [...rawOutput.matchAll(fencedYamlRegex)];
  for (let i = fencedMatches.length - 1; i >= 0; i--) {
    const content = fencedMatches[i][1].trim();
    if (content.includes('status:')) {
      return content;
    }
  }

  // Strategy 3: Look for code-fenced JSON (```json\n...\n```)
  const fencedJsonRegex = /```json\s*\n([\s\S]*?)\n```/g;
  const jsonMatches = [...rawOutput.matchAll(fencedJsonRegex)];
  for (let i = jsonMatches.length - 1; i >= 0; i--) {
    const content = jsonMatches[i][1].trim();
    if (content.includes('"status"')) {
      return content;
    }
  }

  // Strategy 4: Try to find a JSON object with status field
  // Look for { ... "status": "..." ... } pattern
  const jsonObjectRegex = /\{[^{}]*"status"\s*:\s*"[A-Z_]+"/g;
  const jsonObjectMatches = [...rawOutput.matchAll(jsonObjectRegex)];
  if (jsonObjectMatches.length > 0) {
    // Try to extract the full JSON object starting from the last match
    for (let i = jsonObjectMatches.length - 1; i >= 0; i--) {
      const matchStart = jsonObjectMatches[i].index ?? 0;
      // Find the closing brace by counting braces
      let braceCount = 0;
      let endPos = matchStart;
      for (let j = matchStart; j < rawOutput.length; j++) {
        if (rawOutput[j] === '{') braceCount++;
        if (rawOutput[j] === '}') braceCount--;
        if (braceCount === 0) {
          endPos = j + 1;
          break;
        }
      }
      const jsonCandidate = rawOutput.slice(matchStart, endPos);
      const parsed = tryParseJson(jsonCandidate);
      if (parsed && typeof parsed === 'object' && 'status' in (parsed as object)) {
        return jsonCandidate;
      }
    }
  }

  return null;
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

    case 'NEEDS_WORK': {
      // Support both execute format (subtaskId) and verify format (failingSubtasks)
      const hasExecuteFormat = typeof output.subtaskId === 'string';
      const hasVerifyFormat =
        Array.isArray(output.failingSubtasks) && output.failingSubtasks.length > 0;

      if (!hasExecuteFormat && !hasVerifyFormat) {
        errors.push(
          'NEEDS_WORK requires either subtaskId (string) or failingSubtasks (array with items)'
        );
      }

      // For execute format, issues and suggestedFixes are required
      if (hasExecuteFormat && !hasVerifyFormat) {
        if (!Array.isArray(output.issues)) {
          errors.push('NEEDS_WORK with subtaskId requires issues (array)');
        }
        if (!Array.isArray(output.suggestedFixes)) {
          errors.push('NEEDS_WORK with subtaskId requires suggestedFixes (array)');
        }
      }

      // For verify format, feedbackComments and reworkIteration are expected but not required
      // The failingSubtasks array is validated above
      break;
    }

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
 * Supports both YAML and JSON formats. The function first attempts to extract
 * a structured block from raw pane content (which may contain conversation text),
 * then parses the extracted block as JSON or YAML.
 *
 * @param rawOutput - The raw output string from the skill (may be full pane content)
 * @returns Typed SkillOutput with discriminated union based on status
 * @throws SkillOutputParseError if the output cannot be parsed or is invalid
 */
export function parseSkillOutput(rawOutput: string): SkillOutput {
  if (!rawOutput || typeof rawOutput !== 'string') {
    throw new SkillOutputParseError('Skill output is empty or not a string', rawOutput ?? '');
  }

  const trimmed = rawOutput.trim();
  if (trimmed === '') {
    throw new SkillOutputParseError('Skill output is empty after trimming whitespace', rawOutput);
  }

  // First, try to extract a structured block from the raw output
  // This handles the case where rawOutput is full tmux pane content
  const extractedBlock = extractStructuredBlock(trimmed);
  const contentToParse = extractedBlock ?? trimmed;

  // Try JSON first (faster), then YAML
  let parsed = tryParseJson(contentToParse);
  if (parsed === null) {
    parsed = tryParseYaml(contentToParse);
  }

  if (parsed === null) {
    throw new SkillOutputParseError(
      'Failed to parse skill output as JSON or YAML. Ensure the output contains a valid structured block.',
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
    throw new SkillOutputParseError('Skill output missing required field: status', rawOutput);
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
    throw new SkillOutputParseError(`Invalid skill output: ${fieldErrors.join('; ')}`, rawOutput);
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
 * Handles raw tmux pane content by extracting the structured block first.
 *
 * @param rawOutput - The raw output string from the skill (may be full pane content)
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

  // First, try to extract a structured block from the raw output
  const extractedBlock = extractStructuredBlock(trimmed);
  const contentToParse = extractedBlock ?? trimmed;

  // Try JSON first, then YAML
  let parsed = tryParseJson(contentToParse);
  if (parsed === null) {
    parsed = tryParseYaml(contentToParse);
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
