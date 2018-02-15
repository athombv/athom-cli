var fs			= require('fs');
var path		= require('path');

var _			= require('underscore');
var request		= require('request');
var keypress	= require('keypress');

module.exports.run = function( animation_path ) {

	animation_path = path.join( process.cwd(), animation_path );

	// verify if the folder has a homey app
	if( !fs.existsSync(animation_path) )
		return console.error("invalid animation file folder. Give the file as argument (--run <path>)".red);

	// compile animation
	var animation = require(animation_path);

	// get active homey
	if( typeof global.settings.homey == 'undefined' ) {
		global.lib.homey.select( false, step2);
	} else {
		step2(global.settings.homey);
	}

	function step2( homey ){

		// get access token
		homey = _.findWhere(global.settings.me.homeys, { _id: homey._id });

		// POST the tmp file to Homey
		request.post({
			url: 'http://' + homey.ipInternal + '/api/manager/devkit/ledring/',
			headers: {
	    		'Authorization': 'Bearer ' + homey.token
			},
			json: animation
		}, function( err, data, response ){
			if( err ) return console.error(err);
			if( response && response.status !== 200 ) return console.error( 'Error:', response.result );

			console.log('Running animation... press CTRL+C to abort...');

			keypress(process.stdin);

			// listen for the "keypress" event
			process.stdin.on('keypress', function (ch, key) {
				if (key && key.ctrl && key.name == 'c') {

					console.log('Stopping animation...');
					request.del({
						url: 'http://' + homey.ipInternal + '/api/manager/devkit/ledring/',
						qs: {
							animation_id: response.result.animation_id
						},
						headers: {
				    		'Authorization': 'Bearer ' + homey.token
						}
					}, function( err, data, response ){
						if( err ) console.error(err);
						process.exit();
					});

				}
			});

			// Prevent failure on setRawMode when piping process.stdin
			if ( typeof process.stdin.setRawMode === "function") {
				process.stdin.setRawMode( true );
			}

			process.stdin.resume();
		});

	}

}