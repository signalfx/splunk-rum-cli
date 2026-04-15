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

import { Command } from 'commander';
import { extractManifestData } from '../utils/androidManifestUtils';
import {
  isValidFile,
  hasValidExtension,
  isValidAppId,
  isValidVersionCode,
  isValidSplunkBuildId,
  COMMON_ERROR_MESSAGES,
  validateAndPrepareToken
} from '../utils/inputValidations';
import {
  BASE_URL_PREFIX,
  API_VERSION_STRING,
  ANDROID_CONSTANTS,
  DEFAULT_DOMAIN
} from '../utils/constants';
import { UserFriendlyError } from '../utils/userFriendlyErrors';
import { createLogger, LogLevel } from '../utils/logger';
import { fetchAndroidMappingMetadata, uploadFile } from '../utils/httpUtils';
import axios from 'axios';
import { createSpinner } from '../utils/spinner';
import { formatAndroidMappingMetadata } from '../utils/metadataFormatUtils';
import path from 'path';
import { attachApiInterceptor } from '../utils/apiInterceptor';

export const androidCommand = new Command('android');

const generateURL = (type: 'upload' | 'list', realm: string, appId: string, versionCode?: string, splunkBuildId?: string): string => {
  const baseUrl = `${BASE_URL_PREFIX}.${realm}.${DEFAULT_DOMAIN}/${API_VERSION_STRING}/${ANDROID_CONSTANTS.PATH_FOR_UPLOAD}`;

  if (type === 'upload') {
    if (!versionCode) throw new Error('Version code is required for uploading.');
    let uploadUrl = `${baseUrl}/${appId}/${versionCode}`;
    if (splunkBuildId) {
      uploadUrl += `/${splunkBuildId}`;
    }
    return uploadUrl;
  }

  if (type === 'list') {
    return `${baseUrl}/${appId}/metadatas`;
  }

  throw new Error('Invalid URL type specified.');
};


const androidUploadDescription =
`
This command uploads the provided mapping.txt file. 
You need to provide the Application ID and version code of the app, and the path to the mapping file. 
Optionally, you can also include a Splunk Build ID to identify the different pre-production app builds.
`;

const androidUploadWithManifestDescription =
`
This command uploads the provided file using the packaged AndroidManifest.xml provided. 
You need to provide the path to the mapping file, and the path to the AndroidManifest.xml file.
The application ID, version code, and optional Splunk Build ID will be extracted from the manifest file. 
This command is recommended if you want to automate the upload process without manually specifying the application details.
`;

const listProguardDescription = `
This command retrieves and lists the metadata of the uploaded ProGuard mapping files.
By default, it will return the last 100 ProGuard mapping files uploaded, sorted in reverse chronological order based on the upload timestamp.
`;

interface UploadAndroidOptions {
  'path': string,
  'appId': string,
  'versionCode': string,
  'splunkBuildId': string,
  'debug'?: boolean
  'token': string,
  'realm': string,
  'dryRun'?: boolean
}

interface UploadAndroidWithManifestOptions {
  'path': string,
  'manifest': string,
  'debug'?: boolean,
  'token': string,
  'realm': string,
  'dryRun'?: boolean
}

const shortDescription = 'Upload and list zipped or unzipped Proguard/R8 mapping.txt files';

const detailedHelp = `For each respective command listed below under 'Commands', please run 'splunk-rum android <command> --help' for an overview of its usage and options`;

androidCommand
  .description(shortDescription)
  .usage('[command] [options]');

androidCommand.configureHelp({
  commandDescription: (cmd) => {
    return `${cmd.description()}\n\n${detailedHelp}`;
  }
});

