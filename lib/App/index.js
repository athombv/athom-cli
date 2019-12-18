'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const Log = require('../..').Log;
const AthomApi = require('../..').AthomApi;
const AppPluginCompose = require('../AppPluginCompose');
const AppPluginZwave = require('../AppPluginZwave');
const AppPluginZigbee = require('../AppPluginZigbee');
const AppPluginRF = require('../AppPluginRF');
const AppPluginLog = require('../AppPluginLog');
const AppPluginOAuth2 = require('../AppPluginOAuth2');
const { AthomAppsAPI } = require('athom-api');

const HomeyLibApp = require('homey-lib').App;
const HomeyLibDevice = require('homey-lib').Device;
const colors = require('colors');
const inquirer = require('inquirer');
const tmp = require('tmp-promise');
const tar = require('tar-fs');
const semver = require('semver');
const gitIgnoreParser = require('gitignore-parser');
const { monitorCtrlC } = require('monitorctrlc');
const fse = require('fs-extra');
const filesize = require('filesize');
const querystring = require('querystring');
const fetch = require('node-fetch');

const statAsync = promisify( fs.stat );
const mkdirAsync = promisify( fs.mkdir );
const readFileAsync = promisify( fs.readFile );
const writeFileAsync = promisify( fs.writeFile );
const copyFileAsync = promisify( fs.copyFile );
const accessAsync = promisify( fs.access );
const readDirAsync = promisify( fs.readdir );

const GitCommands = require('../Modules/GitCommands');
const NpmCommands = require('../Modules/NpmCommands');

const PLUGINS = {
  'compose': AppPluginCompose,
  'zwave': AppPluginZwave,
  'zigbee': AppPluginZigbee,
  'rf': AppPluginRF,
  'log': AppPluginLog,
  'oauth2': AppPluginOAuth2,
};

const FLOW_TYPES = [ 'triggers', 'conditions', 'actions' ];

class App {

	constructor( appPath ) {
		this.path = appPath;
		this._app = new HomeyLibApp( this.path );
    this._appJsonPath = path.join( this.path, 'app.json' );
    this._pluginsPath = path.join( this.path, '.homeyplugins.json');
		this._exiting = false;
		this._std = {};
    this._git = new GitCommands(appPath);
  }

  async validate({ level = 'debug' } = {}) {
    Log(colors.green('✓ Validating app...'));

    try {
      await this._app.validate({ level });

      Log(colors.green(`✓ Homey App validated successfully against level \`${level}\``));
      return true;
    } catch( err ) {
      Log(colors.red(`✖ Homey App did not validate against level \`${level}\`:`));
      Log(err.message);
      return false;
    }
  }

  async build() {
    Log(colors.green('✓ Building app...'));
    await this.preprocess();

    let valid = await this.validate();
    if( valid !== true ) throw new Error('The app is not valid, please fix the validation issues first.');

    Log(colors.green('✓ App built successfully'));
  }

  async run({
    clean = false,
    skipBuild = false,
  } = {}) {

    this._session = await this.install({
      clean,
      skipBuild,
      debug: true,
    });

    const activeHomey = await AthomApi.getActiveHomey();

    clean && Log(colors.green(`✓ Purged all Homey App settings`));
    Log(colors.green(`✓ Running \`${this._session.appId}\`, press CTRL+C to quit`));
    Log(colors.grey(` — Profile your app's performance at https://go.athom.com/app-profiling?homey=${activeHomey._id}&app=${this._session.appId}`));
    Log('─────────────── Logging stdout & stderr ───────────────');

    activeHomey.devkit.on('std', this._onStd.bind(this));
    activeHomey.devkit.waitForConnection()
      .then(() => {
        return activeHomey.devkit.getAppStdOut({
          session: this._session.session
        })
      }).then( stdCache => {
        stdCache
          .map(std => {
            std.chunk = new Buffer(std.chunk);
            return std;
          })
          .forEach(this._onStd.bind(this));
      }).catch(err => {
        Log(colors.red('✖', err.message || err.toString()));
      })
    activeHomey.devkit.on('disconnect', () => {
      Log(colors.red(`✖ Connection has been lost, exiting...`));
      process.exit();
    })

    monitorCtrlC(this._onCtrlC.bind(this));
  }

  async install({
    clean = false,
    skipBuild = false,
    debug = false,
  } = {}) {

    if (skipBuild) {
      Log(colors.yellow(`\n⚠ Skipping build steps!\n`));
    } else {
      await this.preprocess();
    }

    let valid = await this.validate();
    if( valid !== true ) throw new Error('Not installing, please fix the validation issues first');

    let activeHomey = await AthomApi.getActiveHomey();

    Log(colors.green(`✓ Packing Homey App...`));

    let archiveStream = await this._getPackStream();
    let env = await this._getEnv();
    env = JSON.stringify(env);

    let form = {
      app: archiveStream,
      debug: debug,
      env: env,
      purgeSettings: clean,
    }

    Log(colors.green(`✓ Installing Homey App on \`${activeHomey.name}\` (${await activeHomey.baseUrl})...`));

    try {
      let result = await activeHomey.devkit._call('POST', '/', {
        form: form,
        opts: {
          $timeout: 1000 * 60 * 5 // 5 min
        },
      });

      Log(colors.green(`✓ Homey App \`${result.appId}\` successfully installed`));

      return result;
    } catch( err ) {
      Log(colors.red('✖', err.message || err.toString()));
      process.exit();
    }
  }

	async preprocess() {
    	Log(colors.green('✓ Pre-processing app...'));

		const appJson = await this._getAppJsonFromFolder();
		if (appJson) {
			this._isValidAppJson(appJson);
		} else throw new Error('This app.json is invalid!');

		let plugins = await this._getPlugins();
		if( plugins.length < 1 ) return;

    Log(colors.green('✓ Running plugins...'));

    for( let i = 0; i < plugins.length; i++ ) {
      let plugin = plugins[i];
      let pluginId = plugin.id;
      let pluginClass = PLUGINS[ pluginId ];

      if( typeof pluginClass !== 'function' )
        throw new Error(`Invalid plugin: ${pluginId}`);

      Log(colors.green(`✓ Running plugin \`${pluginId}\`...`));
      let pluginInstance = new pluginClass( this, plugin.options );
      try {
        await pluginInstance.run();
        Log(colors.green(`✓ Plugin \`${pluginId}\` finished`));
      } catch( err ) {
        console.trace(err)
        throw new Error(`Plugin \`${pluginId}\` did not finish:\n${err.message}\n\nAborting.`);
      }
    }

  }

