'use strict';

var os			= require('os');

var _			= require('underscore');
var inquirer	= require("inquirer");
var request		= require('request');

module.exports.select = function( save, callback ){

	callback = callback || function(){}

	global.lib.user.refresh(function(err){
		if( err ) return console.error(err);

		var homeys = global.settings.me.homeys;

		// generate list of choices
		var choices = [];
		homeys.forEach(function(homey){
			choices.push({
				value: homey._id,
				name: homey.name + ' @ ' + homey.ipInternal
			});
		});

		// ask
		inquirer.prompt([
			{
				type: "list",
				name: "homey",
				message: "Select active Homey",
				choices: choices
			}
		], function(answers){

			// show which homey is active
			var activeHomey = _.findWhere(homeys, { _id: answers.homey });
			delete activeHomey.users;

			if( save ) {
				global.settings.homey = activeHomey;
				console.log("Saved active Homey: " + activeHomey.name );
			}

			callback( null, activeHomey );
		});
	});

}

module.exports.unselect = function(){
	var active = global.settings.homey;

	if( typeof active == 'undefined' ) {
		console.log('there was no active homey');
	} else {
		delete global.settings.homey;
		console.log('unselected homey `' + active.name + '`');
	}
}

module.exports.list = function( log, callback ){

	callback = callback || function(){}

	if( log ) {
		console.log("");
		console.log("Your Homeys:");
		console.log("");
	}

	global.lib.user.refresh(function(err){
		if( err ) return console.error(err);

		var homeys = global.settings.me.homeys;
		var homeysArr = [];

		homeys.forEach(function(homey, i){
			var homeyObj = {
				id: homey.id,
				name: homey.name,
				address: homey.ipInternal,
				role: homey.role,
				token: homey.token,
				users: homey.users.length,
			}

			if( log ) {
				console.log('-------------------------------------');
				for( let key in homeyObj ) {
					console.log(` ${padRight(key, 15, ' ')}: ${homeyObj[key]}`);
				}
				if( i == homeys.length-1 ) {
					console.log('-------------------------------------');
					callback( null, homeys );
				}
			}
		});

	})
}

module.exports.listLocal = function( log, callback ){

	callback = callback || function(){}

	if( log ) {
		console.log("");
		console.log("Your USB connected Homeys:");
		console.log("");
	}

	// UNTESTED ON WINDOWS & LINUX

	var networkInterfaces = os.networkInterfaces();

	var candidates = [];
	var homeys = [];

	for( var networkInterface in networkInterfaces ) {
		networkInterfaces[ networkInterface ].forEach(function(adapter){
			if( adapter.address.substring(0,3) == '10.' ) {
				var ip = adapter.address.split('.');
					ip[3] = '1';
					ip = ip.join('.');
				candidates.push(ip);
			}
		})
	}

	if( candidates.length == 0 ) return callback( null, [] );

	// ping
	var done = 0;
	candidates.forEach(function(candidate){

		request({
			method	: 'GET',
			url		: 'http://' + candidate + '/api/manager/webserver/ping',
			json	: true,
			timeout	: 5000
		}, function( err, result, body ){
			if( body && body.result == 'pong' ) {

				var id = result.headers['x-homey-id'];
				var token = false;

				// find token
				const homey = global.settings.me.homeys.find(function(homeySettings){
					return homeySettings._id === id;
				});

				if(homey) {
					homeys.push({
						id: id,
						name: homey.name,
						address: candidate,
						role: homey.role,
						token: homey.token,
						users: homey.users.length,
					});
				} else {
					homeys.push({
						id: id,
						address: candidate,
					});
				}
			}

			if( ++done == candidates.length ) {

				homeys.forEach(function(homey, i){

					if( log ) {
						console.log('-------------------------------------');
						for( let key in homey ) {
							console.log(` ${padRight(key, 15, ' ')}: ${homey[key]}`);
						}
						if( i == homeys.length-1 ) {
							console.log('-------------------------------------');
						}
					}
				})

				callback( null, homeys );
			}
		})

	})


}

function padRight(str, l, c) {
	return str+Array(l-str.length+1).join(c||" ")
}