'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const util = require('util');

const Log = require('../..').Log;
const AthomApi = require('../..').AthomApi;
const HomeyLibApp = require('homey-lib').App;
const colors = require('colors');
const inquirer = require('inquirer');
const tmp = require('tmp-promise');
const tar = require('tar-fs');
const semver = require('semver');
const gitIgnoreParser = require('gitignore-parser');
const { monitorCtrlC } = require('monitorctrlc');

const statAsync = util.promisify( fs.stat );
const mkdirAsync = util.promisify( fs.mkdir );
const readFileAsync = util.promisify( fs.readFile );
const writeFileAsync = util.promisify( fs.writeFile );
const copyFileAsync = util.promisify( fs.copyFile );

class App {
	
	constructor( appPath ) {
		this._path = appPath;		
		this._app = new HomeyLibApp( this._path );
		this._exiting = false;
		this._std = {};
	}
	
	async validate({ level = 'debug' } = {}) {

		try {
			let valid = await this._app.validate({ level });
			
			Log(colors.green(`✓ Homey App validated successfully against level \`${level}\``));
			return true;
		} catch( err ) {
			Log(colors.red(`✘ Homey App did not validate against level \`${level}\`:`));
			Log(err.message);
			return false;
		}
	}
	
	async run({
		clean = false,
	} = {}) {
		this._session = await this.install({
			clean,
			debug: true,
		});
		
		clean && Log(colors.green(`✓ Purged all Homey App settings`));
		Log(colors.green(`✓ Running \`${this._session.appId}\`, press CTRL+C to quit`));
		Log('─────────────── Logging stdout & stderr ───────────────');
		
		let activeHomey = await AthomApi.getActiveHomey();
		
		activeHomey.devkit.subscribe()
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
			}).catch( Log )
		activeHomey.devkit.on('std', this._onStd.bind(this));
		
		monitorCtrlC(this._onCtrlC.bind(this));
	}
	
	async install({
		clean = false,
		debug = false,
	} = {}) {
		Log(colors.green('✓ Validating app...'));
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
		
		let result = await activeHomey.devkit._call('POST', '/', {
			form: form,
			opts: {
				$timeout: 1000 * 60 * 5 // 5 min
			},
		});
		
		Log(colors.green(`✓ Homey App \`${result.appId}\` successfully installed`));
		
		return result;
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
			let data = await readFileAsync( path.join(this._path, 'env.json') );
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
				let homeyIgnoreContents = await readFileAsync( path.join( this._path, '.homeyignore'), 'utf8' );
				homeyIgnore = gitIgnoreParser.compile( homeyIgnoreContents );
			} catch( err ){}
			
			let tarOpts = {
				ignore: (name) => {

					// ignore env.json
					if( name == path.join( this._path, 'env.json' ) ) return true;

					// ignore dotfiles (.git, .gitignore, .mysecretporncollection etc.)
					if( path.basename(name).charAt(0) === '.' ) return true;

					// ignore .homeyignore files
					if( homeyIgnore ) {
						return homeyIgnore.denies( name.replace(this._path, '') );
					}

					return false;
				},
				dereference: true
			};
			
			return new Promise((resolve, reject) => {
				
				let writeFileStream = fs.createWriteStream( tmpPath )
					.once('close', () => {
						let readFileStream = fs.createReadStream( tmpPath );
							readFileStream.once('close', () => {
								o.cleanup();
							})
						resolve( readFileStream );								
					})
					.once('error', reject)
					
				tar
					.pack( this._path, tarOpts )
					.pipe( zlib.createGzip() )
					.pipe( writeFileStream )
					
			});
			
		})
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
				name: 'license',
				message: 'Use standard license for Homey Apps (GPL3)?'
			},
			{
				type: 'confirm',
				name: 'confirm',
				message: 'Seems good?'
			}
		]);
		
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
				
	}
	
}

module.exports = App;