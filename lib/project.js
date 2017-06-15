var fs					= require('fs');
var path				= require('path');
var zlib				= require('zlib');

var _					= require('underscore');
var inquirer			= require('inquirer');
var request				= require('request');
var tmp					= require('tmp');
var tar					= require('tar-fs');
var keypress			= require('keypress');
var homey_lib			= require('homey-lib');
var semver				= require('semver');
var socket_io_client 	= require('socket.io-client');
var clone				= require('clone');
var gitignoreparser 	= require('gitignore-parser');

module.exports.create = function( app_path ) {

	app_path = ( typeof app_path == 'string' ) ? app_path : process.cwd();
	
	var App = homey_lib.App;
	var app = new App( app_path );

	if( !fs.existsSync(app_path) ) return console.error("Error: path does not exist");
	if( !fs.lstatSync(app_path).isDirectory() ) return console.error("Error: path is not a directory");

	inquirer.prompt([
		{
			type: "input",
			name: "id",
			message: "What is your app's unique ID?",
			default: "com.athom.hello",
			validate: function( input ) {
				return input.length > 0 && input.split('.').length > 1;
			}
		},
		{
			type: "input",
			name: "name",
			message: "What is your app's name?",
			default: "My App",
			validate: function( input ) {
				return input.length > 0;
			}
		},
		{
			type: "input",
			name: "description",
			message: "What is your app's description?",
			default: "Adds support for <brand> devices.",
			validate: function( input ) {
				return input.length > 0;
			}
		},
		{
			type: "list",
			name: "category",
			message: "What is your app's category?",
			choices: app.getAllowedCategories()
		},
		{
			type: "input",
			name: "version",
			message: "What is your app's version?",
			default: "1.0.0",
			validate: function( input ) {
				return semver.valid(input) === input;
			}
		},
		{
			type: "input",
			name: "sdk",
			message: "What is your app's SDK version?",
			default: "2",
			validate: function( input ) {
				return !isNaN(parseInt(input));
			}
		},
		{
			type: "input",
			name: "compatibility",
			message: "What is your app's compatibility?",
			default: "1.x >=1.5.0",
			validate: function( input ) {
				return semver.validRange(input) !== null;
			}
		},
		{
			type: "confirm",
			name: "confirm",
			message: "Seems good?"
		}
	], function(answers){

		var project_path = path.join(app_path, answers.id);

		if( fs.existsSync(project_path) ) return console.error("Error: path " + project_path + " already exist");

		// == create the project ==
		fs.mkdirSync( project_path );

		// == create app.json ==
		var manifest = {
			"id": answers.id,
			"sdk": parseInt(answers.sdk),
			"name": {
				"en": answers.name
			},
			"description": {
				"en": answers.description //
			},
			"category": answers.category,
			"version": answers.version,
			"compatibility": answers.compatibility
		};

		// add author info, if logged in
		if( typeof global.settings.me == 'object' ) {
			manifest.author = {
				"name": global.settings.me.firstname + ' ' + global.settings.me.lastname,
				"email": global.settings.me.email
			}
		}

		fs.writeFileSync( path.join( project_path, 'app.json'), JSON.stringify(manifest, null, 4) );

		// == create app.js ==
		var appjs_template = fs.readFileSync( path.join(__dirname, '..', 'templates', 'app.js') )
		fs.writeFileSync( path.join( project_path, 'app.js'), appjs_template );

		// == create locales ==
		fs.mkdirSync( path.join(project_path, 'locales') );
		fs.writeFileSync( path.join(project_path, 'locales', 'en.json'), '{}' );
		
		// == create env ==
		fs.writeFileSync( path.join(project_path, 'env.json'), '{}' );

		// == create assets ==
		fs.mkdirSync( path.join(project_path, 'assets') );
		fs.writeFileSync( path.join(project_path, 'assets', 'icon.svg'), fs.readFileSync( path.join(__dirname, '..', 'templates', 'icon.svg') ) );
		
		console.log('Your app has been created at:', project_path);

		setTimeout(process.exit, 1000);

	});
}

module.exports.run = function( app_path ) {

	run_app( app_path, true );

}

module.exports.runClean = function( app_path ) {

	run_app( app_path, true, true );

}

module.exports.install = function( app_path ) {

	run_app( app_path, false );

}

module.exports.validate = function( app_path ) {
	validate_app( app_path, false );
}

module.exports.validateAppStore = function( app_path ) {
	validate_app( app_path, true )
}