  async version(version) {
    let hasCompose = await this._hasPlugin('compose');
    let appJsonPath;
    let appJson;

    if( hasCompose ) {
        let appJsonComposePath = path.join(this.path, '.homeycompose', 'app.json');
        let exists = false;
        try {
          await accessAsync(appJsonComposePath, fs.constants.R_OK | fs.constants.W_OK);
          exists = true;
        } catch( err ) {}

        if( exists ) {
          appJsonPath = appJsonComposePath;
        } else {
          appJsonPath = path.join(this.path, 'app.json');
        }
      } else {
        appJsonPath = path.join(this.path, 'app.json');
      }

      try {
        appJson = await readFileAsync( appJsonPath, 'utf8' );
        appJson = JSON.parse( appJson );
      } catch( err ) {
        if( err.code === 'ENOENT' )
          throw new Error(`Could not find a valid Homey App at \`${this.path}\``);

        throw new Error(`Error in \`app.json\`:\n${err}`);
      }

      if( semver.valid(version) ) {
        appJson.version = version;
    } else {
      if( !['minor', 'major', 'patch'].includes(version) )
        throw new Error('Invalid version. Must be either patch, minor or major.');

      appJson.version = semver.inc(appJson.version, version);
    }

    await writeFileAsync( appJsonPath, JSON.stringify(appJson, false, 2) );
    await this.build();

    Log(colors.green(`✓ Updated app.json version to  \`${appJson.version}\``));
  }

  async publish() {

    await this.preprocess();

    if ( await this._git.isGitRepo() ) {
      if( await this._git.hasUncommitedChanges() )
        throw new Error('✖ Please commit your changes to Git first.');
    }

    const valid = await this.validate({ level: 'publish' });
    if( valid !== true ) throw new Error('The app is not valid, please fix the validation issues first.');

    const archiveStream = await this._getPackStream();
    const { size } = await fse.stat(archiveStream.path);
    const env = await this._getEnv();

    const appJson = await fse.readJSON(this._appJsonPath);
    const {
      id: appId,
      version: appVersion,
    } = appJson;

    // Get or create changelog
    const changelog = await Promise.resolve().then(async () => {
      const changelogJsonPath = path.join(this.path, '.homeychangelog.json');
      const changelogJson = (await fse.pathExists(changelogJsonPath))
        ? await fse.readJson(changelogJsonPath)
        : {}

      if( !changelogJson[appVersion] || !changelogJson[appVersion]['en'] ) {
        const { text } = await inquirer.prompt([
          {
            type: 'input',
            name: 'text',
            message: `(Changelog) What's new in ${appJson.name.en} v${appJson.version}?`,
            validate: input => {
              return input.length > 3;
            }
          },
        ]);

        changelogJson[appVersion] = changelogJson[appVersion] || {};
        changelogJson[appVersion]['en'] = text;
        await fse.writeJson(changelogJsonPath, changelogJson, {
          spaces: 2,
        });

        // Commit the changelog to Git if the current path is a repo
        if ( await this._git.isGitRepo() ) {
          this._git.commitFile({
            file: changelogJsonPath,
            message: `Updated changelog for version ${appVersion}`
          });
        }
      }

      return changelogJson[appVersion];
    });

    Log(colors.grey(` — Changelog: ${changelog['en']}`));

    // Get readme
    const readme = await readFileAsync( path.join(this.path, 'README.txt' ) )
      .then(buf => buf.toString())
      .catch(err => {
        throw new Error('Missing file `/README.txt`. Please provide a README for your app. The contents of this file will be visible in the App Store.');
      });

    // Get delegation token
    Log(colors.green(`✓ Submitting ${appId}@${appVersion}...`));
    if( Object.keys(env).length ) {
      function ellipsis(str) {
        if (str.length > 10)
          return str.substr(0, 5) + '...' + str.substr(str.length-5, str.length);
        return str;
      }

      Log(colors.grey(` — Homey.env (env.json)`));
      Object.keys(env).forEach(key => {
        const value = env[key];
        Log(colors.grey(`   — ${key}=${ellipsis(value)}`));
      });
    }

    const bearer = await AthomApi.createDelegationToken({
      audience: 'apps',
    });

    const api = new AthomAppsAPI({
      bearer,
    });

    const {
      url,
      method,
      headers,
      buildId,
    } = await api.createBuild({
      env,
      appId,
      changelog,
      version: appVersion,
      readme: {
        en: readme,
      },
    }).catch(err => {
      err.message = err.name || err.message;
      throw err;
    });

    Log(colors.green(`✓ Created Build ID ${buildId}`));
    Log(colors.green(`✓ Uploading ${appId}@${appVersion} (${filesize(size)})...`));
    {
      await fetch(url, {
        method,
        headers: {
          'Content-Length': size,
          ...headers,
        },
        body: archiveStream,
      }).then(async res => {
        if(!res.ok) {
          throw new Error(res.statusText);
        }
      });
    }

    // TODO: version
    try {
      await this._git.createTag( {
        version: appVersion,
        message: changelog['en']
      });

      Log(colors.green(`✓ Succesfully created Git tag \`${appVersion}\``));
    } catch( error ) {
      throw error;
    }

    const answers =  await inquirer.prompt([
      {
        type: 'confirm',
        name: 'push',
        message: `Do you want to push the Git branch to \`remote "origin"\`?`,
        default: false
      }
    ]);

    if ( answers.push ) {
      await this._git.push();
      Log(colors.green(`✓ Succesfully pushed Git branch.`));
    }

    Log(colors.green(`✓ App ${appId}@${appVersion} successfully uploaded.`));
    Log(colors.white(`\nVisit https://developer.athom.com/apps/app/${appId}/build/${buildId} to publish your app.`));
  }

  async _hasPlugin( pluginId ) {
    let plugins = await this._getPlugins();
    for( let i = 0; i < plugins.length; i++ ) {
      let plugin = plugins[i];
      if( plugin.id === pluginId ) return true;
    }
    return false;
  }

  async _getPlugins() {
    try {
      let plugins = await readFileAsync( this._pluginsPath );
      return JSON.parse(plugins);
    } catch( err ) {
      if( err.code !== 'ENOENT' )
        throw new Error(`Error in \`.homeyplugins.json\`:\n${err}`);
    }
    return [];
  }

  async addPlugin( pluginId ) {
    if( await this._hasPlugin(pluginId) ) return;
    let plugins = await this._getPlugins();
    plugins.push({
      id: pluginId
    });
    await this._savePlugins( plugins );
  }

