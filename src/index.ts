#!/usr/bin/env node

/* eslint-disable header/header */

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
import { iOSCommand } from './commands/ios';
import { androidCommand } from './commands/android';
import { sourcemapsCommand } from './commands/sourcemaps';
import { reactNativeCommand } from './commands/reactNative';
import * as packageJson from '../package.json';

const program = new Command();

const helpDescription =
`The Splunk RUM CLI is a tool for uploading Android, iOS, Browser, and React Native symbolication files to Splunk Observability Cloud.

For each respective command listed below under 'Commands', please run 'splunk-rum <command>' for an overview of available subcommands and options.

For subcommands like "upload" and "list" that make an API call, please ensure that the realm and token are either passed into the command as options, or set using the environment variables SPLUNK_REALM and SPLUNK_ACCESS_TOKEN.
`;

program
  .version(packageJson.version)
  .description(helpDescription)
  .name('splunk-rum')
  .usage('[command] [subcommand] [options]');
  
program.addCommand(iOSCommand);
program.addCommand(androidCommand);
program.addCommand(sourcemapsCommand);
program.addCommand(reactNativeCommand);

program.parseAsync(process.argv);
