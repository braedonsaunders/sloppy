/**
 * Language-specific prompting for the LLM analyzer.
 * Provides tailored analysis instructions for different programming languages.
 */

export interface LanguageProfile {
  name: string;
  extensions: string[];
  linters: string[];
  commonIssues: string[];
  bestPractices: string[];
  testFrameworks: string[];
}

const LANGUAGE_PROFILES: Record<string, LanguageProfile> = {
  python: {
    name: 'Python',
    extensions: ['.py', '.pyw', '.pyi'],
    linters: ['ruff', 'pylint', 'flake8', 'mypy', 'pyright'],
    commonIssues: [
      'Missing type hints on function signatures',
      'Bare except clauses (should catch specific exceptions)',
      'Mutable default arguments (list/dict as default params)',
      'Not using context managers for file/resource handling',
      'Circular imports',
      'Using string formatting instead of f-strings',
      'Missing __init__.py files',
      'Not handling None returns properly',
    ],
    bestPractices: [
      'Use type hints (PEP 484)',
      'Follow PEP 8 style guide',
      'Use dataclasses or Pydantic models for data structures',
      'Use pathlib instead of os.path',
      'Use enumerate() instead of range(len())',
    ],
    testFrameworks: ['pytest', 'unittest', 'nose2'],
  },
  go: {
    name: 'Go',
    extensions: ['.go'],
    linters: ['golangci-lint', 'go vet', 'staticcheck', 'errcheck'],
    commonIssues: [
      'Unchecked errors (ignoring error returns)',
      'Goroutine leaks (unbounded goroutine creation)',
      'Race conditions (missing mutex/sync)',
      'Nil pointer dereferences',
      'Resource leaks (unclosed files, connections)',
      'Unused variables and imports',
      'Shadowed variables',
    ],
    bestPractices: [
      'Always check error returns',
      'Use defer for cleanup',
      'Keep interfaces small (1-3 methods)',
      'Use context.Context for cancellation',
      'Table-driven tests',
    ],
    testFrameworks: ['testing (stdlib)', 'testify', 'gomock'],
  },
  rust: {
    name: 'Rust',
    extensions: ['.rs'],
    linters: ['clippy', 'rustfmt'],
    commonIssues: [
      'Unnecessary cloning (clone() when borrowing suffices)',
      'Unwrap/expect on Result/Option in production code',
      'Missing error propagation with ? operator',
      'Unused imports and dead code',
      'Overly permissive visibility (pub when pub(crate) suffices)',
      'Not using iterators/combinators over manual loops',
    ],
    bestPractices: [
      'Use Result<T, E> for fallible operations',
      'Prefer &str over String for function params',
      'Use #[derive] for common traits',
      'Implement Display for custom error types',
      'Use cargo clippy for lint checking',
    ],
    testFrameworks: ['built-in #[test]', 'tokio::test', 'proptest'],
  },
  java: {
    name: 'Java',
    extensions: ['.java'],
    linters: ['checkstyle', 'spotbugs', 'PMD', 'ErrorProne'],
    commonIssues: [
      'NullPointerException risks (missing null checks)',
      'Resource leaks (not using try-with-resources)',
      'Mutable static fields',
      'Overly broad exception catching',
      'Missing @Override annotations',
      'Raw types usage (missing generics)',
    ],
    bestPractices: [
      'Use Optional<T> instead of null returns',
      'Use try-with-resources for AutoCloseable',
      'Prefer immutable objects',
      'Use records for data classes (Java 16+)',
      'Follow Google Java Style Guide',
    ],
    testFrameworks: ['JUnit 5', 'Mockito', 'AssertJ'],
  },
  ruby: {
    name: 'Ruby',
    extensions: ['.rb', '.erb'],
    linters: ['rubocop', 'reek', 'brakeman'],
    commonIssues: [
      'N+1 query problems in ActiveRecord',
      'Missing strong parameters in controllers',
      'SQL injection via string interpolation',
      'Mass assignment vulnerabilities',
      'Missing validations on models',
      'Overly complex methods (too many branches)',
    ],
    bestPractices: [
      'Follow Ruby Style Guide',
      'Use frozen_string_literal: true',
      'Prefer symbols over strings for hash keys',
      'Use guard clauses for early returns',
      'Keep methods under 10 lines',
    ],
    testFrameworks: ['RSpec', 'Minitest'],
  },
  php: {
    name: 'PHP',
    extensions: ['.php'],
    linters: ['phpstan', 'psalm', 'php-cs-fixer', 'phpmd'],
    commonIssues: [
      'SQL injection via concatenation',
      'XSS vulnerabilities (missing output escaping)',
      'Missing type declarations',
      'Deprecated function usage',
      'Mixed return types without union types',
      'Not using prepared statements',
    ],
    bestPractices: [
      'Use strict types (declare(strict_types=1))',
      'Type-hint all parameters and return types',
      'Use PSR-12 coding standard',
      'Use dependency injection',
      'Validate all user input',
    ],
    testFrameworks: ['PHPUnit', 'Pest'],
  },
};

/**
 * Get the language profile for a detected language.
 */
export function getLanguageProfile(language: string): LanguageProfile | null {
  const normalized = language.toLowerCase();
  return LANGUAGE_PROFILES[normalized] ?? null;
}

/**
 * Generate language-specific analysis instructions for the LLM.
 */
export function generateLanguagePrompt(language: string, focusAreas?: string[]): string {
  const profile = getLanguageProfile(language);

  if (!profile) {
    return `Analyze this codebase written in ${language}. Look for common issues including bugs, security vulnerabilities, code smells, and missing best practices.`;
  }

  const sections: string[] = [
    `This is a ${profile.name} codebase. Use your knowledge of ${profile.name}-specific patterns and idioms.`,
    '',
  ];

  if (profile.linters.length > 0) {
    sections.push(`Available linters for this language: ${profile.linters.join(', ')}. If any are available in the project, use them via the tool executor.`);
    sections.push('');
  }

  sections.push(`Common ${profile.name} issues to check for:`);
  for (const issue of profile.commonIssues) {
    sections.push(`  - ${issue}`);
  }
  sections.push('');

  sections.push(`${profile.name} best practices to enforce:`);
  for (const practice of profile.bestPractices) {
    sections.push(`  - ${practice}`);
  }

  if (focusAreas && focusAreas.length > 0) {
    sections.push('');
    sections.push(`Priority focus areas for this analysis: ${focusAreas.join(', ')}`);
  }

  return sections.join('\n');
}

/**
 * Detect language from file extensions present in the file list.
 */
export function detectLanguageFromFiles(files: string[]): string {
  const extCounts: Record<string, number> = {};
  const extToLang: Record<string, string> = {};

  for (const profile of Object.values(LANGUAGE_PROFILES)) {
    for (const ext of profile.extensions) {
      extToLang[ext] = profile.name.toLowerCase();
    }
  }

  // Add JS/TS
  for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']) {
    extToLang[ext] = 'typescript';
  }

  for (const file of files) {
    const ext = file.substring(file.lastIndexOf('.'));
    const lang = extToLang[ext];
    if (lang) {
      extCounts[lang] = (extCounts[lang] ?? 0) + 1;
    }
  }

  const sorted = Object.entries(extCounts).sort((a, b) => b[1] - a[1]);
  return sorted.length > 0 ? sorted[0][0] : 'unknown';
}

export { LANGUAGE_PROFILES };