  async _savePlugins( plugins ) {
    await writeFileAsync( this._pluginsPath, JSON.stringify(plugins, false, 2) );
  }

  _onStd( std ) {
    if( this._exiting ) return;
    if( std.session !== this._session.session ) return;
    if( this._std[ std.id ] ) return;

    if( std.type === 'stdout' ) process.stdout.write( std.chunk );
    if( std.type === 'stderr' ) process.stderr.write( std.chunk );

    // mark std as received to prevent duplicates
    this._std[ std.id ] = true;
  }

  async _onCtrlC() {
    if( this._exiting ) return;
      this._exiting = true;

    Log('───────────────────────────────────────────────────────');
    Log(colors.green(`✓ Uninstalling \`${this._session.appId}\`...`));

    try {
      let activeHomey = await AthomApi.getActiveHomey();
      await activeHomey.devkit.stopApp({ session: this._session.session });
      Log(colors.green(`✓ Homey App \`${this._session.appId}\` successfully uninstalled`));
    } catch( err ) {
      Log(err.message || err.toString());
    }

    process.exit();

  }

  async _getEnv() {
    try {
      let data = await readFileAsync( path.join(this.path, 'env.json') );
      return JSON.parse(data);
    } catch( err ) {
      return {};
    }
  }

  /**
   * Method performs a npm prune dry run. It reads the generated JSON and based on that builds a Set of paths that need
   * to be ignored during the tar process. If anything goes wrong, an empty Set is returned (hence no paths will be pruned).
   * @returns {Promise<Set<String>>}
   * @private
   */
  async _getPrunePaths() {
    // Check if npm is available then start prune dry-run
    const npmInstalled = await NpmCommands.isNpmInstalled();
    if (npmInstalled) {
      Log(colors.green('✓ Pruning dev dependencies...'));
      return NpmCommands.getPrunePaths({path: this.path});
    }
  }

  async _getPackStream() {
    return tmp.file().then( async o => {

      let tmpPath = o.path;
      let homeyIgnore;

      try {
        let homeyIgnoreContents = await readFileAsync( path.join( this.path, '.homeyignore'), 'utf8' );
        homeyIgnore = gitIgnoreParser.compile( homeyIgnoreContents );
      } catch( err ){}

      // Get npm prune paths
      const prunePaths = await this._getPrunePaths();

			let tarOpts = {
				ignore: (name) => {

					// ignore env.json
					if( name === path.join( this.path, 'env.json' ) ) return true;

          // ignore dotfiles (.git, .gitignore, .mysecretporncollection etc.)
          if( path.basename(name).charAt(0) === '.' ) return true;

          // Check if file is a node_module file, then check if it needs to be pruned
          if (prunePaths.size > 0 && name.startsWith(path.join(this.path, 'node_modules')) && prunePaths.has(name)) return true;

          /*
          // ignore dependencies not in the production list
          if( productionPackages !== null ) {
					  const nodeModulesPath = path.join(this.path, 'node_modules');
					  if( name === nodeModulesPath ) return false;

            if (name.includes(nodeModulesPath)) {
              let found = false;
              for (let i = 0; i < productionPackages.length; i++) {
                const productionPackage = productionPackages[i];
                if (name.indexOf(productionPackage) === 0) {
                  found = true;
                  break;
                }
              }
              if (!found) {
                Log(colors.grey(` — Skipping ${name.replace(this.path, '')}`));
                return true;
              }
            }
          }
          */

          // ignore .homeyignore files
          if( homeyIgnore ) {
            return homeyIgnore.denies( name.replace(this.path, '') );
          }

          return false;
        },
        dereference: true
      };

      return new Promise((resolve, reject) => {

        let appSize = 0;
        let writeFileStream = fs.createWriteStream( tmpPath )
          .once('close', () => {
            Log(colors.grey(' — App size: ' + filesize(appSize)));
            let readFileStream = fs.createReadStream( tmpPath );
              readFileStream.once('close', () => {
                o.cleanup();
              })
            resolve( readFileStream );
          })
          .once('error', reject)

        tar
          .pack( this.path, tarOpts )
          .on('data', chunk => {
            appSize += chunk.length;
          })
          .pipe( zlib.createGzip() )
          .pipe( writeFileStream )

      });

		})
	}

  /**
   * Check if the current folder has a valid app.json.
   * @returns : Parsed JSON object or Error if no app.json was found
   * @private
   */
  async _getAppJsonFromFolder() {
    const appJsonPath = path.join(this.path, 'app.json');
    let appJson;

    try {
      appJson = await readFileAsync( appJsonPath, 'utf8' );
      appJson = JSON.parse( appJson );
    } catch( err ) {
      if( err.code === 'ENOENT' )	throw new Error(`Could not find a valid Homey App at \`${this.path}\``);

      throw new Error(`Error in \`app.json\`:\n${err}`);
    }
    return appJson;
  }

  /**
   * Check if the parsed app.json contains the keys to be a valid Homey app.
   * @param
   * @returns {Boolean} 
   *  */
  _isValidAppJson(appJson) {
    if( appJson.hasOwnProperty('id') &&
      appJson.hasOwnProperty('version') &&
      appJson.hasOwnProperty('compatibility') &&
      appJson.hasOwnProperty('name')
    ) return true;

    return false;
  }

  _validateAppJson(appJson) {
    if( this._isValidAppJson(appJson) ) return;

    throw new Error(`The found app.json does not contain the required properties for a valid Homey app!`);
  }

  /**
   * Function to get al drivers from the current path.
   * Returns: String array containing the driver id's.
   */
  async _getDrivers() {
    let driverPath = path.join( this.path, 'drivers' );
    try {
      await fse.ensureDir( driverPath );
    } catch( error ) {
      throw new Error('Your app doesn\'t contain any drivers!');
    }

    const folderContents = await readDirAsync(driverPath, { withFileTypes: true });
    let drivers = [];

    folderContents.forEach( content => {
      if( content.isDirectory() ) {
        drivers.push(content.name);
      }
    })

    return drivers;
  }

