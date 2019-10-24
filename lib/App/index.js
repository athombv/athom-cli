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

const HomeyLibApp = require('homey-lib').App;
const HomeyLibDevice = require('homey-lib').Device;
const colors = require('colors');
const inquirer = require('inquirer');
const tmp = require('tmp-promise');
const tar = require('tar-fs');
const semver = require('semver');
const npm = require('npm-programmatic');
const gitIgnoreParser = require('gitignore-parser');
const { monitorCtrlC } = require('monitorctrlc');
const fse = require('fs-extra');
const filesize = require('filesize');

const statAsync = promisify( fs.stat );
const mkdirAsync = promisify( fs.mkdir );
const readFileAsync = promisify( fs.readFile );
const writeFileAsync = promisify( fs.writeFile );
const copyFileAsync = promisify( fs.copyFile );
const accessAsync = promisify( fs.access );

const PLUGINS = {
	'compose': AppPluginCompose,
	'zwave': AppPluginZwave,
	'zigbee': AppPluginZigbee,
	'rf': AppPluginRF,
	'log': AppPluginLog,
	'oauth2': AppPluginOAuth2,
};

class App {

	constructor( appPath ) {
		this.path = appPath;
		this._app = new HomeyLibApp( this.path );
		this._pluginsPath = path.join( this.path, '.homeyplugins.json');
		this._exiting = false;
		this._std = {};
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
		if( valid !== true ) throw new Error('The app is not valid, please fix the validation issues');

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
		} else return;

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
		await this.validate({ level: 'publish' });

		const archiveStream = await this._getPackStream();
		const env = await this._getEnv();

		// TODO version
		// TODO git tag

		throw new Error('Submitting the app to the Homey Apps Store using athom-cli has not yet been implemented. Visit https://apps.athom.com/developer/dashboard to submit your app.');
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

	async installNpmPackage({ id, version = 'latest' }) {
		Log(colors.green(`✓ Installing ${id}@${version}...`));

		await fse.ensureDir(path.join(this.path, 'node_modules'));
		await npm.install([`${id}@${version}`], {
			save: true,
			cwd: this.path,
		})

		Log(colors.green(`✓ Installation complete`));
	}

	// Get all PRODUCTION npm package paths
	async getNpmPackages() {
		if( !this._hasPackageJson() ) return null;
		const result = [];

		const findDependencies = async (dir) => {
			const {
				packageJson,
				packageDir
			} = await readPackageJson(dir);
			if( !packageJson ) return;
			if( packageDir !== this.path ) result.push(packageDir);

			const dependencies = Object.keys(packageJson.dependencies || {});
			if( !dependencies.length ) return;

			for( let i = 0; i < dependencies.length; i++ ) {
				const dependency = dependencies[i];
				await findDependencies(path.join(dir, 'node_modules', dependency))
			}
		}

		const readPackageJson = async (dir) => {
			let packageJsonPath = path.join(dir, 'package.json');
			let packageJson;
			let packageDir;

			try {
				packageJson = await fse.readJSON(packageJsonPath);
				packageDir = path.dirname(packageJsonPath);
			} catch( err ) {
				if( err.code === 'ENOENT' ) {
					const dirArray = dir.split(path.sep);
					dirArray.splice(dirArray.length-3, 2);
					const dirJoined = dirArray.join(path.sep);
					if(dirJoined.length ) {
						return readPackageJson(dirJoined);
					}
				} else {
					console.error(err)
				}
			}
			return {
				packageJson,
				packageDir,
			};
		}

		await findDependencies(this.path);

		return result;
	}