function validate_app( app_path, appstore ) {

	app_path = ( typeof app_path == 'string' ) ? app_path : process.cwd();

	if( appstore ) {
		console.log('Validating ' + app_path + ' for App Store use...')
	} else {
		console.log('Validating ' + app_path + ' for private use...')
	}

	var app = new homey_lib.App( app_path );

	var valid = app.validate( appstore );
	if( valid.success ) {
		console.log("App validated successfully!".green)
	} else {
		console.log("App failed to validate!".red);
		valid.errors.forEach(function(error){
			console.log( 'Error: ' + error)
		});
	}

}

function run_app( app_path, debug, purgeSettings ) {
	app_path = ( typeof app_path == 'string' ) ? app_path : process.cwd();
	debug = ( typeof debug == 'undefined' ) ? false : debug;
	purgeSettings = ( typeof purgeSettings == 'undefined' ) ? false : purgeSettings;

	// verify if the folder has a homey app
	if( !fs.existsSync( path.join( app_path, 'app.json' ) ) ) return console.error("invalid app folder. Give the folder as argument (--run <path>), or change your current directory to the app folder".red);

	var step = 0;
	var steps = ( debug ) ? 4 : 3;
	var session;

	// get active homey
	if( typeof global.settings.homey == 'undefined' ) {
		global.lib.homey.select( false, function( err, homey ){
			step2( clone(homey) );
		});
	} else {
		step2( clone(global.settings.homey) );
	}

	function step2( homey ){

		global.lib.homey.listLocal( false, function( err, localHomeys ){

			var localHomey = _.findWhere( localHomeys, {
				id: homey._id
			})

			if( typeof localHomey != 'undefined' ) {
				homey.ipInternal 	= localHomey.address;
				homey.usb 			= true;
			}

			// get access token
			var token = _.findWhere(global.settings.me.homeys, { _id: homey._id }).token;

			// prepare environment vars
			var env = '{}';
			var env_path = path.join( app_path, 'env.json' );
			if( fs.existsSync( env_path ) ) {
				env = fs.readFileSync( env_path ).toString();
			}

			pack( app_path, function( tmppath ){
				upload( tmppath, homey, token, debug, env, purgeSettings, function( err, response ){
					if( err ) return console.error(err.toString().red);

					if( typeof response.result == 'undefined' ) {
						return console.error('Invalid response, got:', response)
					}

					if( response.status != 200 ) {
						return console.error(response.result.red);
					}

					if( debug ) {

						if( response.result && response.result.session ) session = response.result.session;

						console.log( ++step + '/' + steps + ' -', "Running `" + response.result.app_id + "`, press CTRL+C to abort...");

						var log_ids = [];
						function onLog( log ) {
							if( log_ids.indexOf(log.id) > -1 ) return; // skip duplicate logs
							if( log.app != response.result.app_id ) return; // don't show other apps in debug mode

							// make errors red
							if( log.type == 'error' ) {
								for( var arg in log.args ) {
									if( typeof log.args[arg] == 'string' ) {
										log.args[arg] = log.args[arg].red;
									}
								}
							}

							console.log.apply(null, log.args);

							log_ids.push(log.id);
						}

						var chunk_ids = [];
						function onStd( data, callback ) {
							if( data.session != session ) return;
							if( chunk_ids.indexOf(data.id) > -1 ) return; // skip duplicate logs
							if( data.chunk.type == 'Buffer' ) data.chunk = new Buffer( data.chunk.data );

							process[data.type].write( data.chunk );
							chunk_ids.push(data.id);

						}

						var socketManagerDevkit = socket_io_client( 'ws://' + homey.ipInternal + '/realtime/manager/devkit/', {
							query: 'token=' + token
						})
							.on('connect', function(){

								if( session ) {

									// get std buffer
									request({
										url: 'http://' + homey.ipInternal + '/api/manager/devkit/std/' + session,
										headers: {
								    		'Authorization': 'Bearer ' + token
										},
										json: true
									}, function( err, data, response ){
										if( err ) throw( err );
										if( response && response.result ) {
											if( response.result == 'invalid_session' ) {
												console.log('Debug session expired, exiting...');
												process.exit();
											} else if( Array.isArray(response.result) ) {
												response.result.forEach(onStd);

												console.log( ++step + '/' + steps + ' -', 'Debugging...');
												console.log();
												console.log('-------------------------------------------------');
											}
										} else {
											console.log('Invalid state, exiting...');
											process.exit();
										}
									});

								} else {

									// get the log buffer
									request({
										url: 'http://' + homey.ipInternal + '/api/manager/devkit/log/',
										headers: {
								    		'Authorization': 'Bearer ' + token
										},
										json: true
									}, function( err, data, response ){
										if( err ) throw( err );
										response.result.forEach(onLog);

										console.log( ++step + '/' + steps + ' -', 'Debugging...');
										console.log();
										console.log('-------------------------------------------------');
									});

								}


							})
							.on('error', console.error)
							//
							.on('disconnect', function(){
								console.log('Disconnected from Homey, automatically reconnecting...');
							})
							.on('reconnect_attempt', function(){
								console.log('Trying to reconnect...');
							})

						if( session ) {
							socketManagerDevkit.on('std', onStd)
						} else {
							socketManagerDevkit.on('log', onLog)
						}

						var socketManagerApps = socket_io_client( 'ws://' + homey.ipInternal + '/realtime/manager/apps/', {
							query: 'token=' + token
						})
							.on('app.unload', function( data ){
								if( data.id === response.result.app_id ) {
									setTimeout(function(){
										process.exit();
									}, 2000);
								}
							})


						keypress(process.stdin);

						// listen for the "keypress" event
						process.stdin.on('keypress', function (ch, key) {
							if (key && key.ctrl && key.name == 'c') {
								stop( homey.ipInternal, token, response.result.app_id, function(err, status, body){
									if( body && body.result === true ) {
										console.log("App uninstalled");
									}
									process.exit();
								})
							}
						});

						// Prevent failure on setRawMode when piping process.stdin
						if ( typeof process.stdin.setRawMode === "function") {
							process.stdin.setRawMode( true );
						}

						process.stdin.resume();

					} else {
						console.log( ++step + '/' + steps + ' -', "Installed `" + response.result.app_id + "`");
					}
				})
			});

		});

	}

	// functions for packing & uploading
	function pack( app_path, callback ){

		console.log( ++step + '/' + steps + ' -', 'Archiving...');

		// create a temporary file (.tar)
		tmp.file(function(err, tmppath, fd, cleanupCallback) {

			try {
				var homeyignore = gitignoreparser.compile( fs.readFileSync( path.join( app_path, '.homeyignore') ).toString() );
			} catch(e){}

			var tarOpts = {
				ignore: function(name) {

					// ignore env.json
					if( name == path.join( app_path, 'env.json' ) ) return true;

					// ignore dotfiles (.git, .gitignore, .mysecretporncollection etc.)
					if( path.basename(name).charAt(0) === '.' ) return true;

					// ignore .homeyignore files
					if( homeyignore ) {
						if( homeyignore.denies( name.replace(app_path, '') ) === true ) return true;
					}

					return false;
				},
				dereference: true
			};

			tar
				.pack( app_path, tarOpts )
				.pipe( zlib.createGzip() )
				.pipe(
					fs
						.createWriteStream(tmppath)
						.on('close', function(){
							callback( tmppath );
						})
					);

		});
	}

	function upload( tmppath, homey, token, debug, env, purgeSettings, callback ) {

		var address = homey.ipInternal;

		console.log( ++step + '/' + steps + ' -', 'Uploading to ' + homey.name.italic + ' @ ' + address.italic + ( homey.usb ? ' (USB)' : '' ) + '...');

		// POST the tmp file to Homey
		req = request.post({
			url: 'http://' + homey.ipInternal + '/api/manager/devkit/',
			headers: {
	    		'Authorization': 'Bearer ' + token
			},
			json	: true
		}, function( err, data, response ){
			if( err ) return callback(err);

			callback( null, response );

			// clean up the tmp file
			fs.unlink( tmppath );
		});

		var form = req.form();
		form.append('app', fs.createReadStream(tmppath));
		form.append('debug', debug.toString());
		form.append('env', env.toString());

		if( purgeSettings ) {
			form.append('purgeSettings', 'true');
		}

	}

	function stop( address, token, app_id, callback ) {

		console.log('-------------------------------------------------');
		console.log();
		console.log('Stopping...');

		req = request.del({
			url: 'http://' + address + '/api/manager/devkit/' + ( ( typeof session != 'undefined' ) ? session : app_id ),
			headers: {
	    		'Authorization': 'Bearer ' + token
			},
			json: true
		}, callback);
	}
}