  /**
   *
   * @param {Object} param Object containing options. Message is the message to aks the user for input.
   * 					Validator is an optional validator function if the default is not sufficient.
   * @returns Object with translations.
   */
  async _getTranslatedString({ message, validator }) {
    const locales = {
      en: {
        name: '🇬🇧 English',
        value: 'en',
      },
      nl: {
        name: '🇳🇱 Nederlands',
        value: 'nl',
      },
      de: {
        name: '🇩🇪 Deutsch',
        value: 'de'
      },
      se: {
        name: '🇸🇪 Svenska',
        value: 'se'
      },
      no: {
        name: '🇳🇴 Norsk',
        value: 'no'
      },
      fr: {
        name: '🇫🇷 Français',
        value: 'fr'
      },

    }

    let translations = {};

    async function addLocale(locale) {
      const answers =  await inquirer.prompt([
        {
          type: 'input',
          name: 'translated',
          message: `[${locale}] ${message}`,
          validate: validator || (input => {
            return input.length > 0;
          })
        },
        {
          type: 'confirm',
          name: 'more',
          message: 'Do you want to add another language?',
          default: false
        }
      ]);

      translations[locale] = answers.translated;
      // Remove already translated keys.
      delete locales[locale];

      if( answers.more ) {
        const chosenLanguage = await inquirer.prompt([
          {
            type: 'list',
            name: 'language',
            message: `Select the next locale to translate`,
            choices: Object.values(locales)
          }
        ]);

        if (Object.keys(locales).length === 0) {
          Log('No more supported languages to translate.');
          return;
        }
        await addLocale( chosenLanguage.language );
      } else {
        return;
      }
    }

    await addLocale('en'); // default call and start the recursive loop

    return translations;
  }

  async migrateToCompose() {
    // Check if the current folder is a git repo. If it is, check for uncommitted changes.
    if ( await this._git.isGitRepo() ) {
      if( await this._git.hasUncommitedChanges() )
        throw new Error('Please commit changes first!');
    }

    const appJson = await this._getAppJsonFromFolder( this.path );
    this._validateAppJson( appJson );

    let drivers = await this._getDrivers();
    if( appJson.flow ) {
      var appFlowJson = appJson.flow;
      // Delete the flow section from the app JSON.
      delete appJson.flow;
    }

    const homeyComposePath = path.join(this.path, '.homeycompose');

    try {
      if ( !await fse.exists( homeyComposePath ) ) await mkdirAsync( homeyComposePath );
    } catch( err ) { console.log('Error creating folder', dir, err) }

    if( drivers && appJson.drivers ) {
      drivers.forEach(driver => {
        appJson.drivers.forEach(async driverObject => {
          if( driverObject.id === driver ) {
            // Create a driver Flow JSON object.
            let driverFlowJson = {};
            // Check for flows using this driver as filter

            if( appFlowJson ) {
              FLOW_TYPES.forEach( type => {
                if( !appFlowJson[type] ) return // Return when this type is not found in the JSON.

                appFlowJson[type].forEach( flowCard => {
                  const newArgs = [];

                  flowCard.args.forEach( argument => {
                    if( argument.hasOwnProperty('filter') && argument.filter.includes('driver') ) {
                      // Check if the filter contains a driver_id field.
                      // If it does, check if it literally matches the current driver.
                      let argumentFilter = querystring.parse(argument.filter);
                      if( driver === argumentFilter.driver_id ) {
                        delete argumentFilter.driver_id;

                        // Restore other argument properties
                        if( Object.keys(argumentFilter).length > 0 ) {
                          argument.filter = querystring.stringify(argumentFilter);
                          newArgs.push(argument);
                        }

                        // Set the new argument on the Flow Card
                        flowCard.args = newArgs;

                        if( driverFlowJson[type] ) {
                          driverFlowJson[type].push(flowCard);
                        } else {
                          driverFlowJson[type] = [
                            flowCard
                          ]
                        }

                        // Remove the Flowcard from the JSON since it has been composifyed.
                        appFlowJson[type] = appFlowJson[type].filter(filterFlowCard => {
                          if( filterFlowCard !== flowCard ) return filterFlowCard;
                        });
                      }
                    }
                  });
                });
              });
            }

            // If there are driver Flows write them to a JSON file.
            if (Object.keys(driverFlowJson).length > 0) {
              await writeFileAsync(
                path.join( this.path, 'drivers', driver, 'driver.flow.compose.json'),
                JSON.stringify( driverFlowJson, false, 2)
              );
              Log(`Created driver Flow compose file for ${driver}`);
            }

            // Driver compose stuff
            delete driverObject.id //id Should not be in the compose driver JSON.
            await writeFileAsync(
              path.join( this.path, 'drivers', driver, 'driver.compose.json'),
              JSON.stringify( driverObject, false, 2)
            );
            Log(`Created driver compose file for ${driver}`);
          }
        });
      });

      // Delete the driver section from the app JSON.
      delete appJson.drivers;
    }

    // Flow seperation
    if( appFlowJson ){
      try {
        if ( !await fse.exists( path.join(homeyComposePath, 'flow') ) ) await mkdirAsync( path.join(homeyComposePath, 'flow') );
      } catch( err ) { console.log('Error creating folder', err) }

      FLOW_TYPES.forEach( async type => {
        if( !appFlowJson[type] ) return // Return when this type is not found in the JSON.

        try {
          if ( !await fse.exists( path.join(homeyComposePath, 'flow', type) ) ) await mkdirAsync( path.join(homeyComposePath, 'flow', type) );
        } catch( err ) { console.log('Error creating folder', err) }

        // Loop over all flow cards
        appFlowJson[type].forEach( async flowCard => {
          try {
            await writeFileAsync(
              path.join( homeyComposePath, 'flow', type, `${flowCard.id}.json` ),
              JSON.stringify( flowCard, false, 2 )
            );
            console.log(`Created Flow Card '${flowCard.id}.json'`);
          } catch( err ) { console.log('Error writing flow trigger JSON', err) }
        });
      });
    }

    if( appJson.discovery ) {
      try {
        if ( !await fse.exists( path.join(homeyComposePath, 'discovery') ) ) await mkdirAsync( path.join(homeyComposePath, 'discovery') );
      } catch( err ) { console.log('Error creating folder', err) }

      Object.entries(appJson.discovery).forEach( async ([name, strategy]) => {
        try {
          await writeFileAsync(
            path.join(homeyComposePath, 'discovery', `${name.toLowerCase()}.json`),
            JSON.stringify(strategy, false, 2)
          );
          Log(`Created Discovery ${name}.json`);
        } catch( err ) { console.log('Error writing Discovery json', err) }
      })

      // Remove the discovery section from the app JSON.
      delete appJson.discovery;
    }

    try {
      await writeFileAsync(
        path.join(homeyComposePath, 'app.json'),
        JSON.stringify(appJson, false, 2)
      );
    } catch( err ) { console.log('Error writing app.json', err) }

    await this.addPlugin('compose');

    Log(colors.green(`✓ Succesfully migrated app ${appJson.id} to compose`));

  }