	/**
	 * Check if the current folder has a valid app.json.
	 * @returns : Parsed JSON object or Error if no app.json was found
	 */
  	async _getAppJsonFromFolder(jsonPath) {
		const appJsonPath = jsonPath || path.join(this.path, 'app.json');
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

	// Check if the parsed app.json contains the keys to be a valid Homey app.
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

	// TODO better function name?
	async _switchToCompose(appPath) {
		// TODO Create compose structure here
		const appJson = await this._getAppJsonFromFolder(appPath);
		this._validateAppJson(appJson);
		
		console.log(appJson);

		// Create the neccessary folders

		const composeDirs = [
			'.homeycompose',
			path.join('.homeycompose', 'flows')
		];

		composeDirs.forEach(async dir => {
			try {
				await mkdirAsync( path.join(appPath, dir) );
			} catch( err ) {
				Log( err );
			}
		});

		this.addPlugin('compose');
		const composeDriverJson = appJson.drivers;
		const composeFlowsJson = appJson.flow;
		delete appJson.drivers;
		delete appJson.flow;

		// loop over drivers and flows, create files for every property with the name of the property
		// in case of driver files it should go into the driver folder

		console.log('Trimmed appjson', appJson);
		const composeAppJson = appJson;

	}

	async _askSwitchCompose() {
		let answers = await inquirer.prompt(
			{
				type: 'confirm',
				name: 'switch_compose',
				message: 'This command only works with the Homey compose plugin which is not detected. Do you want to use Homey compose?'
			}
		)

		return answers.switch_compose;
	}

	// Check if a package.json is present in the current directory
	_hasPackageJson() {
		try {
			require(path.join(this.path, 'package.json'));
			return true;
		} catch( err ) {
			return false;
		}
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

	async _getPackStream() {
		return tmp.file().then( async o => {

			let tmpPath = o.path;
			let homeyIgnore;

			try {
				let homeyIgnoreContents = await readFileAsync( path.join( this.path, '.homeyignore'), 'utf8' );
				homeyIgnore = gitIgnoreParser.compile( homeyIgnoreContents );
			} catch( err ) {}

			//const productionPackages = await this.getNpmPackages();

			let tarOpts = {
				ignore: (name) => {
					// ignore env.json
					if( name === path.join( this.path, 'env.json' ) ) return true;

					// ignore dotfiles (.git, .gitignore, .mysecretporncollection etc.)
					if( path.basename(name).charAt(0) === '.' ) return true;

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

        let tarSize = 0;
		let writeFileStream = fs.createWriteStream( tmpPath )
			.once('close', () => {
            	Log(colors.grey(' — App size: ' + filesize(tarSize)));
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
				tarSize += chunk.length;
			})
			.pipe( zlib.createGzip() )
			.pipe( writeFileStream )
		});

		})
	}

	async createDriver() {
		const appJson = await this._getAppJsonFromFolder();
		if (appJson) {
			this._isValidAppJson(appJson);
		} else return;

		let answers = await inquirer.prompt([].concat(
			[
				{
					type: 'input',
					name: 'name',
					message: 'What is your Driver\'s Name?',
					validate: input => {
						return input.length > 0;
					}
				},
				{
					type: 'input',
					name: 'id',
					message: 'What is your Driver\'s ID?',
					default: answers => {
						let name = answers.name;
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
					name: 'isIp',
					default: false,
					message: 'Is this a IP device?'
				},
				{
					type: 'confirm',
					name: 'createDiscovery',
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
			name: {
				en: answers.name,
			},
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

		console.log(answers.isIp, answers.createDiscovery)
		if( answers.isIp && answers.createDiscovery ) {
			await this.createDiscoveryStrategy();
		}

		let hasCompose = await this._hasPlugin('compose');
		if( hasCompose ) {

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

	async createFlow() {
		const appJson = await this._getAppJsonFromFolder();
		if( appJson ) {
			this._validateAppJson(appJson);
		}

		let hasCompose = await this._hasPlugin('compose');
		if( !hasCompose ) { 
			// if( await this._askSwitchCompose() ) {
			// 	await this._switchToCompose();
			// } else {
				throw new Error("This command requires the compose plugin to be enabled!");
			// }
		}

		const flowFolder = path.join(this.path, '.homeycompose', 'flow');

		let answers = await inquirer.prompt([].concat(
			[
				{
					type: 'list',
					name: 'type',
					message: 'What is your Flow\'s type?',
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
					name: 'title',
					message: 'What is your Flow\'s title?',
					validate: input => {
						return input.length > 0;
					}
				},
				{
					type: 'input',
					name: 'id',
					message: 'What is your Flow\'s ID?',
					default: answers => {
						let name = answers.title;
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
				},
				{
					type: 'input',
					name: 'hint',
					message: 'Enter the description of your Flow',
					validate: input => {
						return input.length > 0;
					}
				}
			]
		));

		const useArgs = await inquirer.prompt([
			{
				type: 'confirm',
				name: 'using_arguments',
				message: 'Use arguments for this Flow?'
			}
		]);

		let flowArgs;
		if (useArgs.using_arguments) {
			flowArgs =  await inquirer.prompt([].concat(
				[
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
						message: 'What the name of your argument?',
						validate: async input => {
							if( input.search(/^[a-zA-Z0-9-_]+$/) === -1 )
								throw new Error('Invalid characters: only use [a-zA-Z0-9-_]');
	
							return true;
						}
					},
					{
						type: 'input',
						name: 'placeholder',
						message: 'Enter the hint for the argument',
						validate: input => {
							return input.length > 0;
						}
					}
				]
			));
		}

		const useTokens = await inquirer.prompt([
			{
				type: 'confirm',
				name: 'using_tokens',
				message: 'Use tokens for this Flow?'
			}
		]);

		let flowTokens;
		if (useTokens.using_tokens) {
			flowTokens =  await inquirer.prompt([].concat(
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
					},
					{
						type: 'input',
						name: 'title',
						message: 'Enter the user title of your token',
						validate: input => {
							return input.length > 0;
						}
					},
					{
						type: 'input',
						name: 'example',
						message: 'Give a brief example of what your token can provide',
						validate: input => {
							return input.length > 0;
						}
					}
				]
			));
		}

		const confirm = await inquirer.prompt([
			{
				type: 'confirm',
				name: 'confirm',
				message: 'Seems good?'
			}
		]);

		if( !confirm ) return;

		let flowId = answers.id;
		let flowJson = {
			id: flowId,
			title: {
				en: answers.title,
			},
			hint: {
				en: answers.hint,
			},
		}

		if( useArgs.using_arguments ) {
			Object.assign(flowJson, flowJson,
				{
					args: [
						{
							type: flowArgs.type,
							name: flowArgs.name,
							placeholder: flowArgs.placeholder
						},
					]
				}
			);
		}
		
		if( useTokens.using_tokens ) {
			Object.assign(flowJson, flowJson,
				{
					tokens: [
						{
							type: flowTokens.type,
							name: flowTokens.name,
							title: flowTokens.title,
							example: {
								en: flowTokens.example
							}
						}
					]
				}
			)
		}

		const flowPath = path.join(this.path, '.homeycompose', 'flow', answers.type);

		// Check if the folder already exists, if not create it
		if ( !await fse.exists( flowFolder ) ) await mkdirAsync( flowFolder );
		if ( !await fse.exists( flowPath ) ) await mkdirAsync( flowPath );

		await writeFileAsync( path.join(flowPath, `${answers.id}.json`), JSON.stringify(flowJson, false, 2) );

		Log(colors.green(`✓ Flow created in \`${flowPath}\``));

	}

	async createDiscoveryStrategy() {
		const appJson = await this._getAppJsonFromFolder();
		if( appJson ) {
			this._validateAppJson(appJson);
		}

		let hasCompose = await this._hasPlugin('compose');
		if( !hasCompose ) { 
			// if( await this._askSwitchCompose() ) {
			// 	await this._switchToCompose();
			// } else {
				throw new Error("This command requires the compose plugin to be enabled!");
			// }
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
							name: "mDNS-SD",
							value: "mdns-sd"
						},
						{
							name: "SSDP",
							value: "ssdp"
						},
						{
							name: "MAC Address range",
							value: "mac"
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

				discoveryJson = {
					type: 'mdns-sd',
					"mdns-sd": {
						name: answers.name,
						protocol: answers.protocol
					},
					id: `{{${answers.id}}}`
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
					"ssdp": {
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
					"mac": {
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
		if( !stat.isDirectory() ) {
			throw new Error('Invalid path, must be a directory');
		}

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

		// TODO create pre-filled plugin file here
		const pluginJson = [
			{
				id: "compose"
			}
		];

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

		dirs.forEach(async dir => {
			try {
				await mkdirAsync( path.join(appPath, dir) );
			} catch( err ) {
				Log( err );
			}
		});

		await writeFileAsync( path.join(appPath, 'app.json'), JSON.stringify(appJson, false, 2) );
		await writeFileAsync( path.join(appPath, 'locales', 'en.json'), JSON.stringify({}, false, 2) );
		await writeFileAsync( path.join(appPath, 'app.js'), '' );
		await writeFileAsync( path.join(appPath, 'README.md'), `# ${appJson.name.en}\n\n${appJson.description.en}` );

		if( answers.compose ) {
			await writeFileAsync( path.join(appPath, '.homeyplugins.json'), JSON.stringify(pluginJson, false, 2) ); 
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

		files.forEach(async file => {
			try {
				await copyFileAsync( path.join(templatePath, file), path.join( appPath, file ) );
			} catch( err ) {
				Log( err );
			}
		});

		Log(colors.green(`✓ App created in \`${appPath}\``));

	}

}

module.exports = App;