androidCommand
  .command('upload')
  .showHelpAfterError(COMMON_ERROR_MESSAGES.HELP_MESSAGE_AFTER_ERROR)
  .usage('--app-id <value> --version-code <int> --path <path> [--splunk-build-id <value>]')
  .description(androidUploadDescription)
  .summary(`Uploads the Android mapping.txt file with the provided application ID, version code, and optional Splunk Build ID`)
  .requiredOption('--app-id <value>', 'Application ID')
  .requiredOption('--version-code <int>', 'Version code')
  .requiredOption('--path <path>', 'Path to the mapping file')
  .requiredOption('--realm <value>',
    'Realm for your organization (example: us0).  Can also be set using the environment variable SPLUNK_REALM',
    process.env.SPLUNK_REALM
  )
  .option(
    '--token <value>',
    'API access token. Can also be set using the environment variable SPLUNK_ACCESS_TOKEN'
  )
  .option('--splunk-build-id <value>', 'Optional Splunk Build ID for the upload')
  .option( '--dry-run', 'Preview the file that will be uploaded')
  .option('--debug', 'Enable debug logs')
  .action(async (options: UploadAndroidOptions) => {
    const spinner = createSpinner();
    const logger = createLogger(options.debug ? LogLevel.DEBUG : LogLevel.INFO, spinner);

    try {
      const token = validateAndPrepareToken(options);

      if (!options.realm || options.realm.trim() === '') {
        androidCommand.error(COMMON_ERROR_MESSAGES.REALM_NOT_SPECIFIED);
      }

      logger.debug(`Validating App ID: ${options.appId}`);
      if (!isValidAppId(options.appId)) {
        throw new UserFriendlyError(null, 'Invalid Application ID. It must be a non-empty string.');
      }

      logger.debug(`Validating Version Code: ${options.versionCode}`);
      if (!isValidVersionCode(options.versionCode)) {
        throw new UserFriendlyError(null, 'Invalid Version Code. It must be an integer.');
      }

      logger.debug(`Validating Mapping File Path: ${options.path}`);
      if (!isValidFile(options.path)) {
        throw new UserFriendlyError(null, `Invalid mapping file path: ${options.path}.`);
      }

      logger.debug(`Validating Mapping File Extension`);
      if (!hasValidExtension(options.path, '.txt', '.gz')) {
        throw new UserFriendlyError(null, `Mapping file does not have correct extension: ${options.path}.`);
      }

      logger.debug(`Validating optional Splunk Build ID: ${options.splunkBuildId}`);
      if (options.splunkBuildId && !isValidSplunkBuildId(options.splunkBuildId)) {
        throw new UserFriendlyError(null, 'Error: Invalid Splunk Build ID. It must be a non-empty string.');
      }

      logger.info(`Preparing to upload Android mapping file:
      File: ${options.path}
      App ID: ${options.appId}
      Version Code: ${options.versionCode}
      Splunk Build ID: ${options.splunkBuildId || 'Not provided'}`);

      if (options.dryRun) {
        logger.info('Dry Run complete - No file will be uploaded.');
        return;
      }

      const url = generateURL('upload', options.realm, options.appId, options.versionCode, options.splunkBuildId);
      logger.debug(`URL Endpoint: ${url}`);

      spinner.start(`Uploading Android mapping file: ${options.path}`);

      const axiosInstance = axios.create();
      attachApiInterceptor(axiosInstance, logger, url, { 
        userFriendlyMessage: 'An error occurred during mapping file upload.' 
      });

      await uploadFile({
        url: url,
        file: { filePath: options.path, fieldName: 'file' },
        token: token,
        parameters: { 
          filename: path.basename(options.path)
        },
        onProgress: options.debug ? (progressData) => {
          spinner.updateText(`Uploading: ${Math.round(progressData.progress)}%`);
        } : undefined,
      },
      axiosInstance
      );
      
      spinner.stop();
      logger.info(`Upload complete`);
    } catch (err) {
      spinner.stop();
      if (err instanceof UserFriendlyError) {
        logger.error(err.message);
        if (options.debug && err.originalError) {
          logger.debug('Error details:', err.originalError);
        }
      } else {
        logger.error('An unexpected error occurred:');
        logger.error(err);
      }
      process.exit(1);
    }
  });