  async _askComposeMigration() {
    let answers = await inquirer.prompt(
      {
        type: 'confirm',
        name: 'switch_compose',
        message: 'The Homey compose plugin is not detected. Do you want to use Homey compose? It will split the app.json file into seperate files for Drivers, Flow Cards and Discovery Strategies.'
      }
    )

    return answers.switch_compose;
  }

	async createDriver() {
		const appJson = await this._getAppJsonFromFolder();
		if (appJson) {
			this._isValidAppJson(appJson);
		} else return;

		const driverName = await this._getTranslatedString( {
			message: 'What is your Driver\'s Name?'
		} );

		let answers = await inquirer.prompt([].concat(
			[
				{
					type: 'input',
					name: 'id',
					message: 'What is your Driver\'s ID?',
					default: () => {
						let name = driverName.en; // Always use the en name to create a driver id
							name = name.toLowerCase();
							name = name.replace(/ /g, '-');
							name = name.replace(/[^0-9a-zA-Z-_]+/g, '');
						return name;
					},
					validate: async input => {
						if( input.search(/^[a-zA-Z0-9-_]+$/) === -1 )
							throw new Error('Invalid characters: only use [a-zA-Z0-9-_]');

            if( await fse.exists( path.join(this.path, 'drivers', input) ) )
              throw new Error('Driver directory already exists!');

            return true;
          }
        },
        {
          type: 'list',
          name: 'class',
          message: 'What is your Driver\'s Device Class?',
          choices: () => {
            let classes = HomeyLibDevice.getClasses();
            return Object.keys(classes)
              .sort(( a, b ) => {
                a = classes[a];
                b = classes[b];
                return a.title.en.localeCompare( b.title.en )
              })
              .map( classId => {
                return {
                  name: classes[classId].title.en + colors.grey(` (${classId})`),
                  value: classId,
                }
              })
          }
        },
        {
          type: 'checkbox',
          name: 'capabilities',
          message: 'What are your Driver\'s Capabilities?',
          choices: () => {
            let capabilities = HomeyLibDevice.getCapabilities();
            return Object.keys(capabilities)
              .sort(( a, b ) => {
                a = capabilities[a];
                b = capabilities[b];
                return a.title.en.localeCompare( b.title.en )
              })
              .map( capabilityId => {
                let capability = capabilities[capabilityId];
                return {
                  name: capability.title.en + colors.grey(` (${capabilityId})`),
                  value: capabilityId,
                }
              })
          }
        },
      ],

      // TODO pair

			AppPluginZwave.createDriverQuestions(),
			AppPluginZigbee.createDriverQuestions(),
			AppPluginRF.createDriverQuestions(),
			[
				{
					type: 'confirm',
					name: 'createDiscovery',
					default: false,
					message: 'Do you want to create a Discovery strategy to find your device automatically in the IP network?'
				},
			],
			[
				{
					type: 'confirm',
					name: 'confirm',
					message: 'Seems good?'
				}
			]
		));

    if( !answers.confirm ) return;

		let driverId = answers.id;
		let driverPath = path.join( this.path, 'drivers', driverId );
		let driverJson = {
			id: driverId,
			name: driverName,
			class: answers.class,
			capabilities: answers.capabilities,
			images: {
				large: `/drivers/${driverId}/assets/images/large.png`,
				small: `/drivers/${driverId}/assets/images/small.png`,
			},
		}

		await fse.ensureDir( driverPath );
		await fse.ensureDir( path.join(driverPath, 'assets') );
		await fse.ensureDir( path.join(driverPath, 'assets', 'images') );

    let templatePath = path.join(__dirname, '..', '..', 'assets', 'templates', 'app', 'drivers');
    await copyFileAsync( path.join(templatePath, 'driver.js'), path.join(driverPath, 'driver.js') );
    await copyFileAsync( path.join(templatePath, 'device.js'), path.join(driverPath, 'device.js') );

    if( answers.isZwave ) {
      await AppPluginZwave.createDriver({
        driverId,
        driverPath,
        answers,
        driverJson,
        app: this,
      });
    }

    if( answers.isZigbee ) {
      await AppPluginZigbee.createDriver({
        driverId,
        driverPath,
        answers,
        driverJson,
        app: this,
      });
    }

    if( answers.isRf ) {
      await AppPluginRF.createDriver({
        driverId,
        driverPath,
        answers,
        driverJson,
        app: this,
      });
    }

		let hasCompose = await this._hasPlugin('compose');
		if( hasCompose ) {
			if( answers.createDiscovery === true ) {
				await this.createDiscoveryStrategy();
			}

      if( driverJson.settings ) {
        let driverJsonSettings = driverJson.settings;
        delete driverJson.settings;
        await writeFileAsync( path.join(driverPath, 'driver.settings.compose.json'), JSON.stringify(driverJsonSettings, false, 2) );
      }

      if( driverJson.flow ) {
        let driverJsonFlow = driverJson.flow;
        delete driverJson.flow;
        await writeFileAsync( path.join(driverPath, 'driver.flow.compose.json'), JSON.stringify(driverJsonFlow, false, 2) );
      }

      await writeFileAsync( path.join(driverPath, 'driver.compose.json'), JSON.stringify(driverJson, false, 2) );

    } else {
      let appJsonPath = path.join(this.path, 'app.json');
      let appJson = await readFileAsync( appJsonPath );
        appJson = appJson.toString();
        appJson = JSON.parse(appJson);
        appJson.drivers = appJson.drivers || [];
        appJson.drivers.push( driverJson );

      await writeFileAsync( appJsonPath, JSON.stringify(appJson, false, 2) );
    }

    Log(colors.green(`✓ Driver created in \`${driverPath}\``));

  }

