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


import { Command, Option } from 'commander';
import { runReactNativeSourceMapUpload } from '../reactNative/uploadSourceMap';
import {
  ReactNativeJsEngine,
  ReactNativePlatform
} from '../reactNative/types';
import { COMMON_ERROR_MESSAGES, validateAndPrepareToken } from '../utils/inputValidations';
import { createLogger, LogLevel } from '../utils/logger';
import { createSpinner } from '../utils/spinner';
import { UserFriendlyError } from '../utils/userFriendlyErrors';

export const reactNativeCommand = new Command('react-native');
const reactNativeSourceMapsCommand = new Command('sourcemaps');
const reactNativeSourceMapUploadCommand = new Command('upload');

reactNativeCommand
  .description('Prepare and upload symbolication artifacts for React Native applications')
  .addCommand(reactNativeSourceMapsCommand);

reactNativeSourceMapsCommand
  .description('Manage React Native JavaScript source maps')
  .addCommand(reactNativeSourceMapUploadCommand);

reactNativeSourceMapUploadCommand
  .showHelpAfterError(COMMON_ERROR_MESSAGES.HELP_MESSAGE_AFTER_ERROR)
  .description(
    'Validate and upload final React Native source maps using IDs injected by the Splunk Metro integration. This command never modifies JavaScript or Hermes bundles.'
  )
  .addOption(
    new Option('--platform <platform>', 'Native application platform')
      .choices(['android', 'ios'])
      .makeOptionMandatory()
  )
  .addOption(
    new Option('--engine <engine>', 'React Native JavaScript engine')
      .choices(['hermes', 'jsc'])
      .makeOptionMandatory()
  )
  .option('--bundle-name <name>', 'Canonical runtime bundle name, for example index.android.bundle')
  .option('--bundle <file>', 'Path to the exact JavaScript or Hermes bundle shipped in the application')
  .option('--source-map <file>', 'Path to the final Source Map v3 file matching the shipped bundle')
  .option('--artifacts <json-file>', 'JSON catalog describing multiple final bundle/source-map pairs')
  .option('--artifacts-dir <directory>', 'Recursively discover conventional <bundle>/<bundle>.map pairs')
  .option(
    '--realm <realm>',
    'Splunk Observability Cloud realm; can also be set using SPLUNK_REALM',
    process.env.SPLUNK_REALM
  )
  .option(
    '--token <token>',
    'API access token; can also be set using SPLUNK_ACCESS_TOKEN'
  )
  .option('--strict', 'Promote inconclusive React Native source-map validation warnings to errors')
  .option('--dry-run', 'Validate and prepare final map identity without uploading')
  .option('--debug', 'Enable debug logs')
  .action(async (options: ReactNativeSourceMapCliOptions) => {
    const spinner = createSpinner();
    const logger = createLogger(options.debug ? LogLevel.DEBUG : LogLevel.INFO, spinner);
    try {
      const { realm, token } = prepareReactNativeUploadCredentials(options);
      validateReactNativeArtifactOptions(options);

      await runReactNativeSourceMapUpload({
        platform: options.platform,
        engine: options.engine,
        bundleName: options.bundleName,
        bundlePath: options.bundle,
        sourceMapPath: options.sourceMap,
        artifactsConfigPath: options.artifacts,
        artifactsDirectoryPath: options.artifactsDir,
        realm,
        token,
        strict: options.strict,
        dryRun: options.dryRun,
        debug: options.debug,
      }, { logger, spinner });
    } catch (error) {
      if (error instanceof UserFriendlyError) {
        logger.debug(error.originalError);
        logger.error(error.message);
      } else {
        logger.error('Exiting due to an unexpected error:');
        logger.error(error);
      }
      reactNativeSourceMapUploadCommand.error('');
    }
  });

interface ReactNativeSourceMapCliOptions {
  platform: ReactNativePlatform;
  engine: ReactNativeJsEngine;
  bundleName?: string;
  bundle?: string;
  sourceMap?: string;
  artifacts?: string;
  artifactsDir?: string;
  realm?: string;
  token?: string;
  strict?: boolean;
  dryRun?: boolean;
  debug?: boolean;
}

export function validateReactNativeArtifactOptions(
  options: Pick<ReactNativeSourceMapCliOptions, 'artifacts' | 'artifactsDir' | 'bundleName' | 'bundle' | 'sourceMap'>
): void {
  const scalarValues = [options.bundleName, options.bundle, options.sourceMap];
  const hasAnyScalar = scalarValues.some(value => value !== undefined);
  const hasBundleAndMap = [options.bundle, options.sourceMap]
    .every(value => typeof value === 'string' && value.trim() !== '');
  const selectedModes = [Boolean(options.artifacts), Boolean(options.artifactsDir), hasAnyScalar]
    .filter(Boolean).length;

  if (selectedModes > 1) {
    throw new UserFriendlyError(
      null,
      '--artifacts, --artifacts-dir, and scalar --bundle/--source-map options are mutually exclusive.'
    );
  }
  if (selectedModes === 0 || (hasAnyScalar && !hasBundleAndMap)) {
    throw new UserFriendlyError(
      null,
      'Provide --artifacts, --artifacts-dir, or both --bundle and --source-map. --bundle-name is optional.'
    );
  }
}

export function prepareReactNativeUploadCredentials(
  options: Pick<ReactNativeSourceMapCliOptions, 'dryRun' | 'realm' | 'token'>
): { realm: string; token: string } {
  if (options.dryRun) {
    return {
      realm: options.realm?.trim() ?? '',
      token: options.token ?? '',
    };
  }

  if (!options.realm || options.realm.trim() === '') {
    throw new UserFriendlyError(null, COMMON_ERROR_MESSAGES.REALM_NOT_SPECIFIED);
  }

  return {
    realm: options.realm.trim(),
    token: validateAndPrepareToken(options),
  };
}
