/**
 * Agentic File Browser
 *
 * Intelligently explores codebases to find files that need analysis.
 * Uses heuristics and optionally LLM to prioritize files.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { glob } from 'glob';
import type { FileContent } from '../base.js';

/**
 * Configuration for the file browser
 */
export interface FileBrowserConfig {
  /** Maximum file size to read (in bytes) */
  maxFileSize?: number;
  /** Maximum number of files to analyze per batch */
  batchSize?: number;
  /** Maximum total files to analyze */
  maxFiles?: number;
  /** File patterns to prioritize */
  priorityPatterns?: string[];
  /** File patterns to deprioritize */
  lowPriorityPatterns?: string[];
  /** Context lines to include around detected issues */
  contextLines?: number;
}

/**
 * Represents a file with its analysis priority
 */
export interface PrioritizedFile {
  path: string;
  relativePath: string;
  priority: number;
  reason: string;
  size: number;
  relatedFiles?: string[];
}

/**
 * Represents a group of related files to analyze together
 */
export interface AnalysisGroup {
  name: string;
  files: PrioritizedFile[];
  reason: string;
}

/**
 * Result of file exploration
 */
export interface ExplorationResult {
  prioritizedFiles: PrioritizedFile[];
  analysisGroups: AnalysisGroup[];
  totalFiles: number;
  skippedFiles: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<FileBrowserConfig> = {
  maxFileSize: 100 * 1024, // 100KB
  batchSize: 10,
  maxFiles: 100,
  priorityPatterns: [
    '**/index.{ts,tsx,js,jsx}',
    '**/main.{ts,tsx,js,jsx}',
    '**/app.{ts,tsx,js,jsx}',
    '**/server.{ts,tsx,js,jsx}',
    '**/api/**/*.{ts,tsx,js,jsx}',
    '**/routes/**/*.{ts,tsx,js,jsx}',
    '**/services/**/*.{ts,tsx,js,jsx}',
    '**/controllers/**/*.{ts,tsx,js,jsx}',
    '**/handlers/**/*.{ts,tsx,js,jsx}',
    '**/middleware/**/*.{ts,tsx,js,jsx}',
    '**/auth/**/*.{ts,tsx,js,jsx}',
    '**/security/**/*.{ts,tsx,js,jsx}',
  ],
  lowPriorityPatterns: [
    '**/*.test.{ts,tsx,js,jsx}',
    '**/*.spec.{ts,tsx,js,jsx}',
    '**/__tests__/**',
    '**/__mocks__/**',
    '**/fixtures/**',
    '**/examples/**',
    '**/docs/**',
    '**/*.stories.{ts,tsx,js,jsx}',
  ],
  contextLines: 3,
};

/**
 * Agentic file browser that intelligently explores codebases
 */
export class FileBrowser {
  private readonly config: Required<FileBrowserConfig>;
  private readonly rootDir: string;
  private fileCache: Map<string, FileContent> = new Map();
  private importGraph: Map<string, Set<string>> = new Map();

  constructor(rootDir: string, config: FileBrowserConfig = {}) {
    this.rootDir = rootDir;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Explore the codebase and return prioritized files
   */
  async explore(files: string[]): Promise<ExplorationResult> {
    const prioritizedFiles: PrioritizedFile[] = [];
    let skippedFiles = 0;

    // Analyze each file and assign priority
    for (const filePath of files) {
      try {
        const stats = await fs.promises.stat(filePath);

        // Skip files that are too large
        if (stats.size > this.config.maxFileSize) {
          skippedFiles++;
          continue;
        }

        const relativePath = path.relative(this.rootDir, filePath);
        const priority = this.calculatePriority(relativePath, stats.size);

        prioritizedFiles.push({
          path: filePath,
          relativePath,
          priority: priority.score,
          reason: priority.reason,
          size: stats.size,
        });
      } catch {
        skippedFiles++;
      }
    }

    // Sort by priority (highest first)
    prioritizedFiles.sort((a, b) => b.priority - a.priority);

    // Limit to maxFiles
    const limitedFiles = prioritizedFiles.slice(0, this.config.maxFiles);

    // Build import graph for related files
    await this.buildImportGraph(limitedFiles.map((f) => f.path));

    // Add related files information
    for (const file of limitedFiles) {
      file.relatedFiles = this.getRelatedFiles(file.path);
    }

    // Create analysis groups
    const analysisGroups = this.createAnalysisGroups(limitedFiles);

    return {
      prioritizedFiles: limitedFiles,
      analysisGroups,
      totalFiles: files.length,
      skippedFiles,
    };
  }

  /**
   * Get files for a specific batch
   */
  async getBatch(
    files: PrioritizedFile[],
    batchIndex: number
  ): Promise<FileContent[]> {
    const start = batchIndex * this.config.batchSize;
    const end = start + this.config.batchSize;
    const batchFiles = files.slice(start, end);

    const contents: FileContent[] = [];

    for (const file of batchFiles) {
      const content = await this.readFile(file.path);
      if (content) {
        contents.push(content);
      }
    }

    return contents;
  }

  /**
   * Read a file and cache the result
   */
  async readFile(filePath: string): Promise<FileContent | null> {
    // Check cache first
    if (this.fileCache.has(filePath)) {
      return this.fileCache.get(filePath)!;
    }

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const fileContent: FileContent = {
        path: filePath,
        content,
        lines: content.split('\n'),
      };

      this.fileCache.set(filePath, fileContent);
      return fileContent;
    } catch {
      return null;
    }
  }