  async changeDriverCapabilities() {
    let hasCompose = await this._hasPlugin('compose');
    if( !hasCompose ) {
      if( await this._askComposeMigration() ) {
        await this.migrateToCompose();
      } else {
        throw new Error("This command requires the compose plugin to be enabled!");
      }
    }

    let drivers = await this._getDrivers();

    const selectedDriverAnswer = await inquirer.prompt([
      {
        type: 'list',
        name: 'driverId',
        message: 'For which driver do you want to change the capabilities?',
        choices: () => {
          return drivers;
        }
      }
    ]);

    const driverJsonPath = path.join(this.path, 'drivers', selectedDriverAnswer.driverId, 'driver.compose.json');

    let driverJson;
    try {
      driverJson = await readFileAsync( driverJsonPath, 'utf8' );
      driverJson = JSON.parse( driverJson );
    } catch( err ) {
      if( err.code === 'ENOENT' )
        throw new Error(`Could not find a valid driver.compose JSON at \`${driverJsonPath}\``);

      throw new Error(`Error in \`driver.compose.json.json\`:\n${err}`);
    }

    Log(`Current Driver capabilities: ${driverJson.capabilities}`);

    const capabilitesAnswers = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'capabilities',
        message: 'What are your Driver\'s Capabilities?',
        choices: () => {
          let capabilities = HomeyLibDevice.getCapabilities();
          return Object.keys(capabilities)
            .sort(( a, b ) => {
              a = capabilities[a];
              b = capabilities[b];
              return a.title.en.localeCompare( b.title.en )
            })
            .map( capabilityId => {
              let capability = capabilities[capabilityId];
              return {
                name: capability.title.en + colors.grey(` (${capabilityId})`),
                value: capabilityId,
              }
            })
        },
        default: driverJson.capabilities
      }
    ]);

    // Since we've used the existing capabilities as a default and therefore loaded them into the array,
    // we can just overwrite the capabilities array in the JSON
    driverJson.capabilities = capabilitesAnswers.capabilities;

    await writeFileAsync( driverJsonPath, JSON.stringify(driverJson, false, 2) );

    Log(colors.green(`✓ Driver capabilities updated for \`${driverJson.id}\``));
  }

  async createDriverFlow() {
    let drivers = await this._getDrivers();

    const driverFlowAnswers = await inquirer.prompt([
      {
        type: 'list',
        name: 'driverId',
        message: 'For which driver do you want to create a Flow?',
        choices: () => {
          return drivers;
        }
      }
    ]);
    const chosenDriver = driverFlowAnswers.driverId;

    let flowJson = await this.createFlowJson();

    const flowPath = path.join(this.path, 'drivers', chosenDriver, 'driver.flow.compose.json');

    let driverFlowJson;
    try {
      driverFlowJson = await readFileAsync( flowPath, 'utf8' );
      driverFlowJson = JSON.parse( driverFlowJson );
    } catch( err ) {
      if( err.code === 'ENOENT' )	{
        driverFlowJson = {}; // File not found so init empty JSON
      } else {
        throw new Error(`Error in \`driver.flow.compose.json.\`:\n${err}`);
      }
    }

    const flowType = flowJson.type;
    delete flowJson.type;

    // Check if the chosen flow type entry is available
    driverFlowJson[flowType] = driverFlowJson[flowType] || [];

    driverFlowJson[flowType].push(flowJson);

    await writeFileAsync( flowPath, JSON.stringify(driverFlowJson, false, 2) );

    Log(colors.green(`✓ Driver Flow created in \`${flowPath}\``));
  }

  async createFlowJson() {
    const appJson = await this._getAppJsonFromFolder();
    if( appJson ) {
      this._validateAppJson(appJson);
    }

    let hasCompose = await this._hasPlugin('compose');
    if( !hasCompose ) {
      if( await this._askComposeMigration() ) {
        await this.migrateToCompose();
      } else {
        throw new Error("This command requires the compose plugin to be enabled!");
      }
    }

    const flowFolder = path.join(this.path, '.homeycompose', 'flow');

    const translatedStrings = {
      title: await this._getTranslatedString({ message: 'What is the title of your Flow Card?' }),
      hint: await this._getTranslatedString({ message: 'Enter the description for your Flow Card' }),
    }

    let answers = await inquirer.prompt([].concat(
      [
        {
          type: 'list',
          name: 'type',
          message: 'What is the type of your Flow card?',
          choices: () => {
            return [
              {
                name: "Trigger",
                value: "triggers"
              },
              {
                name: "Condition",
                value: "conditions"
              },
              {
                name: "Action",
                value: "actions"
              }
            ]
          }
        },

        {
          type: 'input',
          name: 'id',
          message: 'What is the ID of your Flow Card?',
          default: () => {
            let name = translatedStrings.title.en;
            name = name.toLowerCase();
            name = name.replace(/ /g, '-');
            name = name.replace(/[^0-9a-zA-Z-_]+/g, '');
            return name;
          },
          validate: async input => {
            if( input.search(/^[a-zA-Z0-9-_]+$/) === -1 )
              throw new Error('Invalid characters: only use [a-zA-Z0-9-_]');

            // Check if the flow entry already exists in the .homeycompose/flow folder
            if( await fse.exists( path.join(flowFolder, 'triggers', `${input}.json` ) ) ||
              await fse.exists( path.join(flowFolder, 'conditions', `${input}.json` ) ) ||
              await fse.exists( path.join(flowFolder, 'actions', `${input}.json` ) )
            )

              throw new Error('Flow already exists!');

            return true;
          }
        }
      ]
    ));

    const useArgs = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'using_arguments',
        message: 'Do you want to use arguments for this Flow Card?',
        default: false
      }
    ]);

    let flowArgs = [];
    if ( useArgs.using_arguments ) {
      // recursive function to add arguments to the flow.
      async function addArgument() {
        const argumentStrings = {
          placeholder: await this.getTranslatedString({ message: 'Enter the placeholder for the argument' })
        }

        let argumentAnswers =  await inquirer.prompt([
          {
            type: 'list',
            name: 'type',
            message: 'What is the type of the argument?',
            choices: () => {
              return [
                {
                  name: "Text",
                  value: "text"
                },
                {
                  name: "Number",
                  value: "number"
                },
                {
                  name: "Autocomplete",
                  value: "autocomplete"
                },
                {
                  name: "Range",
                  value: "range"
                },
                {
                  name: "Date",
                  value: "date"
                },
                {
                  name: "Time",
                  value: "time"
                },
                {
                  name: "Dropdown",
                  value: "dropdown"
                },
                {
                  name: "Color",
                  value: "color"
                },
                {
                  name: "Droptoken",
                  value: "droptoken"
                }
              ]
            }
          },
          {
            type: 'input',
            name: 'name',
            message: 'What is the name of your argument?',
            validate: async input => {
              if( input.search(/^[a-zA-Z0-9-_]+$/) === -1 )
                throw new Error('Invalid characters: only use [a-zA-Z0-9-_]');

              return true;
            }
          }
        ]);

        const addMore = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'more',
            message: 'Add more arguments?'
          }
        ]);

        // Create a custom object to inject en flag for the placeholder.
        flowArgs.push({
          type: argumentAnswers.type,
          name: argumentAnswers.name,
          placeholder: argumentStrings.placeholder,
        });

        if( addMore.more ) {
          await addArgument();
        } else {
          return;
        }
      }

      await addArgument();
    }

    const useTokens = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'using_tokens',
        message: 'Do you want to use tokens for this Flow Card?',
        default: false
      }
    ]);

    let flowTokens = [];
    if( useTokens.using_tokens ) {
      async function addToken() {
        const tokenStrings = {
          title: await this.getTranslatedString({ message: 'Enter the user title of your token' }),
          example: await this.getTranslatedString({ message: 'Give a brief example of what your token can provide' }),
        }

        let tokenAnswers =  await inquirer.prompt([].concat(
          [
            {
              type: 'list',
              name: 'type',
              message: 'What is the type of the token?',
              choices: () => {
                return [
                  {
                    name: "Text",
                    value: "string"
                  },
                  {
                    name: "Number",
                    value: "number"
                  },
                  {
                    name: "Boolean",
                    value: "boolean"
                  },
                  {
                    name: "Image",
                    value: "image"
                  }
                ]
              }
            },
            {
              type: 'input',
              name: 'name',
              message: 'What the name of your token?',
              validate: async input => {
                if( input.search(/^[a-zA-Z0-9-_]+$/) === -1 )
                  throw new Error('Invalid characters: only use [a-zA-Z0-9-_]');

                return true;
              }
            }
          ]
        ));

        const addMore = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'more',
            message: 'Add more tokens?'
          }
        ]);

        flowTokens.push({
          type: tokenAnswers.type,
          name: tokenAnswers.name,
          title: tokenStrings.title,
          example : tokenStrings.example,
        });

        if( addMore.more ) {
          await addToken();
        } else {
          return;
        }
      }

      await addToken();
    }

    const confirm = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Seems good?'
      }
    ]);

    if( !confirm ) return;

    let flowJson = {
      type: answers.type,
      id: answers.id,
      title: translatedStrings.title,
      hint: translatedStrings.hint,
    }

    if( useArgs.using_arguments ) {
      Object.assign(flowJson, flowJson,
        {
          args: flowArgs
        }
      );
    }

    if( useTokens.using_tokens ) {
      Object.assign(flowJson, flowJson,
        {
          tokens: flowTokens
        }
      )
    }

    return flowJson;
  }

  async createFlow() {
    let flowJson = await this.createFlowJson();

    if( !flowJson ) throw new Error('Could not create valid Flow');

    const flowFolder = path.join(this.path, '.homeycompose', 'flow');
    const flowPath = path.join(this.path, '.homeycompose', 'flow', flowJson.type);

    // Delete roperty 'type' from the Flow JSON because it's not needed.
    delete flowJson.type;

    // Check if the folder already exists, if not create it
    if ( !await fse.exists( flowFolder ) ) await mkdirAsync( flowFolder );
    if ( !await fse.exists( flowPath ) ) await mkdirAsync( flowPath );

    await writeFileAsync( path.join(flowPath, `${flowJson.id}.json`), JSON.stringify(flowJson, false, 2) );

    Log(colors.green(`✓ Flow created in \`${flowPath}\``));
  }

  async createDiscoveryStrategy() {
    const appJson = await this._getAppJsonFromFolder();
    if( appJson ) {
      this._validateAppJson(appJson);
    }

    let hasCompose = await this._hasPlugin('compose');
    if( !hasCompose ) {
      if( await this._askComposeMigration() ) {
        await this.migrateToCompose();
      } else {
        throw new Error("This command requires the compose plugin to be enabled!");
      }
    }

    const discoveryPath = path.join(this.path, '.homeycompose', 'discovery');
    const discoveryBase = await inquirer.prompt([
        {
          type: 'input',
          name: 'title',
          message: 'What is your Discovery strategy title?',
          validate: async input => {
            input.replace(/[^0-9a-zA-Z-_]+/g, '');
            if( input.search(/^[a-zA-Z0-9-_]+$/) === -1 )
              throw new Error('Invalid characters: only use [a-zA-Z0-9-_]');

            if( await fse.exists( path.join(discoveryPath, `${input}.json` ) ) ) {
              throw new Error('Discovery strategy already exists!');
            }

            return true;
          }
        },
        {
          type: 'list',
          name: 'type',
          message: 'What is the type of your Discovery strategy?',
          choices: () => {
            return [
              {
                name: 'mDNS-SD',
                value: 'mdns-sd'
              },
              {
                name: 'SSDP',
                value: 'ssdp'
              },
              {
                name: 'MAC Address range',
                value: 'mac'
              }
            ]
          }
        }
      ]
    );

    // Create new questions based on the Discovery type selected
    let discoveryJson;
    let answers;
    switch( discoveryBase.type ) {
      case 'mdns-sd':
        answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'name',
            message: 'What is the name of the mDNS query?',
            validate: input => {
              return input.length > 0;
            }
          },
          {
            type: 'list',
            name: 'protocol',
            message: 'What is the protocol of your mDNS query?',
            choices: [ "tcp", "udp"	]
          },
          {
            type: 'input',
            name: 'id',
            message: 'What is the indentifier to indentify the device? For example, \'name\' or \'txt.id\'',
            validate: input => {
              return input.length > 0;
            }
          },
        ]);

        if( !answers.id.startsWith('{{') && !answers.id.endsWith('}}') ) {
          answers.id = `{{${answers.id}}}`;
        }

        discoveryJson = {
          type: 'mdns-sd',
          'mdns-sd': {
            name: answers.name,
            protocol: answers.protocol
          },
          id: answers.id,
        }

        break;
      case 'ssdp':
        answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'search',
            message: 'What is the search scheme?',
            validate: input => {
              return input.length > 0;
            }
          },
          {
            type: 'input',
            name: 'id',
            message: 'What is the indentifier to indentify the device? For example, \'name\' or \'headers.usn\'',
            validate: input => {
              if( input.search(/^[a-zA-Z0-9-_]+$/) === -1 ) throw new Error('Invalid characters: only use [a-zA-Z0-9-_]');
            }
          },
        ]);

        discoveryJson = {
          type: 'ssdp',
          ssdp: {
            name: answers.name,
            search: answers.search
          },
          id: `{{${answers.id}}}`
        }

        break;
      case 'mac':
        // All added MAC addresses from the addMacAddress recursive function will be stored in this array.
        let macAddresses = [];

      function parseMacToDecArray(macAddress) {
        let mac = [];
        macAddress
          .slice(0,8)
          .split(':') // TODO - is also a valid MAC address seperator
          .forEach( macByte => mac.push( parseInt(macByte, 16) ) );

        return mac;
      }

        // Recursive function to input, parse and store MAC addresses.
      async function addMacAddress() {
        answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'mac',
            message: 'Enter a full MAC address or the first three bytes',
            validate: async input => {
              if( input.length === 17 && input.search(/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/) === 0 ) return true;
              if( input.length === 8 && input.search(/^([0-9A-Fa-f]{2}[:-]){2}([0-9A-Fa-f]{2})$/) === 0 ) return true;

              return false;
            }
          },
          {
            type: 'confirm',
            name: 'more',
            message: 'Add more MAC addresses?'
          }
        ]);

        // Parse and store the address
        macAddresses.push( parseMacToDecArray( answers.mac ) );

        // If the user wants to add more addresses, call this function again.
        if( answers.more ) {
          await addMacAddress();
        } else {
          return;
        }
      }

        await addMacAddress();

        if( macAddresses.length < 1) return;

        discoveryJson = {
          type: 'mac',
          mac: {
            manufacturer: macAddresses
          }
        }

        break;
    }

    const confirmCreate = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Seems good?'
      }
    ]);

    if( !confirmCreate.confirm ) return;

    // Check if the folder already exists, if not create it
    if ( !await fse.exists( discoveryPath ) ) await mkdirAsync( discoveryPath );

    await writeFileAsync( path.join(discoveryPath, `${discoveryBase.title}.json`), JSON.stringify(discoveryJson, false, 2) );

    Log(colors.green(`✓ Discovery strategy created in \`${discoveryPath}\``));

  }

  static async create({ appPath }) {

    let stat = await statAsync( appPath );
    if( !stat.isDirectory() )
      throw new Error('Invalid path, must be a directory');

		let answers = await inquirer.prompt([
			{
				type: 'input',
				name: 'id',
				message: 'What is your app\'s unique ID?',
				default: 'com.athom.myapp',
				validate: input => {
					return HomeyLibApp.isValidId( input );
				}
			},
			{
				type: 'input',
				name: 'name',
				message: 'What is your app\'s name?',
				default: 'My App',
				validate: input => {
					return input.length > 0;
				}
			},
			{
				type: 'input',
				name: 'description',
				message: 'What is your app\'s description?',
				default: 'Adds support for MyBrand devices.',
				validate: input => {
					return input.length > 0;
				}
			},
			{
				type: 'list',
				name: 'category',
				message: 'What is your app\'s category?',
				choices: HomeyLibApp.getCategories()
			},
			{
				type: 'input',
				name: 'version',
				message: 'What is your app\'s version?',
				default: '1.0.0',
				validate: input => {
					return semver.valid(input) === input;
				}
			},
			{
				type: 'input',
				name: 'compatibility',
				message: 'What is your app\'s compatibility?',
				default: '>=1.5.0',
				validate: input => {
					return semver.validRange(input) !== null;
				}
			},
			{
				type: 'confirm',
				name: 'compose',
				message: 'Use Homey compose plugin?'
			},
			{
				type: 'confirm',
				name: 'license',
				message: 'Use standard license for Homey Apps (GPL3)?'
			},
			{
				type: 'confirm',
				name: 'confirm',
				message: 'Seems good?'
			}
		]);

    if( !answers.confirm ) return;

    const appJson = {
      id: answers.id,
      version: answers.version,
      compatibility: answers.compatibility,
      sdk: 2,
      name: {
        en: answers.name,
      },
      description: {
        en: answers.description,
      },
      category: [ answers.category ],
      permissions: [],
      images: {
        large: '/assets/images/large.png',
        small: '/assets/images/small.png'
      }
    }

    try {
      let profile = await AthomApi.getProfile();
      appJson.author = {
        name: `${profile.firstname} ${profile.lastname}`,
        email: profile.email
      }
    } catch( err ) {}

    appPath = path.join( appPath, appJson.id );

    try {
      let stat = await statAsync( appPath );
      throw new Error(`Path ${appPath} already exists`);
    } catch( err ) {
      if( err.code === undefined ) throw err;
    }

    // make dirs
    const dirs = [
      '',
      'locales',
      'drivers',
      'assets',
      path.join('assets', 'images'),
    ];

    // Append the homeycompose dir if used
    if( answers.compose ) {
      dirs.push( '.homeycompose' );
      dirs.push( path.join('.homeycompose', 'flow') );
      dirs.push( path.join('.homeycompose', 'drivers') );
    }

    for( let i = 0; i < dirs.length; i++ ) {
      let dir = dirs[i];
      try {
        await mkdirAsync( path.join(appPath, dir) );
      } catch( err ) {
        Log( err );
      }
    }

		await writeFileAsync( path.join(appPath, 'app.json'), JSON.stringify(appJson, false, 2) );
		await writeFileAsync( path.join(appPath, 'locales', 'en.json'), JSON.stringify({}, false, 2) );
		await writeFileAsync( path.join(appPath, 'app.js'), '' );
		await writeFileAsync( path.join(appPath, 'README.md'), `# ${appJson.name.en}\n\n${appJson.description.en}` );
		await writeFileAsync( path.join(appPath, 'README.txt'), `${appJson.description.en}\n`);

		// i18n pre-support
		// TODO check if this works after creating i18n inquirer stuff
		if( appJson.description.nl ) {
			await writeFileAsync( path.join(appPath, 'README.nl.txt'), `${appJson.description.nl}\n`);
		}

    // copy files
    const templatePath = path.join(__dirname, '..', '..', 'assets', 'templates', 'app');
    const files = [
      'app.js',
      path.join('assets', 'icon.svg'),
    ]

    if( answers.license ) {
      files.push('LICENSE');
      files.push('CODE_OF_CONDUCT.md');
      files.push('CONTRIBUTING.md');
    }

    for( let i = 0; i < files.length; i++ ) {
      let file = files[i];
      try {
        await copyFileAsync( path.join(templatePath, file), path.join( appPath, file ) );
      } catch( err ) {
        Log( err );
      }
    }

    // Now the ap files has been created, we can create a App instance and use that to add plugins.
    if( answers.compose ) {
      const app = new App( appPath );
      app.addPlugin( 'compose' );
    }

    // Create package lock
    const packageJson = {
      name: answers.id,
      version: answers.version,
      main: 'app.js',
    }

    await writeFileAsync( path.join(appPath, 'package.json'), JSON.stringify(packageJson, false, 2) );

    // Check if npm is available, then install homey as dev dependency
    const npmInstalled = await NpmCommands.isNpmInstalled();
    if (npmInstalled) {
      await NpmCommands.install({ saveDev: true, path: appPath }, {
        id: 'homey',
        version: 'latest',
      });
    }

    Log(colors.green(`✓ App created in \`${appPath}\``));

  }

}

module.exports = App;