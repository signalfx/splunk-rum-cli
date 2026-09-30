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


import { readFile, writeFile } from 'node:fs/promises';
import { UserFriendlyError } from '../utils/userFriendlyErrors';

const UUID_PATTERN = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

export interface PreparedSourceMapIdentity {
  sourceMapId: string;
  mapIdentityNeedsStaging: boolean;
}

/**
 * Verifies the identity carried by an executable React Native bundle and its
 * final source map. Metro establishes the identity in executable code. Hermes
 * composition is allowed to drop custom map fields, so a missing map identity
 * is recorded for later staging without modifying the generated build output.
 */
export async function prepareFinalSourceMapIdentity(
  bundlePath: string,
  sourceMapPath: string
): Promise<PreparedSourceMapIdentity> {
  const [bundle, sourceMapText] = await Promise.all([
    readFile(bundlePath),
    readFile(sourceMapPath, 'utf-8'),
  ]);
  const bundleText = bundle.toString('latin1');
  const bundleMatch = bundleText.match(
    new RegExp(`(?:__splunkRumSourceMapId=|sourceMapId=)(${UUID_PATTERN})`, 'i')
  );

  let sourceMap: Record<string, unknown>;
  try {
    sourceMap = JSON.parse(sourceMapText) as Record<string, unknown>;
  } catch (error) {
    throw new UserFriendlyError(
      error,
      `Unable to read the final React Native source map "${sourceMapPath}" as JSON.`
    );
  }

  const bundleId = bundleMatch?.[1]?.toLowerCase();
  if (!bundleId) {
    throw new UserFriendlyError(
      null,
      `The bundle "${bundlePath}" does not contain a Splunk source-map ID. Wrap Metro with @splunk/otel-react-native/metro before creating the release bundle.`
    );
  }

  const mapId = readMapId(sourceMap.sourceMapId, 'sourceMapId', sourceMapPath);
  if (mapId && bundleId !== mapId) {
    throw new UserFriendlyError(
      null,
      `The injected source-map IDs in "${bundlePath}" and "${sourceMapPath}" do not match.`
    );
  }

  const mapIdentityNeedsStaging = mapId !== bundleId;
  return { sourceMapId: bundleId, mapIdentityNeedsStaging };
}

/** Writes an upload-only copy with the exact bundle identity. */
export async function stageFinalSourceMapIdentity(
  sourceMapPath: string,
  stagedSourceMapPath: string,
  sourceMapId: string
): Promise<void> {
  let sourceMap: Record<string, unknown>;
  try {
    sourceMap = JSON.parse(await readFile(sourceMapPath, 'utf-8')) as Record<string, unknown>;
  } catch (error) {
    throw new UserFriendlyError(
      error,
      `Unable to prepare the final React Native source map "${sourceMapPath}" for upload.`
    );
  }
  const mapId = readMapId(sourceMap.sourceMapId, 'sourceMapId', sourceMapPath);
  if (mapId && mapId !== sourceMapId) {
    throw new UserFriendlyError(
      null,
      `The injected source-map ID in "${sourceMapPath}" changed during upload preparation.`
    );
  }
  sourceMap.sourceMapId = sourceMapId;
  await writeFile(stagedSourceMapPath, `${JSON.stringify(sourceMap)}\n`, 'utf-8');
}

function readMapId(value: unknown, field: string, sourceMapPath: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !new RegExp(`^${UUID_PATTERN}$`, 'i').test(value)) {
    throw new UserFriendlyError(
      null,
      `The ${field} value in "${sourceMapPath}" is not a valid UUID-shaped source-map ID.`
    );
  }
  return value.toLowerCase();
}
