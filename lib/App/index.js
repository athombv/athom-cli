'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const util = require('util');

const Log = require('../..').Log;
const AthomApi = require('../..').AthomApi;
const HomeyLibApp = require('homey-lib').App;
const colors = require('colors');
const tmp = require('tmp-promise');
const tar = require('tar-fs');
const gitIgnoreParser = require('gitignore-parser');

const readFileAsync = util.promisify( fs.readFile );

class App {
	
	constructor( path ) {
		this._path = path;
		this._app = new HomeyLibApp( path );
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
		Log('─────────────── Logging stdout/stderr ───────────────');
		
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
			
		process.on('SIGINT', this._onSigint.bind(this));
	}
	
	async install({
		clean = false,
		debug = false,
	} = {}) {
		Log(colors.green('✓ Validating app...'));
		await this.validate();
		
		let activeHomey = await AthomApi.getActiveHomey();
		
		let archiveStream = await this._getPackStream();
		let env = await this._getEnv();
			env = JSON.stringify(env);
		
		let form = {
			app: archiveStream,
			debug: debug,
			env: env,
			purgeSettings: clean,
		}
		
		Log(colors.green(`✓ Installing Homey App...`));
		
		let result = await activeHomey.devkit._call('POST', '/', { form });
		
		Log(colors.green(`✓ Homey App \`${result.appId}\` successfully installed`));
		
		return result;
	}
	
	async create() {
		// TODO
	}
	
	_onStd( std ) {
		if( std.session !== this._session.session ) return;
		if( this._std[ std.id ] ) return;
		
		if( std.type === 'stdout' ) process.stdout.write( std.chunk );
		if( std.type === 'stderr' ) process.stderr.write( std.chunk );
		
		// mark std as received to prevent duplicates
		this._std[ std.id ] = true;
	}
	
	async _onSigint() {
		if( this._exiting ) return;
			this._exiting = true;
		
		Log(colors.green(`✓ Uninstalling \`${this._session.appId}\`...`));
		
		try {
			let activeHomey = await AthomApi.getActiveHomey();
			await activeHomey.devkit.stopApp({ session: this._session.session });
		} catch( err ) {}
		
		Log(colors.green(`✓ Homey App \`${this._session.appId}\` successfully uninstalled`));
		
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
	
}

module.exports = App;