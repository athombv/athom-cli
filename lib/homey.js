var os			= require('os');

var _			= require('underscore');
var inquirer	= require("inquirer");
var request		= require('request');

module.exports.select = function( save, callback ){
	
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
				// save
				global.settings.homey = activeHomey;
			
				// give feedback
				console.log("Saved active Homey: " + activeHomey.name );
			} else {
				if( typeof callback == 'function' ){
					callback(activeHomey);
				}
			}
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

module.exports.list = function(){
	
	console.log("");
	console.log("Your Homeys:");
	console.log("");
	
	global.lib.user.refresh(function(err){
		if( err ) return console.error(err);
		
		var homeys = global.settings.me.homeys;
	
		homeys.forEach(function(homey, i){
			
			var me = _.findWhere(homey.users, { user: global.settings.me._id });
			
			console.log('-------------------------------------');
			console.log(' name:      ' 	+ homey.name);
			console.log(' id:        '	+ homey._id);
			console.log(' lan ip:    ' 	+ homey.ipInternal);
			console.log(' wan ip:    ' 	+ homey.ipExternal);
			console.log(' my role:   ' 	+ homey.role);
			console.log(' my token:  ' 	+ homey.token); // TOFIX by joachim
			console.log(' # users:   ' 	+ homey.users.length);
			
			if( i == homeys.length-1 ) {
				console.log('-------------------------------------');
			}
		})
	
	})
}

module.exports.listLocal = function( callback ){
	
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
		
	// ping
	var done = 0;
	candidates.forEach(function(candidate){
				
		request({
			method	: 'GET',
			url		: 'http://' + candidate + '/api/manager/webserver/ping',
			json	: true
		}, function( err, result, body ){
			if( body && body.result == 'pong' ) {
				
				var id = result.headers['x-homey-id'];
				var token = false;
				
				// find token
				global.settings.me.homeys.forEach(function(homey){
					if( homey._id == id ) token = homey.token;
				})
				
				homeys.push({
					id		: id,
					address	: candidate,
					token	: token
				});
			}
			
			if( ++done == candidates.length ) {
	
				homeys.forEach(function(homey, i){
					
					var me = _.findWhere(homey.users, { user: global.settings.me._id });
					
					console.log('-------------------------------------');
					console.log(' id:        '	+ homey.id);
					console.log(' address:   ' 	+ homey.address);
					console.log(' token  :   ' 	+ homey.token);
					
					if( i == homeys.length-1 ) {
						console.log('-------------------------------------');
					}
				})
			}
		})
		
	})
	
	
}