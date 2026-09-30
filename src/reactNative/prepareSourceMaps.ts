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


import path from 'node:path';
import { UserFriendlyError } from '../utils/userFriendlyErrors';
import { prepareFinalSourceMapIdentity } from './readInjectedSourceMapId';
import {
  ReactNativeBundleArtifactInput,
  ReactNativePreparedArtifact,
  ReactNativeSourceMapUploadOptions,
  ReactNativeSourceMapUploadResultV1,
} from './types';

const MAX_BUNDLES = 32;

export async function prepareReactNativeSourceMaps(
  options: ReactNativeSourceMapUploadOptions
): Promise<ReactNativeSourceMapUploadResultV1> {
  const artifacts = resolveArtifactInputs(options);
  if (artifacts.length > MAX_BUNDLES) {
    throw new UserFriendlyError(null, `A React Native build may contain at most ${MAX_BUNDLES} bundle artifacts.`);
  }

  const names = new Set<string>();
  for (const artifact of artifacts) {
    const resolvedName = resolveBundleName(artifact);
    const foldedName = resolvedName.toLowerCase();
    if (names.has(foldedName)) {
      throw new UserFriendlyError(null, `Duplicate React Native bundleName "${resolvedName}".`);
    }
    names.add(foldedName);
  }

  const prepared = await Promise.all(artifacts.map(prepareArtifact));
  prepared.sort((left, right) => left.bundleName.localeCompare(right.bundleName));
  return {
    schemaVersion: 1,
    platform: options.platform,
    jsEngine: options.engine,
    artifacts: prepared,
  };
}

export function resolveArtifactInputs(
  options: ReactNativeSourceMapUploadOptions
): ReactNativeBundleArtifactInput[] {
  if (options.artifacts && options.artifacts.length > 0) {
    return options.artifacts;
  }
  if (!options.bundlePath || !options.sourceMapPath) {
    throw new UserFriendlyError(
      null,
      'Provide --artifacts, --artifacts-dir, or both --bundle and --source-map.'
    );
  }
  return [{
    bundleName: options.bundleName,
    bundlePath: options.bundlePath,
    sourceMapPath: options.sourceMapPath,
  }];
}

async function prepareArtifact(input: ReactNativeBundleArtifactInput): Promise<ReactNativePreparedArtifact> {
  const bundleName = resolveBundleName(input);
  const identity = await prepareFinalSourceMapIdentity(input.bundlePath, input.sourceMapPath);
  return {
    bundleName,
    sourceMapId: identity.sourceMapId,
    mapIdentityNeedsStaging: identity.mapIdentityNeedsStaging,
  };
}

export function resolveBundleName(input: ReactNativeBundleArtifactInput): string {
  return normalizeBundleName(
    input.bundleName?.trim() || path.basename(input.bundlePath)
  );
}

export function normalizeBundleName(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.includes('?') ||
    normalized.includes('#') ||
    normalized.split('/').some(part => !part || part === '.' || part === '..')
  ) {
    throw new UserFriendlyError(
      null,
      `bundleName value "${value}" must be a non-empty relative logical bundle path without dot segments, a query, or a fragment.`
    );
  }
  return normalized;
}
