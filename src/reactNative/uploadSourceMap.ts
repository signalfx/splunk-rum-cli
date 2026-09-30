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


import type { SourceMapUploadContext } from '../sourcemaps';
import { getSourceMapUploadUrl, uploadSourceMap } from '../sourcemaps/uploadSourceMap';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readReactNativeArtifactsConfig } from './readArtifactsConfig';
import { discoverReactNativeArtifacts } from './discoverArtifacts';
import {
  prepareReactNativeSourceMaps,
  resolveBundleName,
  resolveArtifactInputs,
} from './prepareSourceMaps';
import {
  ReactNativeSourceMapUploadResultV1,
  ReactNativeSourceMapUploadOptions
} from './types';
import { validateReactNativeSourceMap } from './validateSourceMap';
import { UserFriendlyError } from '../utils/userFriendlyErrors';
import { stageFinalSourceMapIdentity } from './readInjectedSourceMapId';

export async function runReactNativeSourceMapUpload(
  options: ReactNativeSourceMapUploadOptions,
  context: SourceMapUploadContext
): Promise<ReactNativeSourceMapUploadResultV1> {
  const resolvedOptions = await resolveConfiguredArtifacts(options);
  const artifacts = resolveArtifactInputs(resolvedOptions);
  const validations = await Promise.all(artifacts.map(async artifact => ({
    artifact,
    result: await validateReactNativeSourceMap({
      sourceMapPath: artifact.sourceMapPath,
      engine: resolvedOptions.engine,
      strict: resolvedOptions.strict,
    }),
  })));

  validations.forEach(({ artifact, result }) => {
    context.logger.debug(
      'React Native source-map validation evidence for %s: %o',
      resolveBundleName(artifact),
      result.evidence
    );
    result.warnings.forEach(warning => context.logger.warn(`${resolveBundleName(artifact)}: ${warning}`));
  });
  const result = await prepareReactNativeSourceMaps(resolvedOptions);

  if (options.dryRun) {
    context.logger.info(JSON.stringify(result, null, 2));
    return result;
  }

  context.spinner.start('');
  let uploadedCount = 0;
  let stagingDirectory: string | undefined;
  try {
    const uploadedIds = new Set<string>();
    for (const artifact of artifacts) {
      const normalizedName = resolveBundleName(artifact);
      const preparedArtifact = result.artifacts.find(
        candidate => candidate.bundleName === normalizedName
      );
      if (!preparedArtifact || uploadedIds.has(preparedArtifact.sourceMapId)) {
        continue;
      }
      context.logger.info(
        'Upload URL: %s',
        getSourceMapUploadUrl(resolvedOptions.realm, preparedArtifact.sourceMapId)
      );
      let sourceMapPath = artifact.sourceMapPath;
      if (preparedArtifact.mapIdentityNeedsStaging) {
        stagingDirectory ??= await mkdtemp(path.join(os.tmpdir(), 'splunk-rum-rn-upload-'));
        sourceMapPath = path.join(
          stagingDirectory,
          `${uploadedCount}-${path.basename(artifact.sourceMapPath)}`
        );
        await stageFinalSourceMapIdentity(
          artifact.sourceMapPath,
          sourceMapPath,
          preparedArtifact.sourceMapId
        );
      }
      await uploadSourceMap({
        sourceMapPath,
        sourceMapId: preparedArtifact.sourceMapId,
        realm: resolvedOptions.realm,
        token: resolvedOptions.token,
        metadata: {},
      }, context);
      uploadedIds.add(preparedArtifact.sourceMapId);
      uploadedCount += 1;
    }
  } finally {
    context.spinner.stop();
    if (stagingDirectory) {
      await rm(stagingDirectory, { recursive: true, force: true });
    }
  }

  context.logger.info('%d React Native source map(s) uploaded successfully', uploadedCount);
  return result;
}

async function resolveConfiguredArtifacts(
  options: ReactNativeSourceMapUploadOptions
): Promise<ReactNativeSourceMapUploadOptions> {
  if (!options.artifactsConfigPath) {
    if (!options.artifactsDirectoryPath) {
      return options;
    }
    if (options.artifacts || options.bundleName || options.bundlePath || options.sourceMapPath) {
      throw new UserFriendlyError(null, 'An artifacts directory cannot be combined with scalar bundle options.');
    }
    const artifacts = await discoverReactNativeArtifacts(options.artifactsDirectoryPath);
    return { ...options, artifacts };
  }
  if (
    options.artifactsDirectoryPath || options.artifacts || options.bundleName ||
    options.bundlePath || options.sourceMapPath
  ) {
    throw new UserFriendlyError(null, 'An artifacts configuration cannot be combined with another artifact input mode.');
  }
  const configured = await readReactNativeArtifactsConfig(options.artifactsConfigPath);
  return { ...options, ...configured };
}
