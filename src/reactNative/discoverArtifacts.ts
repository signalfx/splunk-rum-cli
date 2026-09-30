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


import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { UserFriendlyError } from '../utils/userFriendlyErrors';
import { ReactNativeBundleArtifactInput } from './types';

const INTERMEDIATE_MAP_SUFFIXES = ['.packager.map', '.compiler.map'];

/**
 * Discovers conventional React Native bundle/map pairs below one output root.
 * A final map named <bundle>.map is paired with the adjacent executable first,
 * then with a uniquely named executable elsewhere below the same root. This
 * supports both co-located exports and Android's separate assets/sourcemaps
 * directories without guessing when two candidates are possible.
 */
export async function discoverReactNativeArtifacts(
  directoryPath: string
): Promise<ReactNativeBundleArtifactInput[]> {
  const root = path.resolve(directoryPath);
  let rootStats;
  try {
    rootStats = await stat(root);
  } catch (error) {
    throw new UserFriendlyError(
      error,
      `React Native artifacts directory was not found at "${root}".`
    );
  }
  if (!rootStats.isDirectory()) {
    throw new UserFriendlyError(
      null,
      `React Native artifacts path "${root}" is not a directory.`
    );
  }

  const files = await listFilesRecursively(root);
  const fileSet = new Set(files);
  const filesByBaseName = new Map<string, string[]>();
  for (const file of files) {
    const baseName = path.basename(file);
    const existing = filesByBaseName.get(baseName) ?? [];
    existing.push(file);
    filesByBaseName.set(baseName, existing);
  }

  const pairs: ReactNativeBundleArtifactInput[] = [];
  const usedBundles = new Map<string, string>();
  const maps = files.filter(isFinalSourceMap).sort();
  for (const sourceMapPath of maps) {
    const expectedBundlePath = sourceMapPath.slice(0, -'.map'.length);
    const expectedBundleName = path.basename(expectedBundlePath);
    let bundlePath: string | undefined;

    if (fileSet.has(expectedBundlePath)) {
      bundlePath = expectedBundlePath;
    } else {
      const candidates = filesByBaseName.get(expectedBundleName) ?? [];
      if (candidates.length === 1) {
        bundlePath = candidates[0];
      } else if (candidates.length > 1) {
        throw new UserFriendlyError(
          null,
          `Unable to pair source map "${sourceMapPath}" because multiple bundles named "${expectedBundleName}" exist below "${root}". Use --artifacts with explicit bundle/map pairs.`
        );
      }
    }

    // Output directories can contain unrelated JavaScript source maps. Only
    // maps with a matching executable bundle participate in this workflow.
    if (!bundlePath) continue;

    const previousMap = usedBundles.get(bundlePath);
    if (previousMap) {
      throw new UserFriendlyError(
        null,
        `Bundle "${bundlePath}" matches more than one final source map: "${previousMap}" and "${sourceMapPath}". Use --artifacts to select the exact final map.`
      );
    }
    usedBundles.set(bundlePath, sourceMapPath);
    pairs.push({
      bundleName: expectedBundleName,
      bundlePath,
      sourceMapPath,
    });
  }

  if (pairs.length === 0) {
    throw new UserFriendlyError(
      null,
      `No React Native <bundle>/<bundle>.map pairs were found below "${root}". Generate final release bundles and maps, or use --artifacts for a custom layout.`
    );
  }
  return pairs;
}

async function listFilesRecursively(directoryPath: string): Promise<string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      return listFilesRecursively(entryPath);
    }
    return entry.isFile() ? [entryPath] : [];
  }));
  return nested.flat();
}

function isFinalSourceMap(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.endsWith('.map') &&
    !INTERMEDIATE_MAP_SUFFIXES.some(suffix => lower.endsWith(suffix));
}