androidCommand
  .command('upload-with-manifest')
  .showHelpAfterError(COMMON_ERROR_MESSAGES.HELP_MESSAGE_AFTER_ERROR)
  .usage('--manifest <path> --path <path>')
  .summary(`Uploads the Android mapping.txt file with metadata extracted from the AndroidManifest.xml file`)
  .description(androidUploadWithManifestDescription)
  .requiredOption('--manifest <path>', 'Path to the packaged AndroidManifest.xml file')
  .requiredOption('--path <path>', 'Path to the mapping.txt file')
  .requiredOption('--realm <value>',
    'Realm for your organization (example: us0).  Can also be set using the environment variable SPLUNK_REALM',
    process.env.SPLUNK_REALM
  )
  .option(
    '--token <value>',
    'API access token. Can also be set using the environment variable SPLUNK_ACCESS_TOKEN'
  )
  .option('--dry-run', 'Preview the file that will be uploaded and the parameters extracted from the AndroidManifest.xml file')
  .option('--debug', 'Enable debug logs')
  .action(async (options: UploadAndroidWithManifestOptions) => {
    const spinner = createSpinner();
    const logger = createLogger(options.debug ? LogLevel.DEBUG : LogLevel.INFO, spinner);

    try {
      const token = validateAndPrepareToken(options);

      if (!options.realm || options.realm.trim() === '') {
        androidCommand.error(COMMON_ERROR_MESSAGES.REALM_NOT_SPECIFIED);
      }
    
      logger.debug(`Validating Mapping File Path: ${options.path}`);
      if (!isValidFile(options.path)) {
        throw new UserFriendlyError(null, `Invalid mapping file path: ${options.path}.`);
      }

      logger.debug(`Validating Mapping File Extension`);
      if (!hasValidExtension(options.path, '.txt', '.gz')) {
        throw new UserFriendlyError(null, `Mapping file does not have correct extension: ${options.path}.`);
      }

      logger.debug(`Validating Manifest File Path: ${options.manifest}`);
      if (!isValidFile(options.manifest)) {
        throw new UserFriendlyError(null, `Invalid manifest file path: ${options.manifest}.`);
      }

      logger.debug(`Validating Mapping File Extension`);
      if (!hasValidExtension(options.manifest, '.xml')) {
        throw new UserFriendlyError(null, `Manifest file does not have correct extension: ${options.manifest}.`);
      }

      logger.info(`Preparing to extract parameters from ${options.manifest}`);
      const { package: appId, versionCode, splunkBuildId } = await extractManifestData(options.manifest);

      logger.debug(`Validating App ID: ${appId}`);
      if (!isValidAppId(appId)) {
        throw new UserFriendlyError(null, 'Invalid Application ID extracted from the manifest.');
      }

      logger.debug(`Validating Version Code: ${versionCode}`);
      if (!isValidVersionCode(versionCode)) {
        throw new UserFriendlyError(null, 'Invalid Version Code extracted from the manifest.');
      }

      logger.debug(`Validating optional Splunk Build ID: ${splunkBuildId}`);
      if (splunkBuildId && !isValidSplunkBuildId(splunkBuildId)) {
        throw new UserFriendlyError(null, `Invalid Splunk Build ID extracted from the manifest: ${splunkBuildId}.`);
      }

      logger.info(`Preparing to upload Android mapping file:
        File: ${options.path}
        Extracted parameters from the AndroidManifest.xml:
        - Splunk Build ID: ${splunkBuildId || 'Not provided'}
        - App ID: ${appId}
        - Version Code: ${versionCode}`);

      if (options.dryRun) {
        logger.info('Dry Run complete - No file will be uploaded.');
        return;
      }

      const url = generateURL('upload', options.realm, appId, versionCode as string, splunkBuildId as string);
      logger.debug(`URL Endpoint: ${url}`);

      spinner.start(`Uploading Android mapping file: ${options.path}`);

      const axiosInstance = axios.create();
      attachApiInterceptor(axiosInstance, logger, url, { 
        userFriendlyMessage: 'An error occurred during mapping file upload.' 
      });

      await uploadFile({
        url: url,
        file: { filePath: options.path, fieldName: 'file' },
        token: token,
        parameters: { 
          filename: path.basename(options.path)
        },
        onProgress: options.debug ? (progressData) => {
          spinner.updateText(`Uploading: ${Math.round(progressData.progress)}%`);
        } : undefined
      }, axiosInstance);

      spinner.stop();
      logger.info(`Upload complete`);
    } catch (err) {      
      spinner.stop();
      if (err instanceof UserFriendlyError) {
        logger.error(err.message);
        if (options.debug && err.originalError) {
          logger.debug('Error details:', err.originalError);
        }
      } else {
        logger.error('An unexpected error occurred:');
        logger.error(err);
      }
      process.exit(1);
    }
  });

androidCommand
  .command('list')
  .usage('--app-id <value>')
  .summary(`Retrieves list of metadata of all uploaded Proguard/R8 mapping files`)
  .requiredOption('--app-id <value>', 'Application ID')
  .requiredOption('--realm <value>',
    'Realm for your organization (example: us0).  Can also be set using the environment variable SPLUNK_REALM',
    process.env.SPLUNK_REALM
  )
  .option(
    '--token <value>',
    'API access token. Can also be set using the environment variable SPLUNK_ACCESS_TOKEN'
  )
  .showHelpAfterError(COMMON_ERROR_MESSAGES.HELP_MESSAGE_AFTER_ERROR)
  .description(listProguardDescription)
  .option('--debug', 
    'Enable debug logs')
  .action(async (options) => {
    const logger = createLogger(options.debug ? LogLevel.DEBUG : LogLevel.INFO);
    
    try {
      const token = validateAndPrepareToken(options);

      if (!options.realm || options.realm.trim() === '') {
        androidCommand.error(COMMON_ERROR_MESSAGES.REALM_NOT_SPECIFIED);
      }

      const url = generateURL('list', options.realm, options.appId);

      logger.debug(`URL Endpoint: ${url}`);

      const axiosInstance = axios.create();
      attachApiInterceptor(axiosInstance, logger, url, { 
        userFriendlyMessage: 'An error occurred while retrieving mapping file metadata.' 
      });
    
      const responseData = await fetchAndroidMappingMetadata({ url, token, axiosInstance });
      logger.info(formatAndroidMappingMetadata(responseData));
    } catch (err) {
      if (err instanceof UserFriendlyError) {
        logger.error(err.message);
        if (options.debug && err.originalError) {
          logger.debug('Error details:', err.originalError);
        }
      } else {
        logger.error('Failed to fetch metadata:');
        logger.error(err);
      }
      process.exit(1);
    }
  });

