import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface DetectedProject {
  language: string;
  framework: string | null;
  packageManager: string | null;
  commands: {
    test: string | null;
    lint: string | null;
    build: string | null;
    typecheck: string | null;
  };
  hasGit: boolean;
  detectedFiles: string[];
}

export function detectProject(rootDir: string): DetectedProject {
  const result: DetectedProject = {
    language: 'unknown',
    framework: null,
    packageManager: null,
    commands: { test: null, lint: null, build: null, typecheck: null },
    hasGit: existsSync(join(rootDir, '.git')),
    detectedFiles: [],
  };

  // Detect by manifest files
  if (existsSync(join(rootDir, 'package.json'))) {
    result.detectedFiles.push('package.json');
    result.language = 'javascript';

    try {
      const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));

      // Detect TypeScript
      if (existsSync(join(rootDir, 'tsconfig.json')) || pkg.devDependencies?.typescript) {
        result.language = 'typescript';
        result.detectedFiles.push('tsconfig.json');
      }

      // Detect framework
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps?.next) result.framework = 'next.js';
      else if (deps?.react) result.framework = 'react';
      else if (deps?.vue) result.framework = 'vue';
      else if (deps?.svelte) result.framework = 'svelte';
      else if (deps?.angular || deps?.['@angular/core']) result.framework = 'angular';
      else if (deps?.express) result.framework = 'express';
      else if (deps?.fastify) result.framework = 'fastify';
      else if (deps?.nuxt) result.framework = 'nuxt';
      else if (deps?.astro) result.framework = 'astro';

      // Detect package manager
      if (existsSync(join(rootDir, 'pnpm-lock.yaml'))) result.packageManager = 'pnpm';
      else if (existsSync(join(rootDir, 'yarn.lock'))) result.packageManager = 'yarn';
      else if (existsSync(join(rootDir, 'bun.lockb'))) result.packageManager = 'bun';
      else result.packageManager = 'npm';

      const pm = result.packageManager;
      const run = pm === 'npm' ? 'npm run' : pm;

      // Detect commands from scripts
      if (pkg.scripts) {
        if (pkg.scripts.test) result.commands.test = `${run} test`;
        if (pkg.scripts.lint) result.commands.lint = `${run} lint`;
        if (pkg.scripts.build) result.commands.build = `${run} build`;
        if (pkg.scripts.typecheck) result.commands.typecheck = `${run} typecheck`;
        else if (pkg.scripts['type-check']) result.commands.typecheck = `${run} type-check`;
        else if (result.language === 'typescript') result.commands.typecheck = 'npx tsc --noEmit';
      }
    } catch {
      // JSON parse error
    }
  }

  // Python
  if (existsSync(join(rootDir, 'pyproject.toml'))) {
    result.language = 'python';
    result.detectedFiles.push('pyproject.toml');
    result.commands.test = 'pytest';
    result.commands.lint = 'ruff check .';

    // Check for specific tools
    try {
      const toml = readFileSync(join(rootDir, 'pyproject.toml'), 'utf-8');
      if (toml.includes('django')) result.framework = 'django';
      else if (toml.includes('fastapi')) result.framework = 'fastapi';
      else if (toml.includes('flask')) result.framework = 'flask';
    } catch {}
  } else if (existsSync(join(rootDir, 'requirements.txt'))) {
    result.language = 'python';
    result.detectedFiles.push('requirements.txt');
    result.commands.test = 'pytest';
    result.commands.lint = 'ruff check .';
  } else if (existsSync(join(rootDir, 'setup.py'))) {
    result.language = 'python';
    result.detectedFiles.push('setup.py');
    result.commands.test = 'pytest';
  }

  // Go
  if (existsSync(join(rootDir, 'go.mod'))) {
    result.language = 'go';
    result.detectedFiles.push('go.mod');
    result.commands.test = 'go test ./...';
    result.commands.lint = 'golangci-lint run';
    result.commands.build = 'go build ./...';
  }

  // Rust
  if (existsSync(join(rootDir, 'Cargo.toml'))) {
    result.language = 'rust';
    result.detectedFiles.push('Cargo.toml');
    result.commands.test = 'cargo test';
    result.commands.lint = 'cargo clippy';
    result.commands.build = 'cargo build';
    result.commands.typecheck = 'cargo check';
  }

  // Java/Kotlin
  if (existsSync(join(rootDir, 'pom.xml'))) {
    result.language = 'java';
    result.detectedFiles.push('pom.xml');
    result.commands.test = 'mvn test';
    result.commands.build = 'mvn package';
    result.framework = 'maven';
  } else if (existsSync(join(rootDir, 'build.gradle')) || existsSync(join(rootDir, 'build.gradle.kts'))) {
    result.language = existsSync(join(rootDir, 'build.gradle.kts')) ? 'kotlin' : 'java';
    result.detectedFiles.push('build.gradle');
    result.commands.test = './gradlew test';
    result.commands.build = './gradlew build';
    result.framework = 'gradle';
  }

  // Ruby
  if (existsSync(join(rootDir, 'Gemfile'))) {
    result.language = 'ruby';
    result.detectedFiles.push('Gemfile');
    result.commands.test = 'bundle exec rspec';
    result.commands.lint = 'bundle exec rubocop';
    if (existsSync(join(rootDir, 'config/application.rb'))) result.framework = 'rails';
  }

  // PHP
  if (existsSync(join(rootDir, 'composer.json'))) {
    result.language = 'php';
    result.detectedFiles.push('composer.json');
    result.commands.test = 'vendor/bin/phpunit';
    result.commands.lint = 'vendor/bin/phpstan analyse';
    if (existsSync(join(rootDir, 'artisan'))) result.framework = 'laravel';
  }

  return result;
}
