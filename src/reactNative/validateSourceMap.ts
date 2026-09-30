/*
 * Copyright Splunk Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
*/


import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ReactNativeJsEngine } from './types';
import { UserFriendlyError } from '../utils/userFriendlyErrors';

export interface SourceMapValidationEvidence {
  version?: number;
  sourceCount: number;
  nameCount?: number;
  hasHermesFunctionOffsets: boolean;
  hasFacebookSources: boolean;
}

export interface SourceMapValidationResult {
  warnings: string[];
  evidence: SourceMapValidationEvidence;
}

interface SourceMapValidationOptions {
  sourceMapPath: string;
  engine: ReactNativeJsEngine;
  strict?: boolean;
}

type JsonObject = Record<string, unknown>;

export async function validateReactNativeSourceMap(
  options: SourceMapValidationOptions
): Promise<SourceMapValidationResult> {
  const { sourceMapPath, engine, strict } = options;
  const fileName = path.basename(sourceMapPath).toLowerCase();

  if (engine === 'hermes' && (fileName.endsWith('.packager.map') || fileName.endsWith('.compiler.map'))) {
    throw new UserFriendlyError(
      null,
      `The Hermes source map "${sourceMapPath}" is an intermediate React Native build artifact. Pass the final composed source map instead of a .packager.map or .compiler.map file.`
    );
  }

  let sourceMap: unknown;
  try {
    sourceMap = JSON.parse(await readFile(sourceMapPath, 'utf-8'));
  } catch (error) {
    throw new UserFriendlyError(
      error,
      `Unable to read a valid JSON source map from "${sourceMapPath}". Verify that --source-map points to the final Source Map v3 file generated for the shipped bundle.`
    );
  }

  if (!isJsonObject(sourceMap)) {
    throwValidationError(sourceMapPath, ['the root value must be a JSON object']);
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  if (sourceMap.version !== 3) {
    errors.push('version must be 3');
  }
  if ('sections' in sourceMap) {
    errors.push('indexed source maps containing "sections" are not supported');
  }
  if (!Array.isArray(sourceMap.sources) || sourceMap.sources.length === 0) {
    errors.push('sources must be a non-empty array');
  }
  if (typeof sourceMap.mappings !== 'string') {
    errors.push('mappings must be a string');
  }
  if ('names' in sourceMap && !Array.isArray(sourceMap.names)) {
    errors.push('names must be an array when present');
  }

  const sourceCount = Array.isArray(sourceMap.sources) ? sourceMap.sources.length : 0;
  const hasHermesFunctionOffsets = 'x_hermes_function_offsets' in sourceMap;
  const hasFacebookSources = 'x_facebook_sources' in sourceMap;

  if (engine === 'hermes') {
    if (!hasHermesFunctionOffsets) {
      warnings.push('the map does not contain x_hermes_function_offsets, so it may be a Metro intermediate map rather than the final Hermes-composed map');
    }
    if (sourceCount <= 1) {
      warnings.push('the map contains one or fewer original sources, so it may be a Hermes compiler intermediate map rather than the final composed map');
    }
  } else if (hasHermesFunctionOffsets) {
    errors.push('the map contains Hermes compiler metadata but --engine is jsc');
  }

  if (strict && warnings.length > 0) {
    errors.push(...warnings.map(warning => `strict validation: ${warning}`));
  }

  if (errors.length > 0) {
    throwValidationError(sourceMapPath, errors);
  }

  return {
    warnings,
    evidence: {
      version: typeof sourceMap.version === 'number' ? sourceMap.version : undefined,
      sourceCount,
      nameCount: Array.isArray(sourceMap.names) ? sourceMap.names.length : undefined,
      hasHermesFunctionOffsets,
      hasFacebookSources,
    }
  };
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function throwValidationError(sourceMapPath: string, errors: string[]): never {
  throw new UserFriendlyError(
    null,
    `The source map "${sourceMapPath}" is not compatible with React Native symbolication:\n - ${errors.join('\n - ')}`
  );
}
