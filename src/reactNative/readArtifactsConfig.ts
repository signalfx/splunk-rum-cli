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
import { UserFriendlyError } from '../utils/userFriendlyErrors';
import { ReactNativeBundleArtifactInput } from './types';

interface ArtifactConfigFile {
  bundles: Array<{
    bundleName?: string;
    bundle: string;
    sourceMap: string;
  }>;
}

export async function readReactNativeArtifactsConfig(
  configPath: string
): Promise<{ artifacts: ReactNativeBundleArtifactInput[] }> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(configPath, 'utf-8'));
  } catch (error) {
    throw new UserFriendlyError(
      error,
      `Unable to read a valid React Native artifacts configuration from "${configPath}".`
    );
  }

  if (!isArtifactConfigFile(value)) {
    throw new UserFriendlyError(
      null,
      'The React Native artifacts configuration must contain a non-empty bundles array. Every entry requires bundle and sourceMap; bundleName is optional.'
    );
  }

  const baseDirectory = path.dirname(path.resolve(configPath));
  return {
    artifacts: value.bundles.map(bundle => ({
      bundleName: bundle.bundleName,
      bundlePath: path.resolve(baseDirectory, bundle.bundle),
      sourceMapPath: path.resolve(baseDirectory, bundle.sourceMap),
    })),
  };
}

function isArtifactConfigFile(value: unknown): value is ArtifactConfigFile {
  if (!isObject(value) || !Array.isArray(value.bundles) || value.bundles.length === 0) {
    return false;
  }

  return value.bundles.every(bundle =>
    isObject(bundle) &&
    (bundle.bundleName === undefined || isNonEmptyString(bundle.bundleName)) &&
    isNonEmptyString(bundle.bundle) &&
    isNonEmptyString(bundle.sourceMap)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