  /**
   * Read multiple files
   */
  async readFiles(filePaths: string[]): Promise<FileContent[]> {
    const results = await Promise.all(filePaths.map((fp) => this.readFile(fp)));
    return results.filter((r): r is FileContent => r !== null);
  }

  /**
   * Get context around a specific line
   */
  async getContext(
    filePath: string,
    lineStart: number,
    lineEnd: number
  ): Promise<string> {
    const file = await this.readFile(filePath);
    if (!file) return '';

    const contextStart = Math.max(0, lineStart - this.config.contextLines - 1);
    const contextEnd = Math.min(
      file.lines.length,
      lineEnd + this.config.contextLines
    );

    return file.lines.slice(contextStart, contextEnd).join('\n');
  }

  /**
   * Calculate priority score for a file
   */
  private calculatePriority(
    relativePath: string,
    size: number
  ): { score: number; reason: string } {
    let score = 50; // Base score
    const reasons: string[] = [];

    // Check priority patterns (high priority files)
    const isPriority = this.config.priorityPatterns.some((pattern) =>
      this.matchGlobPattern(relativePath, pattern)
    );
    if (isPriority) {
      score += 30;
      reasons.push('matches priority pattern');
    }

    // Check low priority patterns
    const isLowPriority = this.config.lowPriorityPatterns.some((pattern) =>
      this.matchGlobPattern(relativePath, pattern)
    );
    if (isLowPriority) {
      score -= 30;
      reasons.push('test/spec file');
    }

    // Boost for certain file names
    const fileName = path.basename(relativePath).toLowerCase();
    if (
      fileName.includes('auth') ||
      fileName.includes('security') ||
      fileName.includes('login')
    ) {
      score += 20;
      reasons.push('security-related');
    }
    if (
      fileName.includes('api') ||
      fileName.includes('route') ||
      fileName.includes('handler')
    ) {
      score += 15;
      reasons.push('API endpoint');
    }
    if (fileName.includes('service') || fileName.includes('controller')) {
      score += 10;
      reasons.push('business logic');
    }
    if (
      fileName === 'index.ts' ||
      fileName === 'index.tsx' ||
      fileName === 'index.js'
    ) {
      score += 10;
      reasons.push('entry point');
    }

    // Penalize very small files (likely just re-exports)
    if (size < 500) {
      score -= 10;
      reasons.push('small file');
    }

    // Boost medium-sized files (more likely to have logic)
    if (size > 2000 && size < 20000) {
      score += 10;
      reasons.push('substantial file');
    }

    // Penalize very large files (might be generated)
    if (size > 50000) {
      score -= 20;
      reasons.push('very large file');
    }

    // Boost src directory files
    if (relativePath.startsWith('src/') || relativePath.startsWith('lib/')) {
      score += 5;
      reasons.push('source directory');
    }

    return {
      score: Math.max(0, Math.min(100, score)),
      reason: reasons.join(', ') || 'default priority',
    };
  }

