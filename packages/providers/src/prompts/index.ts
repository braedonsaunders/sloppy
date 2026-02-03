/**
 * Prompt templates and parsing utilities for AI providers
 *
 * This module contains carefully crafted prompts for code analysis, fixing, and verification.
 * These prompts can be customized or extended for specific use cases.
 */

// Analysis prompts
export {
  ANALYSIS_SYSTEM_PROMPT,
  ANALYSIS_TYPE_INSTRUCTIONS,
  generateAnalysisUserPrompt,
  parseAnalysisResponse,
  detectLanguage,
  type AnalysisType,
  type AnalysisPromptOptions,
} from './analysis.js';

// Fix prompts
export {
  FIX_SYSTEM_PROMPT,
  FIX_TYPE_INSTRUCTIONS,
  DIFF_GENERATION_INSTRUCTIONS,
  generateFixUserPrompt,
  parseFixResponse,
  type FixPromptOptions,
} from './fix.js';

// Verify prompts
export {
  VERIFY_SYSTEM_PROMPT,
  generateVerifyUserPrompt,
  generateQuickVerifyPrompt,
  parseVerifyResponse,
  type VerifyPromptOptions,
} from './verify.js';