  /**
   * Simple glob pattern matching
   */
  private matchGlobPattern(filePath: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\*\*/g, '{{DOUBLE_STAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/\{\{DOUBLE_STAR\}\}/g, '.*')
      .replace(/\./g, '\\.')
      .replace(/\{([^}]+)\}/g, (_, group) => `(${group.replace(/,/g, '|')})`);

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filePath);
  }

  /**
   * Build import graph to find related files
   */
  private async buildImportGraph(filePaths: string[]): Promise<void> {
    for (const filePath of filePaths) {
      const content = await this.readFile(filePath);
      if (!content) continue;

      const imports = this.extractImports(content.content, filePath);
      this.importGraph.set(filePath, imports);
    }
  }

  /**
   * Extract import paths from file content
   */
  private extractImports(content: string, currentFile: string): Set<string> {
    const imports = new Set<string>();
    const importRegex =
      /(?:import|from)\s+['"]([^'"]+)['"]/g;
    const requireRegex =
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const importPath = this.resolveImportPath(match[1]!, currentFile);
      if (importPath) imports.add(importPath);
    }
    while ((match = requireRegex.exec(content)) !== null) {
      const importPath = this.resolveImportPath(match[1]!, currentFile);
      if (importPath) imports.add(importPath);
    }

    return imports;
  }

  /**
   * Resolve relative import path to absolute path
   */
  private resolveImportPath(
    importPath: string,
    currentFile: string
  ): string | null {
    // Skip node_modules imports
    if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
      return null;
    }

    const currentDir = path.dirname(currentFile);
    let resolved = path.resolve(currentDir, importPath);

    // Try common extensions
    const extensions = ['.ts', '.tsx', '.js', '.jsx', ''];
    for (const ext of extensions) {
      const withExt = resolved + ext;
      if (this.fileCache.has(withExt)) {
        return withExt;
      }
      // Check for index files
      const indexPath = path.join(resolved, `index${ext || '.ts'}`);
      if (this.fileCache.has(indexPath)) {
        return indexPath;
      }
    }

    return null;
  }

  /**
   * Get files related to the given file (imports it or is imported by it)
   */
  private getRelatedFiles(filePath: string): string[] {
    const related = new Set<string>();

    // Files this file imports
    const imports = this.importGraph.get(filePath);
    if (imports) {
      imports.forEach((imp) => related.add(imp));
    }

    // Files that import this file
    for (const [file, fileImports] of this.importGraph) {
      if (fileImports.has(filePath)) {
        related.add(file);
      }
    }

    return Array.from(related).slice(0, 5); // Limit to 5 related files
  }

  /**
   * Create logical groups of files for analysis
   */
  private createAnalysisGroups(files: PrioritizedFile[]): AnalysisGroup[] {
    const groups: AnalysisGroup[] = [];
    const usedFiles = new Set<string>();

    // Group by directory
    const byDirectory = new Map<string, PrioritizedFile[]>();
    for (const file of files) {
      const dir = path.dirname(file.relativePath);
      if (!byDirectory.has(dir)) {
        byDirectory.set(dir, []);
      }
      byDirectory.get(dir)!.push(file);
    }

    // Create groups for directories with multiple files
    for (const [dir, dirFiles] of byDirectory) {
      if (dirFiles.length >= 2) {
        const groupName = this.generateGroupName(dir);
        groups.push({
          name: groupName,
          files: dirFiles,
          reason: `Files in ${dir} directory`,
        });
        dirFiles.forEach((f) => usedFiles.add(f.path));
      }
    }

    // Create a group for security-related files
    const securityFiles = files.filter(
      (f) =>
        !usedFiles.has(f.path) &&
        (f.relativePath.includes('auth') ||
          f.relativePath.includes('security') ||
          f.relativePath.includes('login') ||
          f.relativePath.includes('permission'))
    );
    if (securityFiles.length > 0) {
      groups.push({
        name: 'Security & Authentication',
        files: securityFiles,
        reason: 'Files related to security and authentication',
      });
      securityFiles.forEach((f) => usedFiles.add(f.path));
    }

    // Create a group for API/routes
    const apiFiles = files.filter(
      (f) =>
        !usedFiles.has(f.path) &&
        (f.relativePath.includes('api') ||
          f.relativePath.includes('route') ||
          f.relativePath.includes('handler') ||
          f.relativePath.includes('controller'))
    );
    if (apiFiles.length > 0) {
      groups.push({
        name: 'API & Routes',
        files: apiFiles,
        reason: 'API endpoints and route handlers',
      });
      apiFiles.forEach((f) => usedFiles.add(f.path));
    }

    // Create a group for remaining high-priority files
    const remainingHigh = files.filter(
      (f) => !usedFiles.has(f.path) && f.priority >= 60
    );
    if (remainingHigh.length > 0) {
      groups.push({
        name: 'Core Files',
        files: remainingHigh.slice(0, 10),
        reason: 'High-priority source files',
      });
    }

    return groups;
  }

  /**
   * Generate a human-readable group name from directory path
   */
  private generateGroupName(dirPath: string): string {
    const parts = dirPath.split('/').filter(Boolean);
    if (parts.length === 0) return 'Root Files';

    const lastPart = parts[parts.length - 1]!;
    // Capitalize first letter
    return lastPart.charAt(0).toUpperCase() + lastPart.slice(1);
  }

  /**
   * Clear file cache
   */
  clearCache(): void {
    this.fileCache.clear();
    this.importGraph.clear();
  }
}
